import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const EDITORIAL_SEGMENT_PERMISSION_FIXTURES = [
  {
    id: '9d000000-0000-5000-8000-000000000001',
    code: 'editorial_segment.manage',
    description: 'Synthetic permission for controlled technical-media observation and editorial segment commands.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '9d000000-0000-5000-8000-000000000002',
    code: 'editorial_segment.read',
    description: 'Synthetic permission for organization-scoped editorial segment projections.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const EDITORIAL_SEGMENT_PERMISSION_SET_PERMISSION_FIXTURES =
  EDITORIAL_SEGMENT_PERMISSION_FIXTURES.map((permission) => ({
    permission_set_id: PERMISSION_SET_FIXTURE.id,
    permission_id: permission.id,
    created_at: BASE_CREATED_AT
  }));

export const EDITORIAL_SEGMENT_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: EDITORIAL_SEGMENT_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: EDITORIAL_SEGMENT_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const EDITORIAL_SEGMENT_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2
};
