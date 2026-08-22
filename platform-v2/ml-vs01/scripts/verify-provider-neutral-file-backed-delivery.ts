import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql';
const migrationBytes = fs.readFileSync(path.join(base, 'db/migrations', migration));
const migrationSha256 = crypto.createHash('sha256').update(migrationBytes).digest('hex');
const migrationSql = migrationBytes.toString('utf8');
const appSource = fs.readFileSync(path.join(base, 'src/disposable-delivery/app.ts'), 'utf8');
const databaseSource = fs.readFileSync(path.join(base, 'src/disposable-delivery/database.ts'), 'utf8');
const adapterSource = fs.readFileSync(path.join(base, 'src/disposable-delivery/local-file-adapter.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
const lockSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(base, 'package-lock.json'))).digest('hex');

function fail(message: string): never {
  throw new Error(`PROVIDER_NEUTRAL_FILE_BACKED_DELIVERY_VERIFICATION_FAILED: ${message}`);
}

if (JSON.stringify(packageJson.dependencies) !== JSON.stringify({ fastify: '5.11.2', pg: '8.22.0' })) fail('required runtime dependency identity changed');
if (lockSha256 !== '2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a') fail('package-lock identity changed');
if (/CREATE\s+TABLE/i.test(migrationSql)) fail('0021 creates an unauthorized durable table');
if ((migrationSql.match(/evaluate_temporary_download_center_gateway_access/g) ?? []).length !== 1) fail('resolver must call the accepted gateway exactly once');
for (const required of ['temporary_download_center_items', 'media_asset_versions', 'media_storage_objects', 'storage_count <> 1', 'SECURITY DEFINER', 'SET search_path=pg_catalog,medialab_core,pg_temp']) {
  if (!migrationSql.includes(required)) fail(`migration invariant missing: ${required}`);
}
if (!databaseSource.includes("'LOCAL_FIXTURE', 'M15D_DELIVERY'")) fail('provider and namespace are not selected server-side');
if (!appSource.includes('database.resolveDownloadSource') || !appSource.includes('byteSource.read(descriptor)')) fail('active DOWNLOAD route does not use resolver then byte source');
if (appSource.includes('createSyntheticFixtureDownload') || appSource.includes("from './fixture-download.js'")) fail('active DOWNLOAD route still uses generated predecessor bytes');
if (/credentialId.*secret.*accessEventReference.*itemId.*provider/s.test(appSource)) fail('recipient request surface appears to accept provider selection');
for (const required of ['path.isAbsolute', "identifier.includes('\\\\')", 'realpath', 'lstat', 'O_NOFOLLOW', "createHash('sha256')", 'fileStat.size !== descriptor.byte_size', 'sha256 !== descriptor.checksum_sha256']) {
  if (!adapterSource.includes(required)) fail(`local adapter safety control missing: ${required}`);
}
if (/\breaddir(?:Sync)?\b|\bfetch\b|node:https|node:http|signed[_ -]?url|presigned/i.test(adapterSource + appSource + databaseSource)) fail('filesystem enumeration, network, or signed URL mechanism detected');

const client = new pg.Client({ host: '/tmp/mlvs01-p02m16a-pg', port: 55447, database: 'medialab_p02m16a_test', user: 'medialab_p02m16a_test_owner' });
await client.connect();
try {
  const ledger = await client.query('SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  if (ledger.rows.length !== 27 || ledger.rows[20].filename !== migration || ledger.rows[20].sha256 !== migrationSha256 || ledger.rows[22].filename !== '0023_runtime_intake_reconciliation_commands.sql') fail('migration ledger identity mismatch');
  const fn = await client.query(`SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
      pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,
      has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='medialab_core' AND p.proname='resolve_temporary_download_center_delivery_source'`, ['medialab_p02m16a_test_app']);
  if (fn.rows.length !== 1) fail('resolver function inventory mismatch');
  const row = fn.rows[0];
  if (!row.prosecdef || row.owner !== 'medialab_p02m16a_test_owner' || !row.runtime || row.public ||
      JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp'])) fail('resolver owner/security/privilege mismatch');
  if (row.arguments !== 'p_credential uuid, p_presented_secret text, p_access_event_reference text, p_item uuid, p_evidence jsonb, p_provider text, p_storage_namespace text') fail('resolver signature mismatch');
  if ((row.definition.match(/evaluate_temporary_download_center_gateway_access/g) ?? []).length !== 1 || /\b(?:INSERT|UPDATE|DELETE)\b/i.test(row.definition)) fail('resolver gateway reuse or no-direct-DML boundary mismatch');
  const runtimeDml = await client.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE')`, ['medialab_p02m16a_test_app']);
  if (runtimeDml.rows[0].n !== 0) fail('restricted runtime has direct table DML');
  const publicFunctions = await client.query(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND has_function_privilege('public',p.oid,'EXECUTE')`);
  if (publicFunctions.rows[0].n !== 0) fail('PUBLIC function execution authority is not zero');
} finally {
  await client.end();
}

console.log(JSON.stringify({
  status: 'PROVIDER_NEUTRAL_FILE_BACKED_DELIVERY_VERIFIED',
  migration,
  migrationSize: migrationBytes.length,
  migrationSha256,
  packageLockSha256: lockSha256,
  provider: 'LOCAL_FIXTURE',
  namespace: 'M15D_DELIVERY',
  adapter: 'CONTROLLED_LOCAL_FILE_SHA256_SIZE_VERIFIED'
}, null, 2));
