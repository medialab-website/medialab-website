import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const MEDIA_CULL_PERMISSION_FIXTURES = [
  {
    id: '96000000-0000-5000-8000-000000000001',
    code: 'media_cull.manage',
    description: 'Synthetic permission for controlled Cull Workspace inventory, decision, completion, and supersession commands.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '96000000-0000-5000-8000-000000000002',
    code: 'media_cull.read',
    description: 'Synthetic permission for organization-scoped Cull Workspace and selected-media projections.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const MEDIA_CULL_PERMISSION_SET_PERMISSION_FIXTURES =
  MEDIA_CULL_PERMISSION_FIXTURES.map((permission) => ({
    permission_set_id: PERMISSION_SET_FIXTURE.id,
    permission_id: permission.id,
    created_at: BASE_CREATED_AT
  }));

export const MEDIA_CULL_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: MEDIA_CULL_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: MEDIA_CULL_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const MEDIA_CULL_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2
};
