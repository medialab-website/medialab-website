-- P02-M23-A: provider-neutral client-account and organization-operator contact intake.
-- Nonproduction foundation only. This migration creates no customer authentication,
-- payment authority, provider connection, notification, or deployment capability.

ALTER TABLE medialab_core.contact_methods
    DROP CONSTRAINT contact_methods_creation_authority_check;

ALTER TABLE medialab_core.contact_methods
    ADD CONSTRAINT contact_methods_creation_authority_check CHECK (
        (creation_authority = 'IDENTITY' AND created_by_identity_id IS NOT NULL) OR
        (creation_authority = 'SYSTEM_MIGRATION' AND created_by_identity_id IS NULL) OR
        (creation_authority = 'ORGANIZATION_OPERATOR' AND created_by_identity_id IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION medialab_core.guard_contact_method_insert()
RETURNS trigger AS $$
BEGIN
    IF NEW.creation_authority = 'SYSTEM_MIGRATION' THEN
        IF pg_trigger_depth() < 2 THEN
            RAISE EXCEPTION 'SYSTEM_MIGRATION contact creation is restricted to identity bootstrap triggers'
                USING ERRCODE = '42501';
        END IF;
    ELSIF NEW.creation_authority = 'IDENTITY' THEN
        PERFORM medialab_core.require_identity_person(NEW.created_by_identity_id, NEW.person_id, true);
    ELSIF NEW.creation_authority <> 'ORGANIZATION_OPERATOR' THEN
        RAISE EXCEPTION 'Contact creation authority is invalid' USING ERRCODE = '42501';
    END IF;

    IF NEW.lifecycle_state <> 'ACTIVE' OR NEW.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'New contact methods must begin ACTIVE' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_contact_supersession_insert()
RETURNS trigger AS $$
DECLARE
    v_previous medialab_core.contact_methods%ROWTYPE;
    v_replacement medialab_core.contact_methods%ROWTYPE;
    v_actor_person_id uuid;
    v_operator_organization_text text;
    v_operator_organization_id uuid;
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
        RAISE EXCEPTION 'Supersession contacts must both exist' USING ERRCODE = '23503';
    END IF;

    SELECT person_id INTO v_actor_person_id
      FROM medialab_core.identities
     WHERE id = NEW.recorded_by_identity_id AND status = 'ACTIVE';

    IF v_actor_person_id = v_previous.person_id THEN
        PERFORM medialab_core.require_identity_person(NEW.recorded_by_identity_id, v_previous.person_id, true);
    ELSE
        v_operator_organization_text := current_setting('medialab.client_contact_organization_id', true);
        IF v_operator_organization_text IS NULL OR
           v_operator_organization_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'Organization-operator contact supersession context is unavailable' USING ERRCODE = '42501';
        END IF;
        v_operator_organization_id := v_operator_organization_text::uuid;
        IF v_previous.creation_authority <> 'ORGANIZATION_OPERATOR' OR
           v_replacement.creation_authority <> 'ORGANIZATION_OPERATOR' OR
           NOT medialab_core.actor_has_permission(
               NEW.recorded_by_identity_id, v_operator_organization_id, 'client_account.manage'
           ) OR
           NOT EXISTS (
               SELECT 1 FROM medialab_core.memberships
                WHERE organization_id = v_operator_organization_id
                  AND person_id = v_previous.person_id
                  AND status = 'ACTIVE'
           ) THEN
            RAISE EXCEPTION 'Organization-operator contact supersession is unavailable' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_previous.person_id <> v_replacement.person_id OR
       v_previous.contact_type <> v_replacement.contact_type OR
       v_previous.lifecycle_state <> 'ACTIVE' OR
       v_replacement.lifecycle_state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Supersession requires active same-Person contacts of the same type' USING ERRCODE = '23514';
    END IF;

    IF NEW.transaction_id <> txid_current() THEN
        RAISE EXCEPTION 'Supersession transaction attribution mismatch' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TABLE medialab_core.client_accounts (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    account_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_accounts_id_org_key UNIQUE (id, organization_id),
    CONSTRAINT client_accounts_type_check CHECK (account_type IN ('CUSTOMER_GROUP', 'CUSTOMER_TEAM'))
);

CREATE TABLE medialab_core.client_account_external_references (
    id uuid PRIMARY KEY,
    client_account_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    source_system text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    provenance text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (client_account_id, organization_id)
        REFERENCES medialab_core.client_accounts(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT client_account_external_refs_source_key UNIQUE (
        organization_id, source_system, external_record_type, external_identifier
    ),
    CONSTRAINT client_account_external_refs_source_check CHECK (source_system ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT client_account_external_refs_type_check CHECK (external_record_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT client_account_external_refs_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND external_identifier <> '' AND length(external_identifier) <= 255
    ),
    CONSTRAINT client_account_external_refs_provenance_check CHECK (
        provenance = btrim(provenance) AND provenance <> '' AND length(provenance) <= 500
    )
);

CREATE TABLE medialab_core.client_account_revisions (
    id uuid PRIMARY KEY,
    client_account_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    parent_client_account_id uuid NULL,
    display_name text NOT NULL,
    brokerage_name text NULL,
    source_evidence_fingerprint text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (client_account_id, organization_id)
        REFERENCES medialab_core.client_accounts(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (parent_client_account_id, organization_id)
        REFERENCES medialab_core.client_accounts(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT client_account_revisions_identity_key UNIQUE (client_account_id, source_evidence_fingerprint),
    CONSTRAINT client_account_revisions_parent_check CHECK (parent_client_account_id IS NULL OR parent_client_account_id <> client_account_id),
    CONSTRAINT client_account_revisions_name_check CHECK (
        display_name = regexp_replace(btrim(display_name), '\s+', ' ', 'g') AND display_name <> '' AND length(display_name) <= 200
    ),
    CONSTRAINT client_account_revisions_brokerage_check CHECK (
        brokerage_name IS NULL OR (
            brokerage_name = regexp_replace(btrim(brokerage_name), '\s+', ' ', 'g') AND
            brokerage_name <> '' AND length(brokerage_name) <= 200
        )
    ),
    CONSTRAINT client_account_revisions_fingerprint_check CHECK (source_evidence_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX client_account_revisions_current_idx
    ON medialab_core.client_account_revisions (client_account_id, recorded_at DESC, id DESC);

CREATE TABLE medialab_core.client_account_people (
    id uuid PRIMARY KEY,
    client_account_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    relationship_role text NOT NULL,
    source_evidence_fingerprint text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (client_account_id, organization_id)
        REFERENCES medialab_core.client_accounts(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT client_account_people_relationship_key UNIQUE (client_account_id, person_id, relationship_role),
    CONSTRAINT client_account_people_role_check CHECK (relationship_role IN ('ACCOUNT_MEMBER', 'PRIMARY_CONTACT')),
    CONSTRAINT client_account_people_fingerprint_check CHECK (source_evidence_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.order_client_accounts (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    client_account_id uuid NOT NULL,
    relationship_role text NOT NULL,
    source_evidence_fingerprint text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (order_id, organization_id)
        REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (client_account_id, organization_id)
        REFERENCES medialab_core.client_accounts(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT order_client_accounts_relationship_key UNIQUE (order_id, relationship_role),
    CONSTRAINT order_client_accounts_role_check CHECK (relationship_role IN ('CUSTOMER_GROUP', 'CUSTOMER_TEAM')),
    CONSTRAINT order_client_accounts_fingerprint_check CHECK (source_evidence_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.client_contact_source_evidence (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    contact_method_id uuid NOT NULL REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    source_system text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    source_evidence_fingerprint text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_contact_source_evidence_observation_key UNIQUE (
        organization_id, source_system, external_record_type, external_identifier, source_evidence_fingerprint
    ),
    CONSTRAINT client_contact_source_evidence_source_check CHECK (source_system ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT client_contact_source_evidence_type_check CHECK (external_record_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT client_contact_source_evidence_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND external_identifier <> '' AND length(external_identifier) <= 255
    ),
    CONSTRAINT client_contact_source_evidence_fingerprint_check CHECK (source_evidence_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX client_contact_source_evidence_current_idx
    ON medialab_core.client_contact_source_evidence (
        organization_id, source_system, external_record_type, external_identifier, recorded_at DESC, id DESC
    );

CREATE TABLE medialab_core.client_intake_idempotency_records (
    id uuid PRIMARY KEY,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    command_name text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    response_payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_intake_idempotency_actor_key UNIQUE (actor_identity_id, command_name, idempotency_key),
    CONSTRAINT client_intake_idempotency_command_check CHECK (command_name ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT client_intake_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT client_intake_idempotency_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT client_intake_idempotency_response_check CHECK (jsonb_typeof(response_payload) = 'object')
);

CREATE OR REPLACE FUNCTION medialab_core.reject_client_foundation_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are append-only and immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER client_accounts_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.client_accounts
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_client_foundation_mutation();
CREATE TRIGGER client_account_external_refs_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.client_account_external_references
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_client_foundation_mutation();
CREATE TRIGGER client_account_revisions_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.client_account_revisions
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_client_foundation_mutation();
CREATE TRIGGER client_account_people_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.client_account_people
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_client_foundation_mutation();
CREATE TRIGGER order_client_accounts_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.order_client_accounts
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_client_foundation_mutation();
CREATE TRIGGER client_contact_source_evidence_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.client_contact_source_evidence
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_client_foundation_mutation();
CREATE TRIGGER client_intake_idempotency_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.client_intake_idempotency_records
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_client_foundation_mutation();

CREATE OR REPLACE FUNCTION medialab_core.require_client_account_permission(
    p_actor_identity_id uuid,
    p_organization_id uuid,
    p_permission_code text
)
RETURNS void AS $$
BEGIN
    IF p_permission_code NOT IN ('client_account.read', 'client_account.manage') OR
       NOT medialab_core.actor_has_permission(p_actor_identity_id, p_organization_id, p_permission_code) THEN
        RAISE EXCEPTION 'Client-account authority is unavailable' USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.client_intake_replay(
    p_actor_identity_id uuid,
    p_command_name text,
    p_idempotency_key text,
    p_request_sha256 text
)
RETURNS jsonb AS $$
DECLARE v_record medialab_core.client_intake_idempotency_records%ROWTYPE;
BEGIN
    IF p_command_name IS NULL OR p_command_name !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
       p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 OR
       p_request_sha256 IS NULL OR p_request_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Client intake idempotency evidence is invalid' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'CLIENT_INTAKE:' || p_actor_identity_id::text || ':' || p_command_name || ':' || p_idempotency_key, 0
    ));
    SELECT * INTO v_record
      FROM medialab_core.client_intake_idempotency_records
     WHERE actor_identity_id = p_actor_identity_id
       AND command_name = p_command_name
       AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_record.request_sha256 <> p_request_sha256 THEN
            RAISE EXCEPTION 'Client intake idempotency key was reused with different evidence' USING ERRCODE = '23505';
        END IF;
        RETURN v_record.response_payload || jsonb_build_object('replayed', true);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.reconcile_client_account_intake(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_source_system text,
    p_external_record_type text,
    p_external_identifier text,
    p_source_evidence_fingerprint text,
    p_account_type text,
    p_display_name text,
    p_brokerage_name text,
    p_parent_client_account_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_actor uuid; v_request_sha text; v_replay jsonb; v_account medialab_core.client_accounts%ROWTYPE;
    v_revision medialab_core.client_account_revisions%ROWTYPE; v_account_outcome text; v_revision_outcome text;
    v_display text; v_brokerage text; v_response jsonb; v_parent medialab_core.client_accounts%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_client_account_permission(v_actor, p_organization_id, 'client_account.manage');
    v_display := regexp_replace(btrim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
    v_brokerage := NULLIF(regexp_replace(btrim(coalesce(p_brokerage_name, '')), '\s+', ' ', 'g'), '');
    IF p_source_system IS NULL OR p_source_system !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
       p_external_record_type IS NULL OR p_external_record_type !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
       p_external_identifier IS NULL OR p_external_identifier <> btrim(p_external_identifier) OR
       p_external_identifier = '' OR length(p_external_identifier) > 255 OR
       p_source_evidence_fingerprint IS NULL OR p_source_evidence_fingerprint !~ '^[0-9a-f]{64}$' OR
       p_account_type IS NULL OR p_account_type NOT IN ('CUSTOMER_GROUP', 'CUSTOMER_TEAM') OR
       v_display = '' OR length(v_display) > 200 OR
       (v_brokerage IS NOT NULL AND length(v_brokerage) > 200) OR
       (p_account_type = 'CUSTOMER_GROUP' AND p_parent_client_account_id IS NOT NULL) OR
       (p_account_type = 'CUSTOMER_TEAM' AND p_parent_client_account_id IS NULL) THEN
        RAISE EXCEPTION 'Client-account source evidence is invalid' USING ERRCODE = '22023';
    END IF;
    IF p_parent_client_account_id IS NOT NULL THEN
        SELECT * INTO v_parent FROM medialab_core.client_accounts
         WHERE id = p_parent_client_account_id AND organization_id = p_organization_id;
        IF NOT FOUND OR v_parent.account_type <> 'CUSTOMER_GROUP' THEN
            RAISE EXCEPTION 'Client-account parent is missing or unavailable' USING ERRCODE = '42501';
        END IF;
    END IF;
    v_request_sha := encode(sha256(convert_to(jsonb_build_array(
        p_organization_id, p_source_system, p_external_record_type, p_external_identifier,
        p_source_evidence_fingerprint, p_account_type, v_display, v_brokerage, p_parent_client_account_id
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.client_intake_replay(v_actor, 'RECONCILE_CLIENT_ACCOUNT', p_idempotency_key, v_request_sha);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'CLIENT_ACCOUNT:' || p_organization_id::text || ':' || p_source_system || ':' ||
        p_external_record_type || ':' || p_external_identifier, 0
    ));
    SELECT a.* INTO v_account
      FROM medialab_core.client_account_external_references r
      JOIN medialab_core.client_accounts a ON a.id = r.client_account_id AND a.organization_id = r.organization_id
     WHERE r.organization_id = p_organization_id AND r.source_system = p_source_system
       AND r.external_record_type = p_external_record_type AND r.external_identifier = p_external_identifier;
    IF NOT FOUND THEN
        v_account.id := gen_random_uuid(); v_account.organization_id := p_organization_id; v_account.account_type := p_account_type;
        INSERT INTO medialab_core.client_accounts(id, organization_id, account_type)
        VALUES(v_account.id, v_account.organization_id, v_account.account_type);
        INSERT INTO medialab_core.client_account_external_references(
            id, client_account_id, organization_id, source_system, external_record_type,
            external_identifier, provenance, recorded_by_identity_id
        ) VALUES(
            gen_random_uuid(), v_account.id, p_organization_id, p_source_system, p_external_record_type,
            p_external_identifier, 'LOCAL_READ_ONLY_SOURCE_EVIDENCE:' || p_source_evidence_fingerprint, v_actor
        );
        v_account_outcome := 'CREATED';
    ELSE
        IF v_account.account_type <> p_account_type THEN
            RAISE EXCEPTION 'Client-account external identity conflicts with account type' USING ERRCODE = '23505';
        END IF;
        v_account_outcome := 'REUSED';
    END IF;
    SELECT * INTO v_revision FROM medialab_core.client_account_revisions
     WHERE client_account_id = v_account.id ORDER BY recorded_at DESC, id DESC LIMIT 1;
    IF NOT FOUND OR v_revision.display_name <> v_display OR
       v_revision.brokerage_name IS DISTINCT FROM v_brokerage OR
       v_revision.parent_client_account_id IS DISTINCT FROM p_parent_client_account_id THEN
        SELECT * INTO v_revision FROM medialab_core.client_account_revisions
         WHERE client_account_id = v_account.id
           AND source_evidence_fingerprint = p_source_evidence_fingerprint;
        IF FOUND THEN
            v_revision_outcome := 'REUSED';
        ELSE
            INSERT INTO medialab_core.client_account_revisions(
                id, client_account_id, organization_id, parent_client_account_id, display_name,
                brokerage_name, source_evidence_fingerprint, recorded_by_identity_id
            ) VALUES(
                gen_random_uuid(), v_account.id, p_organization_id, p_parent_client_account_id, v_display,
                v_brokerage, p_source_evidence_fingerprint, v_actor
            ) RETURNING * INTO v_revision;
            v_revision_outcome := 'CREATED';
        END IF;
    ELSE
        v_revision_outcome := 'REUSED';
    END IF;
    v_response := jsonb_build_object(
        'clientAccountId', v_account.id, 'revisionId', v_revision.id,
        'accountOutcome', v_account_outcome, 'revisionOutcome', v_revision_outcome, 'replayed', false
    );
    INSERT INTO medialab_core.client_intake_idempotency_records(
        id, actor_identity_id, command_name, idempotency_key, request_sha256, response_payload
    ) VALUES(gen_random_uuid(), v_actor, 'RECONCILE_CLIENT_ACCOUNT', p_idempotency_key, v_request_sha, v_response - 'replayed');
    RETURN v_response;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.reconcile_customer_contact_intake(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_person_id uuid,
    p_source_system text,
    p_external_record_type text,
    p_external_identifier text,
    p_source_evidence_fingerprint text,
    p_contact_type text,
    p_submitted_value text
)
RETURNS jsonb AS $$
DECLARE
    v_actor uuid; v_value text; v_request_sha text; v_replay jsonb; v_previous uuid; v_contact uuid;
    v_contact_outcome text; v_evidence uuid; v_response jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_client_account_permission(v_actor, p_organization_id, 'client_account.manage');
    IF NOT EXISTS (SELECT 1 FROM medialab_core.memberships
        WHERE organization_id = p_organization_id AND person_id = p_person_id AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Customer Person is missing or unavailable' USING ERRCODE = '42501';
    END IF;
    IF p_contact_type IS NULL OR p_contact_type <> 'PHONE' OR
       p_source_system IS NULL OR p_source_system !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
       p_external_record_type IS NULL OR p_external_record_type !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
       p_external_identifier IS NULL OR p_external_identifier <> btrim(p_external_identifier) OR
       p_external_identifier = '' OR length(p_external_identifier) > 255 OR
       p_source_evidence_fingerprint IS NULL OR p_source_evidence_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Customer contact source evidence is invalid' USING ERRCODE = '22023';
    END IF;
    v_value := medialab_core.normalize_contact_value(p_contact_type, p_submitted_value);
    IF v_value = '' OR length(v_value) > 64 THEN
        RAISE EXCEPTION 'Customer phone evidence is invalid' USING ERRCODE = '22023';
    END IF;
    v_request_sha := encode(sha256(convert_to(jsonb_build_array(
        p_organization_id, p_person_id, p_source_system, p_external_record_type,
        p_external_identifier, p_source_evidence_fingerprint, p_contact_type, v_value
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.client_intake_replay(v_actor, 'RECONCILE_CUSTOMER_CONTACT', p_idempotency_key, v_request_sha);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'CLIENT_CONTACT:' || p_organization_id::text || ':' || p_source_system || ':' ||
        p_external_record_type || ':' || p_external_identifier, 0
    ));
    SELECT e.contact_method_id INTO v_previous
      FROM medialab_core.client_contact_source_evidence e
     WHERE e.organization_id = p_organization_id AND e.person_id = p_person_id
       AND e.source_system = p_source_system AND e.external_record_type = p_external_record_type
       AND e.external_identifier = p_external_identifier
     ORDER BY e.recorded_at DESC, e.id DESC LIMIT 1;
    IF v_previous IS NOT NULL AND EXISTS (
        SELECT 1 FROM medialab_core.contact_methods
         WHERE id = v_previous AND person_id = p_person_id AND contact_type = p_contact_type
           AND normalized_value = v_value AND lifecycle_state = 'ACTIVE'
    ) THEN
        v_contact := v_previous; v_contact_outcome := 'REUSED';
    ELSE
        SELECT id INTO v_contact FROM medialab_core.contact_methods
         WHERE person_id = p_person_id AND contact_type = p_contact_type
           AND normalized_value = v_value AND lifecycle_state = 'ACTIVE'
         ORDER BY created_at, id LIMIT 1;
        IF v_contact IS NULL THEN
            v_contact := gen_random_uuid();
            INSERT INTO medialab_core.contact_methods(
                id, person_id, contact_type, submitted_value, normalized_value,
                lifecycle_state, created_by_identity_id, creation_authority
            ) VALUES(
                v_contact, p_person_id, p_contact_type, p_submitted_value, v_value,
                'ACTIVE', v_actor, 'ORGANIZATION_OPERATOR'
            );
            v_contact_outcome := 'CREATED';
        ELSE
            v_contact_outcome := 'REUSED';
        END IF;
        IF v_previous IS NOT NULL AND v_previous <> v_contact AND EXISTS (
            SELECT 1 FROM medialab_core.contact_methods WHERE id = v_previous AND lifecycle_state = 'ACTIVE'
        ) THEN
            PERFORM set_config('medialab.client_contact_organization_id', p_organization_id::text, true);
            INSERT INTO medialab_core.contact_method_supersessions(
                id, previous_contact_method_id, replacement_contact_method_id,
                recorded_by_identity_id, reason
            ) VALUES(
                gen_random_uuid(), v_previous, v_contact, v_actor,
                'Newer organization-authorized client source evidence replaced the prior imported contact.'
            );
        END IF;
    END IF;
    SELECT id INTO v_evidence FROM medialab_core.client_contact_source_evidence
     WHERE organization_id = p_organization_id AND source_system = p_source_system
       AND external_record_type = p_external_record_type AND external_identifier = p_external_identifier
       AND source_evidence_fingerprint = p_source_evidence_fingerprint;
    IF v_evidence IS NULL THEN
        INSERT INTO medialab_core.client_contact_source_evidence(
            id, organization_id, person_id, contact_method_id, source_system,
            external_record_type, external_identifier, source_evidence_fingerprint, recorded_by_identity_id
        ) VALUES(
            gen_random_uuid(), p_organization_id, p_person_id, v_contact, p_source_system,
            p_external_record_type, p_external_identifier, p_source_evidence_fingerprint, v_actor
        ) RETURNING id INTO v_evidence;
    END IF;
    v_response := jsonb_build_object(
        'contactMethodId', v_contact, 'sourceEvidenceId', v_evidence,
        'contactOutcome', v_contact_outcome, 'replayed', false
    );
    INSERT INTO medialab_core.client_intake_idempotency_records(
        id, actor_identity_id, command_name, idempotency_key, request_sha256, response_payload
    ) VALUES(gen_random_uuid(), v_actor, 'RECONCILE_CUSTOMER_CONTACT', p_idempotency_key, v_request_sha, v_response - 'replayed');
    RETURN v_response;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.link_client_account_person(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_client_account_id uuid,
    p_person_id uuid,
    p_relationship_role text,
    p_source_evidence_fingerprint text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_request_sha text; v_replay jsonb; v_id uuid; v_response jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_client_account_permission(v_actor, p_organization_id, 'client_account.manage');
    IF p_relationship_role IS NULL OR p_relationship_role NOT IN ('ACCOUNT_MEMBER', 'PRIMARY_CONTACT') OR
       p_source_evidence_fingerprint IS NULL OR p_source_evidence_fingerprint !~ '^[0-9a-f]{64}$' OR
       NOT EXISTS (SELECT 1 FROM medialab_core.client_accounts WHERE id=p_client_account_id AND organization_id=p_organization_id) OR
       NOT EXISTS (SELECT 1 FROM medialab_core.memberships WHERE organization_id=p_organization_id AND person_id=p_person_id AND status='ACTIVE') THEN
        RAISE EXCEPTION 'Client-account Person relationship is invalid or unavailable' USING ERRCODE = '42501';
    END IF;
    v_request_sha := encode(sha256(convert_to(jsonb_build_array(
        p_organization_id,p_client_account_id,p_person_id,p_relationship_role,p_source_evidence_fingerprint
    )::text,'UTF8')),'hex');
    v_replay := medialab_core.client_intake_replay(v_actor,'LINK_CLIENT_ACCOUNT_PERSON',p_idempotency_key,v_request_sha);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    INSERT INTO medialab_core.client_account_people(
        id,client_account_id,organization_id,person_id,relationship_role,source_evidence_fingerprint,recorded_by_identity_id
    ) VALUES(
        gen_random_uuid(),p_client_account_id,p_organization_id,p_person_id,p_relationship_role,p_source_evidence_fingerprint,v_actor
    ) ON CONFLICT (client_account_id,person_id,relationship_role) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM medialab_core.client_account_people
         WHERE client_account_id=p_client_account_id AND person_id=p_person_id AND relationship_role=p_relationship_role;
    END IF;
    v_response := jsonb_build_object('relationshipId',v_id,'replayed',false);
    INSERT INTO medialab_core.client_intake_idempotency_records(
        id,actor_identity_id,command_name,idempotency_key,request_sha256,response_payload
    ) VALUES(gen_random_uuid(),v_actor,'LINK_CLIENT_ACCOUNT_PERSON',p_idempotency_key,v_request_sha,v_response-'replayed');
    RETURN v_response;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.link_order_client_account(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_order_id uuid,
    p_client_account_id uuid,
    p_relationship_role text,
    p_source_evidence_fingerprint text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_request_sha text; v_replay jsonb; v_id uuid; v_existing uuid; v_response jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_client_account_permission(v_actor,p_organization_id,'client_account.manage');
    IF p_relationship_role IS NULL OR p_relationship_role NOT IN ('CUSTOMER_GROUP','CUSTOMER_TEAM') OR
       p_source_evidence_fingerprint IS NULL OR p_source_evidence_fingerprint !~ '^[0-9a-f]{64}$' OR
       NOT EXISTS (SELECT 1 FROM medialab_core.orders WHERE id=p_order_id AND organization_id=p_organization_id) OR
       NOT EXISTS (SELECT 1 FROM medialab_core.client_accounts WHERE id=p_client_account_id AND organization_id=p_organization_id) THEN
        RAISE EXCEPTION 'Order client-account relationship is invalid or unavailable' USING ERRCODE = '42501';
    END IF;
    v_request_sha := encode(sha256(convert_to(jsonb_build_array(
        p_organization_id,p_order_id,p_client_account_id,p_relationship_role,p_source_evidence_fingerprint
    )::text,'UTF8')),'hex');
    v_replay := medialab_core.client_intake_replay(v_actor,'LINK_ORDER_CLIENT_ACCOUNT',p_idempotency_key,v_request_sha);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    SELECT client_account_id,id INTO v_existing,v_id FROM medialab_core.order_client_accounts
     WHERE order_id=p_order_id AND relationship_role=p_relationship_role FOR SHARE;
    IF v_existing IS NOT NULL AND v_existing <> p_client_account_id THEN
        RAISE EXCEPTION 'Order client-account relationship conflicts with existing evidence' USING ERRCODE = '23505';
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO medialab_core.order_client_accounts(
            id,order_id,organization_id,client_account_id,relationship_role,source_evidence_fingerprint,recorded_by_identity_id
        ) VALUES(
            gen_random_uuid(),p_order_id,p_organization_id,p_client_account_id,p_relationship_role,p_source_evidence_fingerprint,v_actor
        ) RETURNING id INTO v_id;
    END IF;
    v_response := jsonb_build_object('relationshipId',v_id,'replayed',false);
    INSERT INTO medialab_core.client_intake_idempotency_records(
        id,actor_identity_id,command_name,idempotency_key,request_sha256,response_payload
    ) VALUES(gen_random_uuid(),v_actor,'LINK_ORDER_CLIENT_ACCOUNT',p_idempotency_key,v_request_sha,v_response-'replayed');
    RETURN v_response;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_client_account_record(
    p_session_token text,
    p_client_account_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_account medialab_core.client_accounts%ROWTYPE; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_account FROM medialab_core.client_accounts WHERE id=p_client_account_id;
    IF NOT FOUND OR NOT (
        medialab_core.actor_has_permission(v_actor,v_account.organization_id,'client_account.read') OR
        medialab_core.actor_has_permission(v_actor,v_account.organization_id,'client_account.manage')
    ) THEN RAISE EXCEPTION 'Client account is missing or unavailable' USING ERRCODE='42501'; END IF;
    SELECT jsonb_build_object(
        'clientAccount',jsonb_build_object('id',v_account.id,'organizationId',v_account.organization_id,'accountType',v_account.account_type),
        'currentRevision',(SELECT jsonb_build_object(
            'revisionId',r.id,'parentClientAccountId',r.parent_client_account_id,'displayName',r.display_name,
            'brokerageName',r.brokerage_name,'sourceEvidenceFingerprint',r.source_evidence_fingerprint,'recordedAt',r.recorded_at
        ) FROM medialab_core.client_account_revisions r WHERE r.client_account_id=v_account.id ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1),
        'revisions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'revisionId',r.id,'parentClientAccountId',r.parent_client_account_id,'displayName',r.display_name,
            'brokerageName',r.brokerage_name,'sourceEvidenceFingerprint',r.source_evidence_fingerprint,'recordedAt',r.recorded_at
        ) ORDER BY r.recorded_at,r.id) FROM medialab_core.client_account_revisions r
          WHERE r.client_account_id=v_account.id),'[]'::jsonb),
        'externalReferences',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'sourceSystem',e.source_system,'externalRecordType',e.external_record_type,'externalIdentifier',e.external_identifier
        ) ORDER BY e.source_system,e.external_record_type,e.external_identifier) FROM medialab_core.client_account_external_references e
          WHERE e.client_account_id=v_account.id),'[]'::jsonb),
        'people',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'personId',cp.person_id,'displayName',p.display_name,'relationshipRole',cp.relationship_role
        ) ORDER BY p.display_name,p.id,cp.relationship_role) FROM medialab_core.client_account_people cp
          JOIN medialab_core.people p ON p.id=cp.person_id WHERE cp.client_account_id=v_account.id),'[]'::jsonb),
        'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'orderId',oc.order_id,'relationshipRole',oc.relationship_role
        ) ORDER BY oc.recorded_at,oc.id) FROM medialab_core.order_client_accounts oc
          WHERE oc.client_account_id=v_account.id),'[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_client_accounts(
    p_session_token text,
    p_organization_id uuid
)
RETURNS SETOF jsonb AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    IF NOT (
        medialab_core.actor_has_permission(v_actor,p_organization_id,'client_account.read') OR
        medialab_core.actor_has_permission(v_actor,p_organization_id,'client_account.manage')
    ) THEN RAISE EXCEPTION 'Client-account authority is unavailable' USING ERRCODE='42501'; END IF;
    RETURN QUERY
      SELECT jsonb_build_object(
        'clientAccountId',a.id,'accountType',a.account_type,'displayName',r.display_name,
        'brokerageName',r.brokerage_name,'parentClientAccountId',r.parent_client_account_id,
        'personCount',(SELECT count(*) FROM medialab_core.client_account_people p WHERE p.client_account_id=a.id),
        'orderCount',(SELECT count(*) FROM medialab_core.order_client_accounts o WHERE o.client_account_id=a.id)
      )
      FROM medialab_core.client_accounts a
      JOIN LATERAL (
        SELECT * FROM medialab_core.client_account_revisions r0 WHERE r0.client_account_id=a.id
         ORDER BY r0.recorded_at DESC,r0.id DESC LIMIT 1
      ) r ON true
      WHERE a.organization_id=p_organization_id
      ORDER BY r.display_name,a.account_type,a.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON TABLE medialab_core.client_accounts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.client_account_external_references FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.client_account_revisions FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.client_account_people FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.order_client_accounts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.client_contact_source_evidence FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.client_intake_idempotency_records FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_client_foundation_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_client_account_permission(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.client_intake_replay(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reconcile_client_account_intake(text,text,uuid,text,text,text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reconcile_customer_contact_intake(text,text,uuid,uuid,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.link_client_account_person(text,text,uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.link_order_client_account(text,text,uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_client_account_record(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_client_accounts(text,uuid) FROM PUBLIC;

COMMENT ON TABLE medialab_core.client_accounts IS
  'Organization-scoped customer account identity; never a Platform tenant or authentication authority.';
COMMENT ON TABLE medialab_core.client_account_revisions IS
  'Append-only client-account display, parent-team, and brokerage observations.';
COMMENT ON TABLE medialab_core.client_contact_source_evidence IS
  'Append-only source provenance for organization-operator customer contact intake; not verification evidence.';
