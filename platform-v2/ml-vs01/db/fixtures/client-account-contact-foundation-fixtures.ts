import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const CLIENT_ACCOUNT_PERMISSION_FIXTURES = [
  {
    id: '9b000000-0000-5000-8000-000000000001',
    code: 'client_account.manage',
    description: 'Synthetic permission for controlled client-account and organization-operator contact intake.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '9b000000-0000-5000-8000-000000000002',
    code: 'client_account.read',
    description: 'Synthetic permission for organization-scoped client-account retrieval.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES =
  CLIENT_ACCOUNT_PERMISSION_FIXTURES.map((permission) => ({
    permission_set_id: PERMISSION_SET_FIXTURE.id,
    permission_id: permission.id,
    created_at: BASE_CREATED_AT
  }));

export const CLIENT_ACCOUNT_CONTACT_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: CLIENT_ACCOUNT_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const CLIENT_ACCOUNT_CONTACT_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2
};
