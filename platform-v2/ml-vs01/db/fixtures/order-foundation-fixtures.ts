import {
  BASE_CREATED_AT,
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  ORGANIZATION_FIXTURE,
  PEOPLE_FIXTURES,
  PERMISSION_SET_FIXTURE
} from './identity-tenancy-fixtures.js';
import { COMMERCIAL_SNAPSHOT_FIXTURES } from './current-catalog-price-fixtures.js';

export const ORDER_FOUNDATION_SOURCE = 'SYNTHETIC_P02_M04_A_FIXTURE';
export const ORDER_FOUNDATION_CREATED_AT = '2026-08-05T12:00:00.000Z';
export const ORDER_FOUNDATION_ACTOR_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
export const ORDER_FOUNDATION_ORDER_ID = '61000000-0000-5000-8000-000000000001';
export const ORDER_FOUNDATION_PROPERTY_ID = '62000000-0000-5000-8000-000000000001';
export const ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID = '63000000-0000-5000-8000-000000000001';
export const ORDER_FOUNDATION_CUSTOM_SNAPSHOT_ID = '64000000-0000-5000-8000-000000000001';

export const ORDER_PERMISSION_FIXTURES = [
  {
    id: '65000000-0000-5000-8000-000000000001',
    code: 'order.create',
    description: 'Synthetic fixture permission for provider-neutral Order creation.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '65000000-0000-5000-8000-000000000002',
    code: 'order.read',
    description: 'Synthetic fixture permission for organization-scoped Order reads.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const ORDER_PERMISSION_SET_PERMISSION_FIXTURES = ORDER_PERMISSION_FIXTURES.map((permission) => ({
  permission_set_id: PERMISSION_SET_FIXTURE.id,
  permission_id: permission.id,
  created_at: BASE_CREATED_AT
}));

export const ORDER_PROPERTY_FIXTURE = {
  id: ORDER_FOUNDATION_PROPERTY_ID,
  organization_id: ORGANIZATION_FIXTURE.id,
  created_at: ORDER_FOUNDATION_CREATED_AT,
  archived_at: null
};

export const ORDER_PROPERTY_SNAPSHOT_FIXTURE = {
  id: ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
  property_id: ORDER_FOUNDATION_PROPERTY_ID,
  organization_id: ORGANIZATION_FIXTURE.id,
  captured_at: ORDER_FOUNDATION_CREATED_AT,
  address_line_1: '100 Synthetic Evidence Way',
  address_line_2: null,
  locality: 'Fixture City',
  administrative_area: 'WA',
  postal_code: '00000',
  country_code: 'US',
  reported_square_feet: 1800,
  created_at: ORDER_FOUNDATION_CREATED_AT
};

export const ORDER_CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURE = {
  id: ORDER_FOUNDATION_CUSTOM_SNAPSHOT_ID,
  description: 'Synthetic one-order custom commercial line',
  approved_price_cents: 22500,
  currency: 'USD',
  quantity: '1.000',
  reason: 'Synthetic Order-specific authorization evidence',
  adjustment_amount_cents: 0,
  adjustment_reason: null,
  adjustment_actor_identity_id: null,
  adjustment_at: null,
  travel_estimate_amount_cents: 0,
  travel_estimate_basis: null,
  source_system: ORDER_FOUNDATION_SOURCE,
  effective_at: ORDER_FOUNDATION_CREATED_AT,
  created_by_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
  created_at: ORDER_FOUNDATION_CREATED_AT,
  material_increase_amount_cents: 0,
  renewed_acceptance_required: false,
  renewed_accepted_by_identity_id: null,
  renewed_accepted_at: null
};

export const ORDER_FIXTURE = {
  id: ORDER_FOUNDATION_ORDER_ID,
  lane: 'REAL_ESTATE',
  organization_id: ORGANIZATION_FIXTURE.id,
  property_id: ORDER_FOUNDATION_PROPERTY_ID,
  property_snapshot_id: ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
  settlement_mode: 'PAY_NOW',
  currency: 'USD',
  item_subtotal_cents: 37500,
  travel_amount_cents: 3500,
  travel_basis: 'Synthetic manually approved Order travel evidence',
  total_amount_cents: 41000,
  current_state: 'ACCEPTED',
  source_system: ORDER_FOUNDATION_SOURCE,
  created_by_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
  accepted_by_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
  created_at: ORDER_FOUNDATION_CREATED_AT,
  accepted_at: ORDER_FOUNDATION_CREATED_AT
};

const OPERATOR_PERSON = PEOPLE_FIXTURES[1];
const OWNER_PERSON = PEOPLE_FIXTURES[0];
const OPERATOR_MEMBERSHIP = MEMBERSHIP_FIXTURES[1];
const OWNER_MEMBERSHIP = MEMBERSHIP_FIXTURES[0];

export const ORDER_PARTY_FIXTURES = [
  ...[
    ['ORDERING_PERSON', OPERATOR_PERSON, OPERATOR_MEMBERSHIP],
    ['CUSTOMER', OWNER_PERSON, OWNER_MEMBERSHIP],
    ['BILLING_PARTY', OWNER_PERSON, OWNER_MEMBERSHIP],
    ['COMMERCIAL_OWNER', OPERATOR_PERSON, OPERATOR_MEMBERSHIP],
    ['AUTHORIZED_ACTOR', OPERATOR_PERSON, OPERATOR_MEMBERSHIP]
  ].map(([partyRole, person, membership], index) => ({
    id: `66000000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
    order_id: ORDER_FOUNDATION_ORDER_ID,
    party_role: partyRole as string,
    party_kind: 'PERSON',
    person_id: (person as typeof OPERATOR_PERSON).id,
    organization_id: null,
    membership_id: (membership as typeof OPERATOR_MEMBERSHIP).id,
    frozen_display_name: (person as typeof OPERATOR_PERSON).display_name,
    authority_context: 'ACTIVE_MEMBERSHIP_AT_ACCEPTANCE',
    source_system: ORDER_FOUNDATION_SOURCE,
    recorded_by_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
    recorded_at: ORDER_FOUNDATION_CREATED_AT
  })),
  {
    id: '66000000-0000-5000-8000-000000000006',
    order_id: ORDER_FOUNDATION_ORDER_ID,
    party_role: 'ORGANIZATION',
    party_kind: 'ORGANIZATION',
    person_id: null,
    organization_id: ORGANIZATION_FIXTURE.id,
    membership_id: null,
    frozen_display_name: ORGANIZATION_FIXTURE.name,
    authority_context: 'ACTIVE_ORGANIZATION_CONTEXT',
    source_system: ORDER_FOUNDATION_SOURCE,
    recorded_by_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
    recorded_at: ORDER_FOUNDATION_CREATED_AT
  }
];

export const ORDER_ITEM_FIXTURES = [
  {
    id: '67000000-0000-5000-8000-000000000001',
    order_id: ORDER_FOUNDATION_ORDER_ID,
    position: 1,
    item_kind: 'CATALOG',
    commercial_snapshot_id: COMMERCIAL_SNAPSHOT_FIXTURES[1].id,
    custom_commercial_snapshot_id: null,
    catalog_product_id: COMMERCIAL_SNAPSHOT_FIXTURES[1].catalog_product_id,
    frozen_description: COMMERCIAL_SNAPSHOT_FIXTURES[1].display_name,
    quantity: COMMERCIAL_SNAPSHOT_FIXTURES[1].quantity,
    commercial_unit: COMMERCIAL_SNAPSHOT_FIXTURES[1].commercial_unit,
    unit_amount_cents: 15000,
    line_total_cents: 15000,
    currency: 'USD',
    source_item_identifier: COMMERCIAL_SNAPSHOT_FIXTURES[1].source_record_identifier,
    custom_reason: null,
    custom_actor_identity_id: null,
    created_at: ORDER_FOUNDATION_CREATED_AT
  },
  {
    id: '67000000-0000-5000-8000-000000000002',
    order_id: ORDER_FOUNDATION_ORDER_ID,
    position: 2,
    item_kind: 'CUSTOM',
    commercial_snapshot_id: null,
    custom_commercial_snapshot_id: ORDER_FOUNDATION_CUSTOM_SNAPSHOT_ID,
    catalog_product_id: null,
    frozen_description: ORDER_CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURE.description,
    quantity: ORDER_CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURE.quantity,
    commercial_unit: 'CUSTOM',
    unit_amount_cents: 22500,
    line_total_cents: 22500,
    currency: 'USD',
    source_item_identifier: null,
    custom_reason: ORDER_CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURE.reason,
    custom_actor_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
    created_at: ORDER_FOUNDATION_CREATED_AT
  }
];

export const ORDER_EXTERNAL_REFERENCE_FIXTURE = {
  id: '68000000-0000-5000-8000-000000000001',
  order_id: ORDER_FOUNDATION_ORDER_ID,
  provider: ORDER_FOUNDATION_SOURCE,
  external_record_type: 'ORDER',
  external_identifier: 'synthetic-order-source-001',
  provenance: 'SYNTHETIC_CANONICAL_SEED',
  recorded_by_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
  recorded_at: ORDER_FOUNDATION_CREATED_AT
};

export const ORDER_IDEMPOTENCY_FIXTURE = {
  id: '69000000-0000-5000-8000-000000000001',
  actor_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
  command_type: 'CREATE_ORDER',
  idempotency_key: 'synthetic-order-create-001',
  request_sha256: '1111111111111111111111111111111111111111111111111111111111111111',
  result_order_id: ORDER_FOUNDATION_ORDER_ID,
  completion_state: 'COMPLETED',
  created_at: ORDER_FOUNDATION_CREATED_AT,
  completed_at: ORDER_FOUNDATION_CREATED_AT
};

export const ORDER_EVENT_FIXTURES = [
  {
    id: '6a000000-0000-5000-8000-000000000001',
    order_id: ORDER_FOUNDATION_ORDER_ID,
    event_type: 'ORDER_CREATED',
    actor_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
    authority_context: 'ORDER_CREATE_PERMISSION',
    source_system: ORDER_FOUNDATION_SOURCE,
    reason: 'Synthetic canonical Order created',
    idempotency_key: ORDER_IDEMPOTENCY_FIXTURE.idempotency_key,
    occurred_at: ORDER_FOUNDATION_CREATED_AT
  },
  {
    id: '6a000000-0000-5000-8000-000000000002',
    order_id: ORDER_FOUNDATION_ORDER_ID,
    event_type: 'ORDER_ACCEPTED',
    actor_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
    authority_context: 'ORDER_CREATE_PERMISSION',
    source_system: ORDER_FOUNDATION_SOURCE,
    reason: 'Synthetic commercial evidence accepted',
    idempotency_key: ORDER_IDEMPOTENCY_FIXTURE.idempotency_key,
    occurred_at: ORDER_FOUNDATION_CREATED_AT
  }
];

export const ORDER_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: ORDER_PERMISSION_FIXTURES },
  { table: 'permission_set_permissions', keys: ['permission_set_id', 'permission_id'], rows: ORDER_PERMISSION_SET_PERMISSION_FIXTURES },
  { table: 'properties', keys: ['id'], rows: [ORDER_PROPERTY_FIXTURE] },
  { table: 'property_snapshots', keys: ['id'], rows: [ORDER_PROPERTY_SNAPSHOT_FIXTURE] },
  { table: 'custom_commercial_snapshots', keys: ['id'], rows: [ORDER_CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURE] },
  { table: 'orders', keys: ['id'], rows: [ORDER_FIXTURE] },
  { table: 'order_parties', keys: ['id'], rows: ORDER_PARTY_FIXTURES },
  { table: 'order_items', keys: ['id'], rows: ORDER_ITEM_FIXTURES },
  { table: 'order_external_references', keys: ['id'], rows: [ORDER_EXTERNAL_REFERENCE_FIXTURE] },
  { table: 'order_idempotency_records', keys: ['id'], rows: [ORDER_IDEMPOTENCY_FIXTURE] },
  { table: 'order_events', keys: ['id'], rows: ORDER_EVENT_FIXTURES }
] as const;

export const ORDER_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2,
  properties: 1,
  property_snapshots: 1,
  custom_commercial_snapshots: 1,
  orders: 1,
  order_parties: 6,
  order_items: 2,
  order_external_references: 1,
  order_idempotency_records: 1,
  order_events: 2,
  order_relationships: 0
};
