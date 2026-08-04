import {
  BASE_CREATED_AT,
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  ORGANIZATION_FIXTURE,
  PERMISSION_SET_FIXTURE
} from './identity-tenancy-fixtures.js';
import { COMMERCIAL_SNAPSHOT_FIXTURES } from './current-catalog-price-fixtures.js';
import {
  ORDER_FIXTURE,
  ORDER_FOUNDATION_ORDER_ID,
  ORDER_FOUNDATION_PROPERTY_ID,
  ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
  ORDER_PARTY_FIXTURES
} from './order-foundation-fixtures.js';

export const PROPERTY_HUB_SOURCE = 'SYNTHETIC_P02_M04_B_FIXTURE';
export const PROPERTY_HUB_CREATED_AT = '2026-08-06T12:00:00.000Z';
export const PROPERTY_HUB_ACTOR_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
export const PROPERTY_HUB_ID = '71000000-0000-5000-8000-000000000001';
export const PROPERTY_HUB_SECOND_ORDER_ID = '72000000-0000-5000-8000-000000000001';

export const PROPERTY_HUB_PERMISSION_FIXTURES = [
  {
    id: '71000000-0000-5000-8000-000000000002',
    code: 'property_hub.create',
    description: 'Synthetic fixture permission for provider-neutral Property Hub creation.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '71000000-0000-5000-8000-000000000003',
    code: 'property_hub.read',
    description: 'Synthetic fixture permission for participant-scoped Property Hub reads.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const PROPERTY_HUB_PERMISSION_SET_PERMISSION_FIXTURES = PROPERTY_HUB_PERMISSION_FIXTURES.map((permission) => ({
  permission_set_id: PERMISSION_SET_FIXTURE.id,
  permission_id: permission.id,
  created_at: BASE_CREATED_AT
}));

export const PROPERTY_HUB_SECOND_ORDER_FIXTURE = {
  ...ORDER_FIXTURE,
  id: PROPERTY_HUB_SECOND_ORDER_ID,
  item_subtotal_cents: 15000,
  travel_amount_cents: 0,
  travel_basis: null,
  total_amount_cents: 15000,
  source_system: PROPERTY_HUB_SOURCE,
  created_at: PROPERTY_HUB_CREATED_AT,
  accepted_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_SECOND_ORDER_PARTY_FIXTURES = ORDER_PARTY_FIXTURES.map((party, index) => ({
  ...party,
  id: `72100000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
  order_id: PROPERTY_HUB_SECOND_ORDER_ID,
  source_system: PROPERTY_HUB_SOURCE,
  recorded_at: PROPERTY_HUB_CREATED_AT
}));

export const PROPERTY_HUB_SECOND_ORDER_ITEM_FIXTURE = {
  id: '72200000-0000-5000-8000-000000000001',
  order_id: PROPERTY_HUB_SECOND_ORDER_ID,
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
  created_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_SECOND_ORDER_EXTERNAL_REFERENCE_FIXTURE = {
  id: '72300000-0000-5000-8000-000000000001',
  order_id: PROPERTY_HUB_SECOND_ORDER_ID,
  provider: PROPERTY_HUB_SOURCE,
  external_record_type: 'ORDER',
  external_identifier: 'synthetic-property-hub-order-002',
  provenance: 'SYNTHETIC_PROPERTY_HUB_SEED',
  recorded_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
  recorded_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_SECOND_ORDER_IDEMPOTENCY_FIXTURE = {
  id: '72400000-0000-5000-8000-000000000001',
  actor_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
  command_type: 'CREATE_ORDER',
  idempotency_key: 'synthetic-property-hub-order-create-002',
  request_sha256: '2222222222222222222222222222222222222222222222222222222222222222',
  result_order_id: PROPERTY_HUB_SECOND_ORDER_ID,
  completion_state: 'COMPLETED',
  created_at: PROPERTY_HUB_CREATED_AT,
  completed_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_SECOND_ORDER_EVENT_FIXTURES = [
  {
    id: '72500000-0000-5000-8000-000000000001',
    order_id: PROPERTY_HUB_SECOND_ORDER_ID,
    event_type: 'ORDER_CREATED',
    actor_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
    authority_context: 'ORDER_CREATE_PERMISSION',
    source_system: PROPERTY_HUB_SOURCE,
    reason: 'Synthetic supplemental canonical Order created',
    idempotency_key: PROPERTY_HUB_SECOND_ORDER_IDEMPOTENCY_FIXTURE.idempotency_key,
    occurred_at: PROPERTY_HUB_CREATED_AT
  },
  {
    id: '72500000-0000-5000-8000-000000000002',
    order_id: PROPERTY_HUB_SECOND_ORDER_ID,
    event_type: 'ORDER_ACCEPTED',
    actor_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
    authority_context: 'ORDER_CREATE_PERMISSION',
    source_system: PROPERTY_HUB_SOURCE,
    reason: 'Synthetic supplemental commercial evidence accepted',
    idempotency_key: PROPERTY_HUB_SECOND_ORDER_IDEMPOTENCY_FIXTURE.idempotency_key,
    occurred_at: PROPERTY_HUB_CREATED_AT
  }
];

export const PROPERTY_HUB_FIXTURE = {
  id: PROPERTY_HUB_ID,
  organization_id: ORGANIZATION_FIXTURE.id,
  property_id: ORDER_FOUNDATION_PROPERTY_ID,
  initial_property_snapshot_id: ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
  current_state: 'ESTABLISHED',
  source_system: PROPERTY_HUB_SOURCE,
  created_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
  created_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_ORDER_FIXTURES = [
  {
    property_hub_id: PROPERTY_HUB_ID,
    organization_id: ORGANIZATION_FIXTURE.id,
    property_id: ORDER_FOUNDATION_PROPERTY_ID,
    order_id: ORDER_FOUNDATION_ORDER_ID,
    associated_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
    associated_at: PROPERTY_HUB_CREATED_AT
  },
  {
    property_hub_id: PROPERTY_HUB_ID,
    organization_id: ORGANIZATION_FIXTURE.id,
    property_id: ORDER_FOUNDATION_PROPERTY_ID,
    order_id: PROPERTY_HUB_SECOND_ORDER_ID,
    associated_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
    associated_at: PROPERTY_HUB_CREATED_AT
  }
];

export const PROPERTY_HUB_PARTICIPANT_FIXTURES = [
  {
    id: '73000000-0000-5000-8000-000000000001',
    property_hub_id: PROPERTY_HUB_ID,
    organization_id: ORGANIZATION_FIXTURE.id,
    membership_id: MEMBERSHIP_FIXTURES[1].id,
    participant_role: 'HUB_MANAGER',
    recorded_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
    recorded_at: PROPERTY_HUB_CREATED_AT
  },
  {
    id: '73000000-0000-5000-8000-000000000002',
    property_hub_id: PROPERTY_HUB_ID,
    organization_id: ORGANIZATION_FIXTURE.id,
    membership_id: MEMBERSHIP_FIXTURES[0].id,
    participant_role: 'HUB_PARTICIPANT',
    recorded_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
    recorded_at: PROPERTY_HUB_CREATED_AT
  }
];

export const PROPERTY_HUB_EXTERNAL_REFERENCE_FIXTURE = {
  id: '74000000-0000-5000-8000-000000000001',
  property_hub_id: PROPERTY_HUB_ID,
  provider: PROPERTY_HUB_SOURCE,
  external_record_type: 'PROPERTY_ENGAGEMENT',
  external_identifier: 'synthetic-property-hub-001',
  provenance: 'SYNTHETIC_CANONICAL_PROPERTY_HUB_SEED',
  recorded_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
  recorded_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_IDEMPOTENCY_FIXTURE = {
  id: '75000000-0000-5000-8000-000000000001',
  actor_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
  command_type: 'CREATE_PROPERTY_HUB',
  idempotency_key: 'synthetic-property-hub-create-001',
  request_sha256: '3333333333333333333333333333333333333333333333333333333333333333',
  result_property_hub_id: PROPERTY_HUB_ID,
  completion_state: 'COMPLETED',
  created_at: PROPERTY_HUB_CREATED_AT,
  completed_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_EVENT_FIXTURE = {
  id: '76000000-0000-5000-8000-000000000001',
  property_hub_id: PROPERTY_HUB_ID,
  organization_id: ORGANIZATION_FIXTURE.id,
  event_type: 'PROPERTY_HUB_CREATED',
  actor_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
  authority_context: 'PROPERTY_HUB_CREATE_PERMISSION',
  source_system: PROPERTY_HUB_SOURCE,
  reason: 'Synthetic canonical Property Hub engagement established',
  idempotency_key: PROPERTY_HUB_IDEMPOTENCY_FIXTURE.idempotency_key,
  occurred_at: PROPERTY_HUB_CREATED_AT
};

export const PROPERTY_HUB_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: PROPERTY_HUB_PERMISSION_FIXTURES },
  { table: 'permission_set_permissions', keys: ['permission_set_id', 'permission_id'], rows: PROPERTY_HUB_PERMISSION_SET_PERMISSION_FIXTURES },
  { table: 'orders', keys: ['id'], rows: [PROPERTY_HUB_SECOND_ORDER_FIXTURE] },
  { table: 'order_parties', keys: ['id'], rows: PROPERTY_HUB_SECOND_ORDER_PARTY_FIXTURES },
  { table: 'order_items', keys: ['id'], rows: [PROPERTY_HUB_SECOND_ORDER_ITEM_FIXTURE] },
  { table: 'order_external_references', keys: ['id'], rows: [PROPERTY_HUB_SECOND_ORDER_EXTERNAL_REFERENCE_FIXTURE] },
  { table: 'order_idempotency_records', keys: ['id'], rows: [PROPERTY_HUB_SECOND_ORDER_IDEMPOTENCY_FIXTURE] },
  { table: 'order_events', keys: ['id'], rows: PROPERTY_HUB_SECOND_ORDER_EVENT_FIXTURES },
  { table: 'property_hubs', keys: ['id'], rows: [PROPERTY_HUB_FIXTURE] },
  { table: 'property_hub_orders', keys: ['property_hub_id', 'order_id'], rows: PROPERTY_HUB_ORDER_FIXTURES },
  { table: 'property_hub_participants', keys: ['id'], rows: PROPERTY_HUB_PARTICIPANT_FIXTURES },
  { table: 'property_hub_external_references', keys: ['id'], rows: [PROPERTY_HUB_EXTERNAL_REFERENCE_FIXTURE] },
  { table: 'property_hub_idempotency_records', keys: ['id'], rows: [PROPERTY_HUB_IDEMPOTENCY_FIXTURE] },
  { table: 'property_hub_events', keys: ['id'], rows: [PROPERTY_HUB_EVENT_FIXTURE] }
] as const;

export const PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2,
  orders: 1,
  order_parties: 6,
  order_items: 1,
  order_external_references: 1,
  order_idempotency_records: 1,
  order_events: 2,
  property_hubs: 1,
  property_hub_orders: 2,
  property_hub_participants: 2,
  property_hub_external_references: 1,
  property_hub_idempotency_records: 1,
  property_hub_events: 1
};
