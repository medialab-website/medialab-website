import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import crypto from 'crypto';

describe('P02-M01 Property Identity and Immutable Snapshot Schema', () => {
  const poolTest = new Pool({
    host: '/tmp/mlvs01-p02m04a-pg',
    port: 55432,
    database: 'medialab_p02m04a_test',
    user: 'medialab_p02m04a_test_owner'
  });

  const poolDev = new Pool({
    host: '/tmp/mlvs01-p02m04a-pg',
    port: 55432,
    database: 'medialab_p02m04a',
    user: 'medialab_p02m04a_owner'
  });

  afterAll(async () => {
    await poolTest.end();
    await poolDev.end();
  });

  for (const [env, pool] of Object.entries({ test: poolTest, dev: poolDev })) {
    describe(`Migration Ledger Assertions (${env})`, () => {
      it('1 & 2. Verify migration ledger contents and exact checksums', async () => {
        const res = await pool.query(`SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename ASC`);
        expect(res.rows).toHaveLength(6);
        
        expect(res.rows[0].filename).toBe('0001_identity_and_tenancy.sql');
        expect(res.rows[0].sha256).toBe('29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31');

        expect(res.rows[1].filename).toBe('0002_property_identity_and_snapshots.sql');
        expect(res.rows[1].sha256).toBe('d3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83');

        expect(res.rows[2].filename).toBe('0003_person_contacts_and_account_lifecycle.sql');
        expect(res.rows[2].sha256).toBe('984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3');

        expect(res.rows[3].filename).toBe('0004_current_catalog_and_price_snapshots.sql');
        expect(res.rows[3].sha256).toBe('e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876');
        expect(res.rows[4].filename).toBe('0005_catalog_administration_lifecycle.sql');
        expect(res.rows[4].sha256).toBe('928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40');
        expect(res.rows[5].filename).toBe('0006_orders_and_immutable_commercial_evidence.sql');
        expect(res.rows[5].sha256).toMatch(/^[0-9a-f]{64}$/);
      });

      it('Catalog Assertions: properties and property_snapshots exist with correct owners', async () => {
        const res = await pool.query(`
          SELECT tablename, tableowner FROM pg_tables 
          WHERE schemaname = 'medialab_core' AND tablename IN ('properties', 'property_snapshots')
          ORDER BY tablename
        `);
        expect(res.rows).toHaveLength(2);
        const expectedOwner = env === 'test' ? 'medialab_p02m04a_test_owner' : 'medialab_p02m04a_owner';
        expect(res.rows[0].tableowner).toBe(expectedOwner);
        expect(res.rows[1].tableowner).toBe(expectedOwner);
      });
    });
  }

  describe('Property and Property Snapshot Domain Laws (Transaction Scoped)', () => {
    let client: pkg.PoolClient;

    beforeAll(async () => {
      client = await poolTest.connect();
    });

    afterAll(() => {
      if (client) {
        client.release();
      }
    });

    async function expectDbError(sql: string, params: any[] = []) {
      await client.query('SAVEPOINT sp_prop_test');
      await expect(client.query(sql, params)).rejects.toThrow();
      await client.query('ROLLBACK TO sp_prop_test');
    }

    async function runInTransaction(fn: () => Promise<void>) {
      await client.query('BEGIN');
      try {
        await fn();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('3. Property rejects a nonexistent organization', async () => {
      await runInTransaction(async () => {
        const fakeOrgId = crypto.randomUUID();
        const propId = crypto.randomUUID();
        await expectDbError(
          `INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`,
          [propId, fakeOrgId]
        );
      });
    });

    it('4. Snapshot cannot reference a property owned by another organization', async () => {
      await runInTransaction(async () => {
        const orgId1 = crypto.randomUUID();
        const orgId2 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org 1'), ($2, 'Org 2')`, [orgId1, orgId2]);

        const propId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`, [propId, orgId1]);

        const snapId = crypto.randomUUID();
        // Attemping to create snapshot referencing orgId2 for property owned by orgId1 must fail composite FK
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '123 Main St', 'City', 'ST', '12345')`,
          [snapId, propId, orgId2]
        );
      });
    });

    it('5. Same address can exist in two separate organizations', async () => {
      await runInTransaction(async () => {
        const orgId1 = crypto.randomUUID();
        const orgId2 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org A'), ($2, 'Org B')`, [orgId1, orgId2]);

        const propId1 = crypto.randomUUID();
        const propId2 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2), ($3, $4)`, [propId1, orgId1, propId2, orgId2]);

        const snapId1 = crypto.randomUUID();
        const snapId2 = crypto.randomUUID();
        
        await client.query(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '100 Main St', 'Richland', 'WA', '99352')`,
          [snapId1, propId1, orgId1]
        );

        await client.query(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '100 Main St', 'Richland', 'WA', '99352')`,
          [snapId2, propId2, orgId2]
        );

        const res1 = await client.query(`SELECT address_line_1 FROM medialab_core.property_snapshots WHERE id = $1`, [snapId1]);
        const res2 = await client.query(`SELECT address_line_1 FROM medialab_core.property_snapshots WHERE id = $1`, [snapId2]);
        expect(res1.rows[0].address_line_1).toBe('100 Main St');
        expect(res2.rows[0].address_line_1).toBe('100 Main St');
      });
    });

    it('6 & 7. Second snapshot can be inserted; first snapshot remains byte-for-byte unchanged', async () => {
      await runInTransaction(async () => {
        const orgId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org Snap')`, [orgId]);

        const propId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`, [propId, orgId]);

        const snapId1 = crypto.randomUUID();
        await client.query(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, reported_square_feet) 
           VALUES ($1, $2, $3, '200 First Ave', 'Kennewick', 'WA', '99336', 2000)`,
          [snapId1, propId, orgId]
        );

        const snap1Before = await client.query(`SELECT * FROM medialab_core.property_snapshots WHERE id = $1`, [snapId1]);

        const snapId2 = crypto.randomUUID();
        await client.query(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, reported_square_feet) 
           VALUES ($1, $2, $3, '200 First Ave Suite B', 'Kennewick', 'WA', '99336', 2500)`,
          [snapId2, propId, orgId]
        );

        const snap1After = await client.query(`SELECT * FROM medialab_core.property_snapshots WHERE id = $1`, [snapId1]);
        expect(snap1After.rows[0]).toEqual(snap1Before.rows[0]);

        const allSnaps = await client.query(`SELECT id FROM medialab_core.property_snapshots WHERE property_id = $1 ORDER BY created_at`, [propId]);
        expect(allSnaps.rows).toHaveLength(2);
      });
    });

    it('8. Snapshot UPDATE is rejected', async () => {
      await runInTransaction(async () => {
        const orgId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org Update')`, [orgId]);

        const propId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`, [propId, orgId]);

        const snapId = crypto.randomUUID();
        await client.query(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '300 Pine St', 'Pasco', 'WA', '99301')`,
          [snapId, propId, orgId]
        );

        await expectDbError(
          `UPDATE medialab_core.property_snapshots SET address_line_1 = '301 Pine St' WHERE id = $1`,
          [snapId]
        );
      });
    });

    it('9. Snapshot DELETE is rejected', async () => {
      await runInTransaction(async () => {
        const orgId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org Delete')`, [orgId]);

        const propId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`, [propId, orgId]);

        const snapId = crypto.randomUUID();
        await client.query(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '400 Oak St', 'Pasco', 'WA', '99301')`,
          [snapId, propId, orgId]
        );

        await expectDbError(
          `DELETE FROM medialab_core.property_snapshots WHERE id = $1`,
          [snapId]
        );
      });
    });

    it('10, 11, & 12. Square footage validation (0 rejected, negative rejected, null accepted)', async () => {
      await runInTransaction(async () => {
        const orgId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org Sqft')`, [orgId]);

        const propId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`, [propId, orgId]);

        // Zero sqft rejected
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, reported_square_feet) 
           VALUES ($1, $2, $3, '500 Elm St', 'Richland', 'WA', '99352', 0)`,
          [crypto.randomUUID(), propId, orgId]
        );

        // Negative sqft rejected
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, reported_square_feet) 
           VALUES ($1, $2, $3, '500 Elm St', 'Richland', 'WA', '99352', -500)`,
          [crypto.randomUUID(), propId, orgId]
        );

        // Null sqft accepted
        const nullSqftId = crypto.randomUUID();
        await client.query(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, reported_square_feet) 
           VALUES ($1, $2, $3, '500 Elm St', 'Richland', 'WA', '99352', NULL)`,
          [nullSqftId, propId, orgId]
        );
        const res = await client.query(`SELECT reported_square_feet FROM medialab_core.property_snapshots WHERE id = $1`, [nullSqftId]);
        expect(res.rows[0].reported_square_feet).toBeNull();
      });
    });

    it('13. Blank required address fields are rejected', async () => {
      await runInTransaction(async () => {
        const orgId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org Addr')`, [orgId]);

        const propId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`, [propId, orgId]);

        // Blank address_line_1
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '   ', 'Richland', 'WA', '99352')`,
          [crypto.randomUUID(), propId, orgId]
        );

        // Blank locality
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '600 Maple St', ' ', 'WA', '99352')`,
          [crypto.randomUUID(), propId, orgId]
        );

        // Blank administrative_area
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '600 Maple St', 'Richland', '', '99352')`,
          [crypto.randomUUID(), propId, orgId]
        );

        // Blank postal_code
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code) 
           VALUES ($1, $2, $3, '600 Maple St', 'Richland', 'WA', '  ')`,
          [crypto.randomUUID(), propId, orgId]
        );
      });
    });

    it('14. Invalid country codes are rejected', async () => {
      await runInTransaction(async () => {
        const orgId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org Country')`, [orgId]);

        const propId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)`, [propId, orgId]);

        // Lowercase country code rejected
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, country_code) 
           VALUES ($1, $2, $3, '700 Cedar St', 'Richland', 'WA', '99352', 'us')`,
          [crypto.randomUUID(), propId, orgId]
        );

        // 3-letter country code rejected
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, country_code) 
           VALUES ($1, $2, $3, '700 Cedar St', 'Richland', 'WA', '99352', 'USA')`,
          [crypto.randomUUID(), propId, orgId]
        );

        // Numeric country code rejected
        await expectDbError(
          `INSERT INTO medialab_core.property_snapshots 
           (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code, country_code) 
           VALUES ($1, $2, $3, '700 Cedar St', 'Richland', 'WA', '99352', '12')`,
          [crypto.randomUUID(), propId, orgId]
        );
      });
    });

    it('15. archived_at earlier than created_at is rejected', async () => {
      await runInTransaction(async () => {
        const orgId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org Archive')`, [orgId]);

        const propId = crypto.randomUUID();
        await expectDbError(
          `INSERT INTO medialab_core.properties (id, organization_id, created_at, archived_at) 
           VALUES ($1, $2, now(), now() - interval '1 hour')`,
          [propId, orgId]
        );
      });
    });
  });

  it('16 & 20. Verify exact synthetic Order property evidence and foundation fixture rows', async () => {
    for (const [env, pool] of Object.entries({ test: poolTest, dev: poolDev })) {
      const resProps = await pool.query(`SELECT count(*)::int as count FROM medialab_core.properties`);
      expect(resProps.rows[0].count, `Properties table in ${env} must have one synthetic Order fixture`).toBe(1);

      const resSnaps = await pool.query(`SELECT count(*)::int as count FROM medialab_core.property_snapshots`);
      expect(resSnaps.rows[0].count, `Property snapshots table in ${env} must have one synthetic Order fixture`).toBe(1);

      const expectedCounts: Record<string, number> = {
        organizations: 1,
        people: 3,
        identities: 2,
        memberships: 3,
        permissions: 7,
        permission_sets: 1,
        permission_set_permissions: 7,
        membership_permission_sets: 1,
        development_sessions: 1
      };

      for (const [table, exp] of Object.entries(expectedCounts)) {
        const res = await pool.query(`SELECT count(*)::int as count FROM medialab_core.${table}`);
        const cnt = res.rows[0].count;
        expect(cnt, `Table ${table} in ${env} has ${cnt} rows, expected exact ${exp}`).toBe(exp);
      }
    }
  });
});
