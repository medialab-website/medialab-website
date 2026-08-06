import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

console.log('Running verify-property-snapshot-schema.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

let errors = false;

// 1. Required files
const requiredFiles = [
  'db/migrations/0001_identity_and_tenancy.sql',
  'db/migrations/0002_property_identity_and_snapshots.sql',
  'scripts/verify-property-snapshot-schema.ts',
  'tests/property-snapshot-schema.test.ts'
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(baseDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`ERROR: Required file missing: ${relPath}`);
    errors = true;
  }
}

// 2. Canonical migration checks
const migrationsDir = path.join(baseDir, 'db/migrations');
const migrations = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
if (
  migrations.length !== 15 ||
  migrations[0] !== '0001_identity_and_tenancy.sql' ||
  migrations[1] !== '0002_property_identity_and_snapshots.sql' ||
  migrations[2] !== '0003_person_contacts_and_account_lifecycle.sql' ||
  migrations[3] !== '0004_current_catalog_and_price_snapshots.sql' ||
  migrations[4] !== '0005_catalog_administration_lifecycle.sql' ||
  migrations[5] !== '0006_orders_and_immutable_commercial_evidence.sql' ||
  migrations[6] !== '0007_property_hub_foundation.sql' ||
  migrations[7] !== '0008_scheduling_request_and_appointment_foundation.sql' ||
  migrations[8] !== '0009_job_and_service_workstream_foundation.sql' ||
  migrations[9] !== '0010_mission_plan_foundation.sql' ||
  migrations[10] !== '0011_media_asset_identity_and_lineage_foundation.sql' ||
  migrations[11] !== '0012_durable_media_operations_reconciliation_foundation.sql' ||
  migrations[12] !== '0013_capture_session_ingest_custody_foundation.sql' ||
  migrations[13] !== '0014_media_cull_workspace_selected_media_evidence_foundation.sql' ||
  migrations[14] !== '0015_editor_handoff_returned_media_intake_foundation.sql'
) {
  console.error(`ERROR: Unexpected migration inventory: ${migrations.join(', ')}`);
  errors = true;
}

// SHA256 checks
const m1Content = fs.readFileSync(path.join(migrationsDir, '0001_identity_and_tenancy.sql'));
const m1Sha256 = crypto.createHash('sha256').update(m1Content).digest('hex').toLowerCase();
if (m1Sha256 !== '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31') {
  console.error(`ERROR: Migration 0001 SHA256 mismatch. Got: ${m1Sha256}`);
  errors = true;
}

const m2Content = fs.readFileSync(path.join(migrationsDir, '0002_property_identity_and_snapshots.sql'));
const m2Sha256 = crypto.createHash('sha256').update(m2Content).digest('hex').toLowerCase();
if (m2Sha256 !== 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83') {
  console.error(`ERROR: Migration 0002 SHA256 mismatch. Got: ${m2Sha256}`);
  errors = true;
}

// package-lock SHA256
const lockFile = path.join(baseDir, 'package-lock.json');
const lockContent = fs.readFileSync(lockFile);
const lockSha256 = crypto.createHash('sha256').update(lockContent).digest('hex').toLowerCase();
if (lockSha256 !== '11cc280ef7ff1c66638bc1cc3e85c750844f6041bcf338a5b59c55b0f79d9258') {
  console.error(`ERROR: package-lock.json SHA256 mismatch. Got: ${lockSha256}`);
  errors = true;
}

// 3. Test file substantive check
const testFile = path.join(baseDir, 'tests/property-snapshot-schema.test.ts');
if (fs.existsSync(testFile)) {
  const content = fs.readFileSync(testFile, 'utf8');
  if (content.includes('.skip(') || content.includes('.todo(')) {
    console.error(`ERROR: Test file contains skipped or todo tests.`);
    errors = true;
  }
  if (!content.includes('expect(')) {
    console.error(`ERROR: Test file does not contain expect assertions.`);
    errors = true;
  }
  if (!content.includes('.query(')) {
    console.error(`ERROR: Test file does not contain database queries.`);
    errors = true;
  }
}

if (errors) {
  console.error('Property Snapshot schema verification FAILED.');
  process.exit(1);
}

console.log('Property Snapshot schema verification PASSED.');
