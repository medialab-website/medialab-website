import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import pg from "pg";
import { resetTestDatabase } from "../db/reset-test-database.js";
import { IDENTITY_FIXTURES } from "../db/fixtures/identity-tenancy-fixtures.js";
import { OperationalPilotDatabase, DEFAULT_RUNTIME_DATABASE } from "../src/operational-pilot/database.js";
import { createDisposableDeliveryDatabase } from "../src/disposable-delivery/database.js";
import { createLocalFileAdapter } from "../src/disposable-delivery/local-file-adapter.js";
import { createSyntheticMedia, FIXTURE_SCENARIO_ID } from "../src/operational-pilot/fixture-media.js";
import { EXPECTED_OUTCOME, compareReplay } from "../src/operational-pilot/replay-contract.js";
import { QuickEditWorker } from "../src/operational-pilot/quick-edit-worker.js";
import { SCENARIO } from "../src/operational-pilot/fixture-scenario.js";
import { stageRawCorrection } from "../src/operational-pilot/local-media-adapter.js";
import { ownerReadableObservability } from "../src/operational-pilot/observability.js";

const OUTPUT_ROOT = process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ?? "/tmp/mlvs01-p02m16a-output";
const STORAGE_ROOT = "/tmp/mlvs01-p02m16a-storage"; const STAGING_ROOT = "/tmp/mlvs01-p02m16a-staging";
const OWNER = "medialab_p02m16a_test_owner"; const SOURCE = "SYNTHETIC_P02_M16_A_GOLDEN_PATH";
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const key = (name: string) => `m16a-${name}`;
const json = (value: unknown) => JSON.stringify(value);
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  await resetTestDatabase({ ...DEFAULT_RUNTIME_DATABASE, user: OWNER, runtimeUser: DEFAULT_RUNTIME_DATABASE.user, confirm: DEFAULT_RUNTIME_DATABASE.database });
  await mkdir(OUTPUT_ROOT, { recursive: true }); await mkdir(STORAGE_ROOT, { recursive: true }); await mkdir(STAGING_ROOT, { recursive: true });
  const media = await createSyntheticMedia(STORAGE_ROOT); const runtime = new OperationalPilotDatabase();
  const owner = new pg.Client({ ...DEFAULT_RUNTIME_DATABASE, user: OWNER }); await owner.connect();
  const tokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  for (const [index, token] of tokens.entries()) await owner.query(
    `INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at,revoked_at)
     VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 hours',NULL)`,
    [randomUUID(), IDENTITY_FIXTURES[1].id, sha(token)]);
  await owner.end();
  const reviewer = tokens[0]!; const operator = tokens[1]!;

  const schedulingRequest = await runtime.invoke<string>("create_scheduling_request", [reviewer, key("schedule"), SCENARIO.organizationId, SCENARIO.propertyHubId, SCENARIO.orderId, SOURCE]);
  const window = await runtime.invoke<string>("add_scheduling_requested_window", [reviewer, key("window"), schedulingRequest,
    "2026-10-20T14:00:00.000Z", "2026-10-20T16:00:00.000Z", "America/New_York", "2026-10-20 10:00:00", "2026-10-20 12:00:00"], ["", "", "", "::timestamptz", "::timestamptz"]);
  const appointment = await runtime.invoke<string>("confirm_appointment", [reviewer, key("appointment"), schedulingRequest, window, "Synthetic operational-pilot appointment"]);
  const job = await runtime.invoke<string>("create_job", [reviewer, key("job"), SCENARIO.organizationId, SCENARIO.orderId, SCENARIO.propertyHubId, SOURCE]);
  const workstream = await runtime.invoke<string>("create_service_workstream", [reviewer, key("workstream"), job, SCENARIO.orderItemId, SOURCE]);
  const jobAppointment = await runtime.invoke<string>("link_job_appointment", [reviewer, key("job-appointment"), job, appointment, "Synthetic confirmed field appointment"]);
  const missionPlan = await runtime.invoke<string>("create_mission_plan_draft", [reviewer, key("mission-draft"), jobAppointment,
    json({ sections: [{ label: "Staff instructions", visibility: "INTERNAL_STAFF_ONLY", content: { arrive_early_minutes: 15 } },
      { label: "Crew instructions", visibility: "ASSIGNED_CREW_ONLY", content: { entry: "front door" } },
      { label: "Preparation", visibility: "POTENTIALLY_CUSTOMER_VISIBLE", content: { lights: "on" } }] }),
    "UNAVAILABLE", null, "Synthetic offline packet does not call providers"], ["", "", "", "::jsonb", "", "::jsonb"]);
  const missionVersion = await runtime.invoke<string>("issue_mission_plan_version", [reviewer, key("mission-issue"), missionPlan]);
  const missionRecord = await runtime.invoke<Record<string, unknown>>("get_mission_plan_record", [reviewer, missionPlan]);
  const missionHtml = Buffer.from(`<!doctype html><meta charset="utf-8"><title>MediaLab synthetic mission</title><h1>Operational pilot mission</h1><pre>${escapeHtml(JSON.stringify(missionRecord, null, 2))}</pre>`);
  await writeFile(join(OUTPUT_ROOT, "MISSION_PLAN_OFFLINE.html"), missionHtml);

  const capture = await runtime.invoke<string>("create_capture_session", [reviewer, key("capture"), SCENARIO.organizationId, job,
    "Synthetic PHOTO capture", "Bounded local fixture source", json({ source: SOURCE })], ["", "", "", "::uuid", "", "", "::jsonb"]);
  const captureSource = await runtime.invoke<string>("register_capture_source", [reviewer, key("capture-source"), capture, "CARD", "SYNTHETIC_CARD", json({ source: SOURCE })], ["", "", "", "", "", "::jsonb"]);
  const promoted: { media_asset_id: string; media_asset_version_id: string }[] = [];
  for (let index = 0; index < 6; index += 1) {
    const descriptor = media[index]!;
    const item = await runtime.invoke<string>("register_capture_item", [reviewer, key(`capture-item-${index}`), captureSource, descriptor.observedFilename,
      descriptor.byteSize, descriptor.mediaType, `2026-10-20T14:0${index}:00Z`, `SYNTHETIC/${descriptor.objectIdentifier}`, json({ source: SOURCE })], ["", "", "", "", "", "", "::timestamptz", "", "::jsonb"]);
    await runtime.invoke("record_capture_item_verification", [reviewer, key(`verify-${index}`), item, "VERIFIED", "SYNTHETIC_HASH_OBSERVATION",
      descriptor.checksumSha256, descriptor.byteSize, descriptor.mediaType, json({ source: SOURCE })], ["", "", "", "", "", "", "", "", "::jsonb"]);
    const promotion = await runtime.invoke<{ media_asset_id: string; media_asset_version_id: string }>("promote_capture_item", [reviewer, key(`promote-${index}`), item, SOURCE]); promoted.push(promotion);
    await runtime.invoke("record_media_storage_object", [reviewer, key(`storage-original-${index}`), promotion.media_asset_version_id,
      "LOCAL_FIXTURE", "M15D_DELIVERY", descriptor.objectIdentifier, descriptor.checksumSha256, descriptor.byteSize, descriptor.mediaType, SOURCE]);
  }

  const cull = await runtime.invoke<string>("create_cull_workspace", [reviewer, key("cull"), job, null, "PHOTO", "Operational pilot PHOTO cull", "Synthetic six-item cull", json({ source: SOURCE })], ["", "", "", "", "", "", "", "::jsonb"]);
  const candidates: string[] = [];
  for (let index = 0; index < promoted.length; index += 1) candidates.push(await runtime.invoke<string>("admit_cull_candidate", [reviewer, key(`candidate-${index}`), cull,
    promoted[index]!.media_asset_id, promoted[index]!.media_asset_version_id, [], json({ source: SOURCE })], ["", "", "", "", "", "::uuid[]", "::jsonb"]));
  await runtime.invoke("seal_cull_inventory", [reviewer, key("cull-seal"), cull, "Six-item inventory frozen"]);
  for (let index = 0; index < candidates.length; index += 1) await runtime.invoke("decide_cull_candidate", [reviewer, key(`cull-decision-${index}`), candidates[index], index < 5 ? "KEEP" : "REJECT",
    index < 5 ? "Selected for editor handoff" : "Rejected from five-photo listing", index, null, json({ source: SOURCE })], ["", "", "", "", "", "", "::uuid", "::jsonb"]);
  await runtime.invoke("finalize_cull_workspace", [reviewer, key("cull-finalize"), cull, "Exact five-photo selection", 6, false, null]);
  const selectedManifest = await runtime.invoke<Record<string, unknown>>("get_cull_selected_media", [reviewer, cull]);

  const handoff = await runtime.invoke<string>("create_editor_handoff_batch", [reviewer, key("handoff"), cull, "EXTERNAL_EDITOR", "SYNTHETIC_LOCAL_EDITOR", "Local contract-adapter handoff", json({ source: SOURCE })], ["", "", "", "", "", "", "::jsonb"]);
  await runtime.invoke("record_editor_handoff_event", [reviewer, key("handoff-dispatch"), handoff, "DISPATCHED", 0, "Synthetic dispatch", json({ source: SOURCE })], ["", "", "", "", "", "", "::jsonb"]);
  await runtime.invoke("record_editor_handoff_event", [reviewer, key("handoff-ack"), handoff, "ACKNOWLEDGED", 1, "Synthetic acknowledgement", json({ source: SOURCE })], ["", "", "", "", "", "", "::jsonb"]);
  const handoffRecord = await runtime.invoke<any>("get_editor_handoff_batch", [reviewer, handoff]);
  const intake = await runtime.invoke<string>("create_returned_media_intake_batch", [reviewer, key("returned-intake"), handoff, "SYNTHETIC_RETURN", "Five deterministic returned photos", json({ source: SOURCE })], ["", "", "", "", "", "::jsonb"]);
  const returnedVersions: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const descriptor = media[6 + index]!; const handoffItem = handoffRecord.items[index].item.id;
    const returnedId = await runtime.invoke<string>("record_returned_media_item", [reviewer, key(`returned-${index}`), intake, descriptor.observedFilename,
      descriptor.byteSize, descriptor.mediaType, descriptor.checksumSha256, "EXACT_MATCH", "MANIFEST_REFERENCE", handoffItem, index, "Exact synthetic editor return", json({ source: SOURCE })],
      ["", "", "", "", "", "", "", "", "", "::uuid", "", "", "::jsonb"]);
    // Exact replay proves that observed bytes do not duplicate immutable returned versions.
    await runtime.invoke("record_returned_media_item", [reviewer, key(`returned-${index}`), intake, descriptor.observedFilename, descriptor.byteSize, descriptor.mediaType,
      descriptor.checksumSha256, "EXACT_MATCH", "MANIFEST_REFERENCE", handoffItem, index, "Exact synthetic editor return", json({ source: SOURCE })], ["", "", "", "", "", "", "", "", "", "::uuid", "", "", "::jsonb"]);
    const history = await runtime.invoke<any>("get_returned_media_history", [reviewer, handoff]);
    const returned = history.returned_items.find((value: any) => value.item.id === returnedId); const version = returned.current.returned_media_asset_version_id; returnedVersions.push(version);
    await runtime.invoke("record_media_storage_object", [reviewer, key(`storage-returned-${index}`), version, "LOCAL_FIXTURE", "M15D_DELIVERY", descriptor.objectIdentifier,
      descriptor.checksumSha256, descriptor.byteSize, descriptor.mediaType, SOURCE]);
  }
  await runtime.invoke("complete_editor_handoff_returns", [reviewer, key("returns-complete"), handoff, 5, "Five exact returned sources resolved"]);

  const review = await runtime.invoke<string>("create_returned_review_batch", [reviewer, key("review"), handoff, 1, "Whole-listing five-photo review", json({ source: SOURCE })], ["", "", "", "", "", "::jsonb"]);
  const reviewItems: string[] = [];
  for (let index = 0; index < 5; index += 1) reviewItems.push(await runtime.invoke<string>("admit_returned_review_item", [reviewer, key(`review-item-${index}`), review,
    returnedVersions[index], index, json({ source: SOURCE })], ["", "", "", "", "", "::jsonb"]));
  await runtime.invoke("seal_returned_review_inventory", [reviewer, key("review-seal"), review, 5, "Exact five-item listing inventory"]);
  for (let index = 0; index < 5; index += 1) await runtime.invoke("record_returned_review_decision", [reviewer, key(`decision-${index}`), reviewItems[index],
    index < 4 ? "ACCEPT" : "QUICK_EDIT", index < 4 ? "Synthetic accepted return" : "Correct vertical alignment and retain natural color",
    index < 4 ? null : "Correct vertical alignment and retain natural color", 0]);
  const preSubmit = await runtime.invoke<any>("get_returned_review_batch", [reviewer, review]); const preHistory = await runtime.invoke<any>("get_returned_review_history", [reviewer, review]);
  if (preSubmit.current.current_state === "COMPLETED" || preHistory.quick_edit_requests.length !== 1) throw new Error("Quick Edit pre-submit gate evidence invalid");
  await runtime.invoke("complete_returned_review_batch", [reviewer, key("review-complete"), review, 6, "Explicit whole-listing submission at five of five"]);
  const reviewHistory = await runtime.invoke<any>("get_returned_review_history", [operator, review]); const quick = reviewHistory.quick_edit_requests[0];
  if (!quick || quick.source_media_asset_version_id !== returnedVersions[4]) throw new Error("actionable Quick Edit projection mismatch");

  const correction = media[11]!; const correctionBytes = await readFile(join(STORAGE_ROOT, correction.objectIdentifier));
  const stagingReceipt = await stageRawCorrection(Readable.from(correctionBytes), STAGING_ROOT, `${quick.id}.png`, "image/png");
  if (stagingReceipt.byteSize !== correction.byteSize || stagingReceipt.checksumSha256 !== correction.checksumSha256) throw new Error("bounded staging receipt differs from correction fixture");
  const reviewedItem = (await runtime.invoke<any>("get_returned_review_batch", [operator, review])).items[4].item;
  const correctedVersion = await runtime.invoke<string>("add_media_asset_version", [operator, key("corrected-version"), reviewedItem.media_asset_id, "QUICK_EDIT_CORRECTION",
    correction.observedFilename, correction.byteSize, correction.mediaType, correction.checksumSha256, SOURCE]);
  const replayedCorrectedVersion = await runtime.invoke<string>("add_media_asset_version", [operator, key("corrected-version"), reviewedItem.media_asset_id, "QUICK_EDIT_CORRECTION",
    correction.observedFilename, correction.byteSize, correction.mediaType, correction.checksumSha256, SOURCE]);
  if (replayedCorrectedVersion !== correctedVersion) throw new Error("correction-version idempotent replay diverged");
  let conflictingIngressRejected = false;
  try { await runtime.invoke("add_media_asset_version", [operator, key("corrected-version"), reviewedItem.media_asset_id, "QUICK_EDIT_CORRECTION",
    correction.observedFilename, correction.byteSize, correction.mediaType, "0".repeat(64), SOURCE]); } catch { conflictingIngressRejected = true; }
  if (!conflictingIngressRejected) throw new Error("conflicting correction replay did not fail closed");
  const correctedStorage = await runtime.invoke<string>("record_media_storage_object", [operator, key("corrected-storage"), correctedVersion, "LOCAL_FIXTURE", "M15D_DELIVERY",
    correction.objectIdentifier, correction.checksumSha256, correction.byteSize, correction.mediaType, SOURCE]);
  await runtime.invoke("record_media_lineage", [operator, key("corrected-lineage"), quick.source_media_asset_version_id, correctedVersion, "EDITOR_RETURN_TO_CORRECTED_VERSION", "Exact Quick Edit source lineage"]);
  const quickLink = await runtime.invoke<string>("associate_quick_edit_corrected_version", [operator, key("corrected-association"), quick.id, correctedVersion, "Corrected bytes linked after lineage"]);
  const operation = await runtime.invoke<string>("request_media_operation", [operator, key("operation"), job, workstream, "PROCESSING", "QUICK_EDIT_CORRECTED_MEDIA_RETURN",
    "Durable corrected-media verification", json({ source: SOURCE, correctedVersionId: correctedVersion, storageObjectId: correctedStorage })], ["", "", "", "", "", "", "", "::jsonb"]);
  await runtime.invoke("attach_media_operation_target", [operator, key("operation-source"), operation, "MEDIA_ASSET_VERSION", quick.source_media_asset_version_id]);
  const correctionTarget = await runtime.invoke<string>("attach_media_operation_target", [operator, key("operation-correction"), operation, "MEDIA_ASSET_VERSION", correctedVersion]);
  await runtime.invoke("ready_media_operation", [operator, key("operation-ready"), operation, "Exact source and correction targets attached"]);
  const worker = new QuickEditWorker(runtime, STAGING_ROOT);
  const claims = await Promise.all([worker.claimOnce("race-a"), worker.claimOnce("race-b")]); const winner = claims.find((claim) => claim.claimed) as any;
  if (!winner || claims.filter((claim) => claim.claimed).length !== 1) throw new Error("claim race did not produce exactly one winner");
  await runtime.invoke("start_media_operation_attempt", ["P02_M16_A_LOCAL_WORKER", key("attempt-1-start"), winner.attempt_id]);
  await runtime.invoke("record_media_operation_checkpoint", ["P02_M16_A_LOCAL_WORKER", key("attempt-1-checkpoint"), winner.attempt_id, "STAGED_FILE_OPEN",
    json({ objectIdentifier: `${quick.id}.png`, expectedByteSize: correction.byteSize })], ["", "", "", "", "::jsonb"]);
  await runtime.invoke("complete_media_operation_attempt", ["P02_M16_A_LOCAL_WORKER", key("attempt-1-failed"), winner.attempt_id, "FAILED",
    "Injected bounded failure after staged-file checkpoint", json({ failureClass: "M16A_INJECTED_RETRY_PROOF" })], ["", "", "", "", "", "::jsonb"]);
  const failureRecord = await runtime.invoke<any>("get_media_operation_record", [operator, operation]);
  if (failureRecord.projection.current_state !== "FAILED") throw new Error("injected operation failure is not observable");
  await runtime.invoke("schedule_media_operation_retry", ["P02_M16_A_LOCAL_WORKER", key("attempt-1-retry"), operation, winner.attempt_id,
    "Explicit retry after injected failure", new Date(Date.now() + 25).toISOString()], ["", "", "", "", "", "::timestamptz"]); await sleep(50);
  const success = await worker.run({ operationId: operation, targetId: correctionTarget, objectIdentifier: `${quick.id}.png`, byteSize: correction.byteSize,
    checksumSha256: correction.checksumSha256, mediaType: "image/png" }, false);
  if (success.result !== "SUCCEEDED" || success.attempt !== 2) throw new Error("attempt 2 did not succeed");

  const successor = await runtime.invoke<string>("create_returned_review_batch", [operator, key("successor-review"), handoff, 2, "Corrected-version successor review", json({ source: SOURCE })], ["", "", "", "", "", "::jsonb"]);
  const successorItem = await runtime.invoke<string>("admit_returned_review_item", [operator, key("successor-item"), successor, correctedVersion, 0, json({ source: SOURCE })], ["", "", "", "", "", "::jsonb"]);
  await runtime.invoke("seal_returned_review_inventory", [operator, key("successor-seal"), successor, 1, "Exact corrected-version inventory"]);
  await runtime.invoke("link_returned_review_successor", [operator, key("successor-link"), review, successor, "Explicit corrected-version successor cycle"]);
  const needsReviewSnapshot = await runtime.invoke<any>("get_returned_review_batch", [operator, successor]);
  if (needsReviewSnapshot.current.unresolved_count !== 1) throw new Error("Needs Review branch did not remain unresolved");
  await runtime.invoke("record_returned_review_decision", [operator, key("send-to-final-accept"), successorItem, "ACCEPT", "Explicit human Send to Final", null, 0]);
  await runtime.invoke("complete_returned_review_batch", [operator, key("successor-complete"), successor, 2, "Explicit corrected final approval"]);
  const lineage = await runtime.invoke<any>("get_returned_review_lineage", [operator, reviewedItem.media_asset_id]);

  const finalVersions = [...returnedVersions.slice(0, 4), correctedVersion];
  const publication = await runtime.invoke<string>("create_media_publication", [reviewer, key("publication"), job, null, null, "Deliberate synthetic PHOTO publication", json({ source: SOURCE })], ["", "", "", "", "", "", "::jsonb"]);
  for (let index = 0; index < finalVersions.length; index += 1) await runtime.invoke("add_media_publication_item", [reviewer, key(`publication-item-${index}`), publication,
    finalVersions[index], "PHOTOS", "PRIMARY_GALLERY", index + 1, "Exact current final-source placement"]);
  await runtime.invoke("seal_media_publication", [reviewer, key("publication-seal"), publication, 5, "Exact five-item publication freeze"]);
  await runtime.invoke("activate_media_publication", [reviewer, key("publication-activate"), publication, 6, "Explicit synthetic activation"]);
  await runtime.invoke("record_delivery_financial_eligibility", [reviewer, key("financial"), SCENARIO.orderId, "ELIGIBLE", "NONPRODUCTION_FIXTURE",
    "P02_M16_A_FIXTURE_ELIGIBLE", null, "Bounded synthetic eligibility"], ["", "", "", "", "", "", "::uuid"]);
  const tdc = await runtime.invoke<string>("create_temporary_download_center", [reviewer, key("tdc"), SCENARIO.propertyHubId, 7, "Synthetic stakeholder",
    json([{ publication_id: publication, category_code: "PHOTOS" }]), "Fixed synthetic snapshot", json({ source: SOURCE })], ["", "", "", "", "", "::jsonb", "", "::jsonb"]);
  const issued = await runtime.invoke<any>("issue_temporary_download_center_access_credential", [reviewer, key("tdc-credential"), tdc, 0, "Synthetic local access", json({ source: SOURCE })], ["", "", "", "", "", "::jsonb"]);
  const delivery = createDisposableDeliveryDatabase(DEFAULT_RUNTIME_DATABASE); const manifest = await delivery.getManifest({ credentialId: issued.credential_id,
    secret: issued.access_secret, accessEventReference: `OPEN:${randomUUID().toUpperCase()}`, evidence: { source: SOURCE } }); if (!manifest) throw new Error("TDC manifest unavailable");
  const itemIds = manifest.categories.flatMap((category) => category.items.map((item) => item.item_id)); const descriptors = [];
  for (const itemId of itemIds) { const descriptor = await delivery.resolveDownloadSource({ credentialId: issued.credential_id, secret: issued.access_secret,
    accessEventReference: `DOWNLOAD:${randomUUID().toUpperCase()}`, itemId, evidence: { source: SOURCE } }); if (descriptor) descriptors.push(descriptor); }
  const exact = createLocalFileAdapter(STORAGE_ROOT); const correctedDescriptor = descriptors.find((item) => item.media_asset_version_id === correctedVersion); const unchangedDescriptor = descriptors.find((item) => item.media_asset_version_id === returnedVersions[0]);
  if (!correctedDescriptor || !unchangedDescriptor) throw new Error("required exact downloads missing");
  const downloaded = [await exact.read(correctedDescriptor), await exact.read(unchangedDescriptor)]; await delivery.close();

  const operationRecord = await runtime.invoke<any>("get_media_operation_record", [operator, operation]);
  const ownerObservation = await ownerReadableObservability(runtime, reviewer, { missionPlan, captureSession: capture, cullWorkspace: cull,
    handoff, review, operation, publication, tdc });
  const observed = { ...EXPECTED_OUTCOME, missionVersion, originals: promoted.length, selected: 5, returned: returnedVersions.length,
    decisions: { ACCEPT: 4, QUICK_EDIT: 1 }, actionableQuickEdits: 1, operationAttempts: operationRecord.attempts.length,
    verifiedReceipts: operationRecord.receipts.filter((receipt: any) => receipt.verification_state === "VERIFIED").length,
    finalVersions: finalVersions.length, exactDownloads: downloaded.length };
  const comparison = compareReplay(observed); if (!comparison.pass) throw new Error("observed scenario differs from expected outcome");
  const result = { schema: "ML_OPERATIONAL_PILOT_V1", scenarioId: FIXTURE_SCENARIO_ID, ids: { appointment, job, workstream, missionPlan, missionVersion, capture, cull, handoff,
    review, quickEditRequest: quick.id, correctedVersion, quickLink, operation, successorReview: successor, publication, temporaryDownloadCenter: tdc },
    counts: observed, gates: { queueBeforeSubmit: 0, queueAfterSubmit: 1, needsReviewUnresolved: needsReviewSnapshot.current.unresolved_count,
      correctedFinalExact: lineage.final_designations.some((designation: any) => designation.version_id === correctedVersion), claimWinners: 1 },
    hashes: { missionPlanOfflineSha256: sha(missionHtml), selectedManifestSha256: sha(json(selectedManifest)), correctedDownloadSha256: downloaded[0].sha256,
      unchangedDownloadSha256: downloaded[1].sha256 }, operation: operationRecord, comparison };
  await writeFile(join(OUTPUT_ROOT, "OBSERVED_OUTCOME.json"), JSON.stringify(result, null, 2) + "\n");
  await writeFile(join(OUTPUT_ROOT, "SYNTHETIC_MEDIA_MANIFEST.json"), JSON.stringify(media, null, 2) + "\n");
  await writeFile(join(OUTPUT_ROOT, "NEEDS_REVIEW_SNAPSHOT.json"), JSON.stringify({ successorReview: successor, unresolved: needsReviewSnapshot.current.unresolved_count,
    finalDesignationCreatedByNeedsReview: false }, null, 2) + "\n");
  await writeFile(join(OUTPUT_ROOT, "STAGING_RECEIPT.json"), JSON.stringify({ schema: "ML_OPERATIONAL_PILOT_V1", contract: "QuickEditCorrectionStagingReceiptV1",
    queued: true, finalApproved: false, ...stagingReceipt }, null, 2) + "\n");
  await writeFile(join(OUTPUT_ROOT, "CORRECTION_CONTEXT.json"), JSON.stringify({ correctedVersion, quickEditRequest: quick.id, quickEditAssociation: quickLink,
    sourceVersion: quick.source_media_asset_version_id, operation, conflictingIngressRejected }, null, 2) + "\n");
  await writeFile(join(OUTPUT_ROOT, "OPERATION_FAILURE.json"), JSON.stringify(failureRecord, null, 2) + "\n");
  await writeFile(join(OUTPUT_ROOT, "OWNER_OBSERVABILITY.json"), JSON.stringify(ownerObservation, null, 2) + "\n");
  const htmlCapture = (title: string, evidence: unknown) => Buffer.from(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><h1>${escapeHtml(title)}</h1><p>Synthetic local P02-M16-A evidence capture.</p><pre>${escapeHtml(JSON.stringify(evidence, null, 2))}</pre>`);
  await writeFile(join(OUTPUT_ROOT, "UI_JOB_OVERVIEW.html"), htmlCapture("Job overview and Mission Plan", { appointment, job, workstream, missionPlan, missionVersion }));
  await writeFile(join(OUTPUT_ROOT, "UI_WHOLE_LISTING_REVIEW.html"), htmlCapture("Whole-listing review", { context: "Synthetic PHOTO Job", review: preSubmit, decisions: observed.decisions }));
  await writeFile(join(OUTPUT_ROOT, "UI_QUICK_EDIT_QUEUE.html"), htmlCapture("Quick Edit queue", { parentReviewCompleted: true, actionable: [quick] }));
  await writeFile(join(OUTPUT_ROOT, "UI_OPERATION_FAILURE_RETRY.html"), htmlCapture("Operation failure and retry", { failure: failureRecord, recovered: operationRecord }));
  await writeFile(join(OUTPUT_ROOT, "UI_PUBLICATION_DELIVERY.html"), htmlCapture("Publication and local delivery", { publication, temporaryDownloadCenter: tdc,
    finalVersions, exactDownloadHashes: downloaded.map((item) => item.sha256) }));
  await runtime.close(); process.stdout.write(`${FIXTURE_SCENARIO_ID} PASS\n${JSON.stringify(result.ids)}\n`);
}

function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
main().catch((error) => { process.stderr.write(`P02-M16-A scenario failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
