import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const PUBLICATION_DELIVERY_PERMISSION_FIXTURES = [
  {
    id: '99000000-0000-5000-8000-000000000001',
    code: 'media_publication.manage',
    description: 'Synthetic permission for controlled publication lifecycle commands.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '99000000-0000-5000-8000-000000000002',
    code: 'media_publication.read',
    description: 'Synthetic permission for organization-scoped publication evidence.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '99000000-0000-5000-8000-000000000003',
    code: 'delivery_entitlement.evaluate',
    description: 'Synthetic permission for current Property Hub delivery evaluation.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '99000000-0000-5000-8000-000000000004',
    code: 'delivery_entitlement.manage',
    description: 'Synthetic permission for controlled delivery-grant revocation.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '99000000-0000-5000-8000-000000000005',
    code: 'delivery_entitlement.read',
    description: 'Synthetic permission for organization-scoped delivery evidence.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '99000000-0000-5000-8000-000000000006',
    code: 'delivery_financial_evidence.record',
    description: 'Synthetic permission for bounded provider-neutral settlement-eligibility evidence.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const PUBLICATION_DELIVERY_PERMISSION_SET_PERMISSION_FIXTURES =
  PUBLICATION_DELIVERY_PERMISSION_FIXTURES.map((permission) => ({
    permission_set_id: PERMISSION_SET_FIXTURE.id,
    permission_id: permission.id,
    created_at: BASE_CREATED_AT
  }));

export const PUBLICATION_DELIVERY_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: PUBLICATION_DELIVERY_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: PUBLICATION_DELIVERY_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const PUBLICATION_DELIVERY_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 6,
  permission_set_permissions: 6
};
