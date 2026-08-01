CREATE SCHEMA medialab_core;
REVOKE ALL ON SCHEMA medialab_core FROM PUBLIC;

CREATE TABLE medialab_core.people (
    id uuid PRIMARY KEY,
    display_name text NOT NULL,
    email text NOT NULL,
    title text NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT people_display_name_check CHECK (trim(display_name) <> '' AND length(display_name) <= 200 AND display_name = trim(display_name)),
    CONSTRAINT people_email_check CHECK (
        trim(email) <> '' AND 
        email = lower(email) AND 
        email = trim(email) AND
        length(email) - length(replace(email, '@', '')) = 1 AND
        position('@' in email) > 1 AND
        position('@' in email) < length(email)
    ),
    CONSTRAINT people_email_key UNIQUE (email),
    CONSTRAINT people_title_check CHECK (length(title) <= 200),
    CONSTRAINT people_updated_at_check CHECK (updated_at >= created_at)
);
REVOKE ALL ON TABLE medialab_core.people FROM PUBLIC;

CREATE TABLE medialab_core.identities (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    provider_subject text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    email_verified_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identities_provider_check CHECK (provider = 'LOCAL_DEVELOPMENT'),
    CONSTRAINT identities_provider_subject_check CHECK (trim(provider_subject) <> '' AND length(provider_subject) <= 255 AND provider_subject = trim(provider_subject)),
    CONSTRAINT identities_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT identities_provider_subject_key UNIQUE (provider, provider_subject),
    CONSTRAINT identities_person_id_provider_key UNIQUE (person_id, provider)
);
REVOKE ALL ON TABLE medialab_core.identities FROM PUBLIC;

CREATE TABLE medialab_core.organizations (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organizations_name_check CHECK (trim(name) <> '' AND length(name) <= 200 AND name = trim(name)),
    CONSTRAINT organizations_updated_at_check CHECK (updated_at >= created_at)
);
REVOKE ALL ON TABLE medialab_core.organizations FROM PUBLIC;

CREATE TABLE medialab_core.memberships (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    status text NOT NULL,
    is_organization_admin boolean NOT NULL DEFAULT false,
    activated_at timestamptz NULL,
    suspended_at timestamptz NULL,
    suspension_reason text NULL,
    removed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT memberships_status_check CHECK (status IN ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
    CONSTRAINT memberships_suspension_reason_check CHECK (suspension_reason IS NULL OR (trim(suspension_reason) <> '' AND length(suspension_reason) <= 500 AND suspension_reason = trim(suspension_reason))),
    CONSTRAINT memberships_org_person_key UNIQUE (organization_id, person_id),
    CONSTRAINT memberships_id_org_key UNIQUE (id, organization_id),
    CONSTRAINT memberships_updated_at_check CHECK (updated_at >= created_at),
    CONSTRAINT memberships_status_consistency CHECK (
        (status = 'PENDING_ACTIVATION' AND activated_at IS NULL AND suspended_at IS NULL AND suspension_reason IS NULL AND removed_at IS NULL) OR
        (status = 'ACTIVE' AND activated_at IS NOT NULL AND suspended_at IS NULL AND suspension_reason IS NULL AND removed_at IS NULL) OR
        (status = 'SUSPENDED' AND activated_at IS NOT NULL AND suspended_at IS NOT NULL AND suspension_reason IS NOT NULL AND removed_at IS NULL) OR
        (status = 'REMOVED' AND removed_at IS NOT NULL)
    )
);
REVOKE ALL ON TABLE medialab_core.memberships FROM PUBLIC;

CREATE TABLE medialab_core.permissions (
    id uuid PRIMARY KEY,
    code text NOT NULL UNIQUE,
    description text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT permissions_code_check CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    CONSTRAINT permissions_description_check CHECK (trim(description) <> '' AND length(description) <= 500 AND description = trim(description))
);
REVOKE ALL ON TABLE medialab_core.permissions FROM PUBLIC;

CREATE TABLE medialab_core.permission_sets (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    name text NOT NULL,
    is_member_specific boolean NOT NULL DEFAULT false,
    retired_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT permission_sets_name_check CHECK (trim(name) <> '' AND length(name) <= 200 AND name = trim(name)),
    CONSTRAINT permission_sets_org_name_key UNIQUE (organization_id, name),
    CONSTRAINT permission_sets_id_org_key UNIQUE (id, organization_id),
    CONSTRAINT permission_sets_updated_at_check CHECK (updated_at >= created_at)
);
REVOKE ALL ON TABLE medialab_core.permission_sets FROM PUBLIC;

CREATE TABLE medialab_core.permission_set_permissions (
    permission_set_id uuid NOT NULL REFERENCES medialab_core.permission_sets(id) ON DELETE RESTRICT,
    permission_id uuid NOT NULL REFERENCES medialab_core.permissions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (permission_set_id, permission_id)
);
REVOKE ALL ON TABLE medialab_core.permission_set_permissions FROM PUBLIC;

CREATE TABLE medialab_core.membership_permission_sets (
    organization_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    permission_set_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (membership_id, permission_set_id),
    FOREIGN KEY (membership_id, organization_id) REFERENCES medialab_core.memberships(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (permission_set_id, organization_id) REFERENCES medialab_core.permission_sets(id, organization_id) ON DELETE RESTRICT
);
REVOKE ALL ON TABLE medialab_core.membership_permission_sets FROM PUBLIC;

CREATE TABLE medialab_core.development_sessions (
    id uuid PRIMARY KEY,
    identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    token_sha256 text NOT NULL UNIQUE,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz NULL,
    CONSTRAINT development_sessions_token_sha256_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT development_sessions_expires_at_check CHECK (expires_at > issued_at),
    CONSTRAINT development_sessions_revoked_at_check CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);
REVOKE ALL ON TABLE medialab_core.development_sessions FROM PUBLIC;
