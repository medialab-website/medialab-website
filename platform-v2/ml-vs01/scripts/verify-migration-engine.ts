import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

console.log('Running verify-migration-engine.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

let errors = false;

// 1. Missing migration engine files & tests
const requiredEngineFiles = [
  'db/migrate.ts',
  'db/migrations/README.md',
  'tests/migration-engine.test.ts'
];

for (const relPath of requiredEngineFiles) {
  const fullPath = path.join(baseDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`ERROR: Required migration engine file missing: ${relPath}`);
    errors = true;
  }
}

// 2. Canonical migration directory checks
const canonicalDir = path.join(baseDir, 'db/migrations');
if (fs.existsSync(canonicalDir)) {
  const files = fs.readdirSync(canonicalDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  if (
    sqlFiles.length !== 22 ||
    sqlFiles[0] !== '0001_identity_and_tenancy.sql' ||
    sqlFiles[1] !== '0002_property_identity_and_snapshots.sql' ||
    sqlFiles[2] !== '0003_person_contacts_and_account_lifecycle.sql' ||
    sqlFiles[3] !== '0004_current_catalog_and_price_snapshots.sql' ||
    sqlFiles[4] !== '0005_catalog_administration_lifecycle.sql' ||
    sqlFiles[5] !== '0006_orders_and_immutable_commercial_evidence.sql' ||
    sqlFiles[6] !== '0007_property_hub_foundation.sql' ||
    sqlFiles[7] !== '0008_scheduling_request_and_appointment_foundation.sql' ||
    sqlFiles[8] !== '0009_job_and_service_workstream_foundation.sql' ||
    sqlFiles[9] !== '0010_mission_plan_foundation.sql' ||
    sqlFiles[10] !== '0011_media_asset_identity_and_lineage_foundation.sql' ||
    sqlFiles[11] !== '0012_durable_media_operations_reconciliation_foundation.sql' ||
    sqlFiles[12] !== '0013_capture_session_ingest_custody_foundation.sql' ||
    sqlFiles[13] !== '0014_media_cull_workspace_selected_media_evidence_foundation.sql' ||
    sqlFiles[14] !== '0015_editor_handoff_returned_media_intake_foundation.sql' ||
    sqlFiles[15] !== '0016_returned_editor_review_final_source_decision_foundation.sql' ||
    sqlFiles[16] !== '0017_publication_delivery_entitlement_foundation.sql' ||
    sqlFiles[17] !== '0018_temporary_download_center_external_sharing_foundation.sql' ||
    sqlFiles[18] !== '0019_temporary_download_center_access_credential_gateway_foundation.sql' ||
    sqlFiles[19] !== '0020_disposable_delivery_surface_local_fixture_foundation.sql' ||
    sqlFiles[20] !== '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql' ||
    sqlFiles[21] !== '0022_organization_records_dashboard_audited_export_foundation.sql'
  ) {
    console.error(`ERROR: Canonical migration directory must contain exactly 0001 through 0022. Found: ${sqlFiles.join(', ')}`);
    errors = true;
  }

  // Check all non-README files or non-sql files for invalid naming if any exist
  for (const f of files) {
    if (f.endsWith('.sql')) {
      if (!/^[0-9]{4}_[a-z0-9_]+\.sql$/.test(f)) {
        console.error(`ERROR: Invalid canonical migration filename: ${f}`);
        errors = true;
      }
    }
  }
} else {
  console.error(`ERROR: Canonical migration directory db/migrations missing`);
  errors = true;
}

// 3. Package-lock hash verification
const lockPath = path.join(baseDir, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lockBytes = fs.readFileSync(lockPath);
  const lockHash = crypto.createHash('sha256').update(lockBytes).digest('hex').toLowerCase();
  const expectedHash = '2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a';

  if (lockHash !== expectedHash) {
    console.error(`ERROR: package-lock.json SHA-256 changed! Expected: ${expectedHash}, Got: ${lockHash}`);
    errors = true;
  }
} else {
  console.error(`ERROR: package-lock.json missing`);
  errors = true;
}

// 4. Check that migration fixtures are isolated under tests/fixtures/migrations or db/migrations
function searchSqlFiles(dirPath: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;
  const list = fs.readdirSync(dirPath);
  for (const file of list) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(searchSqlFiles(filePath));
    } else if (file.endsWith('.sql')) {
      results.push(filePath);
    }
  }
  return results;
}

const allSqlFiles = searchSqlFiles(baseDir);
const allowedFixturePrefix = path.join(baseDir, 'tests/fixtures/migrations');
const allowedCanonical1 = path.join(baseDir, 'db/migrations/0001_identity_and_tenancy.sql');
const allowedCanonical2 = path.join(baseDir, 'db/migrations/0002_property_identity_and_snapshots.sql');
const allowedCanonical3 = path.join(baseDir, 'db/migrations/0003_person_contacts_and_account_lifecycle.sql');
const allowedCanonical4 = path.join(baseDir, 'db/migrations/0004_current_catalog_and_price_snapshots.sql');
const allowedCanonical5 = path.join(baseDir, 'db/migrations/0005_catalog_administration_lifecycle.sql');
const allowedCanonical6 = path.join(baseDir, 'db/migrations/0006_orders_and_immutable_commercial_evidence.sql');
const allowedCanonical7 = path.join(baseDir, 'db/migrations/0007_property_hub_foundation.sql');
const allowedCanonical8 = path.join(baseDir, 'db/migrations/0008_scheduling_request_and_appointment_foundation.sql');
const allowedCanonical9 = path.join(baseDir, 'db/migrations/0009_job_and_service_workstream_foundation.sql');
const allowedCanonical10 = path.join(baseDir, 'db/migrations/0010_mission_plan_foundation.sql');
const allowedCanonical11 = path.join(baseDir, 'db/migrations/0011_media_asset_identity_and_lineage_foundation.sql');
const allowedCanonical12 = path.join(baseDir, 'db/migrations/0012_durable_media_operations_reconciliation_foundation.sql');
const allowedCanonical13 = path.join(baseDir, 'db/migrations/0013_capture_session_ingest_custody_foundation.sql');
const allowedCanonical14 = path.join(baseDir, 'db/migrations/0014_media_cull_workspace_selected_media_evidence_foundation.sql');
const allowedCanonical15 = path.join(baseDir, 'db/migrations/0015_editor_handoff_returned_media_intake_foundation.sql');
const allowedCanonical16 = path.join(baseDir, 'db/migrations/0016_returned_editor_review_final_source_decision_foundation.sql');
const allowedCanonical17 = path.join(baseDir, 'db/migrations/0017_publication_delivery_entitlement_foundation.sql');
const allowedCanonical18 = path.join(baseDir, 'db/migrations/0018_temporary_download_center_external_sharing_foundation.sql');
const allowedCanonical19 = path.join(baseDir, 'db/migrations/0019_temporary_download_center_access_credential_gateway_foundation.sql');
const allowedCanonical20 = path.join(baseDir, 'db/migrations/0020_disposable_delivery_surface_local_fixture_foundation.sql');
const allowedCanonical21 = path.join(baseDir, 'db/migrations/0021_provider_neutral_file_backed_disposable_delivery_foundation.sql');
const allowedCanonical22 = path.join(baseDir, 'db/migrations/0022_organization_records_dashboard_audited_export_foundation.sql');

for (const sqlFile of allSqlFiles) {
  if (
    !sqlFile.startsWith(allowedFixturePrefix) &&
    sqlFile !== allowedCanonical1 &&
    sqlFile !== allowedCanonical2 &&
    sqlFile !== allowedCanonical3 &&
    sqlFile !== allowedCanonical4 &&
    sqlFile !== allowedCanonical5 &&
    sqlFile !== allowedCanonical6 &&
    sqlFile !== allowedCanonical7 &&
    sqlFile !== allowedCanonical8 &&
    sqlFile !== allowedCanonical9 &&
    sqlFile !== allowedCanonical10 &&
    sqlFile !== allowedCanonical11 &&
    sqlFile !== allowedCanonical12 &&
    sqlFile !== allowedCanonical13 &&
    sqlFile !== allowedCanonical14 &&
    sqlFile !== allowedCanonical15 &&
    sqlFile !== allowedCanonical16 &&
    sqlFile !== allowedCanonical17 &&
    sqlFile !== allowedCanonical18 &&
    sqlFile !== allowedCanonical19 &&
    sqlFile !== allowedCanonical20 &&
    sqlFile !== allowedCanonical21 &&
    sqlFile !== allowedCanonical22
  ) {
    console.error(`ERROR: SQL file outside isolated test-fixture directory: ${sqlFile}`);
    errors = true;
  }
}

if (errors) {
  console.error('Migration engine gate FAILED.');
  process.exit(1);
}

console.log('Migration engine gate PASSED.');
