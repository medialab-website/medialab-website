CREATE OR REPLACE FUNCTION medialab_core.normalize_contact_value(
    p_contact_type text,
    p_submitted_value text
)
RETURNS text AS $$
BEGIN
    IF p_contact_type = 'EMAIL' THEN
        RETURN lower(btrim(p_submitted_value));
    ELSIF p_contact_type = 'PHONE' THEN
        -- This packet only promises deterministic surrounding-whitespace removal.
        RETURN btrim(p_submitted_value);
    END IF;

    RAISE EXCEPTION 'Unsupported contact type: %', p_contact_type
        USING ERRCODE = '22023';
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.normalize_contact_value(text, text) FROM PUBLIC;

CREATE TABLE medialab_core.contact_methods (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    contact_type text NOT NULL,
    submitted_value text NOT NULL,
    normalized_value text NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
    created_by_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    creation_authority text NOT NULL DEFAULT 'IDENTITY',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    superseded_at timestamptz NULL,
    CONSTRAINT contact_methods_type_check CHECK (contact_type IN ('EMAIL', 'PHONE')),
    CONSTRAINT contact_methods_submitted_value_check CHECK (length(submitted_value) <= 320),
    CONSTRAINT contact_methods_normalized_value_check CHECK (
        normalized_value <> '' AND
        normalized_value = medialab_core.normalize_contact_value(contact_type, submitted_value)
    ),
    CONSTRAINT contact_methods_email_check CHECK (
        contact_type <> 'EMAIL' OR (
            length(normalized_value) <= 320 AND
            length(normalized_value) - length(replace(normalized_value, '@', '')) = 1 AND
            position('@' in normalized_value) > 1 AND
            position('@' in normalized_value) < length(normalized_value)
        )
    ),
    CONSTRAINT contact_methods_phone_check CHECK (
        contact_type <> 'PHONE' OR length(normalized_value) <= 64
    ),
    CONSTRAINT contact_methods_lifecycle_check CHECK (
        lifecycle_state IN ('ACTIVE', 'SUPERSEDED', 'RETIRED')
    ),
    CONSTRAINT contact_methods_creation_authority_check CHECK (
        (creation_authority = 'IDENTITY' AND created_by_identity_id IS NOT NULL) OR
        (creation_authority = 'SYSTEM_MIGRATION' AND created_by_identity_id IS NULL)
    ),
    CONSTRAINT contact_methods_lifecycle_timestamp_check CHECK (
        (lifecycle_state = 'ACTIVE' AND superseded_at IS NULL) OR
        (lifecycle_state IN ('SUPERSEDED', 'RETIRED') AND superseded_at IS NOT NULL AND superseded_at >= created_at)
    )
);

CREATE UNIQUE INDEX contact_methods_active_email_normalized_key
    ON medialab_core.contact_methods (normalized_value)
    WHERE contact_type = 'EMAIL' AND lifecycle_state = 'ACTIVE';

CREATE UNIQUE INDEX contact_methods_active_phone_person_key
    ON medialab_core.contact_methods (person_id, normalized_value)
    WHERE contact_type = 'PHONE' AND lifecycle_state = 'ACTIVE';

REVOKE ALL ON TABLE medialab_core.contact_methods FROM PUBLIC;

CREATE TABLE medialab_core.contact_verification_evidence (
    id uuid PRIMARY KEY,
    contact_method_id uuid NOT NULL REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    verified_at timestamptz NOT NULL,
    verification_channel text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    external_evidence_reference text NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT contact_verification_channel_check CHECK (
        verification_channel IN ('EMAIL_LINK', 'SMS_CODE', 'MANUAL_AUTHORITY', 'MIGRATED_IDENTITY_ASSERTION')
    ),
    CONSTRAINT contact_verification_external_reference_check CHECK (
        external_evidence_reference IS NULL OR (
            btrim(external_evidence_reference) <> '' AND
            external_evidence_reference = btrim(external_evidence_reference) AND
            length(external_evidence_reference) <= 255
        )
    ),
    CONSTRAINT contact_verification_time_check CHECK (created_at >= verified_at)
);

REVOKE ALL ON TABLE medialab_core.contact_verification_evidence FROM PUBLIC;

CREATE TABLE medialab_core.contact_verification_invalidations (
    id uuid PRIMARY KEY,
    verification_evidence_id uuid NOT NULL UNIQUE REFERENCES medialab_core.contact_verification_evidence(id) ON DELETE RESTRICT,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    invalidated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT contact_verification_invalidations_reason_check CHECK (
        btrim(reason) <> '' AND reason = btrim(reason) AND length(reason) <= 500
    )
);

REVOKE ALL ON TABLE medialab_core.contact_verification_invalidations FROM PUBLIC;

CREATE TABLE medialab_core.contact_method_supersessions (
    id uuid PRIMARY KEY,
    previous_contact_method_id uuid NOT NULL UNIQUE REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    replacement_contact_method_id uuid NOT NULL REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    superseded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    CONSTRAINT contact_method_supersessions_distinct_check CHECK (
        previous_contact_method_id <> replacement_contact_method_id
    ),
    CONSTRAINT contact_method_supersessions_reason_check CHECK (
        btrim(reason) <> '' AND reason = btrim(reason) AND length(reason) <= 500
    )
);

REVOKE ALL ON TABLE medialab_core.contact_method_supersessions FROM PUBLIC;

CREATE TABLE medialab_core.contact_method_retirements (
    id uuid PRIMARY KEY,
    contact_method_id uuid NOT NULL UNIQUE REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    CONSTRAINT contact_method_retirements_reason_check CHECK (
        btrim(reason) <> '' AND reason = btrim(reason) AND length(reason) <= 500
    )
);

REVOKE ALL ON TABLE medialab_core.contact_method_retirements FROM PUBLIC;

CREATE TABLE medialab_core.primary_email_replacements (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    previous_contact_method_id uuid NOT NULL REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    replacement_contact_method_id uuid NOT NULL REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    replaced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    CONSTRAINT primary_email_replacements_distinct_check CHECK (
        previous_contact_method_id <> replacement_contact_method_id
    ),
    CONSTRAINT primary_email_replacements_reason_check CHECK (
        btrim(reason) <> '' AND reason = btrim(reason) AND length(reason) <= 500
    )
);

REVOKE ALL ON TABLE medialab_core.primary_email_replacements FROM PUBLIC;

CREATE TABLE medialab_core.person_account_states (
    person_id uuid PRIMARY KEY REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    identity_id uuid NOT NULL UNIQUE REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    current_state text NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT person_account_states_state_check CHECK (
        current_state IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'RECOVERED')
    ),
    CONSTRAINT person_account_states_updated_at_check CHECK (updated_at >= created_at)
);

REVOKE ALL ON TABLE medialab_core.person_account_states FROM PUBLIC;

CREATE TABLE medialab_core.account_recovery_sessions (
    id uuid PRIMARY KEY,
    identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    token_sha256 text NOT NULL UNIQUE,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz NULL,
    consumed_at timestamptz NULL,
    external_authentication_reference text NULL,
    CONSTRAINT account_recovery_sessions_token_sha256_check CHECK (
        token_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT account_recovery_sessions_expires_at_check CHECK (expires_at > issued_at),
    CONSTRAINT account_recovery_sessions_revoked_at_check CHECK (
        revoked_at IS NULL OR revoked_at >= issued_at
    ),
    CONSTRAINT account_recovery_sessions_consumed_at_check CHECK (
        consumed_at IS NULL OR (consumed_at >= issued_at AND consumed_at < expires_at)
    ),
    CONSTRAINT account_recovery_sessions_external_reference_check CHECK (
        external_authentication_reference IS NULL OR (
            btrim(external_authentication_reference) <> '' AND
            external_authentication_reference = btrim(external_authentication_reference) AND
            length(external_authentication_reference) <= 255
        )
    )
);

REVOKE ALL ON TABLE medialab_core.account_recovery_sessions FROM PUBLIC;

CREATE TABLE medialab_core.account_lifecycle_transitions (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    previous_state text NOT NULL,
    new_state text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    recovery_mode text NULL,
    transitioned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    CONSTRAINT account_lifecycle_transitions_previous_state_check CHECK (
        previous_state IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'RECOVERED')
    ),
    CONSTRAINT account_lifecycle_transitions_new_state_check CHECK (
        new_state IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'RECOVERED')
    ),
    CONSTRAINT account_lifecycle_transitions_distinct_check CHECK (previous_state <> new_state),
    CONSTRAINT account_lifecycle_transitions_reason_check CHECK (
        btrim(reason) <> '' AND reason = btrim(reason) AND length(reason) <= 500
    ),
    CONSTRAINT account_lifecycle_transitions_recovery_mode_check CHECK (
        (previous_state = 'DEACTIVATED' AND new_state = 'RECOVERED' AND recovery_mode IN ('PRESERVE', 'START_FRESH')) OR
        (NOT (previous_state = 'DEACTIVATED' AND new_state = 'RECOVERED') AND recovery_mode IS NULL)
    )
);

REVOKE ALL ON TABLE medialab_core.account_lifecycle_transitions FROM PUBLIC;

CREATE OR REPLACE FUNCTION medialab_core.resolve_ordinary_session(
    p_session_token text
)
RETURNS TABLE(actor_identity_id uuid, actor_person_id uuid) AS $$
DECLARE
    v_token_sha256 text;
    v_now timestamptz := clock_timestamp();
BEGIN
    v_token_sha256 := encode(sha256(convert_to(p_session_token, 'UTF8')), 'hex');

    RETURN QUERY
    SELECT s.identity_id, i.person_id
      FROM medialab_core.development_sessions s
      JOIN medialab_core.identities i ON i.id = s.identity_id
     WHERE s.token_sha256 = v_token_sha256
       AND s.issued_at <= v_now
       AND s.expires_at > v_now
       AND s.revoked_at IS NULL
       AND i.status = 'ACTIVE'
     FOR SHARE OF s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ordinary session is missing, expired, revoked, or inactive'
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.resolve_ordinary_session(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION medialab_core.resolve_account_recovery_session(
    p_recovery_token text,
    p_target_identity_id uuid
)
RETURNS TABLE(recovery_session_id uuid, actor_identity_id uuid, actor_person_id uuid) AS $$
DECLARE
    v_token_sha256 text;
    v_now timestamptz := clock_timestamp();
BEGIN
    v_token_sha256 := encode(sha256(convert_to(p_recovery_token, 'UTF8')), 'hex');

    RETURN QUERY
    SELECT s.id, s.identity_id, i.person_id
      FROM medialab_core.account_recovery_sessions s
      JOIN medialab_core.identities i ON i.id = s.identity_id
     WHERE s.token_sha256 = v_token_sha256
       AND s.identity_id = p_target_identity_id
       AND s.issued_at <= v_now
       AND s.expires_at > v_now
       AND s.revoked_at IS NULL
       AND s.consumed_at IS NULL
       AND i.status = 'ACTIVE'
     FOR UPDATE OF s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Recovery session is missing, expired, revoked, consumed, or belongs to another Identity'
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.resolve_account_recovery_session(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION medialab_core.require_identity_person(
    p_actor_identity_id uuid,
    p_person_id uuid,
    p_require_usable_account boolean DEFAULT true
)
RETURNS void AS $$
DECLARE
    v_actor_person_id uuid;
    v_identity_status text;
    v_account_state text;
BEGIN
    SELECT person_id, status
      INTO v_actor_person_id, v_identity_status
      FROM medialab_core.identities
     WHERE id = p_actor_identity_id;

    IF v_actor_person_id IS NULL OR v_identity_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Actor identity is missing or inactive'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_person_id <> p_person_id THEN
        RAISE EXCEPTION 'Actor identity does not belong to the target Person'
            USING ERRCODE = '42501';
    END IF;

    IF p_require_usable_account THEN
        SELECT current_state
          INTO v_account_state
          FROM medialab_core.person_account_states
         WHERE person_id = p_person_id
           AND identity_id = p_actor_identity_id;

        IF v_account_state NOT IN ('ACTIVE', 'RECOVERED') THEN
            RAISE EXCEPTION 'Actor account is not usable in state %', coalesce(v_account_state, 'MISSING')
                USING ERRCODE = '42501';
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.require_identity_person(uuid, uuid, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION medialab_core.actor_can_administer_person(
    p_actor_identity_id uuid,
    p_target_person_id uuid
)
RETURNS boolean AS $$
DECLARE
    v_actor_person_id uuid;
BEGIN
    SELECT i.person_id
      INTO v_actor_person_id
      FROM medialab_core.identities i
      JOIN medialab_core.person_account_states s
        ON s.identity_id = i.id
       AND s.person_id = i.person_id
     WHERE i.id = p_actor_identity_id
       AND i.status = 'ACTIVE'
       AND s.current_state IN ('ACTIVE', 'RECOVERED');

    IF v_actor_person_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
          FROM medialab_core.memberships actor_membership
          JOIN medialab_core.memberships target_membership
            ON target_membership.organization_id = actor_membership.organization_id
         WHERE actor_membership.person_id = v_actor_person_id
           AND actor_membership.status = 'ACTIVE'
           AND actor_membership.is_organization_admin = true
           AND target_membership.person_id = p_target_person_id
           AND target_membership.status <> 'REMOVED'
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.actor_can_administer_person(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION medialab_core.guard_contact_method_insert()
RETURNS trigger AS $$
BEGIN
    IF NEW.creation_authority = 'SYSTEM_MIGRATION' THEN
        IF pg_trigger_depth() < 2 THEN
            RAISE EXCEPTION 'SYSTEM_MIGRATION contact creation is restricted to identity bootstrap triggers'
                USING ERRCODE = '42501';
        END IF;
    ELSE
        PERFORM medialab_core.require_identity_person(NEW.created_by_identity_id, NEW.person_id, true);
    END IF;

    IF NEW.lifecycle_state <> 'ACTIVE' OR NEW.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'New contact methods must begin ACTIVE'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_contact_method_update()
RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id OR
       NEW.person_id <> OLD.person_id OR
       NEW.contact_type <> OLD.contact_type OR
       NEW.submitted_value <> OLD.submitted_value OR
       NEW.normalized_value <> OLD.normalized_value OR
       NEW.created_by_identity_id IS DISTINCT FROM OLD.created_by_identity_id OR
       NEW.creation_authority <> OLD.creation_authority OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Contact method identity and historical values are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.lifecycle_state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Superseded or retired contact methods are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.lifecycle_state = 'SUPERSEDED' AND EXISTS (
        SELECT 1
          FROM medialab_core.contact_method_supersessions s
         WHERE s.previous_contact_method_id = OLD.id
           AND s.superseded_at = NEW.superseded_at
           AND s.transaction_id = txid_current()
    ) THEN
        RETURN NEW;
    END IF;

    IF NEW.lifecycle_state = 'RETIRED' AND EXISTS (
        SELECT 1
          FROM medialab_core.contact_method_retirements r
         WHERE r.contact_method_id = OLD.id
           AND r.retired_at = NEW.superseded_at
           AND r.transaction_id = txid_current()
    ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Contact lifecycle changes require validated evidence in the same transaction'
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.reject_contact_history_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are append-only: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_contact_verification_insert()
RETURNS trigger AS $$
DECLARE
    v_person_id uuid;
    v_lifecycle_state text;
BEGIN
    SELECT person_id, lifecycle_state
      INTO v_person_id, v_lifecycle_state
      FROM medialab_core.contact_methods
     WHERE id = NEW.contact_method_id;

    IF v_person_id IS NULL OR v_lifecycle_state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Verification requires an active contact method'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.verification_channel = 'MIGRATED_IDENTITY_ASSERTION' THEN
        IF pg_trigger_depth() < 2 THEN
            RAISE EXCEPTION 'Migrated identity verification is restricted to identity bootstrap triggers'
                USING ERRCODE = '42501';
        END IF;
        PERFORM medialab_core.require_identity_person(NEW.recorded_by_identity_id, v_person_id, false);
    ELSE
        PERFORM medialab_core.require_identity_person(NEW.recorded_by_identity_id, v_person_id, true);
    END IF;

    IF NEW.verified_at > clock_timestamp() THEN
        RAISE EXCEPTION 'Verification timestamp cannot be in the future'
            USING ERRCODE = '22007';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_verification_invalidation_insert()
RETURNS trigger AS $$
DECLARE
    v_person_id uuid;
BEGIN
    SELECT c.person_id
      INTO v_person_id
      FROM medialab_core.contact_verification_evidence v
      JOIN medialab_core.contact_methods c ON c.id = v.contact_method_id
     WHERE v.id = NEW.verification_evidence_id;

    IF v_person_id IS NULL THEN
        RAISE EXCEPTION 'Verification evidence does not exist'
            USING ERRCODE = '23503';
    END IF;

    PERFORM medialab_core.require_identity_person(NEW.recorded_by_identity_id, v_person_id, true);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_contact_supersession_insert()
RETURNS trigger AS $$
DECLARE
    v_previous medialab_core.contact_methods%ROWTYPE;
    v_replacement medialab_core.contact_methods%ROWTYPE;
BEGIN
    SELECT * INTO v_previous
      FROM medialab_core.contact_methods
     WHERE id = NEW.previous_contact_method_id
     FOR UPDATE;

    SELECT * INTO v_replacement
      FROM medialab_core.contact_methods
     WHERE id = NEW.replacement_contact_method_id
     FOR KEY SHARE;

    IF v_previous.id IS NULL OR v_replacement.id IS NULL THEN
        RAISE EXCEPTION 'Supersession contacts must both exist'
            USING ERRCODE = '23503';
    END IF;

    PERFORM medialab_core.require_identity_person(NEW.recorded_by_identity_id, v_previous.person_id, true);

    IF v_previous.person_id <> v_replacement.person_id OR
       v_previous.contact_type <> v_replacement.contact_type OR
       v_previous.lifecycle_state <> 'ACTIVE' OR
       v_replacement.lifecycle_state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Supersession requires active same-Person contacts of the same type'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.transaction_id <> txid_current() THEN
        RAISE EXCEPTION 'Supersession transaction attribution mismatch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.apply_contact_supersession()
RETURNS trigger AS $$
BEGIN
    UPDATE medialab_core.contact_methods
       SET lifecycle_state = 'SUPERSEDED',
           superseded_at = NEW.superseded_at
     WHERE id = NEW.previous_contact_method_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_contact_retirement_insert()
RETURNS trigger AS $$
DECLARE
    v_contact medialab_core.contact_methods%ROWTYPE;
BEGIN
    SELECT * INTO v_contact
      FROM medialab_core.contact_methods
     WHERE id = NEW.contact_method_id
     FOR UPDATE;

    IF v_contact.id IS NULL OR v_contact.lifecycle_state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Retirement requires an active contact method'
            USING ERRCODE = '23514';
    END IF;

    IF v_contact.contact_type = 'EMAIL' AND EXISTS (
        SELECT 1
          FROM medialab_core.people p
         WHERE p.id = v_contact.person_id
           AND p.email = v_contact.normalized_value
    ) THEN
        RAISE EXCEPTION 'The current primary email cannot be retired; replace it first'
            USING ERRCODE = '23514';
    END IF;

    PERFORM medialab_core.require_identity_person(NEW.recorded_by_identity_id, v_contact.person_id, true);

    IF NEW.transaction_id <> txid_current() THEN
        RAISE EXCEPTION 'Retirement transaction attribution mismatch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.apply_contact_retirement()
RETURNS trigger AS $$
BEGIN
    UPDATE medialab_core.contact_methods
       SET lifecycle_state = 'RETIRED',
           superseded_at = NEW.retired_at
     WHERE id = NEW.contact_method_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_primary_email_replacement_insert()
RETURNS trigger AS $$
DECLARE
    v_person_email text;
    v_previous medialab_core.contact_methods%ROWTYPE;
    v_replacement medialab_core.contact_methods%ROWTYPE;
BEGIN
    SELECT email INTO v_person_email
      FROM medialab_core.people
     WHERE id = NEW.person_id
     FOR UPDATE;

    SELECT * INTO v_previous
      FROM medialab_core.contact_methods
     WHERE id = NEW.previous_contact_method_id
     FOR UPDATE;

    SELECT * INTO v_replacement
      FROM medialab_core.contact_methods
     WHERE id = NEW.replacement_contact_method_id
     FOR KEY SHARE;

    PERFORM medialab_core.require_identity_person(NEW.recorded_by_identity_id, NEW.person_id, true);

    IF v_person_email IS NULL OR
       v_previous.id IS NULL OR
       v_replacement.id IS NULL OR
       v_previous.person_id <> NEW.person_id OR
       v_replacement.person_id <> NEW.person_id OR
       v_previous.contact_type <> 'EMAIL' OR
       v_replacement.contact_type <> 'EMAIL' OR
       v_previous.lifecycle_state <> 'ACTIVE' OR
       v_replacement.lifecycle_state <> 'ACTIVE' OR
       v_previous.normalized_value <> v_person_email THEN
        RAISE EXCEPTION 'Primary email replacement requires active same-Person email contacts'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM medialab_core.contact_verification_evidence v
         WHERE v.contact_method_id = v_replacement.id
           AND NOT EXISTS (
               SELECT 1
                 FROM medialab_core.contact_verification_invalidations i
                WHERE i.verification_evidence_id = v.id
           )
    ) THEN
        RAISE EXCEPTION 'Replacement email contact lacks valid verification evidence'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.transaction_id <> txid_current() THEN
        RAISE EXCEPTION 'Primary email replacement transaction attribution mismatch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_people_primary_email_update()
RETURNS trigger AS $$
BEGIN
    IF NEW.email IS NOT DISTINCT FROM OLD.email THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM medialab_core.primary_email_replacements r
          JOIN medialab_core.contact_methods c ON c.id = r.replacement_contact_method_id
         WHERE r.person_id = OLD.id
           AND r.transaction_id = txid_current()
           AND c.normalized_value = NEW.email
           AND r.replaced_at = NEW.updated_at
    ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Direct people.email updates are rejected; use replace_primary_email'
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.apply_primary_email_replacement()
RETURNS trigger AS $$
BEGIN
    INSERT INTO medialab_core.contact_method_supersessions (
        id,
        previous_contact_method_id,
        replacement_contact_method_id,
        recorded_by_identity_id,
        reason,
        superseded_at,
        transaction_id
    ) VALUES (
        NEW.id,
        NEW.previous_contact_method_id,
        NEW.replacement_contact_method_id,
        NEW.recorded_by_identity_id,
        NEW.reason,
        NEW.replaced_at,
        NEW.transaction_id
    );

    UPDATE medialab_core.people p
       SET email = c.normalized_value,
           updated_at = NEW.replaced_at
      FROM medialab_core.contact_methods c
     WHERE p.id = NEW.person_id
       AND c.id = NEW.replacement_contact_method_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_account_state_insert()
RETURNS trigger AS $$
BEGIN
    IF pg_trigger_depth() < 2 OR NEW.current_state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Account state creation is restricted to identity bootstrap'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM medialab_core.identities i
         WHERE i.id = NEW.identity_id AND i.person_id = NEW.person_id
    ) THEN
        RAISE EXCEPTION 'Account state Person and Identity do not match'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_account_state_update()
RETURNS trigger AS $$
BEGIN
    IF NEW.person_id <> OLD.person_id OR
       NEW.identity_id <> OLD.identity_id OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Account state identity is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM medialab_core.account_lifecycle_transitions t
         WHERE t.person_id = OLD.person_id
           AND t.identity_id = OLD.identity_id
           AND t.previous_state = OLD.current_state
           AND t.new_state = NEW.current_state
           AND t.transitioned_at = NEW.updated_at
           AND t.transaction_id = txid_current()
    ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Account state changes require validated transition evidence'
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_account_lifecycle_transition_insert()
RETURNS trigger AS $$
DECLARE
    v_current_state text;
    v_actor_person_id uuid;
    v_self_allowed boolean;
    v_admin_allowed boolean;
BEGIN
    SELECT s.current_state
      INTO v_current_state
      FROM medialab_core.person_account_states s
     WHERE s.person_id = NEW.person_id
       AND s.identity_id = NEW.identity_id
     FOR UPDATE;

    IF v_current_state IS NULL OR v_current_state <> NEW.previous_state THEN
        RAISE EXCEPTION 'Lifecycle transition previous state does not match current state'
            USING ERRCODE = '23514';
    END IF;

    IF NOT (
        (NEW.previous_state = 'ACTIVE' AND NEW.new_state = 'SUSPENDED') OR
        (NEW.previous_state = 'SUSPENDED' AND NEW.new_state = 'ACTIVE') OR
        (NEW.previous_state = 'ACTIVE' AND NEW.new_state = 'DEACTIVATED') OR
        (NEW.previous_state = 'SUSPENDED' AND NEW.new_state = 'DEACTIVATED') OR
        (NEW.previous_state = 'DEACTIVATED' AND NEW.new_state = 'RECOVERED') OR
        (NEW.previous_state = 'RECOVERED' AND NEW.new_state = 'ACTIVE')
    ) THEN
        RAISE EXCEPTION 'Invalid account lifecycle transition: % -> %', NEW.previous_state, NEW.new_state
            USING ERRCODE = '23514';
    END IF;

    SELECT person_id INTO v_actor_person_id
      FROM medialab_core.identities
     WHERE id = NEW.recorded_by_identity_id
       AND status = 'ACTIVE';

    IF v_actor_person_id IS NULL THEN
        RAISE EXCEPTION 'Lifecycle actor identity is missing or inactive'
            USING ERRCODE = '42501';
    END IF;

    v_self_allowed := v_actor_person_id = NEW.person_id AND (
        (NEW.previous_state = 'ACTIVE' AND NEW.new_state = 'DEACTIVATED') OR
        (NEW.previous_state = 'DEACTIVATED' AND NEW.new_state = 'RECOVERED') OR
        (NEW.previous_state = 'RECOVERED' AND NEW.new_state = 'ACTIVE')
    );
    v_admin_allowed := medialab_core.actor_can_administer_person(NEW.recorded_by_identity_id, NEW.person_id);

    IF NOT v_self_allowed AND NOT v_admin_allowed THEN
        RAISE EXCEPTION 'Actor is not authorized for this lifecycle transition'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.transaction_id <> txid_current() THEN
        RAISE EXCEPTION 'Lifecycle transition transaction attribution mismatch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.apply_account_lifecycle_transition()
RETURNS trigger AS $$
BEGIN
    UPDATE medialab_core.person_account_states
       SET current_state = NEW.new_state,
           updated_at = NEW.transitioned_at
     WHERE person_id = NEW.person_id
       AND identity_id = NEW.identity_id;

    IF NEW.new_state IN ('SUSPENDED', 'DEACTIVATED') THEN
        UPDATE medialab_core.development_sessions
           SET revoked_at = NEW.transitioned_at
         WHERE identity_id = NEW.identity_id
           AND revoked_at IS NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.bootstrap_person_contact()
RETURNS trigger AS $$
DECLARE
    v_contact_id uuid;
BEGIN
    v_contact_id := (
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 1, 8) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 9, 4) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 13, 4) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 17, 4) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 21, 12)
    )::uuid;

    INSERT INTO medialab_core.contact_methods (
        id, person_id, contact_type, submitted_value, normalized_value,
        lifecycle_state, created_by_identity_id, creation_authority, created_at
    ) VALUES (
        v_contact_id, NEW.id, 'EMAIL', NEW.email, NEW.email,
        'ACTIVE', NULL, 'SYSTEM_MIGRATION', NEW.created_at
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.bootstrap_identity_account()
RETURNS trigger AS $$
DECLARE
    v_contact_id uuid;
    v_verification_id uuid;
BEGIN
    INSERT INTO medialab_core.person_account_states (
        person_id, identity_id, current_state, created_at, updated_at
    ) VALUES (
        NEW.person_id, NEW.id, 'ACTIVE', NEW.created_at, NEW.created_at
    );

    SELECT id INTO v_contact_id
      FROM medialab_core.contact_methods
     WHERE person_id = NEW.person_id
       AND contact_type = 'EMAIL'
       AND lifecycle_state = 'ACTIVE';

    v_verification_id := (
        substr(md5('verification:' || NEW.id::text || ':' || v_contact_id::text), 1, 8) || '-' ||
        substr(md5('verification:' || NEW.id::text || ':' || v_contact_id::text), 9, 4) || '-' ||
        substr(md5('verification:' || NEW.id::text || ':' || v_contact_id::text), 13, 4) || '-' ||
        substr(md5('verification:' || NEW.id::text || ':' || v_contact_id::text), 17, 4) || '-' ||
        substr(md5('verification:' || NEW.id::text || ':' || v_contact_id::text), 21, 12)
    )::uuid;

    INSERT INTO medialab_core.contact_verification_evidence (
        id, contact_method_id, verified_at, verification_channel,
        recorded_by_identity_id, external_evidence_reference, created_at
    ) VALUES (
        v_verification_id, v_contact_id, NEW.email_verified_at,
        'MIGRATED_IDENTITY_ASSERTION', NEW.id, NULL,
        greatest(NEW.created_at, NEW.email_verified_at)
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_contact_method(
    p_contact_method_id uuid,
    p_session_token text,
    p_person_id uuid,
    p_contact_type text,
    p_submitted_value text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    IF v_actor_person_id <> p_person_id THEN
        RAISE EXCEPTION 'Authenticated session does not belong to the target Person'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO medialab_core.contact_methods (
        id, person_id, contact_type, submitted_value, normalized_value,
        lifecycle_state, created_by_identity_id, creation_authority
    ) VALUES (
        p_contact_method_id, p_person_id, p_contact_type, p_submitted_value,
        medialab_core.normalize_contact_value(p_contact_type, p_submitted_value),
        'ACTIVE', v_actor_identity_id, 'IDENTITY'
    );
    RETURN p_contact_method_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_contact_verification(
    p_verification_id uuid,
    p_session_token text,
    p_contact_method_id uuid,
    p_verified_at timestamptz,
    p_verification_channel text,
    p_external_evidence_reference text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    INSERT INTO medialab_core.contact_verification_evidence (
        id, contact_method_id, verified_at, verification_channel,
        recorded_by_identity_id, external_evidence_reference
    ) VALUES (
        p_verification_id, p_contact_method_id, p_verified_at,
        p_verification_channel, v_actor_identity_id, p_external_evidence_reference
    );
    RETURN p_verification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.invalidate_contact_verification(
    p_invalidation_id uuid,
    p_session_token text,
    p_verification_evidence_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    INSERT INTO medialab_core.contact_verification_invalidations (
        id, verification_evidence_id, recorded_by_identity_id, reason
    ) VALUES (
        p_invalidation_id, p_verification_evidence_id, v_actor_identity_id, p_reason
    );
    RETURN p_invalidation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.correct_contact_method(
    p_supersession_id uuid,
    p_replacement_contact_method_id uuid,
    p_session_token text,
    p_previous_contact_method_id uuid,
    p_submitted_value text,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_person_id uuid;
    v_contact_type text;
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    SELECT person_id, contact_type
      INTO v_person_id, v_contact_type
      FROM medialab_core.contact_methods
     WHERE id = p_previous_contact_method_id;

    IF v_person_id IS NULL THEN
        RAISE EXCEPTION 'Previous contact method does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF v_actor_person_id <> v_person_id THEN
        RAISE EXCEPTION 'Authenticated session does not belong to the target Person'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO medialab_core.contact_methods (
        id, person_id, contact_type, submitted_value, normalized_value,
        lifecycle_state, created_by_identity_id, creation_authority
    ) VALUES (
        p_replacement_contact_method_id, v_person_id, v_contact_type, p_submitted_value,
        medialab_core.normalize_contact_value(v_contact_type, p_submitted_value),
        'ACTIVE', v_actor_identity_id, 'IDENTITY'
    );

    INSERT INTO medialab_core.contact_method_supersessions (
        id, previous_contact_method_id, replacement_contact_method_id,
        recorded_by_identity_id, reason
    ) VALUES (
        p_supersession_id, p_previous_contact_method_id, p_replacement_contact_method_id,
        v_actor_identity_id, p_reason
    );

    RETURN p_replacement_contact_method_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.retire_contact_method(
    p_retirement_id uuid,
    p_session_token text,
    p_contact_method_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    INSERT INTO medialab_core.contact_method_retirements (
        id, contact_method_id, recorded_by_identity_id, reason
    ) VALUES (
        p_retirement_id, p_contact_method_id, v_actor_identity_id, p_reason
    );
    RETURN p_retirement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.replace_primary_email(
    p_replacement_id uuid,
    p_session_token text,
    p_person_id uuid,
    p_replacement_contact_method_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_previous_contact_method_id uuid;
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    IF v_actor_person_id <> p_person_id THEN
        RAISE EXCEPTION 'Authenticated session does not belong to the target Person'
            USING ERRCODE = '42501';
    END IF;

    SELECT c.id
      INTO v_previous_contact_method_id
      FROM medialab_core.people p
      JOIN medialab_core.contact_methods c
        ON c.person_id = p.id
       AND c.contact_type = 'EMAIL'
       AND c.lifecycle_state = 'ACTIVE'
       AND c.normalized_value = p.email
     WHERE p.id = p_person_id;

    IF v_previous_contact_method_id IS NULL THEN
        RAISE EXCEPTION 'Current primary email contact is missing'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO medialab_core.primary_email_replacements (
        id, person_id, previous_contact_method_id, replacement_contact_method_id,
        recorded_by_identity_id, reason
    ) VALUES (
        p_replacement_id, p_person_id, v_previous_contact_method_id,
        p_replacement_contact_method_id, v_actor_identity_id, p_reason
    );

    RETURN p_replacement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.transition_account_lifecycle(
    p_transition_id uuid,
    p_bearer_token text,
    p_person_id uuid,
    p_identity_id uuid,
    p_new_state text,
    p_reason text,
    p_start_fresh boolean DEFAULT false
)
RETURNS uuid AS $$
DECLARE
    v_previous_state text;
    v_recovery_mode text;
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_recovery_session_id uuid;
    v_consumed_at timestamptz;
BEGIN
    SELECT current_state INTO v_previous_state
      FROM medialab_core.person_account_states
     WHERE person_id = p_person_id
       AND identity_id = p_identity_id;

    IF v_previous_state IS NULL THEN
        RAISE EXCEPTION 'Account state does not exist for Person and Identity'
            USING ERRCODE = '23503';
    END IF;

    IF v_previous_state = 'DEACTIVATED' AND p_new_state = 'RECOVERED' THEN
        SELECT recovery_session_id, actor_identity_id, actor_person_id
          INTO v_recovery_session_id, v_actor_identity_id, v_actor_person_id
          FROM medialab_core.resolve_account_recovery_session(p_bearer_token, p_identity_id);

        IF v_actor_identity_id <> p_identity_id OR v_actor_person_id <> p_person_id THEN
            RAISE EXCEPTION 'Recovery session does not belong to the target Person and Identity'
                USING ERRCODE = '42501';
        END IF;

        v_recovery_mode := CASE WHEN p_start_fresh THEN 'START_FRESH' ELSE 'PRESERVE' END;
    ELSE
        SELECT actor_identity_id, actor_person_id
          INTO v_actor_identity_id, v_actor_person_id
          FROM medialab_core.resolve_ordinary_session(p_bearer_token);

        IF p_start_fresh THEN
            RAISE EXCEPTION 'Start-fresh intent is only valid for DEACTIVATED -> RECOVERED'
                USING ERRCODE = '23514';
        END IF;
        v_recovery_mode := NULL;
    END IF;

    INSERT INTO medialab_core.account_lifecycle_transitions (
        id, person_id, identity_id, previous_state, new_state,
        recorded_by_identity_id, reason, recovery_mode
    ) VALUES (
        p_transition_id, p_person_id, p_identity_id, v_previous_state, p_new_state,
        v_actor_identity_id, p_reason, v_recovery_mode
    );

    IF v_recovery_session_id IS NOT NULL THEN
        v_consumed_at := clock_timestamp();
        UPDATE medialab_core.account_recovery_sessions
           SET consumed_at = v_consumed_at
         WHERE id = v_recovery_session_id
           AND consumed_at IS NULL;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Recovery session was consumed concurrently'
                USING ERRCODE = '40001';
        END IF;
    END IF;

    RETURN p_transition_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

-- Backfill released people, identities, contact verification, and current account state.
INSERT INTO medialab_core.contact_methods (
    id, person_id, contact_type, submitted_value, normalized_value,
    lifecycle_state, created_by_identity_id, creation_authority, created_at
)
SELECT
    (
        substr(md5('contact:' || p.id::text || ':' || p.email), 1, 8) || '-' ||
        substr(md5('contact:' || p.id::text || ':' || p.email), 9, 4) || '-' ||
        substr(md5('contact:' || p.id::text || ':' || p.email), 13, 4) || '-' ||
        substr(md5('contact:' || p.id::text || ':' || p.email), 17, 4) || '-' ||
        substr(md5('contact:' || p.id::text || ':' || p.email), 21, 12)
    )::uuid,
    p.id,
    'EMAIL',
    p.email,
    p.email,
    'ACTIVE',
    NULL,
    'SYSTEM_MIGRATION',
    p.created_at
FROM medialab_core.people p;

INSERT INTO medialab_core.person_account_states (
    person_id, identity_id, current_state, created_at, updated_at
)
SELECT person_id, id, 'ACTIVE', created_at, created_at
FROM medialab_core.identities;

INSERT INTO medialab_core.contact_verification_evidence (
    id, contact_method_id, verified_at, verification_channel,
    recorded_by_identity_id, external_evidence_reference, created_at
)
SELECT
    (
        substr(md5('verification:' || i.id::text || ':' || c.id::text), 1, 8) || '-' ||
        substr(md5('verification:' || i.id::text || ':' || c.id::text), 9, 4) || '-' ||
        substr(md5('verification:' || i.id::text || ':' || c.id::text), 13, 4) || '-' ||
        substr(md5('verification:' || i.id::text || ':' || c.id::text), 17, 4) || '-' ||
        substr(md5('verification:' || i.id::text || ':' || c.id::text), 21, 12)
    )::uuid,
    c.id,
    i.email_verified_at,
    'MIGRATED_IDENTITY_ASSERTION',
    i.id,
    NULL,
    greatest(i.created_at, i.email_verified_at)
FROM medialab_core.identities i
JOIN medialab_core.contact_methods c
  ON c.person_id = i.person_id
 AND c.contact_type = 'EMAIL'
 AND c.lifecycle_state = 'ACTIVE';

CREATE TRIGGER contact_methods_insert_guard
    BEFORE INSERT ON medialab_core.contact_methods
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_contact_method_insert();

CREATE TRIGGER contact_methods_update_guard
    BEFORE UPDATE ON medialab_core.contact_methods
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_contact_method_update();

CREATE TRIGGER contact_methods_delete_guard
    BEFORE DELETE ON medialab_core.contact_methods
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER contact_verification_evidence_insert_guard
    BEFORE INSERT ON medialab_core.contact_verification_evidence
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_contact_verification_insert();

CREATE TRIGGER contact_verification_evidence_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.contact_verification_evidence
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER contact_verification_invalidations_insert_guard
    BEFORE INSERT ON medialab_core.contact_verification_invalidations
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_verification_invalidation_insert();

CREATE TRIGGER contact_verification_invalidations_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.contact_verification_invalidations
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER contact_method_supersessions_insert_guard
    BEFORE INSERT ON medialab_core.contact_method_supersessions
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_contact_supersession_insert();

CREATE TRIGGER contact_method_supersessions_apply
    AFTER INSERT ON medialab_core.contact_method_supersessions
    FOR EACH ROW EXECUTE FUNCTION medialab_core.apply_contact_supersession();

CREATE TRIGGER contact_method_supersessions_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.contact_method_supersessions
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER contact_method_retirements_insert_guard
    BEFORE INSERT ON medialab_core.contact_method_retirements
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_contact_retirement_insert();

CREATE TRIGGER contact_method_retirements_apply
    AFTER INSERT ON medialab_core.contact_method_retirements
    FOR EACH ROW EXECUTE FUNCTION medialab_core.apply_contact_retirement();

CREATE TRIGGER contact_method_retirements_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.contact_method_retirements
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER primary_email_replacements_insert_guard
    BEFORE INSERT ON medialab_core.primary_email_replacements
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_primary_email_replacement_insert();

CREATE TRIGGER primary_email_replacements_apply
    AFTER INSERT ON medialab_core.primary_email_replacements
    FOR EACH ROW EXECUTE FUNCTION medialab_core.apply_primary_email_replacement();

CREATE TRIGGER primary_email_replacements_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.primary_email_replacements
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER people_primary_email_update_guard
    BEFORE UPDATE OF email ON medialab_core.people
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_people_primary_email_update();

CREATE TRIGGER person_account_states_insert_guard
    BEFORE INSERT ON medialab_core.person_account_states
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_account_state_insert();

CREATE TRIGGER person_account_states_update_guard
    BEFORE UPDATE ON medialab_core.person_account_states
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_account_state_update();

CREATE TRIGGER person_account_states_delete_guard
    BEFORE DELETE ON medialab_core.person_account_states
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER account_lifecycle_transitions_insert_guard
    BEFORE INSERT ON medialab_core.account_lifecycle_transitions
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_account_lifecycle_transition_insert();

CREATE TRIGGER account_lifecycle_transitions_apply
    AFTER INSERT ON medialab_core.account_lifecycle_transitions
    FOR EACH ROW EXECUTE FUNCTION medialab_core.apply_account_lifecycle_transition();

CREATE TRIGGER account_lifecycle_transitions_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.account_lifecycle_transitions
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_contact_history_mutation();

CREATE TRIGGER people_contact_bootstrap
    AFTER INSERT ON medialab_core.people
    FOR EACH ROW EXECUTE FUNCTION medialab_core.bootstrap_person_contact();

CREATE TRIGGER identities_account_bootstrap
    AFTER INSERT ON medialab_core.identities
    FOR EACH ROW EXECUTE FUNCTION medialab_core.bootstrap_identity_account();

REVOKE ALL ON FUNCTION medialab_core.guard_contact_method_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_contact_method_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_contact_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_contact_verification_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_verification_invalidation_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_contact_supersession_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.apply_contact_supersession() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_contact_retirement_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.apply_contact_retirement() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_primary_email_replacement_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_people_primary_email_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.apply_primary_email_replacement() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_account_state_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_account_state_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_account_lifecycle_transition_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.apply_account_lifecycle_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.bootstrap_person_contact() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.bootstrap_identity_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_contact_method(uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_contact_verification(uuid, text, uuid, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.invalidate_contact_verification(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.correct_contact_method(uuid, uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.retire_contact_method(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.replace_primary_email(uuid, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.transition_account_lifecycle(uuid, text, uuid, uuid, text, text, boolean) FROM PUBLIC;
