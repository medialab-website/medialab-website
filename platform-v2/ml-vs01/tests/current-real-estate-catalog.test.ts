import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { runSeed } from '../db/seed.js';
import {
  CURRENT_CATALOG_SEED_EFFECTIVE_DATE,
  CURRENT_CATALOG_SEED_VERSION,
  CURRENT_CATALOG_SOURCE_TYPE,
  CURRENT_CATALOG_SOURCE_URL
} from '../db/fixtures/current-real-estate-catalog-seed.js';

const TEST_DB = 'medialab_p02m11a_test';
const TEST_OWNER_ROLE = 'medialab_p02m11a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m11a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m11a-pg';
const TEST_PORT = 55441;
const EFFECTIVE_AT = '2026-08-04T00:00:00.000Z';

describe('P02-M03-B real current MediaLab real-estate catalog', () => {
  let owner: pg.Client;
  let runtime: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_OWNER_ROLE,
      runtimeUser: TEST_RUNTIME_ROLE,
      confirm: TEST_DB
    });
  }

  async function selectBracket(codes: string[], basis: number): Promise<string[]> {
    const result = await owner.query(
      `SELECT p.product_code
         FROM medialab_core.catalog_products p
         JOIN medialab_core.catalog_bracket_sets s ON s.package_product_id = p.id
         JOIN medialab_core.catalog_price_brackets b ON b.bracket_set_id = s.id
        WHERE p.product_code = ANY($1::text[])
          AND ($2 > b.lower_bound OR ($2 = b.lower_bound AND b.lower_inclusive))
          AND (b.upper_bound IS NULL OR $2 < b.upper_bound OR ($2 = b.upper_bound AND b.upper_inclusive))
        ORDER BY p.product_code`,
      [codes, basis]
    );
    return result.rows.map((row) => row.product_code);
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_OWNER_ROLE });
    runtime = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_RUNTIME_ROLE });
    await owner.connect();
    await runtime.connect();
  });

  afterAll(async () => {
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    await reset();
  });

  it('1. seeds the exact 30-product canonical inventory with stable MediaLab-owned codes', async () => {
    const products = await owner.query(
      `SELECT product_code FROM medialab_core.catalog_products
        WHERE source_type = 'PUBLIC_WEBSITE' ORDER BY product_code`
    );
    expect(products.rows.map((row) => row.product_code)).toEqual([
      'ADDITIONAL_AERIAL_EXTERIOR_PHOTO',
      'AERIAL_ONLY_VIDEO',
      'AGENT_INTRO_ADD_ON',
      'AI_PHOTO_VIDEO_15',
      'AI_PHOTO_VIDEO_25',
      'CAD_FILES',
      'CINEMATIC_SHOWCASE_2800_4000',
      'CINEMATIC_SHOWCASE_OVER_4000',
      'CINEMATIC_SHOWCASE_UNDER_2800',
      'FLOOR_PLAN_3D_VIDEO',
      'GLA_REPORT',
      'HOME_PACKAGE_LARGE',
      'HOME_PACKAGE_LUXURY',
      'HOME_PACKAGE_MEDIUM',
      'HOME_PACKAGE_PRESTIGIOUS_ESTATE',
      'HOME_PACKAGE_SMALL',
      'INCLUDED_2D_FLOOR_PLAN',
      'INCLUDED_AERIAL_PHOTO',
      'INCLUDED_LISTING_PHOTO',
      'INCLUDED_SHAREABLE_LISTING_WEBPAGE',
      'LAND_PACKAGE',
      'MATTERPORT_2000_4000',
      'MATTERPORT_4000_6000',
      'MATTERPORT_6000_7000',
      'MATTERPORT_UNDER_2500',
      'PROPERTY_BOUNDARY_LINES',
      'VIRTUAL_STAGING',
      'VIRTUAL_TWILIGHT_PHOTO',
      'ZILLOW_3D_OVER_3000',
      'ZILLOW_3D_UNDER_3000'
    ]);
  });

  it('2. preserves exact public-source metadata without claiming a historical launch date', async () => {
    const metadata = await owner.query(
      `SELECT DISTINCT source_type, source_url, seed_version, seed_effective_date::text
         FROM medialab_core.catalog_products
        WHERE source_type = 'PUBLIC_WEBSITE'`
    );
    expect(metadata.rows).toEqual([{
      source_type: CURRENT_CATALOG_SOURCE_TYPE,
      source_url: CURRENT_CATALOG_SOURCE_URL,
      seed_version: CURRENT_CATALOG_SEED_VERSION,
      seed_effective_date: CURRENT_CATALOG_SEED_EFFECTIVE_DATE
    }]);
    const missingLabels = await owner.query(
      `SELECT count(*)::int AS count FROM medialab_core.catalog_products
        WHERE source_type = 'PUBLIC_WEBSITE' AND source_display_label IS NULL`
    );
    expect(missingLabels.rows[0].count).toBe(0);
  });

  it('3. seeds the exact six standard packages, labels, prices, and units', async () => {
    const packages = await owner.query(
      `SELECT p.product_code, p.display_name, p.source_display_label,
              p.commercial_unit, b.amount_cents, b.currency, s.bracket_basis
         FROM medialab_core.catalog_products p
         JOIN medialab_core.catalog_bracket_sets s ON s.package_product_id = p.id
         JOIN medialab_core.catalog_price_brackets b ON b.bracket_set_id = s.id
        WHERE p.product_code = ANY($1::text[])
        ORDER BY p.product_code`,
      [[
        'HOME_PACKAGE_SMALL', 'HOME_PACKAGE_MEDIUM', 'HOME_PACKAGE_LARGE',
        'HOME_PACKAGE_LUXURY', 'HOME_PACKAGE_PRESTIGIOUS_ESTATE', 'LAND_PACKAGE'
      ]]
    );
    expect(packages.rows).toEqual([
      { product_code: 'HOME_PACKAGE_LARGE', display_name: 'Large Home Package', source_display_label: 'Large Home Package (2400-3500 sq ft)', commercial_unit: 'PACKAGE', amount_cents: '23000', currency: 'USD', bracket_basis: 'SQUARE_FEET' },
      { product_code: 'HOME_PACKAGE_LUXURY', display_name: 'Luxury Home Package', source_display_label: 'Luxury Home Package (3500-4500 sq ft)', commercial_unit: 'PACKAGE', amount_cents: '29000', currency: 'USD', bracket_basis: 'SQUARE_FEET' },
      { product_code: 'HOME_PACKAGE_MEDIUM', display_name: 'Medium Home Package', source_display_label: 'Medium Home Package (1200-2400 sq ft)', commercial_unit: 'PACKAGE', amount_cents: '17500', currency: 'USD', bracket_basis: 'SQUARE_FEET' },
      { product_code: 'HOME_PACKAGE_PRESTIGIOUS_ESTATE', display_name: 'Prestigious Estate Package', source_display_label: 'Prestigious Estate Package (Over 4500 sq ft)', commercial_unit: 'PACKAGE', amount_cents: '34500', currency: 'USD', bracket_basis: 'SQUARE_FEET' },
      { product_code: 'HOME_PACKAGE_SMALL', display_name: 'Small Home Package', source_display_label: 'Small Home Package (Under 1200 sq ft)', commercial_unit: 'PACKAGE', amount_cents: '13500', currency: 'USD', bracket_basis: 'SQUARE_FEET' },
      { product_code: 'LAND_PACKAGE', display_name: 'Land Package', source_display_label: 'Land Package', commercial_unit: 'PACKAGE', amount_cents: '16000', currency: 'USD', bracket_basis: 'SCOPE_UNITS' }
    ]);
  });

  it('4. preserves exact package inclusion quantities and deliverables', async () => {
    const inclusions = await owner.query(
      `SELECT p.product_code, i.included_product_code, i.quantity
         FROM medialab_core.catalog_products p
         JOIN medialab_core.catalog_package_versions v ON v.package_product_id = p.id
         JOIN medialab_core.catalog_package_version_items i ON i.package_version_id = v.id
        WHERE p.product_code LIKE 'HOME_PACKAGE_%' OR p.product_code = 'LAND_PACKAGE'
        ORDER BY p.product_code, i.position`
    );
    const expected: Record<string, Array<[string, string]>> = {
      HOME_PACKAGE_SMALL: [['INCLUDED_LISTING_PHOTO', '25.000'], ['INCLUDED_AERIAL_PHOTO', '1.000'], ['INCLUDED_2D_FLOOR_PLAN', '1.000'], ['INCLUDED_SHAREABLE_LISTING_WEBPAGE', '1.000']],
      HOME_PACKAGE_MEDIUM: [['INCLUDED_LISTING_PHOTO', '40.000'], ['INCLUDED_AERIAL_PHOTO', '2.000'], ['INCLUDED_2D_FLOOR_PLAN', '1.000'], ['INCLUDED_SHAREABLE_LISTING_WEBPAGE', '1.000']],
      HOME_PACKAGE_LARGE: [['INCLUDED_LISTING_PHOTO', '55.000'], ['INCLUDED_AERIAL_PHOTO', '3.000'], ['INCLUDED_2D_FLOOR_PLAN', '1.000'], ['INCLUDED_SHAREABLE_LISTING_WEBPAGE', '1.000']],
      HOME_PACKAGE_LUXURY: [['INCLUDED_LISTING_PHOTO', '70.000'], ['INCLUDED_AERIAL_PHOTO', '5.000'], ['INCLUDED_2D_FLOOR_PLAN', '1.000'], ['INCLUDED_SHAREABLE_LISTING_WEBPAGE', '1.000']],
      HOME_PACKAGE_PRESTIGIOUS_ESTATE: [['INCLUDED_LISTING_PHOTO', '95.000'], ['INCLUDED_AERIAL_PHOTO', '5.000'], ['INCLUDED_2D_FLOOR_PLAN', '1.000'], ['INCLUDED_SHAREABLE_LISTING_WEBPAGE', '1.000']],
      LAND_PACKAGE: [['INCLUDED_AERIAL_PHOTO', '4.000'], ['PROPERTY_BOUNDARY_LINES', '1.000'], ['INCLUDED_SHAREABLE_LISTING_WEBPAGE', '1.000']]
    };
    for (const [packageCode, items] of Object.entries(expected)) {
      expect(
        inclusions.rows
          .filter((row) => row.product_code === packageCode)
          .map((row) => [row.included_product_code, row.quantity])
      ).toEqual(items);
    }
    expect(inclusions.rows).toHaveLength(23);
  });

  it('5. implements the exact gap-free, nonoverlapping home-package boundary interpretation', async () => {
    const codes = [
      'HOME_PACKAGE_SMALL', 'HOME_PACKAGE_MEDIUM', 'HOME_PACKAGE_LARGE',
      'HOME_PACKAGE_LUXURY', 'HOME_PACKAGE_PRESTIGIOUS_ESTATE'
    ];
    const cases: Array<[number, string]> = [
      [0, 'HOME_PACKAGE_SMALL'],
      [1199, 'HOME_PACKAGE_SMALL'],
      [1200, 'HOME_PACKAGE_MEDIUM'],
      [2399, 'HOME_PACKAGE_MEDIUM'],
      [2400, 'HOME_PACKAGE_LARGE'],
      [3499, 'HOME_PACKAGE_LARGE'],
      [3500, 'HOME_PACKAGE_LUXURY'],
      [4500, 'HOME_PACKAGE_LUXURY'],
      [4501, 'HOME_PACKAGE_PRESTIGIOUS_ESTATE']
    ];
    for (const [basis, expected] of cases) {
      expect(await selectBracket(codes, basis), String(basis)).toEqual([expected]);
    }
  });

  it('6. seeds the exact photo add-ons and prices', async () => {
    const result = await owner.query(
      `SELECT p.product_code, p.display_name, p.commercial_unit, pr.amount_cents
         FROM medialab_core.catalog_products p
         JOIN medialab_core.catalog_prices pr ON pr.product_id = p.id
        WHERE p.product_code = ANY($1::text[]) ORDER BY p.product_code`,
      [['ADDITIONAL_AERIAL_EXTERIOR_PHOTO', 'VIRTUAL_TWILIGHT_PHOTO', 'VIRTUAL_STAGING', 'PROPERTY_BOUNDARY_LINES']]
    );
    expect(result.rows).toEqual([
      { product_code: 'ADDITIONAL_AERIAL_EXTERIOR_PHOTO', display_name: 'Additional Aerial/Exterior Photo', commercial_unit: 'PHOTO', amount_cents: '1500' },
      { product_code: 'PROPERTY_BOUNDARY_LINES', display_name: 'Property Boundary Lines', commercial_unit: 'PHOTO', amount_cents: '1000' },
      { product_code: 'VIRTUAL_STAGING', display_name: 'Virtual Staging', commercial_unit: 'PHOTO', amount_cents: '2500' },
      { product_code: 'VIRTUAL_TWILIGHT_PHOTO', display_name: 'Virtual Twilight Photo', commercial_unit: 'PHOTO', amount_cents: '1500' }
    ]);
  });

  it('7. seeds all seven video products and exact prices', async () => {
    const result = await runtime.query(
      `SELECT product_code, amount_cents FROM medialab_core.get_current_selectable_catalog($1)
        WHERE product_code = ANY($2::text[]) ORDER BY product_code`,
      [EFFECTIVE_AT, [
        'AI_PHOTO_VIDEO_15', 'AI_PHOTO_VIDEO_25',
        'CINEMATIC_SHOWCASE_UNDER_2800', 'CINEMATIC_SHOWCASE_2800_4000',
        'CINEMATIC_SHOWCASE_OVER_4000', 'AERIAL_ONLY_VIDEO', 'AGENT_INTRO_ADD_ON'
      ]]
    );
    expect(result.rows).toEqual([
      { product_code: 'AERIAL_ONLY_VIDEO', amount_cents: '17500' },
      { product_code: 'AGENT_INTRO_ADD_ON', amount_cents: '5000' },
      { product_code: 'AI_PHOTO_VIDEO_15', amount_cents: '4000' },
      { product_code: 'AI_PHOTO_VIDEO_25', amount_cents: '6000' },
      { product_code: 'CINEMATIC_SHOWCASE_2800_4000', amount_cents: '26500' },
      { product_code: 'CINEMATIC_SHOWCASE_OVER_4000', amount_cents: '29500' },
      { product_code: 'CINEMATIC_SHOWCASE_UNDER_2800', amount_cents: '22000' }
    ]);
  });

  it('8. implements the exact Cinematic Showcase and Zillow boundary arithmetic', async () => {
    const cinematic = ['CINEMATIC_SHOWCASE_UNDER_2800', 'CINEMATIC_SHOWCASE_2800_4000', 'CINEMATIC_SHOWCASE_OVER_4000'];
    expect(await selectBracket(cinematic, 2799)).toEqual(['CINEMATIC_SHOWCASE_UNDER_2800']);
    expect(await selectBracket(cinematic, 2800)).toEqual(['CINEMATIC_SHOWCASE_2800_4000']);
    expect(await selectBracket(cinematic, 4000)).toEqual(['CINEMATIC_SHOWCASE_2800_4000']);
    expect(await selectBracket(cinematic, 4001)).toEqual(['CINEMATIC_SHOWCASE_OVER_4000']);

    const zillow = ['ZILLOW_3D_UNDER_3000', 'ZILLOW_3D_OVER_3000'];
    expect(await selectBracket(zillow, 3000)).toEqual(['ZILLOW_3D_UNDER_3000']);
    expect(await selectBracket(zillow, 3001)).toEqual(['ZILLOW_3D_OVER_3000']);
    const prices = await runtime.query(
      `SELECT product_code, amount_cents FROM medialab_core.get_current_selectable_catalog($1)
        WHERE product_code = ANY($2::text[]) ORDER BY product_code`,
      [EFFECTIVE_AT, zillow]
    );
    expect(prices.rows).toEqual([
      { product_code: 'ZILLOW_3D_OVER_3000', amount_cents: '7500' },
      { product_code: 'ZILLOW_3D_UNDER_3000', amount_cents: '5000' }
    ]);
  });

  it('9. preserves exact Matterport labels and prices as manual-selection products with no automatic bracket set', async () => {
    const matterport = await owner.query(
      `SELECT p.product_code, p.display_name, p.source_display_label, pr.amount_cents
         FROM medialab_core.catalog_products p
         JOIN medialab_core.catalog_prices pr ON pr.product_id = p.id
        WHERE p.product_code LIKE 'MATTERPORT_%' ORDER BY p.product_code`
    );
    expect(matterport.rows).toEqual([
      { product_code: 'MATTERPORT_2000_4000', display_name: 'Matterport (2k - 4k Sq Ft)', source_display_label: 'Matterport (2k - 4k Sq Ft)', amount_cents: '14000' },
      { product_code: 'MATTERPORT_4000_6000', display_name: 'Matterport (4k - 6k Sq Ft)', source_display_label: 'Matterport (4k - 6k Sq Ft)', amount_cents: '22000' },
      { product_code: 'MATTERPORT_6000_7000', display_name: 'Matterport (6k - 7k Sq Ft)', source_display_label: 'Matterport (6k - 7k Sq Ft)', amount_cents: '26500' },
      { product_code: 'MATTERPORT_UNDER_2500', display_name: 'Matterport (Under 2.5k Sq Ft)', source_display_label: 'Matterport (Under 2.5k Sq Ft)', amount_cents: '12000' }
    ]);
    const brackets = await owner.query(
      `SELECT count(*)::int AS count
         FROM medialab_core.catalog_bracket_sets s
         JOIN medialab_core.catalog_products p ON p.id = s.package_product_id
        WHERE p.product_code LIKE 'MATTERPORT_%'`
    );
    expect(brackets.rows[0].count).toBe(0);
  });

  it('10. seeds only the three priced floor-plan add-ons and invents no upgrade base price', async () => {
    const result = await owner.query(
      `SELECT p.product_code, pr.amount_cents
         FROM medialab_core.catalog_products p
         JOIN medialab_core.catalog_prices pr ON pr.product_id = p.id
        WHERE p.product_code = ANY($1::text[]) ORDER BY p.product_code`,
      [['GLA_REPORT', 'CAD_FILES', 'FLOOR_PLAN_3D_VIDEO']]
    );
    expect(result.rows).toEqual([
      { product_code: 'CAD_FILES', amount_cents: '3000' },
      { product_code: 'FLOOR_PLAN_3D_VIDEO', amount_cents: '6500' },
      { product_code: 'GLA_REPORT', amount_cents: '1500' }
    ]);
    const invented = await owner.query(
      `SELECT product_code FROM medialab_core.catalog_products
        WHERE product_code IN ('ENHANCED_FLOOR_PLAN_UPGRADE', 'FLOOR_PLAN_3D_UPGRADE')`
    );
    expect(invented.rows).toEqual([]);
  });

  it('11. exposes exactly 26 canonical selectable rows and no synthetic offering', async () => {
    const selected = await runtime.query(
      `SELECT product_code
         FROM medialab_core.get_current_selectable_catalog($1)
        ORDER BY product_code`,
      [EFFECTIVE_AT]
    );
    expect(selected.rows).toHaveLength(26);
    expect(selected.rows.some((row) => row.product_code.startsWith('SYNTH_'))).toBe(false);
  });

  it('12. keeps canonical and synthetic inventories distinct and creates no unapproved Aryeo mapping', async () => {
    const grouped = await owner.query(
      `SELECT source_type, count(*)::int AS count
         FROM medialab_core.catalog_products GROUP BY source_type ORDER BY source_type`
    );
    expect(grouped.rows).toEqual([
      { source_type: 'PUBLIC_WEBSITE', count: 30 },
      { source_type: 'SYNTHETIC_FIXTURE', count: 5 }
    ]);
    const canonicalMappings = await owner.query(
      `SELECT count(*)::int AS count
         FROM medialab_core.catalog_external_mappings m
         JOIN medialab_core.catalog_products p ON p.id = m.target_product_id
        WHERE p.source_type = 'PUBLIC_WEBSITE'`
    );
    expect(canonicalMappings.rows[0].count).toBe(0);
  });

  it('13. reseeds as a no-op and leaves immutable commercial snapshots byte-equivalent at the row level', async () => {
    const snapshotsBefore = await owner.query('SELECT * FROM medialab_core.commercial_snapshots ORDER BY id');
    const packageItemsBefore = await owner.query('SELECT * FROM medialab_core.commercial_snapshot_package_items ORDER BY id');
    const reseed = await runSeed({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_OWNER_ROLE });
    expect(reseed).toEqual({ inserted: 0, verified: 207 });
    const snapshotsAfter = await owner.query('SELECT * FROM medialab_core.commercial_snapshots ORDER BY id');
    const packageItemsAfter = await owner.query('SELECT * FROM medialab_core.commercial_snapshot_package_items ORDER BY id');
    expect(snapshotsAfter.rows).toEqual(snapshotsBefore.rows);
    expect(packageItemsAfter.rows).toEqual(packageItemsBefore.rows);
  });
});
