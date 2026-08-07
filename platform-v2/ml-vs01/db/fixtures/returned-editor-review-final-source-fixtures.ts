import { BASE_CREATED_AT, PERMISSION_SET_FIXTURE } from './identity-tenancy-fixtures.js';

export const MEDIA_RETURN_REVIEW_PERMISSION_FIXTURES = [
  {
    id: '98000000-0000-5000-8000-000000000001',
    code: 'media_return_review.manage',
    description: 'Synthetic permission for controlled returned-editor review and final-source decision commands.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '98000000-0000-5000-8000-000000000002',
    code: 'media_return_review.read',
    description: 'Synthetic permission for organization-scoped returned-editor review evidence.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const MEDIA_RETURN_REVIEW_PERMISSION_SET_PERMISSION_FIXTURES =
  MEDIA_RETURN_REVIEW_PERMISSION_FIXTURES.map((permission) => ({
    permission_set_id: PERMISSION_SET_FIXTURE.id,
    permission_id: permission.id,
    created_at: BASE_CREATED_AT
  }));

export const MEDIA_RETURN_REVIEW_FOUNDATION_FIXTURE_TABLES = [
  { table: 'permissions', keys: ['id'], rows: MEDIA_RETURN_REVIEW_PERMISSION_FIXTURES },
  {
    table: 'permission_set_permissions',
    keys: ['permission_set_id', 'permission_id'],
    rows: MEDIA_RETURN_REVIEW_PERMISSION_SET_PERMISSION_FIXTURES
  }
] as const;

export const MEDIA_RETURN_REVIEW_FOUNDATION_ROW_COUNT_INCREMENTS = {
  permissions: 2,
  permission_set_permissions: 2
};
