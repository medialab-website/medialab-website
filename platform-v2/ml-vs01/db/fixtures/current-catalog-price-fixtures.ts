import {
  BASE_CREATED_AT,
  IDENTITY_FIXTURES,
  PERMISSION_SET_FIXTURE
} from './identity-tenancy-fixtures.js';

export const CATALOG_EFFECTIVE_AT = '2026-03-27T12:00:00.000Z';
export const CATALOG_REPRICE_AT = '2026-04-01T12:00:00.000Z';
export const CATALOG_SNAPSHOT_AT = '2026-03-28T12:00:00.000Z';
export const CATALOG_ACTOR_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
export const SYNTHETIC_SOURCE_SYSTEM = 'SYNTHETIC_P02_M03_A_FIXTURE';

export const CATALOG_PERMISSION_FIXTURES = [
  {
    id: '4d437ee3-4a12-5ff8-8cc9-7cd602e37d01',
    code: 'catalog.manage',
    description: 'Synthetic fixture permission for attributable catalog administration.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '4d437ee3-4a12-5ff8-8cc9-7cd602e37d02',
    code: 'catalog.snapshot_create',
    description: 'Synthetic fixture permission for immutable commercial snapshot creation.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const CATALOG_PERMISSION_SET_PERMISSION_FIXTURES = CATALOG_PERMISSION_FIXTURES.map((permission) => ({
  permission_set_id: PERMISSION_SET_FIXTURE.id,
  permission_id: permission.id,
  created_at: BASE_CREATED_AT
}));

export const CATALOG_PRODUCT_FIXTURES = [
  {
    id: '51000000-0000-5000-8000-000000000001',
    product_code: 'SYNTH_HOME_PACKAGE',
    display_name: 'Synthetic Home Package',
    product_kind: 'PACKAGE',
    classification: 'SERVICE',
    commercial_unit: 'PACKAGE',
    catalog_origin: 'CURRENT',
    lifecycle_state: 'NONSELECTABLE',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: BASE_CREATED_AT,
    updated_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    updated_at: BASE_CREATED_AT
  },
  {
    id: '51000000-0000-5000-8000-000000000002',
    product_code: 'SYNTH_INTERIOR_PHOTOS',
    display_name: 'Synthetic Interior Photography',
    product_kind: 'SERVICE',
    classification: 'SERVICE',
    commercial_unit: 'SESSION',
    catalog_origin: 'CURRENT',
    lifecycle_state: 'NONSELECTABLE',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: BASE_CREATED_AT,
    updated_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    updated_at: BASE_CREATED_AT
  },
  {
    id: '51000000-0000-5000-8000-000000000003',
    product_code: 'SYNTH_AERIAL_ADDON',
    display_name: 'Synthetic Aerial Add-On',
    product_kind: 'ADD_ON',
    classification: 'SERVICE',
    commercial_unit: 'SESSION',
    catalog_origin: 'CURRENT',
    lifecycle_state: 'NONSELECTABLE',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: BASE_CREATED_AT,
    updated_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    updated_at: BASE_CREATED_AT
  },
  {
    id: '51000000-0000-5000-8000-000000000004',
    product_code: 'SYNTH_RETIRED_ADDON',
    display_name: 'Synthetic Retired Add-On',
    product_kind: 'ADD_ON',
    classification: 'SERVICE',
    commercial_unit: 'SESSION',
    catalog_origin: 'CURRENT',
    lifecycle_state: 'RETIRED',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: BASE_CREATED_AT,
    updated_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    updated_at: CATALOG_EFFECTIVE_AT
  },
  {
    id: '51000000-0000-5000-8000-000000000005',
    product_code: 'SYNTH_LEGACY_ALACARTE',
    display_name: 'Synthetic Legacy A-La-Carte Service',
    product_kind: 'SERVICE',
    classification: 'SERVICE',
    commercial_unit: 'SESSION',
    catalog_origin: 'LEGACY',
    lifecycle_state: 'NONSELECTABLE',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: BASE_CREATED_AT,
    updated_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    updated_at: BASE_CREATED_AT
  }
].map((product) => ({
  ...product,
  authoring_state: 'PUBLISHED',
  published_at: product.created_at,
  published_by_identity_id: product.created_by_identity_id,
  archived_at: null,
  archived_by_identity_id: null,
  duplicated_from_product_id: null,
  source_type: 'SYNTHETIC_FIXTURE',
  source_url: null,
  source_display_label: product.display_name,
  seed_version: 'P02_M03_A_SYNTHETIC_V1',
  seed_effective_date: '2026-03-27'
}));

export const CATALOG_PRODUCT_CHANGE_EVENT_FIXTURES = [
  ...CATALOG_PRODUCT_FIXTURES.map((product, index) => ({
    id: `52000000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
    product_id: product.id,
    previous_display_name: null,
    new_display_name: product.display_name,
    previous_lifecycle_state: null,
    new_lifecycle_state: product.lifecycle_state === 'RETIRED' ? 'ACTIVE' : product.lifecycle_state,
    reason: 'Synthetic catalog fixture created',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    actor_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    occurred_at: BASE_CREATED_AT
  })),
  {
    id: '52000000-0000-5000-8000-000000000006',
    product_id: CATALOG_PRODUCT_FIXTURES[3].id,
    previous_display_name: CATALOG_PRODUCT_FIXTURES[3].display_name,
    new_display_name: CATALOG_PRODUCT_FIXTURES[3].display_name,
    previous_lifecycle_state: 'ACTIVE',
    new_lifecycle_state: 'RETIRED',
    reason: 'Synthetic lifecycle retirement evidence',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    actor_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    occurred_at: CATALOG_EFFECTIVE_AT
  }
];

export const CATALOG_PRICE_FIXTURES = [
  {
    id: '53000000-0000-5000-8000-000000000001',
    product_id: CATALOG_PRODUCT_FIXTURES[1].id,
    amount_cents: 10000,
    currency: 'USD',
    effective_at: CATALOG_EFFECTIVE_AT,
    supersedes_price_id: null,
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_identifier: 'synthetic-price-interior-v1',
    recorded_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    recorded_at: CATALOG_EFFECTIVE_AT
  },
  {
    id: '53000000-0000-5000-8000-000000000002',
    product_id: CATALOG_PRODUCT_FIXTURES[2].id,
    amount_cents: 15000,
    currency: 'USD',
    effective_at: CATALOG_EFFECTIVE_AT,
    supersedes_price_id: null,
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_identifier: 'synthetic-price-aerial-v1',
    recorded_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    recorded_at: CATALOG_EFFECTIVE_AT
  },
  {
    id: '53000000-0000-5000-8000-000000000003',
    product_id: CATALOG_PRODUCT_FIXTURES[2].id,
    amount_cents: 17500,
    currency: 'USD',
    effective_at: CATALOG_REPRICE_AT,
    supersedes_price_id: '53000000-0000-5000-8000-000000000002',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_identifier: 'synthetic-price-aerial-v2',
    recorded_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    recorded_at: CATALOG_REPRICE_AT
  },
  {
    id: '53000000-0000-5000-8000-000000000004',
    product_id: CATALOG_PRODUCT_FIXTURES[3].id,
    amount_cents: 12000,
    currency: 'USD',
    effective_at: CATALOG_EFFECTIVE_AT,
    supersedes_price_id: null,
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_identifier: 'synthetic-price-retired-v1',
    recorded_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    recorded_at: CATALOG_EFFECTIVE_AT
  },
  {
    id: '53000000-0000-5000-8000-000000000005',
    product_id: CATALOG_PRODUCT_FIXTURES[4].id,
    amount_cents: 9000,
    currency: 'USD',
    effective_at: CATALOG_EFFECTIVE_AT,
    supersedes_price_id: null,
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_identifier: 'synthetic-price-legacy-v1',
    recorded_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    recorded_at: CATALOG_EFFECTIVE_AT
  }
];

export const CATALOG_PACKAGE_VERSION_FIXTURES = [{
  id: '54000000-0000-5000-8000-000000000001',
  package_product_id: CATALOG_PRODUCT_FIXTURES[0].id,
  version_number: 1,
  effective_at: CATALOG_EFFECTIVE_AT,
  source_system: SYNTHETIC_SOURCE_SYSTEM,
  created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
  created_at: CATALOG_EFFECTIVE_AT
}];

export const CATALOG_PACKAGE_ITEM_FIXTURES = [{
  id: '55000000-0000-5000-8000-000000000001',
  package_version_id: CATALOG_PACKAGE_VERSION_FIXTURES[0].id,
  included_product_id: CATALOG_PRODUCT_FIXTURES[1].id,
  included_product_code: CATALOG_PRODUCT_FIXTURES[1].product_code,
  included_display_name: CATALOG_PRODUCT_FIXTURES[1].display_name,
  included_classification: CATALOG_PRODUCT_FIXTURES[1].classification,
  quantity: '1.000',
  commercial_unit: CATALOG_PRODUCT_FIXTURES[1].commercial_unit,
  position: 1
}];

export const CATALOG_BRACKET_SET_FIXTURES = [{
  id: '56000000-0000-5000-8000-000000000001',
  package_product_id: CATALOG_PRODUCT_FIXTURES[0].id,
  version_number: 1,
  bracket_basis: 'SQUARE_FEET',
  effective_at: CATALOG_EFFECTIVE_AT,
  source_system: SYNTHETIC_SOURCE_SYSTEM,
  created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
  created_at: CATALOG_EFFECTIVE_AT
}];

export const CATALOG_BRACKET_FIXTURES = [
  { id: '57000000-0000-5000-8000-000000000001', bracket_code: 'SYNTH_SF_0000_1999', lower_bound: 0, upper_bound: 2000, amount_cents: 30000, position: 1 },
  { id: '57000000-0000-5000-8000-000000000002', bracket_code: 'SYNTH_SF_2000_3999', lower_bound: 2000, upper_bound: 4000, amount_cents: 40000, position: 2 },
  { id: '57000000-0000-5000-8000-000000000003', bracket_code: 'SYNTH_SF_4000_PLUS', lower_bound: 4000, upper_bound: null, amount_cents: 50000, position: 3 }
].map((bracket) => ({
  ...bracket,
  bracket_set_id: CATALOG_BRACKET_SET_FIXTURES[0].id,
  lower_inclusive: true,
  upper_inclusive: false,
  currency: 'USD'
}));

export const CATALOG_EXTERNAL_MAPPING_FIXTURES = [{
  id: '58000000-0000-5000-8000-000000000001',
  provider: 'ARYEO',
  external_record_type: 'PRODUCT',
  external_identifier: 'synthetic-aryeo-product-001',
  target_product_id: CATALOG_PRODUCT_FIXTURES[2].id,
  supersedes_mapping_id: null,
  source_system: SYNTHETIC_SOURCE_SYSTEM,
  observed_at: CATALOG_EFFECTIVE_AT,
  recorded_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
  recorded_at: CATALOG_EFFECTIVE_AT
}];

const EMPTY_PACKAGE_FIELDS = {
  package_product_id: null,
  package_product_code: null,
  package_display_name: null,
  package_version_id: null,
  bracket_id: null,
  bracket_code: null,
  bracket_basis: null,
  bracket_lower_bound: null,
  bracket_upper_bound: null,
  bracket_lower_inclusive: null,
  bracket_upper_inclusive: null
};

export const COMMERCIAL_SNAPSHOT_FIXTURES = [
  {
    id: '59000000-0000-5000-8000-000000000001',
    commercial_origin: 'CURRENT',
    catalog_product_id: CATALOG_PRODUCT_FIXTURES[0].id,
    catalog_price_id: null,
    product_code: CATALOG_PRODUCT_FIXTURES[0].product_code,
    display_name: CATALOG_PRODUCT_FIXTURES[0].display_name,
    product_kind: 'PACKAGE',
    classification: 'SERVICE',
    unit_price_cents: 30000,
    currency: 'USD',
    quantity: '1.000',
    commercial_unit: 'PACKAGE',
    package_product_id: CATALOG_PRODUCT_FIXTURES[0].id,
    package_product_code: CATALOG_PRODUCT_FIXTURES[0].product_code,
    package_display_name: CATALOG_PRODUCT_FIXTURES[0].display_name,
    package_version_id: CATALOG_PACKAGE_VERSION_FIXTURES[0].id,
    bracket_id: CATALOG_BRACKET_FIXTURES[0].id,
    bracket_code: CATALOG_BRACKET_FIXTURES[0].bracket_code,
    bracket_basis: 'SQUARE_FEET',
    bracket_lower_bound: 0,
    bracket_upper_bound: 2000,
    bracket_lower_inclusive: true,
    bracket_upper_inclusive: false,
    adjustment_amount_cents: 2500,
    adjustment_reason: 'Synthetic attributable adjustment',
    adjustment_actor_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    adjustment_at: CATALOG_SNAPSHOT_AT,
    travel_estimate_amount_cents: 3500,
    travel_estimate_basis: 'Synthetic manually approved travel estimate',
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_type: 'SYNTHETIC_SELECTION',
    source_record_identifier: 'synthetic-package-selection-001',
    effective_at: CATALOG_SNAPSHOT_AT,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: CATALOG_SNAPSHOT_AT,
    material_increase_amount_cents: 2500,
    renewed_acceptance_required: true,
    renewed_accepted_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    renewed_accepted_at: CATALOG_SNAPSHOT_AT
  },
  {
    ...EMPTY_PACKAGE_FIELDS,
    id: '59000000-0000-5000-8000-000000000002',
    commercial_origin: 'CURRENT',
    catalog_product_id: CATALOG_PRODUCT_FIXTURES[2].id,
    catalog_price_id: CATALOG_PRICE_FIXTURES[1].id,
    product_code: CATALOG_PRODUCT_FIXTURES[2].product_code,
    display_name: CATALOG_PRODUCT_FIXTURES[2].display_name,
    product_kind: 'ADD_ON',
    classification: 'SERVICE',
    unit_price_cents: 15000,
    currency: 'USD',
    quantity: '1.000',
    commercial_unit: 'SESSION',
    adjustment_amount_cents: 0,
    adjustment_reason: null,
    adjustment_actor_identity_id: null,
    adjustment_at: null,
    travel_estimate_amount_cents: 0,
    travel_estimate_basis: null,
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_type: 'SYNTHETIC_SELECTION',
    source_record_identifier: 'synthetic-aerial-selection-001',
    effective_at: CATALOG_SNAPSHOT_AT,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: CATALOG_SNAPSHOT_AT,
    material_increase_amount_cents: 0,
    renewed_acceptance_required: false,
    renewed_accepted_by_identity_id: null,
    renewed_accepted_at: null
  },
  {
    ...EMPTY_PACKAGE_FIELDS,
    id: '59000000-0000-5000-8000-000000000003',
    commercial_origin: 'RETIRED',
    catalog_product_id: CATALOG_PRODUCT_FIXTURES[3].id,
    catalog_price_id: CATALOG_PRICE_FIXTURES[3].id,
    product_code: CATALOG_PRODUCT_FIXTURES[3].product_code,
    display_name: CATALOG_PRODUCT_FIXTURES[3].display_name,
    product_kind: 'ADD_ON',
    classification: 'SERVICE',
    unit_price_cents: 12000,
    currency: 'USD',
    quantity: '1.000',
    commercial_unit: 'SESSION',
    adjustment_amount_cents: 0,
    adjustment_reason: null,
    adjustment_actor_identity_id: null,
    adjustment_at: null,
    travel_estimate_amount_cents: 0,
    travel_estimate_basis: null,
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_type: null,
    source_record_identifier: null,
    effective_at: CATALOG_SNAPSHOT_AT,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: CATALOG_SNAPSHOT_AT,
    material_increase_amount_cents: 0,
    renewed_acceptance_required: false,
    renewed_accepted_by_identity_id: null,
    renewed_accepted_at: null
  },
  {
    ...EMPTY_PACKAGE_FIELDS,
    id: '59000000-0000-5000-8000-000000000004',
    commercial_origin: 'LEGACY',
    catalog_product_id: CATALOG_PRODUCT_FIXTURES[4].id,
    catalog_price_id: CATALOG_PRICE_FIXTURES[4].id,
    product_code: CATALOG_PRODUCT_FIXTURES[4].product_code,
    display_name: CATALOG_PRODUCT_FIXTURES[4].display_name,
    product_kind: 'SERVICE',
    classification: 'SERVICE',
    unit_price_cents: 9000,
    currency: 'USD',
    quantity: '1.000',
    commercial_unit: 'SESSION',
    adjustment_amount_cents: 0,
    adjustment_reason: null,
    adjustment_actor_identity_id: null,
    adjustment_at: null,
    travel_estimate_amount_cents: 0,
    travel_estimate_basis: null,
    source_system: SYNTHETIC_SOURCE_SYSTEM,
    source_record_type: null,
    source_record_identifier: null,
    effective_at: CATALOG_SNAPSHOT_AT,
    created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
    created_at: CATALOG_SNAPSHOT_AT,
    material_increase_amount_cents: 0,
    renewed_acceptance_required: false,
    renewed_accepted_by_identity_id: null,
    renewed_accepted_at: null
  }
];

export const COMMERCIAL_SNAPSHOT_PACKAGE_ITEM_FIXTURES = [{
  id: '5a000000-0000-5000-8000-000000000001',
  snapshot_id: COMMERCIAL_SNAPSHOT_FIXTURES[0].id,
  source_package_item_id: CATALOG_PACKAGE_ITEM_FIXTURES[0].id,
  included_product_id: CATALOG_PRODUCT_FIXTURES[1].id,
  included_product_code: CATALOG_PRODUCT_FIXTURES[1].product_code,
  included_display_name: CATALOG_PRODUCT_FIXTURES[1].display_name,
  included_classification: CATALOG_PRODUCT_FIXTURES[1].classification,
  quantity: '1.000',
  commercial_unit: CATALOG_PRODUCT_FIXTURES[1].commercial_unit,
  position: 1
}];

export const CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURES = [{
  id: '5b000000-0000-5000-8000-000000000001',
  description: 'Synthetic order-specific custom commercial evidence',
  approved_price_cents: 22500,
  currency: 'USD',
  quantity: '1.000',
  reason: 'Synthetic one-time approved work',
  adjustment_amount_cents: 1000,
  adjustment_reason: 'Synthetic attributable custom adjustment',
  adjustment_actor_identity_id: CATALOG_ACTOR_IDENTITY_ID,
  adjustment_at: CATALOG_SNAPSHOT_AT,
  travel_estimate_amount_cents: 2000,
  travel_estimate_basis: 'Synthetic manually approved custom travel estimate',
  source_system: SYNTHETIC_SOURCE_SYSTEM,
  effective_at: CATALOG_SNAPSHOT_AT,
  created_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
  created_at: CATALOG_SNAPSHOT_AT,
  material_increase_amount_cents: 0,
  renewed_acceptance_required: false,
  renewed_accepted_by_identity_id: null,
  renewed_accepted_at: null
}];

export const CATALOG_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: CATALOG_PERMISSION_FIXTURES },
  { table: 'permission_set_permissions', keys: ['permission_set_id', 'permission_id'], rows: CATALOG_PERMISSION_SET_PERMISSION_FIXTURES },
  { table: 'catalog_products', keys: ['id'], rows: CATALOG_PRODUCT_FIXTURES },
  { table: 'catalog_product_change_events', keys: ['id'], rows: CATALOG_PRODUCT_CHANGE_EVENT_FIXTURES },
  { table: 'catalog_prices', keys: ['id'], rows: CATALOG_PRICE_FIXTURES },
  { table: 'catalog_package_versions', keys: ['id'], rows: CATALOG_PACKAGE_VERSION_FIXTURES },
  { table: 'catalog_package_version_items', keys: ['id'], rows: CATALOG_PACKAGE_ITEM_FIXTURES },
  { table: 'catalog_bracket_sets', keys: ['id'], rows: CATALOG_BRACKET_SET_FIXTURES },
  { table: 'catalog_price_brackets', keys: ['id'], rows: CATALOG_BRACKET_FIXTURES },
  { table: 'catalog_external_mappings', keys: ['id'], rows: CATALOG_EXTERNAL_MAPPING_FIXTURES },
  { table: 'commercial_snapshots', keys: ['id'], rows: COMMERCIAL_SNAPSHOT_FIXTURES },
  { table: 'commercial_snapshot_package_items', keys: ['id'], rows: COMMERCIAL_SNAPSHOT_PACKAGE_ITEM_FIXTURES },
  { table: 'custom_commercial_snapshots', keys: ['id'], rows: CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURES }
] as const;

export const CATALOG_EXPECTED_ROW_COUNTS = {
  permissions: 5,
  permission_set_permissions: 5,
  catalog_products: 5,
  catalog_product_change_events: 6,
  catalog_prices: 5,
  catalog_package_versions: 1,
  catalog_package_version_items: 1,
  catalog_bracket_sets: 1,
  catalog_price_brackets: 3,
  catalog_external_mappings: 1,
  commercial_snapshots: 4,
  commercial_snapshot_package_items: 1,
  custom_commercial_snapshots: 1
};
