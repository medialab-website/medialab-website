import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const JOB_SERVICE_PERMISSION_FIXTURES = [
  {
    id: '91000000-0000-5000-8000-000000000001',
    code: 'job.manage',
    description: 'Synthetic permission for controlled Job and Service Workstream commands.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '91000000-0000-5000-8000-000000000002',
    code: 'job.read',
    description: 'Synthetic permission for organization-scoped Job and Service Workstream retrieval.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const JOB_SERVICE_PERMISSION_SET_PERMISSION_FIXTURES = JOB_SERVICE_PERMISSION_FIXTURES.map((permission) => ({
  permission_set_id: PERMISSION_SET_FIXTURE.id,
  permission_id: permission.id,
  created_at: BASE_CREATED_AT
}));

export const JOB_SERVICE_WORKSTREAM_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: JOB_SERVICE_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: JOB_SERVICE_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const JOB_SERVICE_WORKSTREAM_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2
};
