ALTER TABLE medialab_core.property_snapshots
    ADD CONSTRAINT property_snapshots_id_property_org_key
    UNIQUE (id, property_id, organization_id);

ALTER TABLE medialab_core.orders
    ADD CONSTRAINT orders_id_organization_property_key
    UNIQUE (id, organization_id, property_id);

CREATE TABLE medialab_core.property_hubs (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    property_id uuid NOT NULL,
    initial_property_snapshot_id uuid NOT NULL,
    current_state text NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (property_id, organization_id)
        REFERENCES medialab_core.properties(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (initial_property_snapshot_id, property_id, organization_id)
        REFERENCES medialab_core.property_snapshots(id, property_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT property_hubs_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT property_hubs_id_organization_property_key UNIQUE (id, organization_id, property_id),
    CONSTRAINT property_hubs_state_check CHECK (current_state = 'ESTABLISHED'),
    CONSTRAINT property_hubs_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE TABLE medialab_core.property_hub_orders (
    property_hub_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_id uuid NOT NULL,
    order_id uuid NOT NULL,
    associated_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    associated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (property_hub_id, order_id),
    FOREIGN KEY (property_hub_id, organization_id, property_id)
        REFERENCES medialab_core.property_hubs(id, organization_id, property_id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id, organization_id, property_id)
        REFERENCES medialab_core.orders(id, organization_id, property_id) ON DELETE RESTRICT
);

CREATE TABLE medialab_core.property_hub_participants (
    id uuid PRIMARY KEY,
    property_hub_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    participant_role text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (property_hub_id, organization_id)
        REFERENCES medialab_core.property_hubs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (membership_id, organization_id)
        REFERENCES medialab_core.memberships(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT property_hub_participants_role_check CHECK (
        participant_role IN ('HUB_MANAGER', 'HUB_PARTICIPANT')
    ),
    CONSTRAINT property_hub_participants_membership_role_key
        UNIQUE (property_hub_id, membership_id, participant_role)
);

CREATE TABLE medialab_core.property_hub_external_references (
    id uuid PRIMARY KEY,
    property_hub_id uuid NOT NULL REFERENCES medialab_core.property_hubs(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    provenance text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT property_hub_external_references_provider_check CHECK (
        provider ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT property_hub_external_references_type_check CHECK (
        external_record_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT property_hub_external_references_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND
        external_identifier <> '' AND length(external_identifier) <= 200
    ),
    CONSTRAINT property_hub_external_references_provenance_check CHECK (
        provenance = btrim(provenance) AND provenance <> '' AND length(provenance) <= 500
    ),
    CONSTRAINT property_hub_external_references_source_key
        UNIQUE (provider, external_record_type, external_identifier)
);

CREATE TABLE medialab_core.property_hub_idempotency_records (
    id uuid PRIMARY KEY,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    result_property_hub_id uuid NOT NULL REFERENCES medialab_core.property_hubs(id) ON DELETE RESTRICT,
    completion_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz NOT NULL,
    CONSTRAINT property_hub_idempotency_records_command_check CHECK (command_type = 'CREATE_PROPERTY_HUB'),
    CONSTRAINT property_hub_idempotency_records_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND
        idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT property_hub_idempotency_records_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT property_hub_idempotency_records_state_check CHECK (completion_state = 'COMPLETED'),
    CONSTRAINT property_hub_idempotency_records_time_check CHECK (completed_at >= created_at),
    CONSTRAINT property_hub_idempotency_records_actor_command_key
        UNIQUE (actor_identity_id, command_type, idempotency_key)
);

CREATE TABLE medialab_core.property_hub_events (
    id uuid PRIMARY KEY,
    property_hub_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authority_context text NOT NULL,
    source_system text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (property_hub_id, organization_id)
        REFERENCES medialab_core.property_hubs(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT property_hub_events_type_check CHECK (event_type = 'PROPERTY_HUB_CREATED'),
    CONSTRAINT property_hub_events_authority_check CHECK (
        authority_context = btrim(authority_context) AND
        authority_context <> '' AND length(authority_context) <= 200
    ),
    CONSTRAINT property_hub_events_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT property_hub_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 500
    ),
    CONSTRAINT property_hub_events_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND
        idempotency_key <> '' AND length(idempotency_key) <= 200
    )
);

CREATE INDEX property_hubs_organization_created_idx
    ON medialab_core.property_hubs (organization_id, created_at DESC, id DESC);
CREATE INDEX property_hubs_property_created_idx
    ON medialab_core.property_hubs (property_id, created_at DESC, id DESC);
CREATE INDEX property_hub_orders_order_idx
    ON medialab_core.property_hub_orders (order_id, associated_at, property_hub_id);
CREATE INDEX property_hub_participants_membership_idx
    ON medialab_core.property_hub_participants (membership_id, recorded_at, property_hub_id);
CREATE INDEX property_hub_external_references_hub_idx
    ON medialab_core.property_hub_external_references (property_hub_id, recorded_at, id);
CREATE INDEX property_hub_events_hub_idx
    ON medialab_core.property_hub_events (property_hub_id, occurred_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_property_hub_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_property_hub_permission(
    p_actor_identity_id uuid,
    p_organization_id uuid,
    p_permission_code text
)
RETURNS void AS $$
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
        RAISE EXCEPTION 'Property Hub actor identity is missing, inactive, suspended, or otherwise unusable'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM medialab_core.memberships m
          JOIN medialab_core.membership_permission_sets mps
            ON mps.membership_id = m.id
           AND mps.organization_id = m.organization_id
          JOIN medialab_core.permission_sets ps
            ON ps.id = mps.permission_set_id
           AND ps.organization_id = m.organization_id
          JOIN medialab_core.permission_set_permissions psp
            ON psp.permission_set_id = ps.id
          JOIN medialab_core.permissions p
            ON p.id = psp.permission_id
         WHERE m.person_id = v_actor_person_id
           AND m.organization_id = p_organization_id
           AND m.status = 'ACTIVE'
           AND ps.retired_at IS NULL
           AND p.is_active = true
           AND p.code = p_permission_code
    ) THEN
        RAISE EXCEPTION 'Property Hub actor lacks required permission % for the target organization', p_permission_code
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_property_hub(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_property_id uuid,
    p_initial_property_snapshot_id uuid,
    p_source_system text,
    p_order_ids jsonb,
    p_participants jsonb,
    p_external_references jsonb
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_actor_membership_id uuid;
    v_request_sha256 text;
    v_existing medialab_core.property_hub_idempotency_records%ROWTYPE;
    v_property_hub_id uuid := gen_random_uuid();
    v_now timestamptz := clock_timestamp();
    v_order_id uuid;
    v_participant jsonb;
    v_participant_membership_id uuid;
    v_participant_role text;
    v_external_reference jsonb;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    PERFORM medialab_core.require_property_hub_permission(
        v_actor_identity_id, p_organization_id, 'property_hub.create'
    );

    SELECT m.id
      INTO v_actor_membership_id
      FROM medialab_core.memberships m
     WHERE m.organization_id = p_organization_id
       AND m.person_id = v_actor_person_id
       AND m.status = 'ACTIVE';

    IF v_actor_membership_id IS NULL THEN
        RAISE EXCEPTION 'Property Hub actor is not an active member of the target organization'
            USING ERRCODE = '42501';
    END IF;

    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'Property Hub idempotency key is invalid' USING ERRCODE = '22023';
    END IF;

    IF p_source_system IS NULL OR p_source_system <> btrim(p_source_system) OR
       p_source_system = '' OR length(p_source_system) > 100 THEN
        RAISE EXCEPTION 'Property Hub source system is invalid' USING ERRCODE = '22023';
    END IF;

    IF p_order_ids IS NULL OR jsonb_typeof(p_order_ids) <> 'array' OR jsonb_array_length(p_order_ids) = 0 THEN
        RAISE EXCEPTION 'Property Hub creation requires at least one canonical Order'
            USING ERRCODE = '22023';
    END IF;

    IF p_participants IS NULL OR jsonb_typeof(p_participants) <> 'array' THEN
        RAISE EXCEPTION 'Property Hub participants must be a JSON array' USING ERRCODE = '22023';
    END IF;

    IF p_external_references IS NULL OR jsonb_typeof(p_external_references) <> 'array' THEN
        RAISE EXCEPTION 'Property Hub external references must be a JSON array' USING ERRCODE = '22023';
    END IF;

    v_request_sha256 := encode(sha256(convert_to(jsonb_build_object(
        'organization_id', p_organization_id,
        'property_id', p_property_id,
        'initial_property_snapshot_id', p_initial_property_snapshot_id,
        'source_system', p_source_system,
        'order_ids', p_order_ids,
        'participants', p_participants,
        'external_references', p_external_references
    )::text, 'UTF8')), 'hex');

    PERFORM pg_advisory_xact_lock(hashtextextended(
        v_actor_identity_id::text || ':CREATE_PROPERTY_HUB:' || p_idempotency_key, 0
    ));

    SELECT *
      INTO v_existing
      FROM medialab_core.property_hub_idempotency_records
     WHERE actor_identity_id = v_actor_identity_id
       AND command_type = 'CREATE_PROPERTY_HUB'
       AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing.request_sha256 <> v_request_sha256 THEN
            RAISE EXCEPTION 'Idempotency key was already used with a conflicting request fingerprint'
                USING ERRCODE = '23505';
        END IF;
        RETURN v_existing.result_property_hub_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM medialab_core.property_snapshots ps
         WHERE ps.id = p_initial_property_snapshot_id
           AND ps.property_id = p_property_id
           AND ps.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Initial Property snapshot does not belong to the target Property and organization'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_order_ids) entry
         WHERE jsonb_typeof(entry) <> 'string'
    ) THEN
        RAISE EXCEPTION 'Property Hub Order identities must be JSON strings' USING ERRCODE = '22023';
    END IF;

    IF (
        SELECT count(*) <> count(DISTINCT value)
          FROM jsonb_array_elements_text(p_order_ids)
    ) THEN
        RAISE EXCEPTION 'Property Hub Order identities must be unique' USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(p_order_ids) entry(order_id)
          LEFT JOIN medialab_core.orders o
            ON o.id = entry.order_id::uuid
           AND o.organization_id = p_organization_id
           AND o.property_id = p_property_id
         WHERE o.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Property Hub Order is missing, belongs to another organization, or references another Property'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_participants) entry
         WHERE jsonb_typeof(entry) <> 'object'
            OR entry->>'role' NOT IN ('HUB_MANAGER', 'HUB_PARTICIPANT')
            OR entry->>'membership_id' IS NULL
    ) THEN
        RAISE EXCEPTION 'Property Hub participant identity or role is invalid' USING ERRCODE = '22023';
    END IF;

    IF (
        SELECT count(*) <> count(DISTINCT (entry->>'membership_id', entry->>'role'))
          FROM jsonb_array_elements(p_participants) entry
    ) THEN
        RAISE EXCEPTION 'Property Hub participant-role records must be unique' USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_participants) entry
          LEFT JOIN medialab_core.memberships m
            ON m.id = (entry->>'membership_id')::uuid
           AND m.organization_id = p_organization_id
           AND m.status = 'ACTIVE'
         WHERE m.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Property Hub participant is not an active member of the target organization'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_participants) entry
         WHERE (entry->>'membership_id')::uuid = v_actor_membership_id
           AND entry->>'role' = 'HUB_MANAGER'
    ) THEN
        RAISE EXCEPTION 'Authenticated Hub manager participant must not be duplicated'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_external_references) entry
         WHERE jsonb_typeof(entry) <> 'object'
            OR COALESCE(entry->>'provider', '') !~ '^[A-Z][A-Z0-9_]{1,79}$'
            OR COALESCE(entry->>'external_record_type', '') !~ '^[A-Z][A-Z0-9_]{1,79}$'
            OR entry->>'external_identifier' IS NULL
            OR entry->>'external_identifier' <> btrim(entry->>'external_identifier')
            OR entry->>'external_identifier' = ''
            OR length(entry->>'external_identifier') > 200
            OR entry->>'provenance' IS NULL
            OR entry->>'provenance' <> btrim(entry->>'provenance')
            OR entry->>'provenance' = ''
            OR length(entry->>'provenance') > 500
    ) THEN
        RAISE EXCEPTION 'Property Hub external reference is malformed' USING ERRCODE = '22023';
    END IF;

    IF (
        SELECT count(*) <> count(DISTINCT (
            entry->>'provider', entry->>'external_record_type', entry->>'external_identifier'
        ))
          FROM jsonb_array_elements(p_external_references) entry
    ) THEN
        RAISE EXCEPTION 'Property Hub external references must be unique within the request'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO medialab_core.property_hubs (
        id, organization_id, property_id, initial_property_snapshot_id,
        current_state, source_system, created_by_identity_id, created_at
    ) VALUES (
        v_property_hub_id, p_organization_id, p_property_id, p_initial_property_snapshot_id,
        'ESTABLISHED', p_source_system, v_actor_identity_id, v_now
    );

    FOR v_order_id IN
        SELECT value::uuid FROM jsonb_array_elements_text(p_order_ids)
    LOOP
        INSERT INTO medialab_core.property_hub_orders (
            property_hub_id, organization_id, property_id, order_id,
            associated_by_identity_id, associated_at
        ) VALUES (
            v_property_hub_id, p_organization_id, p_property_id, v_order_id,
            v_actor_identity_id, v_now
        );
    END LOOP;

    INSERT INTO medialab_core.property_hub_participants (
        id, property_hub_id, organization_id, membership_id, participant_role,
        recorded_by_identity_id, recorded_at
    ) VALUES (
        gen_random_uuid(), v_property_hub_id, p_organization_id, v_actor_membership_id,
        'HUB_MANAGER', v_actor_identity_id, v_now
    );

    FOR v_participant IN SELECT value FROM jsonb_array_elements(p_participants)
    LOOP
        v_participant_membership_id := (v_participant->>'membership_id')::uuid;
        v_participant_role := v_participant->>'role';
        INSERT INTO medialab_core.property_hub_participants (
            id, property_hub_id, organization_id, membership_id, participant_role,
            recorded_by_identity_id, recorded_at
        ) VALUES (
            gen_random_uuid(), v_property_hub_id, p_organization_id,
            v_participant_membership_id, v_participant_role,
            v_actor_identity_id, v_now
        );
    END LOOP;

    FOR v_external_reference IN SELECT value FROM jsonb_array_elements(p_external_references)
    LOOP
        INSERT INTO medialab_core.property_hub_external_references (
            id, property_hub_id, provider, external_record_type, external_identifier,
            provenance, recorded_by_identity_id, recorded_at
        ) VALUES (
            gen_random_uuid(), v_property_hub_id,
            v_external_reference->>'provider',
            v_external_reference->>'external_record_type',
            v_external_reference->>'external_identifier',
            v_external_reference->>'provenance',
            v_actor_identity_id, v_now
        );
    END LOOP;

    INSERT INTO medialab_core.property_hub_idempotency_records (
        id, actor_identity_id, command_type, idempotency_key, request_sha256,
        result_property_hub_id, completion_state, created_at, completed_at
    ) VALUES (
        gen_random_uuid(), v_actor_identity_id, 'CREATE_PROPERTY_HUB', p_idempotency_key,
        v_request_sha256, v_property_hub_id, 'COMPLETED', v_now, clock_timestamp()
    );

    INSERT INTO medialab_core.property_hub_events (
        id, property_hub_id, organization_id, event_type, actor_identity_id,
        authority_context, source_system, reason, idempotency_key, occurred_at
    ) VALUES (
        gen_random_uuid(), v_property_hub_id, p_organization_id, 'PROPERTY_HUB_CREATED',
        v_actor_identity_id, 'PROPERTY_HUB_CREATE_PERMISSION', p_source_system,
        'Canonical Property Hub engagement established', p_idempotency_key, v_now
    );

    RETURN v_property_hub_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_property_hub_record(
    p_session_token text,
    p_property_hub_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_organization_id uuid;
    v_membership_id uuid;
    v_result jsonb;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    SELECT organization_id
      INTO v_organization_id
      FROM medialab_core.property_hubs
     WHERE id = p_property_hub_id;

    IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Property Hub is missing or unavailable' USING ERRCODE = '42501';
    END IF;

    PERFORM medialab_core.require_property_hub_permission(
        v_actor_identity_id, v_organization_id, 'property_hub.read'
    );

    SELECT m.id
      INTO v_membership_id
      FROM medialab_core.memberships m
      JOIN medialab_core.property_hub_participants hp
        ON hp.membership_id = m.id
       AND hp.organization_id = m.organization_id
       AND hp.property_hub_id = p_property_hub_id
     WHERE m.organization_id = v_organization_id
       AND m.person_id = v_actor_person_id
       AND m.status = 'ACTIVE'
     LIMIT 1;

    IF v_membership_id IS NULL THEN
        RAISE EXCEPTION 'Property Hub is missing or unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'property_hub', to_jsonb(h),
        'property', to_jsonb(p),
        'initial_property_snapshot', to_jsonb(ps),
        'orders', COALESCE((
            SELECT jsonb_agg(to_jsonb(o) ORDER BY ho.associated_at, o.id)
              FROM medialab_core.property_hub_orders ho
              JOIN medialab_core.orders o ON o.id = ho.order_id
             WHERE ho.property_hub_id = h.id
        ), '[]'::jsonb),
        'participants', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', hp.id,
                'membership_id', hp.membership_id,
                'person_id', m.person_id,
                'display_name', person.display_name,
                'role', hp.participant_role,
                'recorded_at', hp.recorded_at
            ) ORDER BY hp.participant_role, hp.membership_id)
              FROM medialab_core.property_hub_participants hp
              JOIN medialab_core.memberships m ON m.id = hp.membership_id
              JOIN medialab_core.people person ON person.id = m.person_id
             WHERE hp.property_hub_id = h.id
        ), '[]'::jsonb),
        'external_references', COALESCE((
            SELECT jsonb_agg(to_jsonb(r) ORDER BY r.recorded_at, r.id)
              FROM medialab_core.property_hub_external_references r
             WHERE r.property_hub_id = h.id
        ), '[]'::jsonb),
        'events', COALESCE((
            SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at, e.id)
              FROM medialab_core.property_hub_events e
             WHERE e.property_hub_id = h.id
        ), '[]'::jsonb)
    )
      INTO v_result
      FROM medialab_core.property_hubs h
      JOIN medialab_core.properties p ON p.id = h.property_id
      JOIN medialab_core.property_snapshots ps ON ps.id = h.initial_property_snapshot_id
     WHERE h.id = p_property_hub_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STRICT STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER property_hubs_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.property_hubs
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_property_hub_evidence_mutation();
CREATE TRIGGER property_hub_orders_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.property_hub_orders
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_property_hub_evidence_mutation();
CREATE TRIGGER property_hub_participants_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.property_hub_participants
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_property_hub_evidence_mutation();
CREATE TRIGGER property_hub_external_references_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.property_hub_external_references
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_property_hub_evidence_mutation();
CREATE TRIGGER property_hub_idempotency_records_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.property_hub_idempotency_records
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_property_hub_evidence_mutation();
CREATE TRIGGER property_hub_events_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.property_hub_events
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_property_hub_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.property_hubs FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.property_hub_orders FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.property_hub_participants FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.property_hub_external_references FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.property_hub_idempotency_records FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.property_hub_events FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_property_hub_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_property_hub_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_property_hub(text, text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_property_hub_record(text, uuid) FROM PUBLIC;
