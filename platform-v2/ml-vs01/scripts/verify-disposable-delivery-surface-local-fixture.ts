import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createSyntheticFixtureDownload } from '../src/disposable-delivery/fixture-download.js';
import { DISPOSABLE_DELIVERY_CSP, DISPOSABLE_DELIVERY_HTML, DISPOSABLE_DELIVERY_JAVASCRIPT } from '../src/disposable-delivery/page.js';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = '0020_disposable_delivery_surface_local_fixture_foundation.sql';
const migrationBytes = fs.readFileSync(path.join(base, 'db/migrations', migration));
const migrationHash = crypto.createHash('sha256').update(migrationBytes).digest('hex');
const migrationSql = migrationBytes.toString('utf8');
const sourceFiles = ['app.ts', 'database.ts', 'page.ts', 'fixture-download.ts'].map((name) =>
  fs.readFileSync(path.join(base, 'src/disposable-delivery', name), 'utf8')).join('\n');
const packageJson = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));

function fail(message: string): never {
  throw new Error(`DISPOSABLE_DELIVERY_SURFACE_LOCAL_FIXTURE_VERIFICATION_FAILED: ${message}`);
}

if (packageJson.dependencies?.fastify !== '5.11.2') fail('Fastify is not pinned exactly to 5.11.2 as a required packet-owned runtime dependency');
if (JSON.stringify(Object.keys(packageJson.dependencies).sort()) !== JSON.stringify(['fastify', 'pg']) ||
    Object.keys(packageJson.optionalDependencies ?? {}).length !== 0) fail('unexpected or optional runtime dependency detected');
if (!sourceFiles.includes("const LOOPBACK_HOST = '127.0.0.1'") || !sourceFiles.includes("host !== LOOPBACK_HOST")) fail('loopback-only bind guard is absent');
for (const route of ['/d/:credentialId', '/assets/disposable-delivery.js', '/api/disposable-delivery/open', '/api/disposable-delivery/download']) {
  if (!sourceFiles.includes(route)) fail(`required route ${route} is absent`);
}
if (!DISPOSABLE_DELIVERY_JAVASCRIPT.includes("location.hash.startsWith('#')") ||
    !DISPOSABLE_DELIVERY_JAVASCRIPT.includes("history.replaceState(null, '', location.pathname)")) fail('fragment handoff and immediate fragment removal are absent');
if (/localStorage|sessionStorage|indexedDB|document\.cookie|console\./.test(DISPOSABLE_DELIVERY_JAVASCRIPT)) fail('browser persistence or logging mechanism detected');
if (/https?:\/\//i.test(DISPOSABLE_DELIVERY_HTML + DISPOSABLE_DELIVERY_JAVASCRIPT) ||
    /signed[_ -]?url|provider[_ -]?(url|path)|storage[_ -]?(url|path)/i.test(sourceFiles)) fail('third-party, public/signed URL, provider, or storage path mechanism detected');
for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"]) {
  if (!DISPOSABLE_DELIVERY_CSP.includes(directive)) fail(`CSP directive missing: ${directive}`);
}
if (!sourceFiles.includes("reply.header('x-robots-tag', 'noindex, nofollow')")) fail('X-Robots-Tag noindex/nofollow header is absent');
const fixtureA = createSyntheticFixtureDownload('11111111-1111-4111-8111-111111111111');
const fixtureB = createSyntheticFixtureDownload('11111111-1111-4111-8111-111111111111');
if (!fixtureA.bytes.equals(fixtureB.bytes) || fixtureA.bytes.length > 512 || fixtureA.sha256 !== fixtureB.sha256) fail('synthetic fixture is not deterministic and bounded');
if (!migrationSql.includes('evaluate_temporary_download_center_gateway_access') || /CREATE TABLE/i.test(migrationSql)) fail('manifest projection does not narrowly reuse M15-B or creates an unauthorized table');

const client = new pg.Client({
  host: '/tmp/mlvs01-p02m16a-pg',
  port: 55447,
  database: 'medialab_p02m16a_test',
  user: 'medialab_p02m16a_test_owner'
});

await client.connect();
try {
  const ledger = await client.query('SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  if (ledger.rows.length !== 28 || ledger.rows[19].filename !== migration || ledger.rows[19].sha256 !== migrationHash || ledger.rows[20].filename !== '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql' || ledger.rows[22].filename !== '0023_runtime_intake_reconciliation_commands.sql') fail('migration ledger identity mismatch');

  const fn = await client.query(`SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
      pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,
      has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='medialab_core' AND p.proname='get_temporary_download_center_delivery_manifest'`, ['medialab_p02m16a_test_app']);
  if (fn.rows.length !== 1) fail('safe manifest function inventory mismatch');
  const row = fn.rows[0];
  if (!row.prosecdef || row.owner !== 'medialab_p02m16a_test_owner' || !row.runtime || row.public ||
      JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp'])) fail('manifest function owner/security/privilege mismatch');
  if (row.arguments !== 'p_credential uuid, p_presented_secret text, p_access_event_reference text, p_evidence jsonb') fail('manifest function signature mismatch');
  if (!row.definition.includes('evaluate_temporary_download_center_gateway_access')) fail('manifest function does not reuse the accepted gateway');
  if (/verifier_sha256|media_asset_version_id|source_order_id|organization_id|property_hub_id/.test(row.definition.split("jsonb_build_object(\n    'status'")[1] ?? '')) fail('manifest return projection exposes internal evidence');

  const runtimeTables = await client.query(`SELECT count(*)::int n FROM information_schema.role_table_grants
    WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE')`, ['medialab_p02m16a_test_app']);
  if (runtimeTables.rows[0].n !== 0) fail('restricted runtime has direct table DML');
  const publicFunctions = await client.query(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='medialab_core' AND has_function_privilege('public',p.oid,'EXECUTE')`);
  if (publicFunctions.rows[0].n !== 0) fail('PUBLIC function execution authority is not zero');
} finally {
  await client.end();
}

console.log(JSON.stringify({
  status: 'DISPOSABLE_DELIVERY_SURFACE_LOCAL_FIXTURE_VERIFIED',
  migration,
  migrationSize: migrationBytes.length,
  migrationSha256: migrationHash,
  fastify: packageJson.dependencies.fastify,
  bind: '127.0.0.1',
  syntheticFixtureSize: fixtureA.bytes.length,
  syntheticFixtureSha256: fixtureA.sha256
}, null, 2));
