import crypto from 'node:crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';

const connection = {
  host: '/tmp/mlvs01-p02m16a-pg',
  port: 55447,
  database: 'medialab_p02m16a_test',
  user: 'medialab_p02m16a_test_owner'
};
const runtimeUser = 'medialab_p02m16a_test_app';
const packetTables = [
  'editorial_segment_current',
  'editorial_segment_decision_events',
  'editorial_segment_versions',
  'editorial_segments',
  'media_technical_observation_current',
  'media_technical_observations'
];

async function reset(): Promise<void> {
  await resetTestDatabase({ ...connection, runtimeUser, confirm: connection.database });
}

async function snapshot(): Promise<{ sha256: string; bytes: number }> {
  const client = new pg.Client(connection);
  await client.connect();
  try {
    const ledger = await client.query(`SELECT filename,sha256 FROM medialab_meta.schema_migrations
      WHERE filename='0026_editorial_segment_foundation.sql' ORDER BY filename`);
    const permissions = await client.query(`SELECT p.id,p.code,p.description,p.is_active,p.created_at,
      psp.permission_set_id FROM medialab_core.permissions p
      JOIN medialab_core.permission_set_permissions psp ON psp.permission_id=p.id
      WHERE p.code LIKE 'editorial_segment.%' ORDER BY p.code`);
    const columns = await client.query(`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
      FROM information_schema.columns WHERE table_schema='medialab_core' AND table_name=ANY($1::text[])
      ORDER BY table_name,ordinal_position`, [packetTables]);
    const constraints = await client.query(`SELECT c.relname AS table_name,con.conname,con.contype,
      pg_get_constraintdef(con.oid,true) AS definition FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND c.relname=ANY($1::text[])
      ORDER BY c.relname,con.conname`, [packetTables]);
    const functions = await client.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
      p.prosecdef,p.provolatile,p.proconfig,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND
        (p.proname LIKE '%editorial_segment%' OR p.proname='record_media_technical_observation')
      ORDER BY p.proname,arguments`);
    const triggers = await client.query(`SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid,true) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND NOT t.tgisinternal AND c.relname=ANY($1::text[])
      ORDER BY c.relname,t.tgname`, [packetTables]);
    const counts = await client.query(`SELECT
      (SELECT count(*)::int FROM medialab_core.media_technical_observations) AS technical_observations,
      (SELECT count(*)::int FROM medialab_core.editorial_segments) AS segments,
      (SELECT count(*)::int FROM medialab_core.editorial_segment_versions) AS versions,
      (SELECT count(*)::int FROM medialab_core.editorial_segment_decision_events) AS decisions`);
    const canonical = JSON.stringify({ ledger: ledger.rows, permissions: permissions.rows, columns: columns.rows,
      constraints: constraints.rows, functions: functions.rows, triggers: triggers.rows, counts: counts.rows[0] });
    return { sha256: crypto.createHash('sha256').update(canonical).digest('hex'), bytes: Buffer.byteLength(canonical) };
  } finally {
    await client.end();
  }
}

await reset();
const first = await snapshot();
await reset();
const second = await snapshot();
if (first.sha256 !== second.sha256 || first.bytes !== second.bytes) {
  throw new Error(`P02-M20-A deterministic reset mismatch: first=${JSON.stringify(first)} second=${JSON.stringify(second)}`);
}
console.log(JSON.stringify({
  verifier: 'P02_M20_A_TWO_RESET_DETERMINISM_V1',
  pass: true,
  runs: 2,
  semanticSha256: first.sha256,
  canonicalBytes: first.bytes,
  operationalRows: 0
}, null, 2));
