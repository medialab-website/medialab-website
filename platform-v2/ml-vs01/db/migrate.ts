import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { fileURLToPath } from 'url';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  failed?: {
    filename: string;
    error: string;
  };
}

export interface MigrateOptions {
  migrationsDir: string;
  databaseUrl?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  runtimeUser?: string;
  password?: string;
  schema?: string;
  client?: pg.Client;
}

const AUTHORITY_PACKET_MIGRATION = '0003_person_contacts_and_account_lifecycle.sql';
const CATALOG_PACKET_MIGRATION = '0004_current_catalog_and_price_snapshots.sql';
const CATALOG_ADMIN_PACKET_MIGRATION = '0005_catalog_administration_lifecycle.sql';
const ORDER_FOUNDATION_PACKET_MIGRATION = '0006_orders_and_immutable_commercial_evidence.sql';
const PROPERTY_HUB_FOUNDATION_PACKET_MIGRATION = '0007_property_hub_foundation.sql';
const SCHEDULING_APPOINTMENT_PACKET_MIGRATION = '0008_scheduling_request_and_appointment_foundation.sql';
const JOB_SERVICE_WORKSTREAM_PACKET_MIGRATION = '0009_job_and_service_workstream_foundation.sql';
const MISSION_PLAN_PACKET_MIGRATION = '0010_mission_plan_foundation.sql';
const MEDIA_ASSET_PACKET_MIGRATION = '0011_media_asset_identity_and_lineage_foundation.sql';
const MEDIA_OPERATION_PACKET_MIGRATION = '0012_durable_media_operations_reconciliation_foundation.sql';
const CAPTURE_SESSION_PACKET_MIGRATION = '0013_capture_session_ingest_custody_foundation.sql';
const MEDIA_CULL_PACKET_MIGRATION = '0014_media_cull_workspace_selected_media_evidence_foundation.sql';
const EDITOR_HANDOFF_PACKET_MIGRATION = '0015_editor_handoff_returned_media_intake_foundation.sql';
const RETURNED_REVIEW_PACKET_MIGRATION = '0016_returned_editor_review_final_source_decision_foundation.sql';
const PUBLICATION_DELIVERY_PACKET_MIGRATION = '0017_publication_delivery_entitlement_foundation.sql';

const CONTACT_PUBLIC_MUTATION_FUNCTIONS = [
  'medialab_core.create_contact_method(uuid, text, uuid, text, text)',
  'medialab_core.record_contact_verification(uuid, text, uuid, timestamptz, text, text)',
  'medialab_core.invalidate_contact_verification(uuid, text, uuid, text)',
  'medialab_core.correct_contact_method(uuid, uuid, text, uuid, text, text)',
  'medialab_core.retire_contact_method(uuid, text, uuid, text)',
  'medialab_core.replace_primary_email(uuid, text, uuid, uuid, text)',
  'medialab_core.transition_account_lifecycle(uuid, text, uuid, uuid, text, text, boolean)'
];

const CATALOG_PUBLIC_FUNCTIONS = [
  'medialab_core.get_current_selectable_catalog(timestamptz)',
  'medialab_core.get_current_catalog_package_inclusions(timestamptz)',
  'medialab_core.create_catalog_product(text, uuid, text, text, text, text, text, text)',
  'medialab_core.revise_catalog_product(text, uuid, text, text, text, text)',
  'medialab_core.record_catalog_price(text, uuid, uuid, bigint, text, timestamptz, text, text)',
  'medialab_core.replace_catalog_package_composition(text, uuid, uuid, timestamptz, text, jsonb)',
  'medialab_core.replace_catalog_bracket_set(text, uuid, uuid, text, timestamptz, text, jsonb)',
  'medialab_core.record_catalog_external_mapping(text, uuid, text, text, text, uuid, text, timestamptz)',
  'medialab_core.create_catalog_commercial_snapshot(text, uuid, uuid, numeric, bigint, bigint, text, bigint, text, timestamptz, text, text, text, bigint, timestamptz)',
  'medialab_core.create_custom_commercial_snapshot(text, uuid, text, bigint, text, numeric, text, bigint, text, bigint, text, text, timestamptz, bigint, timestamptz)'
];

const CATALOG_ADMIN_PUBLIC_FUNCTIONS = [
  'medialab_core.get_catalog_administration_products(text, boolean)',
  'medialab_core.create_catalog_draft_product(text, uuid, text, text, text, text, text, text, text, text, text, text, date, uuid)',
  'medialab_core.revise_catalog_draft_product(text, uuid, text, text, text, text, text, text, text, text, text, date, text)',
  'medialab_core.revise_published_catalog_product_definition(text, uuid, text, text, text, text, text, text)',
  'medialab_core.publish_catalog_draft_product(text, uuid, text, text)',
  'medialab_core.set_catalog_product_archived(text, uuid, boolean, text, text)',
  'medialab_core.delete_catalog_draft_product(text, uuid, text, text)'
];

const ORDER_FOUNDATION_PUBLIC_FUNCTIONS = [
  'medialab_core.create_order(text, text, text, uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb, bigint, text, uuid, text, text)',
  'medialab_core.get_order_record(text, uuid)'
];

const PROPERTY_HUB_FOUNDATION_PUBLIC_FUNCTIONS = [
  'medialab_core.create_property_hub(text, text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb)',
  'medialab_core.get_property_hub_record(text, uuid)'
];

const SCHEDULING_APPOINTMENT_PUBLIC_FUNCTIONS = [
  'medialab_core.create_scheduling_request(text, text, uuid, uuid, uuid, text)',
  'medialab_core.add_scheduling_requested_window(text, text, uuid, timestamptz, timestamptz, text, timestamp without time zone, timestamp without time zone)',
  'medialab_core.propose_scheduling_window(text, text, uuid, timestamptz, timestamptz, text, timestamp without time zone, timestamp without time zone, text)',
  'medialab_core.accept_scheduling_proposal(text, text, uuid, text)',
  'medialab_core.record_scheduling_offline_acceptance(text, text, uuid, uuid, text, text)',
  'medialab_core.withdraw_scheduling_request(text, text, uuid, text)',
  'medialab_core.close_scheduling_request(text, text, uuid, text, text)',
  'medialab_core.confirm_appointment(text, text, uuid, uuid, text)',
  'medialab_core.assign_appointment_participant(text, text, uuid, uuid, text)',
  'medialab_core.end_appointment_participant_assignment(text, text, uuid, text)',
  'medialab_core.replace_appointment_participant_assignment(text, text, uuid, uuid, text)',
  'medialab_core.cancel_appointment(text, text, uuid, text)',
  'medialab_core.record_appointment_no_show(text, text, uuid, text)',
  'medialab_core.record_appointment_unable_to_complete(text, text, uuid, text, text)',
  'medialab_core.record_appointment_weather_delay(text, text, uuid, text)',
  'medialab_core.supersede_and_reschedule_appointment(text, text, uuid, uuid, text, timestamptz, timestamptz, text, timestamp without time zone, timestamp without time zone, text, text)',
  'medialab_core.get_scheduling_request_record(text, uuid)',
  'medialab_core.get_appointment_record(text, uuid)'
];

const JOB_SERVICE_WORKSTREAM_PUBLIC_FUNCTIONS = [
  'medialab_core.create_job(text, text, uuid, uuid, uuid, text)',
  'medialab_core.create_service_workstream(text, text, uuid, uuid, text)',
  'medialab_core.link_job_appointment(text, text, uuid, uuid, text)',
  'medialab_core.transition_job_state(text, text, uuid, text, text)',
  'medialab_core.transition_service_workstream_state(text, text, uuid, text, text)',
  'medialab_core.record_job_service_external_reference(text, text, uuid, uuid, text, text, text, text)',
  'medialab_core.get_job_record(text, uuid)',
  'medialab_core.get_service_workstream_record(text, uuid)'
];

const MISSION_PLAN_PUBLIC_FUNCTIONS = [
  'medialab_core.create_mission_plan_draft(text, text, uuid, jsonb, text, jsonb, text)',
  'medialab_core.revise_mission_plan_draft(text, text, uuid, jsonb, text, jsonb, text)',
  'medialab_core.replace_mission_plan_draft_workstreams(text, text, uuid, uuid[])',
  'medialab_core.replace_mission_plan_draft_contacts(text, text, uuid, jsonb)',
  'medialab_core.record_mission_plan_sensitive_envelope(text, text, uuid, uuid, text, text, text, text, text, text, text)',
  'medialab_core.add_mission_plan_note(text, text, uuid, text, text)',
  'medialab_core.refresh_mission_plan_draft(text, text, uuid)',
  'medialab_core.create_mission_plan_superseding_draft(text, text, uuid, uuid)',
  'medialab_core.issue_mission_plan_version(text, text, uuid)',
  'medialab_core.record_mission_plan_open_event(text, text, uuid, uuid, text, jsonb)',
  'medialab_core.get_mission_plan_record(text, uuid)',
  'medialab_core.list_mission_plans(text, uuid, uuid)',
  'medialab_core.get_mission_plan_sensitive_envelopes(text, uuid)'
];

const MEDIA_ASSET_PUBLIC_FUNCTIONS = [
  'medialab_core.create_media_asset(text, text, uuid, uuid, jsonb)',
  'medialab_core.add_media_asset_version(text, text, uuid, text, text, bigint, text, text, text)',
  'medialab_core.record_media_lineage(text, text, uuid, uuid, text, text)',
  'medialab_core.record_media_capture_relationship(text, text, uuid, uuid, text, text)',
  'medialab_core.record_media_storage_object(text, text, uuid, text, text, text, text, bigint, text, text)',
  'medialab_core.record_media_location_observation(text, text, uuid, text, text, text)',
  'medialab_core.record_media_verification_event(text, text, uuid, text, text, text, jsonb)',
  'medialab_core.record_media_transfer_event(text, text, uuid, text, text, integer, text, text, jsonb)',
  'medialab_core.designate_media_approved_source(text, text, uuid, text, text, uuid, text)',
  'medialab_core.create_media_manifest(text, text, uuid, text)',
  'medialab_core.get_media_asset_record(text, uuid)',
  'medialab_core.get_media_manifest(text, uuid)'
];

const MEDIA_OPERATION_PUBLIC_FUNCTIONS = [
  'medialab_core.request_media_operation(text, text, uuid, uuid, text, text, text, jsonb)',
  'medialab_core.attach_media_operation_target(text, text, uuid, text, uuid)',
  'medialab_core.ready_media_operation(text, text, uuid, text)',
  'medialab_core.request_media_operation_control(text, text, uuid, text, text, jsonb)',
  'medialab_core.list_claimable_media_operations(integer)',
  'medialab_core.claim_media_operation(text, text, integer)',
  'medialab_core.start_media_operation_attempt(text, text, uuid)',
  'medialab_core.record_media_operation_checkpoint(text, text, uuid, text, jsonb)',
  'medialab_core.record_media_operation_receipt(text, text, uuid, uuid, text, text, bigint, text, text, text, text, text, jsonb)',
  'medialab_core.complete_media_operation_attempt(text, text, uuid, text, text, jsonb)',
  'medialab_core.schedule_media_operation_retry(text, text, uuid, uuid, text, timestamptz)',
  'medialab_core.record_media_operation_reconciliation(text, text, uuid, uuid, uuid, text, text, jsonb)',
  'medialab_core.get_media_operation_record(text, uuid)',
  'medialab_core.list_media_operations(text, uuid, uuid)'
];

const CAPTURE_SESSION_PUBLIC_FUNCTIONS = [
  'medialab_core.create_capture_session(text, text, uuid, uuid, text, text, jsonb)',
  'medialab_core.assign_capture_session(text, text, uuid, uuid, text)',
  'medialab_core.register_capture_source(text, text, uuid, text, text, jsonb)',
  'medialab_core.record_capture_source_observation(text, text, uuid, text, jsonb)',
  'medialab_core.register_capture_item(text, text, uuid, text, bigint, text, timestamptz, text, jsonb)',
  'medialab_core.record_capture_item_observation(text, text, uuid, text, bigint, text, timestamptz, text, jsonb)',
  'medialab_core.record_capture_item_verification(text, text, uuid, text, text, text, bigint, text, jsonb)',
  'medialab_core.record_capture_item_custody(text, text, uuid, text, uuid, uuid, uuid, text, jsonb)',
  'medialab_core.record_capture_duplicate_evidence(text, text, uuid, uuid, text, text, text, jsonb)',
  'medialab_core.promote_capture_item(text, text, uuid, text)',
  'medialab_core.get_capture_session_record(text, uuid)',
  'medialab_core.get_capture_item_record(text, uuid)',
  'medialab_core.list_capture_sessions(text, uuid, uuid)'
];

const MEDIA_CULL_PUBLIC_FUNCTIONS = [
  'medialab_core.create_cull_workspace(text, text, uuid, uuid, text, text, text, jsonb)',
  'medialab_core.create_cull_successor_workspace(text, text, uuid, text, text, jsonb)',
  'medialab_core.admit_cull_candidate(text, text, uuid, uuid, uuid, uuid[], jsonb)',
  'medialab_core.admit_cull_candidates(text, text, uuid, jsonb)',
  'medialab_core.withdraw_cull_candidate(text, text, uuid, text, jsonb)',
  'medialab_core.seal_cull_inventory(text, text, uuid, text)',
  'medialab_core.decide_cull_candidate(text, text, uuid, text, text, bigint, uuid, jsonb)',
  'medialab_core.decide_cull_candidates(text, text, uuid, uuid[], text, text, bigint, jsonb)',
  'medialab_core.clear_cull_candidate_decision(text, text, uuid, text, bigint, jsonb)',
  'medialab_core.finalize_cull_workspace(text, text, uuid, text, bigint, boolean, text)',
  'medialab_core.get_cull_workspace(text, uuid)',
  'medialab_core.get_cull_candidate_history(text, uuid)',
  'medialab_core.list_cull_workspaces(text, uuid, uuid, text)',
  'medialab_core.get_cull_selected_media(text, uuid)'
];

const EDITOR_HANDOFF_PUBLIC_FUNCTIONS = [
  'medialab_core.create_editor_handoff_batch(text, text, uuid, text, text, text, jsonb)',
  'medialab_core.record_editor_handoff_event(text, text, uuid, text, bigint, text, jsonb)',
  'medialab_core.create_returned_media_intake_batch(text, text, uuid, text, text, jsonb)',
  'medialab_core.record_returned_media_item(text, text, uuid, text, bigint, text, text, text, text, uuid, bigint, text, jsonb)',
  'medialab_core.resolve_returned_media_match(text, text, uuid, text, text, uuid, bigint, bigint, text, jsonb)',
  'medialab_core.complete_editor_handoff_returns(text, text, uuid, bigint, text)',
  'medialab_core.get_editor_handoff_batch(text, uuid)',
  'medialab_core.list_editor_handoff_batches(text, uuid, text)',
  'medialab_core.get_returned_media_history(text, uuid)'
];

const RETURNED_REVIEW_PUBLIC_FUNCTIONS = [
  'medialab_core.create_returned_review_batch(text, text, uuid, integer, text, jsonb)',
  'medialab_core.admit_returned_review_item(text, text, uuid, uuid, bigint, jsonb)',
  'medialab_core.seal_returned_review_inventory(text, text, uuid, bigint, text)',
  'medialab_core.record_returned_review_decision(text, text, uuid, text, text, text, bigint)',
  'medialab_core.supersede_returned_review_decision(text, text, uuid, uuid, text, text, text, bigint)',
  'medialab_core.complete_returned_review_batch(text, text, uuid, bigint, text)',
  'medialab_core.link_returned_review_successor(text, text, uuid, uuid, text)',
  'medialab_core.associate_returned_revision(text, text, uuid, uuid, text)',
  'medialab_core.associate_quick_edit_corrected_version(text, text, uuid, uuid, text)',
  'medialab_core.get_returned_review_batch(text, uuid)',
  'medialab_core.get_returned_review_history(text, uuid)',
  'medialab_core.list_returned_review_batches(text, uuid, text)',
  'medialab_core.get_returned_review_lineage(text, uuid)'
];

const PUBLICATION_DELIVERY_PUBLIC_FUNCTIONS = [
  'medialab_core.create_media_publication(text, text, uuid, uuid, uuid, text, jsonb)',
  'medialab_core.add_media_publication_item(text, text, uuid, uuid, text, text, integer, text)',
  'medialab_core.seal_media_publication(text, text, uuid, bigint, text)',
  'medialab_core.activate_media_publication(text, text, uuid, bigint, text)',
  'medialab_core.revoke_media_publication(text, text, uuid, bigint, text)',
  'medialab_core.record_delivery_financial_eligibility(text, text, uuid, text, text, text, uuid, text)',
  'medialab_core.evaluate_delivery_entitlement(text, text, uuid, text, uuid, text, jsonb)',
  'medialab_core.issue_delivery_grant(text, text, uuid, text)',
  'medialab_core.revoke_delivery_grant(text, text, uuid, text)',
  'medialab_core.evaluate_delivery_grant_access(text, text, uuid, text, jsonb)',
  'medialab_core.get_media_publication(text, uuid)',
  'medialab_core.get_delivery_entitlement_history(text, uuid)'
];

export function validateMigrationFilenames(filenames: string[]): void {
  const filenameRegex = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
  const prefixes = new Set<string>();

  for (const name of filenames) {
    if (!filenameRegex.test(name)) {
      throw new Error(`Invalid migration filename format: '${name}'. Must match ^[0-9]{4}_[a-z0-9_]+\\.sql$`);
    }

    const prefix = name.substring(0, 4);
    if (prefixes.has(prefix)) {
      throw new Error(`Duplicate migration numeric prefix '${prefix}' detected in filename '${name}'`);
    }
    prefixes.add(prefix);
  }
}

function sanitizeIdentifier(ident: string): string {
  if (!/^[a-z0-9_]+$/.test(ident)) {
    throw new Error(`Invalid schema identifier '${ident}'. Must match ^[a-z0-9_]+$`);
  }
  return `"${ident}"`;
}

function sanitizeRoleIdentifier(ident: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ident)) {
    throw new Error(`Invalid PostgreSQL role identifier '${ident}'. Must match ^[a-z_][a-z0-9_]{0,62}$`);
  }
  return `"${ident}"`;
}

async function validateRuntimeRole(client: pg.Client, runtimeUser: string): Promise<string> {
  const safeRuntimeRole = sanitizeRoleIdentifier(runtimeUser);
  const context = await client.query<{ migration_owner: string; runtime_exists: boolean }>(
    `SELECT current_user AS migration_owner,
            EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS runtime_exists`,
    [runtimeUser]
  );

  if (!context.rows[0].runtime_exists) {
    throw new Error(`Configured runtime role '${runtimeUser}' does not exist`);
  }
  if (context.rows[0].migration_owner === runtimeUser) {
    throw new Error('Migration owner and restricted runtime role must be different roles');
  }

  return safeRuntimeRole;
}

async function applyRuntimePrivilegePolicy(
  client: pg.Client,
  runtimeUser: string,
  includeCatalogFunctions: boolean,
  includeCatalogAdminFunctions = false,
  includeOrderFoundationFunctions = false,
  includePropertyHubFoundationFunctions = false,
  includeSchedulingAppointmentFunctions = false,
  includeJobServiceWorkstreamFunctions = false,
  includeMissionPlanFunctions = false,
  includeMediaAssetFunctions = false,
  includeMediaOperationFunctions = false,
  includeCaptureSessionFunctions = false,
  includeMediaCullFunctions = false,
  includeEditorHandoffFunctions = false,
  includeReturnedReviewFunctions = false,
  includePublicationDeliveryFunctions = false
): Promise<void> {
  const safeRuntimeRole = await validateRuntimeRole(client, runtimeUser);
  const databaseResult = await client.query<{ database_name: string }>('SELECT current_database() AS database_name');
  const safeDatabase = sanitizeIdentifier(databaseResult.rows[0].database_name);

  await client.query(`
    REVOKE ALL PRIVILEGES ON DATABASE ${safeDatabase} FROM ${safeRuntimeRole};
    GRANT CONNECT ON DATABASE ${safeDatabase} TO ${safeRuntimeRole};
    REVOKE ALL PRIVILEGES ON SCHEMA medialab_meta, medialab_core FROM ${safeRuntimeRole};
    GRANT USAGE ON SCHEMA medialab_core TO ${safeRuntimeRole};
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA medialab_core FROM ${safeRuntimeRole};
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA medialab_core FROM ${safeRuntimeRole};
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA medialab_core FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA medialab_core FROM ${safeRuntimeRole};
    ${[
      ...CONTACT_PUBLIC_MUTATION_FUNCTIONS,
      ...(includeCatalogFunctions ? CATALOG_PUBLIC_FUNCTIONS : []),
      ...(includeCatalogAdminFunctions ? CATALOG_ADMIN_PUBLIC_FUNCTIONS : []),
      ...(includeOrderFoundationFunctions ? ORDER_FOUNDATION_PUBLIC_FUNCTIONS : []),
      ...(includePropertyHubFoundationFunctions ? PROPERTY_HUB_FOUNDATION_PUBLIC_FUNCTIONS : []),
      ...(includeSchedulingAppointmentFunctions ? SCHEDULING_APPOINTMENT_PUBLIC_FUNCTIONS : []),
      ...(includeJobServiceWorkstreamFunctions ? JOB_SERVICE_WORKSTREAM_PUBLIC_FUNCTIONS : []),
      ...(includeMissionPlanFunctions ? MISSION_PLAN_PUBLIC_FUNCTIONS : []),
      ...(includeMediaAssetFunctions ? MEDIA_ASSET_PUBLIC_FUNCTIONS : []),
      ...(includeMediaOperationFunctions ? MEDIA_OPERATION_PUBLIC_FUNCTIONS : []),
      ...(includeCaptureSessionFunctions ? CAPTURE_SESSION_PUBLIC_FUNCTIONS : []),
      ...(includeMediaCullFunctions ? MEDIA_CULL_PUBLIC_FUNCTIONS : []),
      ...(includeEditorHandoffFunctions ? EDITOR_HANDOFF_PUBLIC_FUNCTIONS : []),
      ...(includeReturnedReviewFunctions ? RETURNED_REVIEW_PUBLIC_FUNCTIONS : []),
      ...(includePublicationDeliveryFunctions ? PUBLICATION_DELIVERY_PUBLIC_FUNCTIONS : [])
    ].map((signature) =>
      `GRANT EXECUTE ON FUNCTION ${signature} TO ${safeRuntimeRole};`
    ).join('\n    ')}
  `);
}

export async function runMigrations(options: MigrateOptions): Promise<MigrationResult> {
  const { migrationsDir } = options;

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migration directory not found: ${migrationsDir}`);
  }

  // 1. Read and validate filenames before any DB interaction
  const allEntries = fs.readdirSync(migrationsDir);
  const sqlFiles = allEntries.filter((f) => f.endsWith('.sql'));

  validateMigrationFilenames(sqlFiles);

  // 2. Sort lexicographically
  sqlFiles.sort((a, b) => a.localeCompare(b));

  const requiresRuntimeRole = sqlFiles.includes(AUTHORITY_PACKET_MIGRATION);
  const runtimeUser = options.runtimeUser || process.env.PGRUNTIMEUSER;
  if (requiresRuntimeRole && !runtimeUser) {
    throw new Error(`PGRUNTIMEUSER is required when applying ${AUTHORITY_PACKET_MIGRATION}`);
  }

  // Validate and sanitize schema name
  const schemaName = options.schema || 'medialab_meta';
  const safeSchema = sanitizeIdentifier(schemaName);
  const safeTable = `${safeSchema}."schema_migrations"`;

  // 3. Connect to PostgreSQL if client not provided
  let client = options.client;
  let ownClient = false;

  if (!client) {
    ownClient = true;
    const migrationUser = options.user || process.env.PGUSER;
    if (!migrationUser) {
      throw new Error('PGUSER is required as the migration owner role');
    }
    client = new pg.Client({
      host: options.host || process.env.PGHOST || '/tmp/mlvs01-p02m14a-pg',
      port: options.port || (process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 55443),
      database: options.database || process.env.PGDATABASE || 'medialab_p02m14a_test',
      user: migrationUser,
      password: options.password || process.env.PGPASSWORD || undefined
    });
    await client.connect();
  }

  if (requiresRuntimeRole) {
    await validateRuntimeRole(client, runtimeUser!);
  }

  const result: MigrationResult = {
    applied: [],
    skipped: []
  };
  let authorityPolicyApplied = false;

  try {
    // 4. Ensure ledger table exists and set search_path
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS ${safeSchema};
      SET search_path = ${safeSchema}, public;
      CREATE TABLE IF NOT EXISTS ${safeTable} (
        filename text PRIMARY KEY,
        sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    `);

    // 5. Query applied migrations
    const ledgerRes = await client.query<{ filename: string; sha256: string }>(
      `SELECT filename, sha256 FROM ${safeTable} ORDER BY filename ASC;`
    );

    const appliedLedger = new Map<string, string>();
    for (const row of ledgerRes.rows) {
      appliedLedger.set(row.filename, row.sha256);
    }

    // 6. Process migration files
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const fileBytes = fs.readFileSync(filePath);
      const fileSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toLowerCase();

      if (appliedLedger.has(file)) {
        const appliedSha = appliedLedger.get(file)!;
        if (appliedSha !== fileSha256) {
          throw new Error(
            `Checksum drift detected for migration '${file}'. Applied SHA-256: ${appliedSha}, File SHA-256: ${fileSha256}`
          );
        }
        result.skipped.push(file);
      } else {
        // Apply migration in transaction
        const sqlContent = fileBytes.toString('utf-8');
        try {
          await client.query('BEGIN;');
          await client.query(`SET LOCAL search_path = ${safeSchema}, public;`);
          if (sqlContent.trim().length > 0) {
            await client.query(sqlContent);
          }
          if (file === AUTHORITY_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, false);
            authorityPolicyApplied = true;
          }
          if (file === CATALOG_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true);
            authorityPolicyApplied = true;
          }
          if (file === CATALOG_ADMIN_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true);
            authorityPolicyApplied = true;
          }
          if (file === ORDER_FOUNDATION_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === PROPERTY_HUB_FOUNDATION_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === SCHEDULING_APPOINTMENT_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === JOB_SERVICE_WORKSTREAM_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === MISSION_PLAN_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === MEDIA_ASSET_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === MEDIA_OPERATION_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === CAPTURE_SESSION_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === MEDIA_CULL_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === EDITOR_HANDOFF_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === RETURNED_REVIEW_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          if (file === PUBLICATION_DELIVERY_PACKET_MIGRATION) {
            await applyRuntimePrivilegePolicy(client, runtimeUser!, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
            authorityPolicyApplied = true;
          }
          await client.query(
            `INSERT INTO ${safeTable} (filename, sha256) VALUES ($1, $2);`,
            [file, fileSha256]
          );
          await client.query('COMMIT;');
          result.applied.push(file);
        } catch (err: any) {
          await client.query('ROLLBACK;');
          result.failed = {
            filename: file,
            error: err.message || String(err)
          };
          throw new Error(`Migration '${file}' failed: ${err.message || String(err)}`);
        }
      }
    }

    if (requiresRuntimeRole && !authorityPolicyApplied) {
      try {
        await client.query('BEGIN;');
        await applyRuntimePrivilegePolicy(
          client,
          runtimeUser!,
          sqlFiles.includes(CATALOG_PACKET_MIGRATION),
          sqlFiles.includes(CATALOG_ADMIN_PACKET_MIGRATION),
          sqlFiles.includes(ORDER_FOUNDATION_PACKET_MIGRATION),
          sqlFiles.includes(PROPERTY_HUB_FOUNDATION_PACKET_MIGRATION),
          sqlFiles.includes(SCHEDULING_APPOINTMENT_PACKET_MIGRATION),
          sqlFiles.includes(JOB_SERVICE_WORKSTREAM_PACKET_MIGRATION),
          sqlFiles.includes(MISSION_PLAN_PACKET_MIGRATION),
          sqlFiles.includes(MEDIA_ASSET_PACKET_MIGRATION),
          sqlFiles.includes(MEDIA_OPERATION_PACKET_MIGRATION),
          sqlFiles.includes(CAPTURE_SESSION_PACKET_MIGRATION),
          sqlFiles.includes(MEDIA_CULL_PACKET_MIGRATION),
          sqlFiles.includes(EDITOR_HANDOFF_PACKET_MIGRATION),
          sqlFiles.includes(RETURNED_REVIEW_PACKET_MIGRATION),
          sqlFiles.includes(PUBLICATION_DELIVERY_PACKET_MIGRATION)
        );
        await client.query('COMMIT;');
      } catch (err) {
        await client.query('ROLLBACK;');
        throw err;
      }
    }

    return result;
  } finally {
    if (ownClient && client) {
      await client.end();
    }
  }
}

// Path-safe CLI entrypoint detection
const currentPath = fileURLToPath(import.meta.url);
const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (scriptPath && currentPath === scriptPath) {
  const targetDb = process.env.PGDATABASE || 'medialab_p02m14a_test';
  const targetUser = process.env.PGUSER;
  const runtimeUser = process.env.PGRUNTIMEUSER;

  if (!targetUser || !runtimeUser) {
    console.error('Migration CLI requires PGUSER as migration owner and PGRUNTIMEUSER as restricted runtime role.');
    process.exit(1);
  }

  const __dirname = path.dirname(currentPath);
  const migrationsDir = path.resolve(__dirname, 'migrations');

  runMigrations({
    migrationsDir,
    database: targetDb,
    user: targetUser,
    runtimeUser
  })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      const failResult: MigrationResult = {
        applied: [],
        skipped: [],
        failed: {
          filename: 'unknown',
          error: err.message || String(err)
        }
      };
      console.log(JSON.stringify(failResult, null, 2));
      process.exit(1);
    });
}
