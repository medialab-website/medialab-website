export const BASE_CREATED_AT = '2026-01-01T00:00:00.000Z';
export const BASE_UPDATED_AT = '2026-01-01T00:00:00.000Z';
export const IDENTITY_VERIFIED_AT = '2026-01-01T00:05:00.000Z';
export const MEMBERSHIP_ACTIVATED_AT = '2026-01-01T00:05:00.000Z';
export const SESSION_ISSUED_AT = '2026-01-01T00:10:00.000Z';
export const SESSION_EXPIRES_AT = '2099-01-01T00:00:00.000Z';

export const ORGANIZATION_FIXTURE = {
  id: '6d91cee6-91c1-52ea-937a-77c1ddc51c63',
  name: 'MediaLab Foundation Fixture',
  created_at: BASE_CREATED_AT,
  updated_at: BASE_UPDATED_AT
};

export const PEOPLE_FIXTURES = [
  {
    id: '034a2b54-4665-5917-90a6-ae40adb3c8aa',
    display_name: 'Foundation Owner',
    email: 'owner@fixture.medialab.invalid',
    title: 'Owner Fixture',
    created_at: BASE_CREATED_AT,
    updated_at: BASE_UPDATED_AT
  },
  {
    id: 'd43d9499-efbd-5116-b561-67dd34d1df8d',
    display_name: 'Foundation Operator',
    email: 'operator@fixture.medialab.invalid',
    title: 'Operator Fixture',
    created_at: BASE_CREATED_AT,
    updated_at: BASE_UPDATED_AT
  },
  {
    id: '8fea1876-a25f-5dec-9a1e-c17caf0e5de5',
    display_name: 'Pending Member',
    email: 'pending@fixture.medialab.invalid',
    title: null,
    created_at: BASE_CREATED_AT,
    updated_at: BASE_UPDATED_AT
  }
];

export const IDENTITY_FIXTURES = [
  {
    id: 'e69ced56-a63e-57bf-a6b5-26d5fe6cc5c5',
    person_id: '034a2b54-4665-5917-90a6-ae40adb3c8aa',
    provider: 'LOCAL_DEVELOPMENT',
    provider_subject: 'fixture-owner',
    status: 'ACTIVE',
    email_verified_at: IDENTITY_VERIFIED_AT,
    created_at: BASE_CREATED_AT
  },
  {
    id: '87c0043a-334f-548c-95d7-d53939ab054b',
    person_id: 'd43d9499-efbd-5116-b561-67dd34d1df8d',
    provider: 'LOCAL_DEVELOPMENT',
    provider_subject: 'fixture-operator',
    status: 'ACTIVE',
    email_verified_at: IDENTITY_VERIFIED_AT,
    created_at: BASE_CREATED_AT
  }
];

export const MEMBERSHIP_FIXTURES = [
  {
    id: 'd614e5c7-9d65-54da-8e08-2562ae2f1f48',
    organization_id: '6d91cee6-91c1-52ea-937a-77c1ddc51c63',
    person_id: '034a2b54-4665-5917-90a6-ae40adb3c8aa',
    status: 'ACTIVE',
    is_organization_admin: true,
    activated_at: MEMBERSHIP_ACTIVATED_AT,
    suspended_at: null,
    suspension_reason: null,
    removed_at: null,
    created_at: BASE_CREATED_AT,
    updated_at: BASE_UPDATED_AT
  },
  {
    id: '50d8b321-7b99-5bd9-b1a4-cecb924ecc39',
    organization_id: '6d91cee6-91c1-52ea-937a-77c1ddc51c63',
    person_id: 'd43d9499-efbd-5116-b561-67dd34d1df8d',
    status: 'ACTIVE',
    is_organization_admin: false,
    activated_at: MEMBERSHIP_ACTIVATED_AT,
    suspended_at: null,
    suspension_reason: null,
    removed_at: null,
    created_at: BASE_CREATED_AT,
    updated_at: BASE_UPDATED_AT
  },
  {
    id: 'ce25c5aa-c586-573f-b98e-1e23e587ccc5',
    organization_id: '6d91cee6-91c1-52ea-937a-77c1ddc51c63',
    person_id: '8fea1876-a25f-5dec-9a1e-c17caf0e5de5',
    status: 'PENDING_ACTIVATION',
    is_organization_admin: false,
    activated_at: null,
    suspended_at: null,
    suspension_reason: null,
    removed_at: null,
    created_at: BASE_CREATED_AT,
    updated_at: BASE_UPDATED_AT
  }
];

export const PERMISSION_FIXTURES = [
  {
    id: '1bea4429-36a3-52e9-813a-2122b4aeb05c',
    code: 'fixture.members_view',
    description: 'Synthetic fixture permission for membership-read tests.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: '1ad4c2fc-4c89-5deb-b03a-58149463d6a0',
    code: 'fixture.members_manage',
    description: 'Synthetic fixture permission for membership-management tests.',
    is_active: true,
    created_at: BASE_CREATED_AT
  },
  {
    id: 'ae137114-4afd-51ca-a2f0-5e27fbe61471',
    code: 'fixture.foundation_inspect',
    description: 'Synthetic fixture permission for foundation-inspection tests.',
    is_active: true,
    created_at: BASE_CREATED_AT
  }
];

export const PERMISSION_SET_FIXTURE = {
  id: 'a2f7dc02-5f3b-5763-aa57-eeb3474b1af4',
  organization_id: '6d91cee6-91c1-52ea-937a-77c1ddc51c63',
  name: 'Fixture Operations',
  is_member_specific: false,
  retired_at: null,
  created_at: BASE_CREATED_AT,
  updated_at: BASE_UPDATED_AT
};

export const PERMISSION_SET_PERMISSION_FIXTURES = [
  {
    permission_set_id: 'a2f7dc02-5f3b-5763-aa57-eeb3474b1af4',
    permission_id: '1bea4429-36a3-52e9-813a-2122b4aeb05c',
    created_at: BASE_CREATED_AT
  },
  {
    permission_set_id: 'a2f7dc02-5f3b-5763-aa57-eeb3474b1af4',
    permission_id: '1ad4c2fc-4c89-5deb-b03a-58149463d6a0',
    created_at: BASE_CREATED_AT
  },
  {
    permission_set_id: 'a2f7dc02-5f3b-5763-aa57-eeb3474b1af4',
    permission_id: 'ae137114-4afd-51ca-a2f0-5e27fbe61471',
    created_at: BASE_CREATED_AT
  }
];

export const MEMBERSHIP_PERMISSION_SET_FIXTURES = [
  {
    organization_id: '6d91cee6-91c1-52ea-937a-77c1ddc51c63',
    membership_id: '50d8b321-7b99-5bd9-b1a4-cecb924ecc39',
    permission_set_id: 'a2f7dc02-5f3b-5763-aa57-eeb3474b1af4',
    created_at: MEMBERSHIP_ACTIVATED_AT
  }
];

export const DEVELOPMENT_SESSION_FIXTURE = {
  id: 'ffb854e8-572f-5597-877a-1c6dbe8d6e00',
  identity_id: 'e69ced56-a63e-57bf-a6b5-26d5fe6cc5c5',
  token_sha256: '83d0260db72ad3bdecf848d45eca989ea869361b15545596286734a6c79a2668',
  issued_at: SESSION_ISSUED_AT,
  expires_at: SESSION_EXPIRES_AT,
  revoked_at: null
};

export const EXPECTED_ROW_COUNTS = {
  organizations: 1,
  people: 3,
  identities: 2,
  memberships: 3,
  permissions: 3,
  permission_sets: 1,
  permission_set_permissions: 3,
  membership_permission_sets: 1,
  development_sessions: 1
};
