import { contract } from "./contracts.js";
import type { OperationalPilotDatabase } from "./database.js";

export async function ownerReadableObservability(database: OperationalPilotDatabase, session: string,
  ids: { missionPlan: string; captureSession: string; cullWorkspace: string; handoff: string; review: string; operation: string; publication?: string; tdc?: string }) {
  const [missionPlan, capture, cull, handoff, returned, review, history, operation] = await Promise.all([
    database.invoke("get_mission_plan_record", [session, ids.missionPlan]),
    database.invoke("get_capture_session_record", [session, ids.captureSession]),
    database.invoke("get_cull_workspace", [session, ids.cullWorkspace]),
    database.invoke("get_editor_handoff_batch", [session, ids.handoff]),
    database.invoke("get_returned_media_history", [session, ids.handoff]),
    database.invoke("get_returned_review_batch", [session, ids.review]),
    database.invoke("get_returned_review_history", [session, ids.review]),
    database.invoke("get_media_operation_record", [session, ids.operation]),
  ]);
  return contract("OwnerObservabilityV1", { missionPlan, capture, cull, handoff, returned, review, history, operation,
    publication: ids.publication ? await database.invoke("get_media_publication", [session, ids.publication]) : null,
    temporaryDownloadCenter: ids.tdc ? await database.invoke("get_temporary_download_center", [session, ids.tdc]) : null });
}
