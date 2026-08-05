import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const MISSION_PLAN_PERMISSION_FIXTURES = [
  {
    id: '92000000-0000-5000-8000-000000000001',
    code: 'mission_plan.manage',
    description: 'Synthetic permission for controlled Mission Plan draft, issue, note, and open-event commands.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '92000000-0000-5000-8000-000000000002',
    code: 'mission_plan.read',
    description: 'Synthetic permission for organization-scoped Mission Plan projections.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '92000000-0000-5000-8000-000000000003',
    code: 'mission_plan.sensitive_read',
    description: 'Synthetic permission for opaque Mission Plan protected-envelope metadata retrieval.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const MISSION_PLAN_PERMISSION_SET_PERMISSION_FIXTURES = MISSION_PLAN_PERMISSION_FIXTURES.map((permission) => ({
  permission_set_id: PERMISSION_SET_FIXTURE.id,
  permission_id: permission.id,
  created_at: BASE_CREATED_AT
}));

export const MISSION_PLAN_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: MISSION_PLAN_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: MISSION_PLAN_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const MISSION_PLAN_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 3,
  permission_set_permissions: 3
};
