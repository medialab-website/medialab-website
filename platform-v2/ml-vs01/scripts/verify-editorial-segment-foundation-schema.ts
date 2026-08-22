import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = '0026_editorial_segment_foundation.sql';
const migrationBytes = fs.readFileSync(path.join(baseDir, 'db/migrations', migrationName));
const migrationSha256 = crypto.createHash('sha256').update(migrationBytes).digest('hex');
const client = new pg.Client({
  host: '/tmp/mlvs01-p02m16a-pg',
  port: 55447,
  database: 'medialab_p02m16a_test',
  user: 'medialab_p02m16a_test_owner'
});
const runtimeRole = 'medialab_p02m16a_test_app';
const failures: string[] = [];
const exactTables = [
  'editorial_segment_current',
  'editorial_segment_decision_events',
  'editorial_segment_versions',
  'editorial_segments',
  'media_technical_observation_current',
  'media_technical_observations'
];
const publicApis = [
  'clear_editorial_segment_decision',
  'create_editorial_segment',
  'decide_editorial_segment',
  'get_editorial_segment',
  'list_editorial_segments',
  'record_media_technical_observation',
  'revise_editorial_segment'
];

function exact(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

await client.connect();
try {
  const ledger = await client.query<{ filename: string; sha256: string }>(
    'SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename'
  );
  exact('migration count', ledger.rows.length, 28);
  exact('migration 0026 identity', ledger.rows[25], { filename: migrationName, sha256: migrationSha256 });

  const tables = await client.query<{ relname: string }>(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='medialab_core'
    AND c.relkind='r' AND (c.relname LIKE 'editorial_segment%' OR c.relname LIKE 'media_technical_observation%')
    ORDER BY c.relname`);
  exact('packet tables', tables.rows.map((row) => row.relname), exactTables);

  const permissions = await client.query<{ code: string }>(
    "SELECT code FROM medialab_core.permissions WHERE code LIKE 'editorial_segment.%' ORDER BY code"
  );
  exact('packet permissions', permissions.rows.map((row) => row.code), ['editorial_segment.manage', 'editorial_segment.read']);

  const functions = await client.query<{ proname: string; runtime: boolean; public: boolean }>(`SELECT p.proname,
    has_function_privilege($1,p.oid,'EXECUTE') AS runtime,
    has_function_privilege('public',p.oid,'EXECUTE') AS public
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='medialab_core' AND
      (p.proname LIKE '%editorial_segment%' OR p.proname='record_media_technical_observation')
    ORDER BY p.proname`, [runtimeRole]);
  exact('runtime APIs', functions.rows.filter((row) => row.runtime).map((row) => row.proname), publicApis);
  if (functions.rows.some((row) => row.public)) failures.push('PUBLIC retains packet function execution');

  const authority = await client.query<{ direct_tables: number; public_tables: number; runtime_sequences: number }>(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND c.relname=ANY($2::text[])
      AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) AS direct_tables,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND c.relname=ANY($2::text[])
      AND has_table_privilege('public',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) AS public_tables,
    (SELECT count(*)::int FROM information_schema.role_usage_grants
      WHERE grantee=$1 AND object_schema='medialab_core' AND object_type='SEQUENCE') AS runtime_sequences`,
  [runtimeRole, exactTables]);
  exact('least privilege', authority.rows[0], { direct_tables: 0, public_tables: 0, runtime_sequences: 0 });

  const triggers = await client.query<{ tgname: string }>(`SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='medialab_core' AND NOT t.tgisinternal
    AND t.tgname IN ('media_technical_observations_immutability_guard','editorial_segments_immutability_guard',
      'editorial_segment_versions_immutability_guard','editorial_segment_decision_events_immutability_guard')
    ORDER BY t.tgname`);
  exact('append-only triggers', triggers.rows.map((row) => row.tgname), [
    'editorial_segment_decision_events_immutability_guard',
    'editorial_segment_versions_immutability_guard',
    'editorial_segments_immutability_guard',
    'media_technical_observations_immutability_guard'
  ]);

  const operationalRows = await client.query<{ n: number }>(`SELECT sum(n)::int AS n FROM (
    SELECT count(*) n FROM medialab_core.media_technical_observations
    UNION ALL SELECT count(*) FROM medialab_core.editorial_segments
    UNION ALL SELECT count(*) FROM medialab_core.editorial_segment_versions
    UNION ALL SELECT count(*) FROM medialab_core.editorial_segment_decision_events
  ) packet_rows`);
  exact('permission-only reset', operationalRows.rows[0].n, 0);
} finally {
  await client.end();
}

const result = {
  verifier: 'P02_M20_A_EDITORIAL_SEGMENT_FOUNDATION_V1',
  pass: failures.length === 0,
  migration: migrationName,
  migrationSha256,
  runtimeApis: publicApis,
  failures
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exit(1);
