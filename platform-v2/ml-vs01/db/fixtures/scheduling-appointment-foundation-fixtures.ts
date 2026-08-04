import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const SCHEDULING_PERMISSION_FIXTURES = [
  {
    id: '81000000-0000-5000-8000-000000000001',
    code: 'scheduling.staff.manage',
    description: 'Synthetic permission for controlled staff scheduling and Appointment commands.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '81000000-0000-5000-8000-000000000002',
    code: 'scheduling.read',
    description: 'Synthetic permission for authorized staff scheduling and Appointment retrieval.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const SCHEDULING_PERMISSION_SET_PERMISSION_FIXTURES = SCHEDULING_PERMISSION_FIXTURES.map((permission) => ({
  permission_set_id: PERMISSION_SET_FIXTURE.id,
  permission_id: permission.id,
  created_at: BASE_CREATED_AT
}));

export const SCHEDULING_APPOINTMENT_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: SCHEDULING_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: SCHEDULING_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const SCHEDULING_APPOINTMENT_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2
};
