import { IDENTITY_FIXTURES } from './identity-tenancy-fixtures.js';

export const CURRENT_CATALOG_SOURCE_TYPE = 'PUBLIC_WEBSITE';
export const CURRENT_CATALOG_SOURCE_URL = 'https://medialab.fyi/real-estate';
export const CURRENT_CATALOG_SEED_VERSION = 'P02_M03_B_2026_08_03';
export const CURRENT_CATALOG_SEED_EFFECTIVE_DATE = '2026-08-03';
export const CURRENT_CATALOG_EFFECTIVE_AT = '2026-08-03T00:00:00.000Z';
export const CURRENT_CATALOG_ACTOR_IDENTITY_ID = IDENTITY_FIXTURES[1].id;

function stableUuid(group: number, index: number): string {
  return `6${group}000000-0000-5000-8000-${String(index).padStart(12, '0')}`;
}

type ProductDefinition = {
  code: string;
  name: string;
  kind: 'PACKAGE' | 'ADD_ON' | 'SERVICE';
  unit: string;
  lifecycle?: 'ACTIVE' | 'NONSELECTABLE';
  sourceLabel: string;
};

const PRODUCT_DEFINITIONS: ProductDefinition[] = [
  { code: 'HOME_PACKAGE_SMALL', name: 'Small Home Package', kind: 'PACKAGE', unit: 'PACKAGE', sourceLabel: 'Small Home Package (Under 1200 sq ft)' },
  { code: 'HOME_PACKAGE_MEDIUM', name: 'Medium Home Package', kind: 'PACKAGE', unit: 'PACKAGE', sourceLabel: 'Medium Home Package (1200-2400 sq ft)' },
  { code: 'HOME_PACKAGE_LARGE', name: 'Large Home Package', kind: 'PACKAGE', unit: 'PACKAGE', sourceLabel: 'Large Home Package (2400-3500 sq ft)' },
  { code: 'HOME_PACKAGE_LUXURY', name: 'Luxury Home Package', kind: 'PACKAGE', unit: 'PACKAGE', sourceLabel: 'Luxury Home Package (3500-4500 sq ft)' },
  { code: 'HOME_PACKAGE_PRESTIGIOUS_ESTATE', name: 'Prestigious Estate Package', kind: 'PACKAGE', unit: 'PACKAGE', sourceLabel: 'Prestigious Estate Package (Over 4500 sq ft)' },
  { code: 'LAND_PACKAGE', name: 'Land Package', kind: 'PACKAGE', unit: 'PACKAGE', sourceLabel: 'Land Package' },

  { code: 'INCLUDED_LISTING_PHOTO', name: 'Listing Photo', kind: 'SERVICE', unit: 'PHOTO', lifecycle: 'NONSELECTABLE', sourceLabel: 'Listing Photos' },
  { code: 'INCLUDED_AERIAL_PHOTO', name: 'Aerial Photo', kind: 'SERVICE', unit: 'PHOTO', lifecycle: 'NONSELECTABLE', sourceLabel: 'Aerial Photos' },
  { code: 'INCLUDED_2D_FLOOR_PLAN', name: '2D Floor Plan', kind: 'SERVICE', unit: 'DELIVERABLE', lifecycle: 'NONSELECTABLE', sourceLabel: '2D Floor Plan' },
  { code: 'INCLUDED_SHAREABLE_LISTING_WEBPAGE', name: 'Shareable Listing Webpage', kind: 'SERVICE', unit: 'DELIVERABLE', lifecycle: 'NONSELECTABLE', sourceLabel: 'Shareable Listing Webpage' },

  { code: 'ADDITIONAL_AERIAL_EXTERIOR_PHOTO', name: 'Additional Aerial/Exterior Photo', kind: 'ADD_ON', unit: 'PHOTO', sourceLabel: "Add'l Aerial/Exterior Photos" },
  { code: 'VIRTUAL_TWILIGHT_PHOTO', name: 'Virtual Twilight Photo', kind: 'ADD_ON', unit: 'PHOTO', sourceLabel: 'Virtual Twilight Photos' },
  { code: 'VIRTUAL_STAGING', name: 'Virtual Staging', kind: 'ADD_ON', unit: 'PHOTO', sourceLabel: 'Virtual Staging' },
  { code: 'PROPERTY_BOUNDARY_LINES', name: 'Property Boundary Lines', kind: 'ADD_ON', unit: 'PHOTO', sourceLabel: 'Property Boundary Lines' },

  { code: 'AI_PHOTO_VIDEO_15', name: 'AI Photo-to-Video Walkthrough', kind: 'ADD_ON', unit: 'VIDEO', sourceLabel: 'AI Photo-to-Video Walkthrough (15 Photos)' },
  { code: 'AI_PHOTO_VIDEO_25', name: 'AI Photo-to-Video Walkthrough', kind: 'ADD_ON', unit: 'VIDEO', sourceLabel: 'AI Photo-to-Video Walkthrough (25 Photos)' },
  { code: 'CINEMATIC_SHOWCASE_UNDER_2800', name: 'Cinematic Showcase Video', kind: 'PACKAGE', unit: 'VIDEO', sourceLabel: 'Cinematic Showcase Video (< 2800 sq ft)' },
  { code: 'CINEMATIC_SHOWCASE_2800_4000', name: 'Cinematic Showcase Video', kind: 'PACKAGE', unit: 'VIDEO', sourceLabel: 'Cinematic Showcase Video (2800 - 4000 sq ft)' },
  { code: 'CINEMATIC_SHOWCASE_OVER_4000', name: 'Cinematic Showcase Video', kind: 'PACKAGE', unit: 'VIDEO', sourceLabel: 'Cinematic Showcase Video (> 4000 sq ft)' },
  { code: 'AERIAL_ONLY_VIDEO', name: 'Aerial-only Video', kind: 'ADD_ON', unit: 'VIDEO', sourceLabel: 'Aerial-only Video' },
  { code: 'AGENT_INTRO_ADD_ON', name: 'Agent Intro Add-On', kind: 'ADD_ON', unit: 'VIDEO', sourceLabel: 'Add an Agent Intro to any video' },

  { code: 'ZILLOW_3D_UNDER_3000', name: 'Zillow 3D Home Tour', kind: 'PACKAGE', unit: 'TOUR', sourceLabel: 'Zillow 3D Home Tour (Under 3k Sq Ft)' },
  { code: 'ZILLOW_3D_OVER_3000', name: 'Zillow 3D Home Tour', kind: 'PACKAGE', unit: 'TOUR', sourceLabel: 'Zillow 3D Home Tour (Over 3k Sq Ft)' },

  { code: 'MATTERPORT_UNDER_2500', name: 'Matterport (Under 2.5k Sq Ft)', kind: 'ADD_ON', unit: 'TOUR', sourceLabel: 'Matterport (Under 2.5k Sq Ft)' },
  { code: 'MATTERPORT_2000_4000', name: 'Matterport (2k - 4k Sq Ft)', kind: 'ADD_ON', unit: 'TOUR', sourceLabel: 'Matterport (2k - 4k Sq Ft)' },
  { code: 'MATTERPORT_4000_6000', name: 'Matterport (4k - 6k Sq Ft)', kind: 'ADD_ON', unit: 'TOUR', sourceLabel: 'Matterport (4k - 6k Sq Ft)' },
  { code: 'MATTERPORT_6000_7000', name: 'Matterport (6k - 7k Sq Ft)', kind: 'ADD_ON', unit: 'TOUR', sourceLabel: 'Matterport (6k - 7k Sq Ft)' },

  { code: 'GLA_REPORT', name: 'GLA Report', kind: 'ADD_ON', unit: 'DELIVERABLE', sourceLabel: 'GLA Report' },
  { code: 'CAD_FILES', name: 'CAD Files', kind: 'ADD_ON', unit: 'DELIVERABLE', sourceLabel: 'CAD Files' },
  { code: 'FLOOR_PLAN_3D_VIDEO', name: '3D Video', kind: 'ADD_ON', unit: 'VIDEO', sourceLabel: '3D Video' }
];

export const CURRENT_REAL_ESTATE_PRODUCT_FIXTURES = PRODUCT_DEFINITIONS.map((product, index) => ({
  id: stableUuid(1, index + 1),
  product_code: product.code,
  display_name: product.name,
  product_kind: product.kind,
  classification: 'SERVICE',
  commercial_unit: product.unit,
  catalog_origin: 'CURRENT',
  lifecycle_state: product.lifecycle ?? 'ACTIVE',
  source_system: CURRENT_CATALOG_SOURCE_TYPE,
  created_by_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  created_at: CURRENT_CATALOG_EFFECTIVE_AT,
  updated_by_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  updated_at: CURRENT_CATALOG_EFFECTIVE_AT,
  authoring_state: 'PUBLISHED',
  published_at: CURRENT_CATALOG_EFFECTIVE_AT,
  published_by_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  archived_at: null,
  archived_by_identity_id: null,
  duplicated_from_product_id: null,
  source_type: CURRENT_CATALOG_SOURCE_TYPE,
  source_url: CURRENT_CATALOG_SOURCE_URL,
  source_display_label: product.sourceLabel,
  seed_version: CURRENT_CATALOG_SEED_VERSION,
  seed_effective_date: CURRENT_CATALOG_SEED_EFFECTIVE_DATE
}));

export const CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE = Object.fromEntries(
  CURRENT_REAL_ESTATE_PRODUCT_FIXTURES.map((product) => [product.product_code, product])
) as Record<string, (typeof CURRENT_REAL_ESTATE_PRODUCT_FIXTURES)[number]>;

export const CURRENT_REAL_ESTATE_PRODUCT_CHANGE_EVENTS = CURRENT_REAL_ESTATE_PRODUCT_FIXTURES.map((product, index) => ({
  id: stableUuid(2, index + 1),
  product_id: product.id,
  previous_display_name: null,
  new_display_name: product.display_name,
  previous_lifecycle_state: null,
  new_lifecycle_state: product.lifecycle_state,
  reason: 'Canonical current catalog seeded from approved public website evidence',
  source_system: CURRENT_CATALOG_SOURCE_TYPE,
  actor_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  occurred_at: CURRENT_CATALOG_EFFECTIVE_AT
}));

export const CURRENT_REAL_ESTATE_ADMINISTRATION_EVENTS = CURRENT_REAL_ESTATE_PRODUCT_FIXTURES.map((product, index) => ({
  id: stableUuid(8, index + 1),
  product_id: product.id,
  product_code: product.product_code,
  display_name: product.display_name,
  event_type: 'CANONICAL_SEEDED',
  previous_authoring_state: null,
  new_authoring_state: 'PUBLISHED',
  previous_lifecycle_state: null,
  new_lifecycle_state: product.lifecycle_state,
  previous_archived: null,
  new_archived: false,
  duplicated_from_product_id: null,
  reason: 'Canonical current catalog seeded from approved public website evidence',
  source_system: CURRENT_CATALOG_SOURCE_TYPE,
  actor_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  occurred_at: CURRENT_CATALOG_EFFECTIVE_AT
}));

const FLAT_PRICE_DEFINITIONS = [
  ['ADDITIONAL_AERIAL_EXTERIOR_PHOTO', 1500],
  ['VIRTUAL_TWILIGHT_PHOTO', 1500],
  ['VIRTUAL_STAGING', 2500],
  ['PROPERTY_BOUNDARY_LINES', 1000],
  ['AI_PHOTO_VIDEO_15', 4000],
  ['AI_PHOTO_VIDEO_25', 6000],
  ['AERIAL_ONLY_VIDEO', 17500],
  ['AGENT_INTRO_ADD_ON', 5000],
  ['MATTERPORT_UNDER_2500', 12000],
  ['MATTERPORT_2000_4000', 14000],
  ['MATTERPORT_4000_6000', 22000],
  ['MATTERPORT_6000_7000', 26500],
  ['GLA_REPORT', 1500],
  ['CAD_FILES', 3000],
  ['FLOOR_PLAN_3D_VIDEO', 6500]
] as const;

export const CURRENT_REAL_ESTATE_PRICE_FIXTURES = FLAT_PRICE_DEFINITIONS.map(([productCode, amountCents], index) => ({
  id: stableUuid(3, index + 1),
  product_id: CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE[productCode].id,
  amount_cents: amountCents,
  currency: 'USD',
  effective_at: CURRENT_CATALOG_EFFECTIVE_AT,
  supersedes_price_id: null,
  source_system: CURRENT_CATALOG_SOURCE_TYPE,
  source_record_identifier: `public-website:${productCode.toLowerCase()}`,
  recorded_by_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  recorded_at: CURRENT_CATALOG_EFFECTIVE_AT
}));

const STANDARD_PACKAGE_CODES = [
  'HOME_PACKAGE_SMALL',
  'HOME_PACKAGE_MEDIUM',
  'HOME_PACKAGE_LARGE',
  'HOME_PACKAGE_LUXURY',
  'HOME_PACKAGE_PRESTIGIOUS_ESTATE',
  'LAND_PACKAGE'
] as const;

export const CURRENT_REAL_ESTATE_PACKAGE_VERSION_FIXTURES = STANDARD_PACKAGE_CODES.map((productCode, index) => ({
  id: stableUuid(4, index + 1),
  package_product_id: CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE[productCode].id,
  version_number: 1,
  effective_at: CURRENT_CATALOG_EFFECTIVE_AT,
  source_system: CURRENT_CATALOG_SOURCE_TYPE,
  created_by_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  created_at: CURRENT_CATALOG_EFFECTIVE_AT
}));

const PACKAGE_VERSION_BY_CODE = Object.fromEntries(
  STANDARD_PACKAGE_CODES.map((code, index) => [code, CURRENT_REAL_ESTATE_PACKAGE_VERSION_FIXTURES[index]])
) as Record<string, (typeof CURRENT_REAL_ESTATE_PACKAGE_VERSION_FIXTURES)[number]>;

const PACKAGE_INCLUSION_DEFINITIONS = [
  ['HOME_PACKAGE_SMALL', 'INCLUDED_LISTING_PHOTO', 25],
  ['HOME_PACKAGE_SMALL', 'INCLUDED_AERIAL_PHOTO', 1],
  ['HOME_PACKAGE_SMALL', 'INCLUDED_2D_FLOOR_PLAN', 1],
  ['HOME_PACKAGE_SMALL', 'INCLUDED_SHAREABLE_LISTING_WEBPAGE', 1],
  ['HOME_PACKAGE_MEDIUM', 'INCLUDED_LISTING_PHOTO', 40],
  ['HOME_PACKAGE_MEDIUM', 'INCLUDED_AERIAL_PHOTO', 2],
  ['HOME_PACKAGE_MEDIUM', 'INCLUDED_2D_FLOOR_PLAN', 1],
  ['HOME_PACKAGE_MEDIUM', 'INCLUDED_SHAREABLE_LISTING_WEBPAGE', 1],
  ['HOME_PACKAGE_LARGE', 'INCLUDED_LISTING_PHOTO', 55],
  ['HOME_PACKAGE_LARGE', 'INCLUDED_AERIAL_PHOTO', 3],
  ['HOME_PACKAGE_LARGE', 'INCLUDED_2D_FLOOR_PLAN', 1],
  ['HOME_PACKAGE_LARGE', 'INCLUDED_SHAREABLE_LISTING_WEBPAGE', 1],
  ['HOME_PACKAGE_LUXURY', 'INCLUDED_LISTING_PHOTO', 70],
  ['HOME_PACKAGE_LUXURY', 'INCLUDED_AERIAL_PHOTO', 5],
  ['HOME_PACKAGE_LUXURY', 'INCLUDED_2D_FLOOR_PLAN', 1],
  ['HOME_PACKAGE_LUXURY', 'INCLUDED_SHAREABLE_LISTING_WEBPAGE', 1],
  ['HOME_PACKAGE_PRESTIGIOUS_ESTATE', 'INCLUDED_LISTING_PHOTO', 95],
  ['HOME_PACKAGE_PRESTIGIOUS_ESTATE', 'INCLUDED_AERIAL_PHOTO', 5],
  ['HOME_PACKAGE_PRESTIGIOUS_ESTATE', 'INCLUDED_2D_FLOOR_PLAN', 1],
  ['HOME_PACKAGE_PRESTIGIOUS_ESTATE', 'INCLUDED_SHAREABLE_LISTING_WEBPAGE', 1],
  ['LAND_PACKAGE', 'INCLUDED_AERIAL_PHOTO', 4],
  ['LAND_PACKAGE', 'PROPERTY_BOUNDARY_LINES', 1],
  ['LAND_PACKAGE', 'INCLUDED_SHAREABLE_LISTING_WEBPAGE', 1]
] as const;

const packagePositions = new Map<string, number>();
export const CURRENT_REAL_ESTATE_PACKAGE_ITEM_FIXTURES = PACKAGE_INCLUSION_DEFINITIONS.map(
  ([packageCode, includedCode, quantity], index) => {
    const included = CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE[includedCode];
    const position = (packagePositions.get(packageCode) ?? 0) + 1;
    packagePositions.set(packageCode, position);
    return {
      id: stableUuid(5, index + 1),
      package_version_id: PACKAGE_VERSION_BY_CODE[packageCode].id,
      included_product_id: included.id,
      included_product_code: included.product_code,
      included_display_name: included.display_name,
      included_classification: included.classification,
      quantity: `${quantity}.000`,
      commercial_unit: included.commercial_unit,
      position
    };
  }
);

const BRACKET_DEFINITIONS = [
  ['HOME_PACKAGE_SMALL', 'SQUARE_FEET', 'UNDER_1200', 0, 1200, true, false, 13500],
  ['HOME_PACKAGE_MEDIUM', 'SQUARE_FEET', 'FROM_1200_TO_2400', 1200, 2400, true, false, 17500],
  ['HOME_PACKAGE_LARGE', 'SQUARE_FEET', 'FROM_2400_TO_3500', 2400, 3500, true, false, 23000],
  ['HOME_PACKAGE_LUXURY', 'SQUARE_FEET', 'FROM_3500_TO_4500', 3500, 4500, true, true, 29000],
  ['HOME_PACKAGE_PRESTIGIOUS_ESTATE', 'SQUARE_FEET', 'OVER_4500', 4500, null, false, false, 34500],
  ['LAND_PACKAGE', 'SCOPE_UNITS', 'FLAT_RATE', 0, null, true, false, 16000],
  ['CINEMATIC_SHOWCASE_UNDER_2800', 'SQUARE_FEET', 'UNDER_2800', 0, 2800, true, false, 22000],
  ['CINEMATIC_SHOWCASE_2800_4000', 'SQUARE_FEET', 'FROM_2800_TO_4000', 2800, 4000, true, true, 26500],
  ['CINEMATIC_SHOWCASE_OVER_4000', 'SQUARE_FEET', 'OVER_4000', 4000, null, false, false, 29500],
  ['ZILLOW_3D_UNDER_3000', 'SQUARE_FEET', 'UNDER_OR_EQUAL_3000', 0, 3000, true, true, 5000],
  ['ZILLOW_3D_OVER_3000', 'SQUARE_FEET', 'OVER_3000', 3000, null, false, false, 7500]
] as const;

export const CURRENT_REAL_ESTATE_BRACKET_SET_FIXTURES = BRACKET_DEFINITIONS.map((definition, index) => ({
  id: stableUuid(6, index + 1),
  package_product_id: CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE[definition[0]].id,
  version_number: 1,
  bracket_basis: definition[1],
  effective_at: CURRENT_CATALOG_EFFECTIVE_AT,
  source_system: CURRENT_CATALOG_SOURCE_TYPE,
  created_by_identity_id: CURRENT_CATALOG_ACTOR_IDENTITY_ID,
  created_at: CURRENT_CATALOG_EFFECTIVE_AT
}));

export const CURRENT_REAL_ESTATE_BRACKET_FIXTURES = BRACKET_DEFINITIONS.map((definition, index) => ({
  id: stableUuid(7, index + 1),
  bracket_set_id: CURRENT_REAL_ESTATE_BRACKET_SET_FIXTURES[index].id,
  bracket_code: definition[2],
  lower_bound: definition[3],
  upper_bound: definition[4],
  lower_inclusive: definition[5],
  upper_inclusive: definition[6],
  amount_cents: definition[7],
  currency: 'USD',
  position: 1
}));

export const CURRENT_REAL_ESTATE_CATALOG_TABLES = [
  { table: 'catalog_products', keys: ['id'], rows: CURRENT_REAL_ESTATE_PRODUCT_FIXTURES },
  { table: 'catalog_product_change_events', keys: ['id'], rows: CURRENT_REAL_ESTATE_PRODUCT_CHANGE_EVENTS },
  { table: 'catalog_prices', keys: ['id'], rows: CURRENT_REAL_ESTATE_PRICE_FIXTURES },
  { table: 'catalog_package_versions', keys: ['id'], rows: CURRENT_REAL_ESTATE_PACKAGE_VERSION_FIXTURES },
  { table: 'catalog_package_version_items', keys: ['id'], rows: CURRENT_REAL_ESTATE_PACKAGE_ITEM_FIXTURES },
  { table: 'catalog_bracket_sets', keys: ['id'], rows: CURRENT_REAL_ESTATE_BRACKET_SET_FIXTURES },
  { table: 'catalog_price_brackets', keys: ['id'], rows: CURRENT_REAL_ESTATE_BRACKET_FIXTURES },
  { table: 'catalog_administration_events', keys: ['id'], rows: CURRENT_REAL_ESTATE_ADMINISTRATION_EVENTS }
] as const;

export const CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS = {
  catalog_products: 30,
  catalog_product_change_events: 30,
  catalog_prices: 15,
  catalog_package_versions: 6,
  catalog_package_version_items: 23,
  catalog_bracket_sets: 11,
  catalog_price_brackets: 11,
  catalog_administration_events: 30
};
