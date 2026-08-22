import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import pg from "pg";
import {
  MEDIA_CULL_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/media-cull-workspace-selected-media-fixtures.js";
import {
  MEDIA_EDITOR_HANDOFF_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/editor-handoff-returned-media-fixtures.js";
import {
  commercialFingerprint,
  OPERATIONS_CONSOLE_DATABASE,
  OperationsConsoleDatabase,
  resolveCatalogSelections,
  sha256Evidence,
  type CreateListingTransactionCommand,
} from "../src/operations-console/database.js";
import { ReviewMediaStore, type ReviewMediaUploadResult } from "../src/operations-console/review-media-store.js";
import { startOperationsConsole } from "../src/operations-console/server.js";
import { OperationsConsoleService } from "../src/operations-console/service.js";
import { DevelopmentOperatorSessionManager } from "../src/operations-console/session.js";
import {
  issueOperationsConsoleDatabaseSession,
  resetAndSeedOperationsConsoleDatabase,
} from "./run-internal-operations-console-new-listing.js";

export const OWNER_PREVIEW_ROOT = "/tmp/mlvs01-p02m22a-owner-preview";
export const OWNER_PREVIEW_MEDIA_ROOT = resolve(OWNER_PREVIEW_ROOT, "ReviewMediaStore");
export const OWNER_PREVIEW_MANIFEST_PATH = resolve(OWNER_PREVIEW_ROOT, "OWNER_PREVIEW.json");
export const OWNER_PREVIEW_URL = "http://127.0.0.1:4317/operations";

const OWNER_ROLE = "medialab_p02m17a_test_owner";
const SOURCE = "SYNTHETIC_P02_M22_A_OWNER_PREVIEW";
const STORAGE_NAMESPACE = "M22A_OWNER_PREVIEW_REVIEW_MEDIA";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ScenarioMediaEvidence {
  storageObjectId: string;
  verificationEventId: string;
  versionId: string;
  objectIdentifier: string;
  checksumSha256: string;
  byteSize: number;
  mediaType: "image/png";
  filename: string;
}

interface ReturnedPhotoEvidenceSetup {
  returnedVersionId: string;
  storageObjectId: string;
  verificationEventId: string;
}

interface SyntheticReviewScenario {
  kind: "ACTIVE_SEALED_REVIEW" | "COMPLETED_QUICK_EDIT_ROUTE";
  orderId: string;
  jobId: string;
  workstreamId: string;
  handoffBatchId: string;
  reviewBatchId: string;
  reviewItemId: string;
  quickEditRequestId: string | null;
  media: ScenarioMediaEvidence;
  deepLink: string;
}

interface OwnerPreviewManifest {
  schema: "P02_M22_A_SYNTHETIC_OWNER_PREVIEW_V1";
  generatedAt: string;
  boundary: {
    classification: "NONPRODUCTION_SYNTHETIC_ONLY";
    host: "127.0.0.1";
    port: 4317;
    database: string;
    runtimeRole: string;
    reviewMediaRoot: string;
    externalNetworkUsed: false;
    providerMediaUsed: false;
  };
  scenarios: [SyntheticReviewScenario, SyntheticReviewScenario];
}

type RuntimeQuery = Pick<pg.Pool, "query">;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: "IHDR" | "IDAT" | "IEND", data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

/** A complete deterministic 1x1 RGBA PNG used only by the local owner-preview harness. */
export function syntheticPixelPng(red: number, green: number, blue: number): Buffer {
  for (const channel of [red, green, blue]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new TypeError("Synthetic PNG channels must be integers from 0 through 255.");
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const scanline = Buffer.from([0, red, green, blue, 255]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanline)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Deterministic room-like visual evidence with no source or customer media bytes. */
export function syntheticRoomPng(seed: number): Buffer {
  if (!Number.isInteger(seed) || seed < 0 || seed > 255) {
    throw new TypeError("Synthetic room seed must be an integer from 0 through 255.");
  }
  const width = 960;
  const height = 640;
  const stride = 1 + width * 4;
  const pixels = Buffer.alloc(stride * height);
  const setPixel = (x: number, y: number, red: number, green: number, blue: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = y * stride + 1 + x * 4;
    pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue; pixels[offset + 3] = 255;
  };
  const fill = (left: number, top: number, right: number, bottom: number, color: [number, number, number]) => {
    for (let y = Math.max(0, top); y < Math.min(height, bottom); y += 1) {
      for (let x = Math.max(0, left); x < Math.min(width, right); x += 1) setPixel(x, y, ...color);
    }
  };
  const horizon = 430;
  for (let y = 0; y < height; y += 1) {
    pixels[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      if (y < horizon) {
        const shade = Math.floor((x / width) * 18 + (y / horizon) * 10);
        setPixel(x, y, 190 + seed % 18 + shade, 193 + (seed * 3) % 12 + shade,
          196 + (seed * 5) % 10 + shade);
      } else {
        const depth = Math.floor(((y - horizon) / (height - horizon)) * 45);
        const board = Math.floor((x + (y - horizon) * .7) / 52) % 2 ? 9 : 0;
        setPixel(x, y, 92 + seed % 24 + depth + board, 50 + (seed * 2) % 18 + Math.floor(depth / 2),
          30 + (seed * 3) % 12 + Math.floor(depth / 4));
      }
    }
  }
  fill(0, 0, width, 24, [235, 235, 232]);
  fill(0, horizon - 12, width, horizon + 5, [225, 224, 220]);
  for (let y = horizon; y < height; y += 28) fill(0, y, width, y + 2, [74, 43, 28]);
  const windowLeft = seed % 2 ? 650 : 95;
  fill(windowLeft - 18, 86, windowLeft + 218, 344, [236, 236, 232]);
  fill(windowLeft, 104, windowLeft + 200, 326, [145, 188, 210]);
  fill(windowLeft + 8, 210, windowLeft + 192, 318, [91, 142, 86]);
  fill(windowLeft + 96, 104, windowLeft + 104, 326, [235, 235, 230]);
  fill(windowLeft, 210, windowLeft + 200, 218, [235, 235, 230]);
  const doorLeft = seed % 2 ? 110 : 715;
  fill(doorLeft, 124, doorLeft + 148, horizon, [223, 221, 214]);
  fill(doorLeft + 12, 142, doorLeft + 136, horizon, [208, 207, 201]);
  fill(doorLeft + 118, 275, doorLeft + 128, 285, [83, 66, 48]);
  const sofaLeft = 315 + (seed % 5) * 18;
  fill(sofaLeft, 345, sofaLeft + 310, 454, [91 + seed % 30, 96 + seed % 20, 100 + seed % 18]);
  fill(sofaLeft - 24, 372, sofaLeft + 20, 470, [76, 80, 84]);
  fill(sofaLeft + 290, 372, sofaLeft + 334, 470, [76, 80, 84]);
  fill(sofaLeft + 36, 326, sofaLeft + 120, 390, [205, 184, 142]);
  fill(sofaLeft + 182, 326, sofaLeft + 266, 390, [168, 188, 181]);
  const artLeft = 380 + (seed % 3) * 40;
  fill(artLeft, 95, artLeft + 145, 212, [75, 62, 50]);
  fill(artLeft + 8, 103, artLeft + 137, 204, [222, 214 - seed % 20, 184 + seed % 24]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ownerClient(): pg.Client {
  return new pg.Client({
    ...OPERATIONS_CONSOLE_DATABASE,
    user: OWNER_ROLE,
    application_name: "p02-m22-a-synthetic-owner-preview-setup",
  });
}

async function installOwnerPreviewSetupPermissions(client: pg.Client): Promise<void> {
  const bindings = [
    MEDIA_CULL_PERMISSION_SET_PERMISSION_FIXTURES[0],
    MEDIA_EDITOR_HANDOFF_PERMISSION_SET_PERMISSION_FIXTURES[0],
  ];
  await client.query("BEGIN");
  try {
    for (const binding of bindings) {
      await client.query(
        `INSERT INTO medialab_core.permission_set_permissions(permission_set_id,permission_id,created_at)
         VALUES($1,$2,$3) ON CONFLICT (permission_set_id,permission_id) DO NOTHING`,
        [binding.permission_set_id, binding.permission_id, binding.created_at],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function idempotency(label: string): string {
  return `m22a-${label}-${randomUUID()}`;
}

async function createSyntheticListing(
  database: OperationsConsoleDatabase,
  databaseSessionToken: string,
  label: "active-review" | "quick-edit",
): Promise<string> {
  const selections = [{ productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 1 }];
  const property: CreateListingTransactionCommand["property"] = {
    addressLine1: label === "active-review" ? "22 Active Review Way" : "24 Quick Edit Court",
    addressLine2: null,
    locality: "Synthetic Falls",
    administrativeArea: "NY",
    postalCode: label === "active-review" ? "10022" : "10024",
    countryCode: "US",
    squareFeet: 1800,
  };
  const customer: CreateListingTransactionCommand["customer"] = {
    displayName: label === "active-review" ? "Synthetic Active Review" : "Synthetic Quick Edit",
    email: `${label}@fixture.medialab.invalid`,
  };
  const catalog = await database.getCatalog(databaseSessionToken);
  const lines = resolveCatalogSelections(catalog, selections, property.squareFeet);
  const command: CreateListingTransactionCommand = {
    databaseSessionToken,
    submissionId: `m22a-owner-preview-${label}`,
    requestFingerprint: sha256Evidence({ source: SOURCE, label, customer, property, selections }),
    expectedCommercialFingerprint: commercialFingerprint(lines),
    customer,
    property,
    selections,
  };
  return (await database.createListing(command)).orderId;
}

async function scalarUuid(query: RuntimeQuery, sql: string, values: unknown[], column: string): Promise<string> {
  const result = await query.query<Record<string, string>>(sql, values);
  const value = result.rows[0]?.[column];
  if (typeof value !== "string") throw new Error(`M22A_OWNER_PREVIEW_MISSING_${column.toUpperCase()}`);
  return value;
}

async function createReturnedPhoto(
  database: OperationsConsoleDatabase,
  databaseSessionToken: string,
  orderId: string,
  uploads: ReviewMediaUploadResult[],
  label: "active-review" | "quick-edit",
): Promise<{
  jobId: string;
  workstreamId: string;
  handoffBatchId: string;
  photos: ReturnedPhotoEvidenceSetup[];
}> {
  if (uploads.length < 1) throw new Error("M22A_OWNER_PREVIEW_REQUIRES_RETURNED_PHOTOS");
  const context = await database.initializeOperations(databaseSessionToken, orderId);
  const jobId = context.job?.jobId;
  const workstreamId = context.job?.workstreams[0]?.workstreamId;
  if (!jobId || !workstreamId) throw new Error("M22A_OWNER_PREVIEW_JOB_SETUP_FAILURE");
  const query = database.pool;
  const evidence = JSON.stringify({ source: SOURCE, synthetic: true, scenario: label });
  const cullWorkspaceId = await scalarUuid(query,
    "SELECT medialab_core.create_cull_workspace($1,$2,$3::uuid,$4::uuid,'PHOTO',$5,$6,$7::jsonb)",
    [databaseSessionToken, idempotency(`${label}-cull`), jobId, workstreamId,
      "Synthetic owner-preview photo cull", "Synthetic owner-preview selected-photo evidence", evidence],
    "create_cull_workspace");
  const candidates: string[] = [];
  for (const [index] of uploads.entries()) {
    const assetId = await scalarUuid(query,
      "SELECT medialab_core.create_media_asset($1,$2,$3::uuid,$4::uuid,$5::jsonb)",
      [databaseSessionToken, idempotency(`${label}-asset-${index}`), jobId, workstreamId, evidence],
      "create_media_asset");
    const originalChecksum = createHash("sha256").update(`${SOURCE}:${label}:original:${index}`).digest("hex");
    const originalVersionId = await scalarUuid(query,
      "SELECT medialab_core.add_media_asset_version($1,$2,$3::uuid,'ORIGINAL',$4,$5,$6,$7,$8)",
      [databaseSessionToken, idempotency(`${label}-original-${index}`), assetId,
        `${label}-source-${String(index + 1).padStart(2, "0")}.dng`, 2048 + index,
        "image/dng", originalChecksum, SOURCE],
      "add_media_asset_version");
    candidates.push(await scalarUuid(query,
      "SELECT medialab_core.admit_cull_candidate($1,$2,$3::uuid,$4::uuid,$5::uuid,'{}'::uuid[],$6::jsonb)",
      [databaseSessionToken, idempotency(`${label}-candidate-${index}`), cullWorkspaceId, assetId,
        originalVersionId, evidence],
      "admit_cull_candidate"));
  }
  await query.query("SELECT medialab_core.seal_cull_inventory($1,$2,$3::uuid,$4)",
    [databaseSessionToken, idempotency(`${label}-seal-cull`), cullWorkspaceId,
      "Synthetic owner-preview cull inventory sealed"]);
  for (const [index, candidateId] of candidates.entries()) {
    await query.query(
      "SELECT medialab_core.decide_cull_candidate($1,$2,$3::uuid,'KEEP',$4,$5,NULL::uuid,$6::jsonb)",
      [databaseSessionToken, idempotency(`${label}-keep-${index}`), candidateId,
        "Synthetic owner-preview photo selected for editor handoff", index, evidence],
    );
  }
  await query.query(
    "SELECT medialab_core.finalize_cull_workspace($1,$2,$3::uuid,$4,$5::bigint,false,NULL::text)",
    [databaseSessionToken, idempotency(`${label}-complete-cull`), cullWorkspaceId,
      "Synthetic owner-preview cull completed", uploads.length],
  );

  const handoffBatchId = await scalarUuid(query,
    "SELECT medialab_core.create_editor_handoff_batch($1,$2,$3::uuid,'EXTERNAL_EDITOR',$4,$5,$6::jsonb)",
    [databaseSessionToken, idempotency(`${label}-handoff`), cullWorkspaceId,
      "SYNTHETIC_OWNER_PREVIEW_EDITOR", "Synthetic owner-preview editor handoff", evidence],
    "create_editor_handoff_batch");
  await query.query(
    "SELECT medialab_core.record_editor_handoff_event($1,$2,$3::uuid,'DISPATCHED',0,$4,$5::jsonb)",
    [databaseSessionToken, idempotency(`${label}-dispatch`), handoffBatchId,
      "Synthetic owner-preview handoff dispatched", evidence],
  );
  await query.query(
    "SELECT medialab_core.record_editor_handoff_event($1,$2,$3::uuid,'ACKNOWLEDGED',1,$4,$5::jsonb)",
    [databaseSessionToken, idempotency(`${label}-acknowledge`), handoffBatchId,
      "Synthetic owner-preview handoff acknowledged", evidence],
  );
  const intakeBatchId = await scalarUuid(query,
    "SELECT medialab_core.create_returned_media_intake_batch($1,$2,$3::uuid,$4,$5,$6::jsonb)",
    [databaseSessionToken, idempotency(`${label}-intake`), handoffBatchId,
      `SYNTHETIC_RETURN_${label.toUpperCase().replaceAll("-", "_")}`,
      "Synthetic owner-preview returned-media intake", evidence],
    "create_returned_media_intake_batch");
  const handoffProjection = await query.query<{
    value: { items: Array<{ item: { id: string } }> };
  }>("SELECT medialab_core.get_editor_handoff_batch($1,$2::uuid) value", [databaseSessionToken, handoffBatchId]);
  const handoffItems = handoffProjection.rows[0]?.value.items ?? [];
  if (handoffItems.length !== uploads.length) throw new Error("M22A_OWNER_PREVIEW_HANDOFF_ITEM_FAILURE");
  const returnedItemIds: string[] = [];
  for (const [index, uploaded] of uploads.entries()) {
    const handoffItemId = handoffItems[index]?.item.id;
    if (!handoffItemId) throw new Error("M22A_OWNER_PREVIEW_HANDOFF_ITEM_FAILURE");
    returnedItemIds.push(await scalarUuid(query,
      `SELECT medialab_core.record_returned_media_item(
         $1,$2,$3::uuid,$4,$5,'image/png',$6,'EXACT_MATCH','MANIFEST_REFERENCE',$7::uuid,$8,$9,$10::jsonb
       )`,
      [databaseSessionToken, idempotency(`${label}-returned-${index}`), intakeBatchId, uploaded.filename,
        uploaded.byteSize, uploaded.sha256, handoffItemId, index,
        "Synthetic owner-preview exact returned-photo match", evidence],
      "record_returned_media_item"));
  }
  const returnedHistory = await query.query<{
    value: { returned_items: Array<{
      item: { id: string };
      current: { returned_media_asset_version_id: string | null };
    }> };
  }>("SELECT medialab_core.get_returned_media_history($1,$2::uuid) value", [databaseSessionToken, handoffBatchId]);
  const photos: ReturnedPhotoEvidenceSetup[] = [];
  for (const [index, returnedItemId] of returnedItemIds.entries()) {
    const uploaded = uploads[index]!;
    const returnedVersionId = returnedHistory.rows[0]?.value.returned_items
      .find((item) => item.item.id === returnedItemId)?.current.returned_media_asset_version_id;
    if (!returnedVersionId) throw new Error("M22A_OWNER_PREVIEW_RETURNED_VERSION_FAILURE");
    const storageObjectId = await scalarUuid(query,
      `SELECT medialab_core.record_media_storage_object(
         $1,$2,$3::uuid,'LOCAL_FIXTURE',$4,$5,$6,$7,'image/png',$8
       )`,
      [databaseSessionToken, idempotency(`${label}-storage-${index}`), returnedVersionId, STORAGE_NAMESPACE,
        uploaded.objectIdentifier, uploaded.sha256, uploaded.byteSize, SOURCE],
      "record_media_storage_object");
    const verificationEventId = await scalarUuid(query,
      `SELECT medialab_core.record_media_verification_event(
         $1,$2,$3::uuid,'SERVER_STREAM_SHA256','VERIFIED',$4,$5::jsonb
       )`,
      [databaseSessionToken, idempotency(`${label}-verified-${index}`), returnedVersionId, uploaded.sha256,
        JSON.stringify({ source: SOURCE, synthetic: true, scenario: label, result: "EXACT_MATCH", index })],
      "record_media_verification_event");
    photos.push({ returnedVersionId, storageObjectId, verificationEventId });
  }
  await query.query(
    "SELECT medialab_core.complete_editor_handoff_returns($1,$2,$3::uuid,$4,$5)",
    [databaseSessionToken, idempotency(`${label}-complete-returns`), handoffBatchId,
      uploads.length, "Synthetic owner-preview returned inventory completed"],
  );
  return { jobId, workstreamId, handoffBatchId, photos };
}

async function verifyExactMediaEvidence(
  client: pg.Client,
  expected: ScenarioMediaEvidence,
): Promise<void> {
  const result = await client.query<{
    observed_filename: string;
    byte_size: string;
    media_type: string;
    checksum_sha256: string;
    storage_count: number;
    storage_object_id: string;
    provider: string;
    storage_namespace: string;
    provider_object_identifier: string;
    verification_count: number;
    verification_event_id: string;
    verification_state: string;
    observed_checksum_sha256: string;
  }>(
    `SELECT v.observed_filename,v.byte_size,v.media_type,v.checksum_sha256,
       (SELECT count(*)::int FROM medialab_core.media_storage_objects s WHERE s.version_id=v.id) storage_count,
       s.id storage_object_id,s.provider,s.storage_namespace,s.provider_object_identifier,
       (SELECT count(*)::int FROM medialab_core.media_verification_events e
         WHERE e.version_id=v.id AND e.verification_state='VERIFIED') verification_count,
       e.id verification_event_id,e.verification_state,e.observed_checksum_sha256
     FROM medialab_core.media_asset_versions v
     JOIN medialab_core.media_storage_objects s ON s.version_id=v.id
     JOIN medialab_core.media_verification_events e ON e.version_id=v.id AND e.verification_state='VERIFIED'
     WHERE v.id=$1`,
    [expected.versionId],
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row || row.observed_filename !== expected.filename ||
      Number(row.byte_size) !== expected.byteSize || row.media_type !== expected.mediaType ||
      row.checksum_sha256 !== expected.checksumSha256 || row.storage_count !== 1 ||
      row.storage_object_id !== expected.storageObjectId || row.provider !== "LOCAL_FIXTURE" ||
      row.storage_namespace !== STORAGE_NAMESPACE || row.provider_object_identifier !== expected.objectIdentifier ||
      row.verification_count !== 1 || row.verification_event_id !== expected.verificationEventId ||
      row.verification_state !== "VERIFIED" || row.observed_checksum_sha256 !== expected.checksumSha256) {
    throw new Error("M22A_OWNER_PREVIEW_MEDIA_EVIDENCE_FAILURE");
  }
}

function mediaEvidence(
  returned: ReturnedPhotoEvidenceSetup,
  uploaded: ReviewMediaUploadResult,
): ScenarioMediaEvidence {
  return {
    storageObjectId: returned.storageObjectId,
    verificationEventId: returned.verificationEventId,
    versionId: returned.returnedVersionId,
    objectIdentifier: uploaded.objectIdentifier,
    checksumSha256: uploaded.sha256,
    byteSize: uploaded.byteSize,
    mediaType: "image/png",
    filename: uploaded.filename,
  };
}

function deepLink(orderId: string, workspace: "review" | "quick-edit", identifiers: Record<string, string>): string {
  const query = new URLSearchParams({ queue: "attention", orderId, workspace, ...identifiers });
  return `${OWNER_PREVIEW_URL}?${query.toString()}`;
}

async function verifyHttpSurface(
  expectedOrderIds: string[],
  media: Array<{ url: string; evidence: ScenarioMediaEvidence }>,
): Promise<void> {
  const sessionResponse = await fetch("http://127.0.0.1:4317/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!sessionResponse.ok || !cookie) throw new Error("M22A_OWNER_PREVIEW_HTTP_SESSION_FAILURE");
  const response = await fetch("http://127.0.0.1:4317/api/operations/review-attention", {
    headers: { cookie },
  });
  const body = await response.json() as { items?: Array<{ orderId?: string }> };
  const observed = new Set(body.items?.map((item) => item.orderId) ?? []);
  if (!response.ok || expectedOrderIds.some((orderId) => !observed.has(orderId))) {
    throw new Error("M22A_OWNER_PREVIEW_HTTP_ATTENTION_FAILURE");
  }
  for (const check of media) {
    const mediaResponse = await fetch(check.url, { headers: { cookie } });
    const bytes = Buffer.from(await mediaResponse.arrayBuffer());
    if (!mediaResponse.ok || mediaResponse.headers.get("content-type") !== check.evidence.mediaType ||
        mediaResponse.headers.get("x-content-sha256") !== check.evidence.checksumSha256 ||
        bytes.length !== check.evidence.byteSize ||
        createHash("sha256").update(bytes).digest("hex") !== check.evidence.checksumSha256) {
      throw new Error("M22A_OWNER_PREVIEW_HTTP_MEDIA_FAILURE");
    }
  }
}

export async function runContextualEditorReviewOwnerPreview(): Promise<never> {
  await rm(OWNER_PREVIEW_ROOT, { recursive: true, force: true });
  await mkdir(OWNER_PREVIEW_MEDIA_ROOT, { recursive: true, mode: 0o700 });
  await resetAndSeedOperationsConsoleDatabase(1);
  const owner = ownerClient();
  await owner.connect();
  await installOwnerPreviewSetupPermissions(owner);

  const issued = await issueOperationsConsoleDatabaseSession();
  const database = new OperationsConsoleDatabase();
  let app: Awaited<ReturnType<typeof startOperationsConsole>> | null = null;
  try {
    await database.assertRestrictedRuntime();
    const store = new ReviewMediaStore({ root: OWNER_PREVIEW_MEDIA_ROOT });
    const activeMedia = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      store.upload({
        body: syntheticRoomPng(index * 19),
        filename: `active-editor-review-${String(index + 1).padStart(2, "0")}.png`,
        mediaType: "image/png",
      })));
    const quickEditMedia = await store.upload({
      body: syntheticRoomPng(226), filename: "quick-edit-source.png", mediaType: "image/png",
    });
    const activeOrderId = await createSyntheticListing(database, issued.databaseSessionToken, "active-review");
    const quickEditOrderId = await createSyntheticListing(database, issued.databaseSessionToken, "quick-edit");
    const activeReturned = await createReturnedPhoto(
      database, issued.databaseSessionToken, activeOrderId, activeMedia, "active-review");
    const quickEditReturned = await createReturnedPhoto(
      database, issued.databaseSessionToken, quickEditOrderId, [quickEditMedia], "quick-edit");

    const activeStart = await database.startOperationsEditorReview(
      issued.databaseSessionToken, idempotency("active-start-review"), activeOrderId, "PHOTO");
    const activeWorkspace = await database.getOperationsReviewWorkspace(issued.databaseSessionToken, activeOrderId);
    const activeReview = activeWorkspace.activeReview;
    const activeItem = activeReview?.items[0];
    if (!activeReview || !activeItem || activeReview.reviewBatchId !== activeStart.reviewBatchId ||
        activeReview.currentState !== "SEALED" || activeReview.itemCount !== 10 ||
        activeReview.unresolvedCount !== 10 || activeItem.previewAvailable !== true) {
      throw new Error("M22A_OWNER_PREVIEW_ACTIVE_REVIEW_FAILURE");
    }

    const quickStart = await database.startOperationsEditorReview(
      issued.databaseSessionToken, idempotency("quick-start-review"), quickEditOrderId, "PHOTO");
    const quickOpen = await database.getOperationsReviewWorkspace(issued.databaseSessionToken, quickEditOrderId);
    const quickOpenItem = quickOpen.activeReview?.items[0];
    if (!quickOpenItem) throw new Error("M22A_OWNER_PREVIEW_QUICK_EDIT_ITEM_FAILURE");
    await database.submitOperationsReview(
      issued.databaseSessionToken,
      idempotency("quick-edit-submit"),
      quickEditOrderId,
      quickStart.reviewBatchId,
      quickStart.lifecycleGeneration,
      [{
        reviewItemId: quickOpenItem.reviewItemId,
        disposition: "QUICK_EDIT",
        instructions: "Warm the synthetic room slightly and return one PNG revision.",
        expectedGeneration: quickOpenItem.decisionGeneration,
        currentDecisionId: quickOpenItem.currentDecisionId,
      }],
    );
    const quickWorkspace = await database.getOperationsReviewWorkspace(issued.databaseSessionToken, quickEditOrderId);
    const quickEdit = quickWorkspace.quickEdits[0];
    const quickHistory = quickWorkspace.completedHistory[0];
    if (quickWorkspace.activeReview !== null || !quickEdit || !quickHistory ||
        quickEdit.reviewBatchId !== quickStart.reviewBatchId || quickEdit.downloadAvailable !== true ||
        quickHistory.quickEditRoutedCount !== 1 ||
        !quickWorkspace.actions.some((action) => action.code === "QUICK_EDIT_REQUIRED")) {
      throw new Error("M22A_OWNER_PREVIEW_QUICK_EDIT_ROUTE_FAILURE");
    }

    const activeDescriptor = await database.resolveOperationsReviewMediaSource(
      issued.databaseSessionToken, activeOrderId, activeReview.reviewBatchId, activeItem.reviewItemId,
      "REVIEW_PREVIEW");
    const quickDescriptor = await database.resolveOperationsReviewMediaSource(
      issued.databaseSessionToken, quickEditOrderId, quickStart.reviewBatchId, quickOpenItem.reviewItemId,
      "QUICK_EDIT_DOWNLOAD");
    if (activeDescriptor.object_identifier !== activeMedia[0]!.objectIdentifier ||
        activeDescriptor.checksum_sha256 !== activeMedia[0]!.sha256 ||
        quickDescriptor.object_identifier !== quickEditMedia.objectIdentifier ||
        quickDescriptor.checksum_sha256 !== quickEditMedia.sha256) {
      throw new Error("M22A_OWNER_PREVIEW_MEDIA_DESCRIPTOR_FAILURE");
    }
    await Promise.all([...activeMedia.map((media) => store.download(media)), store.download(quickEditMedia)]);

    const activeEvidenceSet = activeReturned.photos.map((photo, index) => mediaEvidence(photo, activeMedia[index]!));
    const activeEvidence = activeEvidenceSet[0]!;
    const quickEvidence = mediaEvidence(quickEditReturned.photos[0]!, quickEditMedia);
    await Promise.all(activeEvidenceSet.map((evidence) => verifyExactMediaEvidence(owner, evidence)));
    await verifyExactMediaEvidence(owner, quickEvidence);

    const activeScenario: SyntheticReviewScenario = {
      kind: "ACTIVE_SEALED_REVIEW",
      orderId: activeOrderId,
      jobId: activeReturned.jobId,
      workstreamId: activeReturned.workstreamId,
      handoffBatchId: activeReturned.handoffBatchId,
      reviewBatchId: activeReview.reviewBatchId,
      reviewItemId: activeItem.reviewItemId,
      quickEditRequestId: null,
      media: activeEvidence,
      deepLink: deepLink(activeOrderId, "review", {
        reviewBatchId: activeReview.reviewBatchId, reviewItemId: activeItem.reviewItemId,
      }),
    };
    const quickEditScenario: SyntheticReviewScenario = {
      kind: "COMPLETED_QUICK_EDIT_ROUTE",
      orderId: quickEditOrderId,
      jobId: quickEditReturned.jobId,
      workstreamId: quickEditReturned.workstreamId,
      handoffBatchId: quickEditReturned.handoffBatchId,
      reviewBatchId: quickStart.reviewBatchId,
      reviewItemId: quickOpenItem.reviewItemId,
      quickEditRequestId: quickEdit.quickEditRequestId,
      media: quickEvidence,
      deepLink: deepLink(quickEditOrderId, "quick-edit", { quickEditRequestId: quickEdit.quickEditRequestId }),
    };
    const manifest: OwnerPreviewManifest = {
      schema: "P02_M22_A_SYNTHETIC_OWNER_PREVIEW_V1",
      generatedAt: new Date().toISOString(),
      boundary: {
        classification: "NONPRODUCTION_SYNTHETIC_ONLY",
        host: "127.0.0.1",
        port: 4317,
        database: OPERATIONS_CONSOLE_DATABASE.database,
        runtimeRole: OPERATIONS_CONSOLE_DATABASE.user,
        reviewMediaRoot: OWNER_PREVIEW_MEDIA_ROOT,
        externalNetworkUsed: false,
        providerMediaUsed: false,
      },
      scenarios: [activeScenario, quickEditScenario],
    };
    await writeFile(OWNER_PREVIEW_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    const service = new OperationsConsoleService(database, { reviewMediaStore: store });
    app = await startOperationsConsole({
      service,
      sessions: new DevelopmentOperatorSessionManager({ ttlSeconds: 3600 }),
      developmentOperatorContext: issued.context,
    });
    await verifyHttpSurface([activeOrderId, quickEditOrderId], [
      {
        url: `http://127.0.0.1:4317/api/operations/orders/${activeOrderId}/review-media/` +
          `${activeReview.reviewBatchId}/items/${activeItem.reviewItemId}?purpose=REVIEW_PREVIEW`,
        evidence: activeEvidence,
      },
      {
        url: `http://127.0.0.1:4317/api/operations/orders/${quickEditOrderId}/review-media/` +
          `${quickStart.reviewBatchId}/items/${quickOpenItem.reviewItemId}?purpose=QUICK_EDIT_DOWNLOAD`,
        evidence: quickEvidence,
      },
    ]);
    process.stdout.write(`${JSON.stringify({
      status: "P02_M22_A_SYNTHETIC_OWNER_PREVIEW_READY",
      url: OWNER_PREVIEW_URL,
      activeReview: activeScenario.deepLink,
      quickEdit: quickEditScenario.deepLink,
      manifest: OWNER_PREVIEW_MANIFEST_PATH,
      reviewMediaRoot: OWNER_PREVIEW_MEDIA_ROOT,
      shutdown: "Press Ctrl-C",
    }, null, 2)}\n`);

    return await new Promise<never>((_resolve, reject) => {
      let closing = false;
      const close = (signal: "SIGINT" | "SIGTERM") => {
        if (closing) return;
        closing = true;
        void app?.close().then(() => {
          process.stdout.write(`P02_M22_A_SYNTHETIC_OWNER_PREVIEW_STOPPED ${signal}\n`);
          process.exit(0);
        }, reject);
      };
      process.once("SIGINT", () => close("SIGINT"));
      process.once("SIGTERM", () => close("SIGTERM"));
    });
  } catch (error) {
    if (app) await app.close().catch(() => undefined);
    else await database.close().catch(() => undefined);
    throw error;
  } finally {
    await owner.end();
  }
}

const currentPath = new URL(import.meta.url).pathname;
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (resolve(currentPath) === invokedPath) {
  runContextualEditorReviewOwnerPreview().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`P02_M22_A_SYNTHETIC_OWNER_PREVIEW_FAILED: ${detail}\n`);
    process.exitCode = 1;
  });
}
