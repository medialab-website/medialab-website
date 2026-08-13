import pg from "pg";

const { Pool } = pg;

export interface OperationalPilotDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
}

export const DEFAULT_RUNTIME_DATABASE: OperationalPilotDatabaseConfig = Object.freeze({
  host: "/tmp/mlvs01-p02m16a-pg", port: 55447, database: "medialab_p02m16a_test", user: "medialab_p02m16a_test_app",
});

const ALLOWED_FUNCTIONS = new Set([
  "get_mission_plan_record", "get_capture_session_record", "get_cull_workspace", "get_cull_selected_media",
  "get_editor_handoff_batch", "get_returned_media_history", "get_returned_review_batch", "get_returned_review_history",
  "get_returned_review_lineage", "list_returned_review_batches", "get_media_operation_record", "list_media_operations",
  "get_media_publication", "get_temporary_download_center", "get_temporary_download_center_activity",
  "create_scheduling_request", "add_scheduling_requested_window", "confirm_appointment", "create_job",
  "create_service_workstream", "link_job_appointment", "create_mission_plan_draft", "issue_mission_plan_version",
  "create_capture_session", "register_capture_source", "register_capture_item", "record_capture_item_verification",
  "promote_capture_item", "record_media_storage_object", "create_cull_workspace", "admit_cull_candidate",
  "seal_cull_inventory", "decide_cull_candidate", "finalize_cull_workspace", "create_editor_handoff_batch",
  "record_editor_handoff_event", "create_returned_media_intake_batch", "record_returned_media_item",
  "complete_editor_handoff_returns", "create_returned_review_batch", "admit_returned_review_item",
  "seal_returned_review_inventory", "record_returned_review_decision", "complete_returned_review_batch",
  "link_returned_review_successor", "add_media_asset_version", "record_media_lineage",
  "associate_quick_edit_corrected_version", "request_media_operation", "attach_media_operation_target",
  "ready_media_operation", "record_media_operation_reconciliation", "create_media_publication",
  "add_media_publication_item", "seal_media_publication", "activate_media_publication",
  "record_delivery_financial_eligibility", "evaluate_delivery_entitlement", "create_temporary_download_center",
  "issue_temporary_download_center_access_credential", "claim_media_operation", "start_media_operation_attempt",
  "record_media_operation_checkpoint", "record_media_operation_receipt", "complete_media_operation_attempt",
  "schedule_media_operation_retry",
]);

export class OperationalPilotDatabase {
  readonly pool: pg.Pool;
  constructor(config: OperationalPilotDatabaseConfig = DEFAULT_RUNTIME_DATABASE) {
    if (/owner/i.test(config.user)) throw new Error("operational runtime cannot use migration owner role");
    this.pool = new Pool({ ...config, max: 8, application_name: "p02-m16-a-operational-pilot", statement_timeout: 30_000 });
  }

  async invoke<T = unknown>(name: string, values: readonly unknown[], casts: readonly string[] = []): Promise<T> {
    if (!ALLOWED_FUNCTIONS.has(name)) throw new Error(`function is outside operational-pilot authority: ${name}`);
    if (casts.length > values.length || casts.some((cast) => cast !== "" && !/^::(?:jsonb|uuid|uuid\[\]|timestamptz)$/.test(cast))) throw new Error("unsafe function cast");
    const placeholders = values.map((_, index) => `$${index + 1}${casts[index] ?? ""}`).join(",");
    const result = await this.pool.query<Record<string, T>>(`SELECT medialab_core.${name}(${placeholders})`, values as unknown[]);
    return result.rows[0]![name] as T;
  }

  async invokeSet<T = unknown>(name: string, values: readonly unknown[], casts: readonly string[] = []): Promise<T[]> {
    if (!ALLOWED_FUNCTIONS.has(name)) throw new Error(`function is outside operational-pilot authority: ${name}`);
    const placeholders = values.map((_, index) => `$${index + 1}${casts[index] ?? ""}`).join(",");
    const result = await this.pool.query<Record<string, T>>(`SELECT medialab_core.${name}(${placeholders})`, values as unknown[]);
    return result.rows.map((row) => row[name] as T);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
