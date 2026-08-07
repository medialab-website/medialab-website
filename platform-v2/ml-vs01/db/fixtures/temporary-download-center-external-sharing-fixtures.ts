import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const TEMPORARY_DOWNLOAD_CENTER_PERMISSION_FIXTURES = [
  {
    id: '9a000000-0000-5000-8000-000000000001',
    code: 'temporary_download_center.create',
    description: 'Synthetic permission for scoped Temporary Download Center creation.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '9a000000-0000-5000-8000-000000000002',
    code: 'temporary_download_center.manage',
    description: 'Synthetic permission for controlled center updates, replacement, and revocation.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '9a000000-0000-5000-8000-000000000003',
    code: 'temporary_download_center.read',
    description: 'Synthetic permission for scoped center and policy projections.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '9a000000-0000-5000-8000-000000000004',
    code: 'temporary_download_center.activity.read',
    description: 'Synthetic permission for creator or Organization Admin activity-evidence reads.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const TEMPORARY_DOWNLOAD_CENTER_PERMISSION_SET_PERMISSION_FIXTURES =
  TEMPORARY_DOWNLOAD_CENTER_PERMISSION_FIXTURES.map((permission) => ({
    permission_set_id: PERMISSION_SET_FIXTURE.id,
    permission_id: permission.id,
    created_at: BASE_CREATED_AT
  }));

export const TEMPORARY_DOWNLOAD_CENTER_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: TEMPORARY_DOWNLOAD_CENTER_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: TEMPORARY_DOWNLOAD_CENTER_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const TEMPORARY_DOWNLOAD_CENTER_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 4,
  permission_set_permissions: 4
};
