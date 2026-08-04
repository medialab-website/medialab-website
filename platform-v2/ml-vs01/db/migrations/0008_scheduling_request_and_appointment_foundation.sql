CREATE TABLE medialab_core.scheduling_requests (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    order_id uuid NOT NULL,
    customer_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    creation_mode text NOT NULL,
    source_system text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (property_hub_id, organization_id)
        REFERENCES medialab_core.property_hubs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (property_hub_id, order_id)
        REFERENCES medialab_core.property_hub_orders(property_hub_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id, organization_id)
        REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT scheduling_requests_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT scheduling_requests_id_hub_order_org_key
        UNIQUE (id, property_hub_id, order_id, organization_id),
    CONSTRAINT scheduling_requests_creation_mode_check CHECK (
        creation_mode IN ('CUSTOMER_DIRECT', 'STAFF_RESCHEDULE')
    ),
    CONSTRAINT scheduling_requests_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE TABLE medialab_core.scheduling_windows (
    id uuid PRIMARY KEY,
    scheduling_request_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    window_kind text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    iana_timezone text NOT NULL,
    local_starts_at timestamp without time zone NOT NULL,
    local_ends_at timestamp without time zone NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    source_system text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (scheduling_request_id, organization_id)
        REFERENCES medialab_core.scheduling_requests(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT scheduling_windows_id_request_org_key UNIQUE (id, scheduling_request_id, organization_id),
    CONSTRAINT scheduling_windows_kind_check CHECK (window_kind IN ('REQUESTED', 'STAFF_PROPOSED')),
    CONSTRAINT scheduling_windows_time_check CHECK (ends_at > starts_at AND local_ends_at > local_starts_at),
    CONSTRAINT scheduling_windows_timezone_check CHECK (
        iana_timezone = btrim(iana_timezone) AND iana_timezone <> '' AND length(iana_timezone) <= 100
    ),
    CONSTRAINT scheduling_windows_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE TABLE medialab_core.scheduling_acceptances (
    id uuid PRIMARY KEY,
    scheduling_request_id uuid NOT NULL,
    proposal_window_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    acceptance_kind text NOT NULL,
    accepting_customer_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    acceptance_method text NOT NULL,
    attributable_note text NULL,
    accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (scheduling_request_id, organization_id)
        REFERENCES medialab_core.scheduling_requests(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (proposal_window_id, scheduling_request_id, organization_id)
        REFERENCES medialab_core.scheduling_windows(id, scheduling_request_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT scheduling_acceptances_request_key UNIQUE (scheduling_request_id),
    CONSTRAINT scheduling_acceptances_proposal_key UNIQUE (proposal_window_id),
    CONSTRAINT scheduling_acceptances_kind_check CHECK (
        acceptance_kind IN ('CUSTOMER_AUTHENTICATED', 'STAFF_RECORDED')
    ),
    CONSTRAINT scheduling_acceptances_method_check CHECK (
        acceptance_method IN ('AUTHENTICATED_SESSION', 'PHONE', 'TEXT', 'EMAIL', 'IN_PERSON', 'OTHER')
    ),
    CONSTRAINT scheduling_acceptances_note_check CHECK (
        attributable_note IS NULL OR
        (attributable_note = btrim(attributable_note) AND attributable_note <> '' AND length(attributable_note) <= 1000)
    ),
    CONSTRAINT scheduling_acceptances_actor_distinction_check CHECK (
        (acceptance_kind = 'CUSTOMER_AUTHENTICATED' AND
         accepting_customer_identity_id = recorded_by_identity_id AND
         acceptance_method = 'AUTHENTICATED_SESSION') OR
        (acceptance_kind = 'STAFF_RECORDED' AND acceptance_method <> 'AUTHENTICATED_SESSION')
    )
);

CREATE TABLE medialab_core.appointments (
    id uuid PRIMARY KEY,
    scheduling_request_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    order_id uuid NOT NULL,
    confirmed_window_id uuid NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    iana_timezone text NOT NULL,
    local_starts_at timestamp without time zone NOT NULL,
    local_ends_at timestamp without time zone NOT NULL,
    confirmed_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    source_system text NOT NULL,
    confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (scheduling_request_id, property_hub_id, order_id, organization_id)
        REFERENCES medialab_core.scheduling_requests(id, property_hub_id, order_id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (confirmed_window_id, scheduling_request_id, organization_id)
        REFERENCES medialab_core.scheduling_windows(id, scheduling_request_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT appointments_request_key UNIQUE (scheduling_request_id),
    CONSTRAINT appointments_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT appointments_id_request_org_key UNIQUE (id, scheduling_request_id, organization_id),
    CONSTRAINT appointments_time_check CHECK (ends_at > starts_at AND local_ends_at > local_starts_at),
    CONSTRAINT appointments_timezone_check CHECK (
        iana_timezone = btrim(iana_timezone) AND iana_timezone <> '' AND length(iana_timezone) <= 100
    ),
    CONSTRAINT appointments_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE TABLE medialab_core.appointment_participant_assignments (
    id uuid PRIMARY KEY,
    appointment_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    operational_role text NOT NULL,
    assigned_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (appointment_id, organization_id)
        REFERENCES medialab_core.appointments(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT appointment_assignments_id_appointment_org_key UNIQUE (id, appointment_id, organization_id),
    CONSTRAINT appointment_assignments_role_check CHECK (
        operational_role IN ('PRIMARY_OPERATOR', 'ADDITIONAL_OPERATOR', 'COORDINATOR')
    )
);

CREATE TABLE medialab_core.appointment_participant_assignment_endings (
    id uuid PRIMARY KEY,
    assignment_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    ended_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    ending_reason text NOT NULL,
    ended_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (assignment_id, appointment_id, organization_id)
        REFERENCES medialab_core.appointment_participant_assignments(id, appointment_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT appointment_assignment_endings_assignment_key UNIQUE (assignment_id),
    CONSTRAINT appointment_assignment_endings_reason_check CHECK (
        ending_reason = btrim(ending_reason) AND ending_reason <> '' AND length(ending_reason) <= 500
    )
);

CREATE TABLE medialab_core.scheduling_external_references (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    scheduling_request_id uuid NULL,
    appointment_id uuid NULL,
    provider text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    provenance text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (scheduling_request_id, organization_id)
        REFERENCES medialab_core.scheduling_requests(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (appointment_id, organization_id)
        REFERENCES medialab_core.appointments(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT scheduling_external_references_subject_check CHECK (
        (scheduling_request_id IS NOT NULL AND appointment_id IS NULL) OR
        (scheduling_request_id IS NULL AND appointment_id IS NOT NULL)
    ),
    CONSTRAINT scheduling_external_references_provider_check CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT scheduling_external_references_type_check CHECK (external_record_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT scheduling_external_references_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND external_identifier <> '' AND length(external_identifier) <= 200
    ),
    CONSTRAINT scheduling_external_references_provenance_check CHECK (
        provenance = btrim(provenance) AND provenance <> '' AND length(provenance) <= 500
    ),
    CONSTRAINT scheduling_external_references_source_key
        UNIQUE (provider, external_record_type, external_identifier)
);

CREATE TABLE medialab_core.scheduling_command_idempotency (
    id uuid PRIMARY KEY,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT scheduling_command_idempotency_command_check CHECK (command_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT scheduling_command_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT scheduling_command_idempotency_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT scheduling_command_idempotency_result_check CHECK (jsonb_typeof(result) = 'object'),
    CONSTRAINT scheduling_command_idempotency_actor_command_key
        UNIQUE (actor_identity_id, command_type, idempotency_key)
);

CREATE TABLE medialab_core.scheduling_request_events (
    id uuid PRIMARY KEY,
    scheduling_request_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authority_context text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (scheduling_request_id, organization_id)
        REFERENCES medialab_core.scheduling_requests(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT scheduling_request_events_type_check CHECK (event_type IN (
        'REQUEST_CREATED', 'REQUESTED_WINDOW_ADDED', 'ALTERNATE_WINDOW_PROPOSED',
        'PROPOSAL_ACCEPTED', 'REQUEST_WITHDRAWN', 'REQUEST_DECLINED',
        'REQUEST_CANCELLED', 'REQUEST_FULFILLED'
    )),
    CONSTRAINT scheduling_request_events_authority_check CHECK (
        authority_context = btrim(authority_context) AND authority_context <> '' AND length(authority_context) <= 200
    ),
    CONSTRAINT scheduling_request_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT scheduling_request_events_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT scheduling_request_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.appointment_events (
    id uuid PRIMARY KEY,
    appointment_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authority_context text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    replacement_appointment_id uuid NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (appointment_id, organization_id)
        REFERENCES medialab_core.appointments(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (replacement_appointment_id, organization_id)
        REFERENCES medialab_core.appointments(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT appointment_events_type_check CHECK (event_type IN (
        'APPOINTMENT_CONFIRMED', 'PARTICIPANT_ASSIGNED', 'PARTICIPANT_ASSIGNMENT_ENDED',
        'PARTICIPANT_ASSIGNMENT_REPLACED', 'APPOINTMENT_CANCELLED', 'NO_SHOW',
        'INACCESSIBLE_PROPERTY', 'UNABLE_TO_COMPLETE', 'WEATHER_DELAYED', 'APPOINTMENT_SUPERSEDED'
    )),
    CONSTRAINT appointment_events_replacement_check CHECK (
        (event_type = 'APPOINTMENT_SUPERSEDED' AND replacement_appointment_id IS NOT NULL AND replacement_appointment_id <> appointment_id) OR
        (event_type <> 'APPOINTMENT_SUPERSEDED' AND replacement_appointment_id IS NULL)
    ),
    CONSTRAINT appointment_events_authority_check CHECK (
        authority_context = btrim(authority_context) AND authority_context <> '' AND length(authority_context) <= 200
    ),
    CONSTRAINT appointment_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT appointment_events_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT appointment_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE INDEX scheduling_requests_hub_created_idx
    ON medialab_core.scheduling_requests (property_hub_id, created_at DESC, id DESC);
CREATE INDEX scheduling_requests_order_created_idx
    ON medialab_core.scheduling_requests (order_id, created_at DESC, id DESC);
CREATE INDEX scheduling_windows_request_recorded_idx
    ON medialab_core.scheduling_windows (scheduling_request_id, recorded_at, id);
CREATE INDEX appointments_hub_time_idx
    ON medialab_core.appointments (property_hub_id, starts_at, id);
CREATE INDEX appointment_assignments_appointment_idx
    ON medialab_core.appointment_participant_assignments (appointment_id, assigned_at, id);
CREATE INDEX scheduling_request_events_request_idx
    ON medialab_core.scheduling_request_events (scheduling_request_id, occurred_at, id);
CREATE INDEX appointment_events_appointment_idx
    ON medialab_core.appointment_events (appointment_id, occurred_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_scheduling_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_scheduling_time_evidence(
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_iana_timezone text,
    p_local_starts_at timestamp without time zone,
    p_local_ends_at timestamp without time zone
)
RETURNS void AS $$
BEGIN
    IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at OR
       p_local_starts_at IS NULL OR p_local_ends_at IS NULL OR p_local_ends_at <= p_local_starts_at OR
       p_iana_timezone IS NULL OR p_iana_timezone <> btrim(p_iana_timezone) OR
       length(p_iana_timezone) = 0 OR length(p_iana_timezone) > 100 THEN
        RAISE EXCEPTION 'Scheduling time evidence is incomplete or invalid' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names
         WHERE name = p_iana_timezone
           AND (position('/' in name) > 0 OR name = 'UTC')
    ) THEN
        RAISE EXCEPTION 'A recognized explicit IANA timezone is required' USING ERRCODE = '22023';
    END IF;

    IF p_local_starts_at AT TIME ZONE p_iana_timezone <> p_starts_at OR
       p_local_ends_at AT TIME ZONE p_iana_timezone <> p_ends_at THEN
        RAISE EXCEPTION 'Local scheduling representation does not reconstruct the supplied instants in timezone %', p_iana_timezone
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_scheduling_window_time()
RETURNS trigger AS $$
BEGIN
    PERFORM medialab_core.validate_scheduling_time_evidence(
        NEW.starts_at, NEW.ends_at, NEW.iana_timezone, NEW.local_starts_at, NEW.local_ends_at
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.actor_has_permission(
    p_actor_identity_id uuid,
    p_organization_id uuid,
    p_permission_code text
)
RETURNS boolean AS $$
DECLARE
    v_person_id uuid;
BEGIN
    SELECT i.person_id INTO v_person_id
      FROM medialab_core.identities i
      JOIN medialab_core.person_account_states s
        ON s.identity_id = i.id AND s.person_id = i.person_id
     WHERE i.id = p_actor_identity_id
       AND i.status = 'ACTIVE'
       AND s.current_state IN ('ACTIVE', 'RECOVERED');

    RETURN v_person_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM medialab_core.memberships m
          JOIN medialab_core.membership_permission_sets mps
            ON mps.membership_id = m.id AND mps.organization_id = m.organization_id
          JOIN medialab_core.permission_sets ps
            ON ps.id = mps.permission_set_id AND ps.organization_id = m.organization_id
          JOIN medialab_core.permission_set_permissions psp ON psp.permission_set_id = ps.id
          JOIN medialab_core.permissions p ON p.id = psp.permission_id
         WHERE m.person_id = v_person_id
           AND m.organization_id = p_organization_id
           AND m.status = 'ACTIVE'
           AND ps.retired_at IS NULL
           AND p.is_active = true
           AND p.code = p_permission_code
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_scheduling_staff(
    p_actor_identity_id uuid,
    p_organization_id uuid
)
RETURNS void AS $$
BEGIN
    IF NOT medialab_core.actor_has_permission(
        p_actor_identity_id, p_organization_id, 'scheduling.staff.manage'
    ) THEN
        RAISE EXCEPTION 'Actor lacks active staff scheduling authority for the target organization'
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.actor_is_order_customer(
    p_actor_identity_id uuid,
    p_order_id uuid,
    p_organization_id uuid,
    p_placer_only boolean DEFAULT false
)
RETURNS boolean AS $$
DECLARE
    v_person_id uuid;
BEGIN
    SELECT i.person_id INTO v_person_id
      FROM medialab_core.identities i
      JOIN medialab_core.person_account_states s
        ON s.identity_id = i.id AND s.person_id = i.person_id
      JOIN medialab_core.memberships m
        ON m.person_id = i.person_id AND m.organization_id = p_organization_id
     WHERE i.id = p_actor_identity_id
       AND i.status = 'ACTIVE'
       AND s.current_state IN ('ACTIVE', 'RECOVERED')
       AND m.status = 'ACTIVE';

    RETURN v_person_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM medialab_core.order_parties op
         WHERE op.order_id = p_order_id
           AND op.party_kind = 'PERSON'
           AND op.person_id = v_person_id
           AND (
               (p_placer_only AND op.party_role = 'ORDERING_PERSON') OR
               (NOT p_placer_only AND op.party_role IN ('ORDERING_PERSON', 'CUSTOMER', 'AUTHORIZED_ACTOR'))
           )
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.current_scheduling_request_state(p_request_id uuid)
RETURNS text AS $$
DECLARE
    v_state text;
BEGIN
    SELECT CASE event_type
        WHEN 'REQUEST_WITHDRAWN' THEN 'WITHDRAWN'
        WHEN 'REQUEST_DECLINED' THEN 'DECLINED'
        WHEN 'REQUEST_CANCELLED' THEN 'CANCELLED'
        WHEN 'REQUEST_FULFILLED' THEN 'FULFILLED'
        ELSE 'REQUESTED'
    END INTO v_state
      FROM medialab_core.scheduling_request_events
     WHERE scheduling_request_id = p_request_id
       AND event_type IN ('REQUEST_CREATED', 'REQUEST_WITHDRAWN', 'REQUEST_DECLINED', 'REQUEST_CANCELLED', 'REQUEST_FULFILLED')
     ORDER BY occurred_at DESC, id DESC LIMIT 1;
    RETURN v_state;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.current_appointment_state(p_appointment_id uuid)
RETURNS text AS $$
DECLARE
    v_state text;
BEGIN
    SELECT CASE event_type
        WHEN 'APPOINTMENT_CONFIRMED' THEN 'CONFIRMED'
        WHEN 'APPOINTMENT_CANCELLED' THEN 'CANCELLED'
        WHEN 'NO_SHOW' THEN 'NO_SHOW'
        WHEN 'INACCESSIBLE_PROPERTY' THEN 'INACCESSIBLE_PROPERTY'
        WHEN 'UNABLE_TO_COMPLETE' THEN 'UNABLE_TO_COMPLETE'
        WHEN 'WEATHER_DELAYED' THEN 'WEATHER_DELAYED'
        WHEN 'APPOINTMENT_SUPERSEDED' THEN 'SUPERSEDED'
    END INTO v_state
      FROM medialab_core.appointment_events
     WHERE appointment_id = p_appointment_id
       AND event_type IN ('APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED', 'NO_SHOW',
                          'INACCESSIBLE_PROPERTY', 'UNABLE_TO_COMPLETE', 'WEATHER_DELAYED',
                          'APPOINTMENT_SUPERSEDED')
     ORDER BY occurred_at DESC, id DESC LIMIT 1;
    RETURN v_state;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.check_scheduling_idempotency(
    p_actor_identity_id uuid,
    p_command_type text,
    p_idempotency_key text,
    p_request_sha256 text
)
RETURNS jsonb AS $$
DECLARE
    v_existing medialab_core.scheduling_command_idempotency%ROWTYPE;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'Scheduling idempotency key is invalid' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        p_actor_identity_id::text || ':' || p_command_type || ':' || p_idempotency_key, 0
    ));
    SELECT * INTO v_existing
      FROM medialab_core.scheduling_command_idempotency
     WHERE actor_identity_id = p_actor_identity_id
       AND command_type = p_command_type
       AND idempotency_key = p_idempotency_key;
    IF FOUND AND v_existing.request_sha256 <> p_request_sha256 THEN
        RAISE EXCEPTION 'Idempotency key was already used with a conflicting request fingerprint'
            USING ERRCODE = '23505';
    END IF;
    RETURN CASE WHEN FOUND THEN v_existing.result ELSE NULL END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_scheduling_idempotency(
    p_actor_identity_id uuid,
    p_command_type text,
    p_idempotency_key text,
    p_request_sha256 text,
    p_result jsonb
)
RETURNS void AS $$
BEGIN
    INSERT INTO medialab_core.scheduling_command_idempotency (
        id, actor_identity_id, command_type, idempotency_key, request_sha256, result
    ) VALUES (
        gen_random_uuid(), p_actor_identity_id, p_command_type, p_idempotency_key, p_request_sha256, p_result
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_scheduling_request(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_property_hub_id uuid,
    p_order_id uuid,
    p_source_system text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_request_id uuid := gen_random_uuid();
    v_hash text;
    v_replay jsonb;
    v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    IF NOT medialab_core.actor_is_order_customer(v_actor_identity_id, p_order_id, p_organization_id, true) THEN
        RAISE EXCEPTION 'Only the active Order placer may create a Scheduling Request' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM medialab_core.property_hub_orders
         WHERE property_hub_id = p_property_hub_id
           AND order_id = p_order_id
           AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Scheduling Request Hub, Order, or organization is unavailable' USING ERRCODE = '42501';
    END IF;
    IF p_source_system IS NULL OR p_source_system <> btrim(p_source_system) OR
       p_source_system = '' OR length(p_source_system) > 100 THEN
        RAISE EXCEPTION 'Scheduling source system is invalid' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'organization_id', p_organization_id, 'property_hub_id', p_property_hub_id,
        'order_id', p_order_id, 'source_system', p_source_system
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(
        v_actor_identity_id, 'CREATE_SCHEDULING_REQUEST', p_idempotency_key, v_hash
    );
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'scheduling_request_id')::uuid; END IF;

    INSERT INTO medialab_core.scheduling_requests (
        id, organization_id, property_hub_id, order_id, customer_identity_id,
        created_by_identity_id, creation_mode, source_system, created_at
    ) VALUES (
        v_request_id, p_organization_id, p_property_hub_id, p_order_id,
        v_actor_identity_id, v_actor_identity_id, 'CUSTOMER_DIRECT', p_source_system, v_now
    );
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, occurred_at
    ) VALUES (
        gen_random_uuid(), v_request_id, p_organization_id, 'REQUEST_CREATED',
        v_actor_identity_id, 'AUTHENTICATED_ORDER_PLACER',
        'Customer-created Scheduling Request recorded', p_idempotency_key, v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'CREATE_SCHEDULING_REQUEST', p_idempotency_key, v_hash,
        jsonb_build_object('scheduling_request_id', v_request_id)
    );
    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.add_scheduling_requested_window(
    p_session_token text,
    p_idempotency_key text,
    p_scheduling_request_id uuid,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_iana_timezone text,
    p_local_starts_at timestamp without time zone,
    p_local_ends_at timestamp without time zone
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_request medialab_core.scheduling_requests%ROWTYPE;
    v_window_id uuid := gen_random_uuid();
    v_hash text;
    v_replay jsonb;
    v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = p_scheduling_request_id;
    IF NOT FOUND OR NOT medialab_core.actor_is_order_customer(
        v_actor_identity_id, v_request.order_id, v_request.organization_id, true
    ) THEN RAISE EXCEPTION 'Scheduling Request is unavailable to the authenticated Order placer' USING ERRCODE = '42501'; END IF;
    IF medialab_core.current_scheduling_request_state(v_request.id) <> 'REQUESTED' THEN
        RAISE EXCEPTION 'Requested windows may only be added to an active request' USING ERRCODE = '23514';
    END IF;
    PERFORM medialab_core.validate_scheduling_time_evidence(
        p_starts_at, p_ends_at, p_iana_timezone, p_local_starts_at, p_local_ends_at
    );
    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'request_id', p_scheduling_request_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
        'timezone', p_iana_timezone, 'local_starts_at', p_local_starts_at, 'local_ends_at', p_local_ends_at
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(
        v_actor_identity_id, 'ADD_REQUESTED_WINDOW', p_idempotency_key, v_hash
    );
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'window_id')::uuid; END IF;
    INSERT INTO medialab_core.scheduling_windows (
        id, scheduling_request_id, organization_id, window_kind, starts_at, ends_at,
        iana_timezone, local_starts_at, local_ends_at, recorded_by_identity_id,
        source_system, recorded_at
    ) VALUES (
        v_window_id, v_request.id, v_request.organization_id, 'REQUESTED', p_starts_at, p_ends_at,
        p_iana_timezone, p_local_starts_at, p_local_ends_at, v_actor_identity_id,
        v_request.source_system, v_now
    );
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_request.id, v_request.organization_id, 'REQUESTED_WINDOW_ADDED',
        v_actor_identity_id, 'AUTHENTICATED_ORDER_PLACER', 'Customer requested scheduling window recorded',
        p_idempotency_key, jsonb_build_object('window_id', v_window_id), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'ADD_REQUESTED_WINDOW', p_idempotency_key, v_hash,
        jsonb_build_object('window_id', v_window_id)
    );
    RETURN v_window_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.propose_scheduling_window(
    p_session_token text,
    p_idempotency_key text,
    p_scheduling_request_id uuid,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_iana_timezone text,
    p_local_starts_at timestamp without time zone,
    p_local_ends_at timestamp without time zone,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_request medialab_core.scheduling_requests%ROWTYPE;
    v_window_id uuid := gen_random_uuid();
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = p_scheduling_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling Request is unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_request.organization_id);
    IF medialab_core.current_scheduling_request_state(v_request.id) <> 'REQUESTED' THEN
        RAISE EXCEPTION 'Alternate windows may only be proposed for an active request' USING ERRCODE = '23514'; END IF;
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'Proposal reason is invalid' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.validate_scheduling_time_evidence(
        p_starts_at, p_ends_at, p_iana_timezone, p_local_starts_at, p_local_ends_at
    );
    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'request_id', p_scheduling_request_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
        'timezone', p_iana_timezone, 'local_starts_at', p_local_starts_at,
        'local_ends_at', p_local_ends_at, 'reason', p_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'PROPOSE_WINDOW', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'window_id')::uuid; END IF;
    INSERT INTO medialab_core.scheduling_windows (
        id, scheduling_request_id, organization_id, window_kind, starts_at, ends_at,
        iana_timezone, local_starts_at, local_ends_at, recorded_by_identity_id, source_system, recorded_at
    ) VALUES (
        v_window_id, v_request.id, v_request.organization_id, 'STAFF_PROPOSED', p_starts_at, p_ends_at,
        p_iana_timezone, p_local_starts_at, p_local_ends_at, v_actor_identity_id, v_request.source_system, v_now
    );
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_request.id, v_request.organization_id, 'ALTERNATE_WINDOW_PROPOSED',
        v_actor_identity_id, 'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key,
        jsonb_build_object('window_id', v_window_id), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'PROPOSE_WINDOW', p_idempotency_key, v_hash, jsonb_build_object('window_id', v_window_id)
    );
    RETURN v_window_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.accept_scheduling_proposal(
    p_session_token text,
    p_idempotency_key text,
    p_proposal_window_id uuid,
    p_note text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_window medialab_core.scheduling_windows%ROWTYPE;
    v_request medialab_core.scheduling_requests%ROWTYPE; v_acceptance_id uuid := gen_random_uuid();
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_window FROM medialab_core.scheduling_windows WHERE id = p_proposal_window_id AND window_kind = 'STAFF_PROPOSED';
    IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling proposal is unavailable' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = v_window.scheduling_request_id;
    IF NOT medialab_core.actor_is_order_customer(v_actor_identity_id, v_request.order_id, v_request.organization_id, false) THEN
        RAISE EXCEPTION 'Only an authorized customer-side actor may accept this proposal' USING ERRCODE = '42501'; END IF;
    IF medialab_core.current_scheduling_request_state(v_request.id) <> 'REQUESTED' THEN
        RAISE EXCEPTION 'Proposal is not eligible for acceptance' USING ERRCODE = '23514'; END IF;
    IF p_note IS NOT NULL AND (p_note <> btrim(p_note) OR p_note = '' OR length(p_note) > 1000) THEN
        RAISE EXCEPTION 'Acceptance note is invalid' USING ERRCODE = '22023'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object('proposal_id', p_proposal_window_id, 'note', p_note)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'ACCEPT_PROPOSAL', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'acceptance_id')::uuid; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.scheduling_acceptances WHERE scheduling_request_id = v_request.id) THEN
        RAISE EXCEPTION 'Scheduling Request already has customer acceptance evidence' USING ERRCODE = '23505'; END IF;
    INSERT INTO medialab_core.scheduling_acceptances (
        id, scheduling_request_id, proposal_window_id, organization_id, acceptance_kind,
        accepting_customer_identity_id, recorded_by_identity_id, acceptance_method, attributable_note, accepted_at
    ) VALUES (
        v_acceptance_id, v_request.id, v_window.id, v_request.organization_id, 'CUSTOMER_AUTHENTICATED',
        v_actor_identity_id, v_actor_identity_id, 'AUTHENTICATED_SESSION', p_note, v_now
    );
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_request.id, v_request.organization_id, 'PROPOSAL_ACCEPTED',
        v_actor_identity_id, 'AUTHENTICATED_CUSTOMER_ACCEPTANCE', 'Customer accepted staff proposal',
        p_idempotency_key, jsonb_build_object('proposal_window_id', v_window.id, 'acceptance_id', v_acceptance_id), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'ACCEPT_PROPOSAL', p_idempotency_key, v_hash, jsonb_build_object('acceptance_id', v_acceptance_id)
    );
    RETURN v_acceptance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_scheduling_offline_acceptance(
    p_session_token text,
    p_idempotency_key text,
    p_proposal_window_id uuid,
    p_accepting_customer_identity_id uuid,
    p_acceptance_method text,
    p_note text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_window medialab_core.scheduling_windows%ROWTYPE;
    v_request medialab_core.scheduling_requests%ROWTYPE; v_acceptance_id uuid := gen_random_uuid();
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_window FROM medialab_core.scheduling_windows WHERE id = p_proposal_window_id AND window_kind = 'STAFF_PROPOSED';
    IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling proposal is unavailable' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = v_window.scheduling_request_id;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_request.organization_id);
    IF NOT medialab_core.actor_is_order_customer(
        p_accepting_customer_identity_id, v_request.order_id, v_request.organization_id, false
    ) THEN RAISE EXCEPTION 'Asserted accepting customer lacks customer-side Order authority' USING ERRCODE = '42501'; END IF;
    IF p_acceptance_method NOT IN ('PHONE', 'TEXT', 'EMAIL', 'IN_PERSON', 'OTHER') THEN
        RAISE EXCEPTION 'Offline acceptance method is invalid' USING ERRCODE = '22023'; END IF;
    IF medialab_core.current_scheduling_request_state(v_request.id) <> 'REQUESTED' THEN
        RAISE EXCEPTION 'Proposal is not eligible for acceptance' USING ERRCODE = '23514'; END IF;
    IF p_note IS NOT NULL AND (p_note <> btrim(p_note) OR p_note = '' OR length(p_note) > 1000) THEN
        RAISE EXCEPTION 'Acceptance note is invalid' USING ERRCODE = '22023'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'proposal_id', p_proposal_window_id, 'customer_id', p_accepting_customer_identity_id,
        'method', p_acceptance_method, 'note', p_note
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'RECORD_OFFLINE_ACCEPTANCE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'acceptance_id')::uuid; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.scheduling_acceptances WHERE scheduling_request_id = v_request.id) THEN
        RAISE EXCEPTION 'Scheduling Request already has customer acceptance evidence' USING ERRCODE = '23505'; END IF;
    INSERT INTO medialab_core.scheduling_acceptances (
        id, scheduling_request_id, proposal_window_id, organization_id, acceptance_kind,
        accepting_customer_identity_id, recorded_by_identity_id, acceptance_method, attributable_note, accepted_at
    ) VALUES (
        v_acceptance_id, v_request.id, v_window.id, v_request.organization_id, 'STAFF_RECORDED',
        p_accepting_customer_identity_id, v_actor_identity_id, p_acceptance_method, p_note, v_now
    );
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_request.id, v_request.organization_id, 'PROPOSAL_ACCEPTED',
        v_actor_identity_id, 'STAFF_RECORDED_CUSTOMER_ACCEPTANCE', 'Staff recorded attributable offline customer acceptance',
        p_idempotency_key, jsonb_build_object('proposal_window_id', v_window.id, 'acceptance_id', v_acceptance_id,
        'accepting_customer_identity_id', p_accepting_customer_identity_id, 'method', p_acceptance_method), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'RECORD_OFFLINE_ACCEPTANCE', p_idempotency_key, v_hash,
        jsonb_build_object('acceptance_id', v_acceptance_id)
    );
    RETURN v_acceptance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.withdraw_scheduling_request(
    p_session_token text,
    p_idempotency_key text,
    p_scheduling_request_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_request medialab_core.scheduling_requests%ROWTYPE;
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = p_scheduling_request_id;
    IF NOT FOUND OR NOT medialab_core.actor_is_order_customer(
        v_actor_identity_id, v_request.order_id, v_request.organization_id, true
    ) THEN RAISE EXCEPTION 'Scheduling Request is unavailable to the authenticated Order placer' USING ERRCODE = '42501'; END IF;
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'Withdrawal reason is invalid' USING ERRCODE = '22023'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object('request_id', p_scheduling_request_id, 'reason', p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'WITHDRAW_REQUEST', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'scheduling_request_id')::uuid; END IF;
    IF medialab_core.current_scheduling_request_state(v_request.id) <> 'REQUESTED' OR
       EXISTS (SELECT 1 FROM medialab_core.scheduling_acceptances WHERE scheduling_request_id = v_request.id) OR
       EXISTS (SELECT 1 FROM medialab_core.appointments WHERE scheduling_request_id = v_request.id) THEN
        RAISE EXCEPTION 'Only an unaccepted, unconfirmed active request may be withdrawn' USING ERRCODE = '23514'; END IF;
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, occurred_at
    ) VALUES (
        gen_random_uuid(), v_request.id, v_request.organization_id, 'REQUEST_WITHDRAWN', v_actor_identity_id,
        'AUTHENTICATED_ORDER_PLACER', p_reason, p_idempotency_key, v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'WITHDRAW_REQUEST', p_idempotency_key, v_hash,
        jsonb_build_object('scheduling_request_id', v_request.id)
    );
    RETURN v_request.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.close_scheduling_request(
    p_session_token text,
    p_idempotency_key text,
    p_scheduling_request_id uuid,
    p_close_state text,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_request medialab_core.scheduling_requests%ROWTYPE;
    v_event_type text; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = p_scheduling_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling Request is unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_request.organization_id);
    v_event_type := CASE p_close_state WHEN 'DECLINED' THEN 'REQUEST_DECLINED' WHEN 'CANCELLED' THEN 'REQUEST_CANCELLED' END;
    IF v_event_type IS NULL THEN RAISE EXCEPTION 'Request close state must be DECLINED or CANCELLED' USING ERRCODE = '22023'; END IF;
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'Request close reason is invalid' USING ERRCODE = '22023'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object('request_id', p_scheduling_request_id, 'state', p_close_state, 'reason', p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'CLOSE_REQUEST', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'scheduling_request_id')::uuid; END IF;
    IF medialab_core.current_scheduling_request_state(v_request.id) <> 'REQUESTED' OR
       EXISTS (SELECT 1 FROM medialab_core.appointments WHERE scheduling_request_id = v_request.id) THEN
        RAISE EXCEPTION 'Only an unconfirmed active request may be closed' USING ERRCODE = '23514'; END IF;
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key
    ) VALUES (
        gen_random_uuid(), v_request.id, v_request.organization_id, v_event_type, v_actor_identity_id,
        'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'CLOSE_REQUEST', p_idempotency_key, v_hash,
        jsonb_build_object('scheduling_request_id', v_request.id)
    );
    RETURN v_request.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.confirm_appointment(
    p_session_token text,
    p_idempotency_key text,
    p_scheduling_request_id uuid,
    p_confirmed_window_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_request medialab_core.scheduling_requests%ROWTYPE;
    v_window medialab_core.scheduling_windows%ROWTYPE; v_appointment_id uuid := gen_random_uuid();
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = p_scheduling_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling Request is unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_request.organization_id);
    SELECT * INTO v_window FROM medialab_core.scheduling_windows
     WHERE id = p_confirmed_window_id AND scheduling_request_id = v_request.id AND organization_id = v_request.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Confirmed window does not belong to this Scheduling Request' USING ERRCODE = '42501'; END IF;
    IF v_window.window_kind = 'STAFF_PROPOSED' AND NOT EXISTS (
        SELECT 1 FROM medialab_core.scheduling_acceptances
         WHERE scheduling_request_id = v_request.id AND proposal_window_id = v_window.id
    ) THEN RAISE EXCEPTION 'Staff-proposed window requires attributable customer acceptance before confirmation' USING ERRCODE = '23514'; END IF;
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'Confirmation reason is invalid' USING ERRCODE = '22023'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'request_id', p_scheduling_request_id, 'window_id', p_confirmed_window_id, 'reason', p_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'CONFIRM_APPOINTMENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'appointment_id')::uuid; END IF;
    IF medialab_core.current_scheduling_request_state(v_request.id) <> 'REQUESTED' THEN
        RAISE EXCEPTION 'Only an active Scheduling Request may be confirmed' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.appointments WHERE scheduling_request_id = v_request.id) THEN
        RAISE EXCEPTION 'Scheduling Request already produced its one Appointment' USING ERRCODE = '23505'; END IF;
    INSERT INTO medialab_core.appointments (
        id, scheduling_request_id, organization_id, property_hub_id, order_id, confirmed_window_id,
        starts_at, ends_at, iana_timezone, local_starts_at, local_ends_at,
        confirmed_by_identity_id, source_system, confirmed_at
    ) VALUES (
        v_appointment_id, v_request.id, v_request.organization_id, v_request.property_hub_id,
        v_request.order_id, v_window.id, v_window.starts_at, v_window.ends_at, v_window.iana_timezone,
        v_window.local_starts_at, v_window.local_ends_at, v_actor_identity_id, v_request.source_system, v_now
    );
    INSERT INTO medialab_core.appointment_events (
        id, appointment_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_appointment_id, v_request.organization_id, 'APPOINTMENT_CONFIRMED',
        v_actor_identity_id, 'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key,
        jsonb_build_object('confirmed_window_id', v_window.id), v_now
    );
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_request.id, v_request.organization_id, 'REQUEST_FULFILLED',
        v_actor_identity_id, 'SCHEDULING_STAFF_PERMISSION', 'Scheduling Request fulfilled by one confirmed Appointment',
        p_idempotency_key, jsonb_build_object('appointment_id', v_appointment_id), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'CONFIRM_APPOINTMENT', p_idempotency_key, v_hash,
        jsonb_build_object('appointment_id', v_appointment_id)
    );
    RETURN v_appointment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.assign_appointment_participant(
    p_session_token text,
    p_idempotency_key text,
    p_appointment_id uuid,
    p_person_id uuid,
    p_operational_role text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_appointment medialab_core.appointments%ROWTYPE;
    v_assignment_id uuid := gen_random_uuid(); v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_appointment FROM medialab_core.appointments WHERE id = p_appointment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Appointment is unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_appointment.organization_id);
    IF medialab_core.current_appointment_state(v_appointment.id) NOT IN ('CONFIRMED', 'WEATHER_DELAYED') THEN
        RAISE EXCEPTION 'Participants may only be assigned to a nonterminal Appointment' USING ERRCODE = '23514'; END IF;
    IF p_operational_role NOT IN ('PRIMARY_OPERATOR', 'ADDITIONAL_OPERATOR', 'COORDINATOR') THEN
        RAISE EXCEPTION 'Appointment operational role is invalid' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM medialab_core.memberships m
         WHERE m.person_id = p_person_id AND m.organization_id = v_appointment.organization_id AND m.status = 'ACTIVE'
    ) OR NOT EXISTS (
        SELECT 1 FROM medialab_core.identities i JOIN medialab_core.person_account_states s
          ON s.identity_id = i.id AND s.person_id = i.person_id
         WHERE i.person_id = p_person_id AND i.status = 'ACTIVE' AND s.current_state IN ('ACTIVE', 'RECOVERED')
    ) THEN RAISE EXCEPTION 'Assigned Person is not active in the Appointment organization' USING ERRCODE = '42501'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object('appointment_id', p_appointment_id, 'person_id', p_person_id, 'role', p_operational_role)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'ASSIGN_PARTICIPANT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'assignment_id')::uuid; END IF;
    IF EXISTS (
        SELECT 1 FROM medialab_core.appointment_participant_assignments a
         WHERE a.appointment_id = v_appointment.id AND a.person_id = p_person_id AND a.operational_role = p_operational_role
           AND NOT EXISTS (SELECT 1 FROM medialab_core.appointment_participant_assignment_endings e WHERE e.assignment_id = a.id)
    ) THEN RAISE EXCEPTION 'Person already has this active Appointment assignment' USING ERRCODE = '23505'; END IF;
    INSERT INTO medialab_core.appointment_participant_assignments (
        id, appointment_id, organization_id, person_id, operational_role, assigned_by_identity_id, assigned_at
    ) VALUES (
        v_assignment_id, v_appointment.id, v_appointment.organization_id, p_person_id,
        p_operational_role, v_actor_identity_id, v_now
    );
    INSERT INTO medialab_core.appointment_events (
        id, appointment_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_appointment.id, v_appointment.organization_id, 'PARTICIPANT_ASSIGNED',
        v_actor_identity_id, 'SCHEDULING_STAFF_PERMISSION', 'Appointment participant assigned', p_idempotency_key,
        jsonb_build_object('assignment_id', v_assignment_id, 'person_id', p_person_id, 'operational_role', p_operational_role), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'ASSIGN_PARTICIPANT', p_idempotency_key, v_hash, jsonb_build_object('assignment_id', v_assignment_id)
    );
    RETURN v_assignment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.end_appointment_participant_assignment(
    p_session_token text,
    p_idempotency_key text,
    p_assignment_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_assignment medialab_core.appointment_participant_assignments%ROWTYPE;
    v_ending_id uuid := gen_random_uuid(); v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_assignment FROM medialab_core.appointment_participant_assignments WHERE id = p_assignment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Appointment assignment is unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_assignment.organization_id);
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 500 THEN
        RAISE EXCEPTION 'Assignment ending reason is invalid' USING ERRCODE = '22023'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object('assignment_id', p_assignment_id, 'reason', p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'END_PARTICIPANT_ASSIGNMENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'ending_id')::uuid; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.appointment_participant_assignment_endings WHERE assignment_id = v_assignment.id) THEN
        RAISE EXCEPTION 'Appointment assignment already ended' USING ERRCODE = '23505'; END IF;
    INSERT INTO medialab_core.appointment_participant_assignment_endings (
        id, assignment_id, appointment_id, organization_id, ended_by_identity_id, ending_reason, ended_at
    ) VALUES (
        v_ending_id, v_assignment.id, v_assignment.appointment_id, v_assignment.organization_id,
        v_actor_identity_id, p_reason, v_now
    );
    INSERT INTO medialab_core.appointment_events (
        id, appointment_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_assignment.appointment_id, v_assignment.organization_id, 'PARTICIPANT_ASSIGNMENT_ENDED',
        v_actor_identity_id, 'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key,
        jsonb_build_object('assignment_id', v_assignment.id, 'ending_id', v_ending_id), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'END_PARTICIPANT_ASSIGNMENT', p_idempotency_key, v_hash, jsonb_build_object('ending_id', v_ending_id)
    );
    RETURN v_ending_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.replace_appointment_participant_assignment(
    p_session_token text,
    p_idempotency_key text,
    p_assignment_id uuid,
    p_replacement_person_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_assignment medialab_core.appointment_participant_assignments%ROWTYPE;
    v_new_assignment_id uuid := gen_random_uuid(); v_ending_id uuid := gen_random_uuid();
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_assignment FROM medialab_core.appointment_participant_assignments WHERE id = p_assignment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Appointment assignment is unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_assignment.organization_id);
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 500 THEN
        RAISE EXCEPTION 'Assignment replacement reason is invalid' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM medialab_core.memberships m
         WHERE m.person_id = p_replacement_person_id AND m.organization_id = v_assignment.organization_id AND m.status = 'ACTIVE'
    ) THEN RAISE EXCEPTION 'Replacement Person is not active in the Appointment organization' USING ERRCODE = '42501'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object('assignment_id', p_assignment_id, 'replacement_person_id', p_replacement_person_id, 'reason', p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'REPLACE_PARTICIPANT_ASSIGNMENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'assignment_id')::uuid; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.appointment_participant_assignment_endings WHERE assignment_id = v_assignment.id) THEN
        RAISE EXCEPTION 'Only an active Appointment assignment may be replaced' USING ERRCODE = '23514'; END IF;
    INSERT INTO medialab_core.appointment_participant_assignment_endings (
        id, assignment_id, appointment_id, organization_id, ended_by_identity_id, ending_reason, ended_at
    ) VALUES (
        v_ending_id, v_assignment.id, v_assignment.appointment_id, v_assignment.organization_id,
        v_actor_identity_id, p_reason, v_now
    );
    INSERT INTO medialab_core.appointment_participant_assignments (
        id, appointment_id, organization_id, person_id, operational_role, assigned_by_identity_id, assigned_at
    ) VALUES (
        v_new_assignment_id, v_assignment.appointment_id, v_assignment.organization_id,
        p_replacement_person_id, v_assignment.operational_role, v_actor_identity_id, v_now
    );
    INSERT INTO medialab_core.appointment_events (
        id, appointment_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES (
        gen_random_uuid(), v_assignment.appointment_id, v_assignment.organization_id, 'PARTICIPANT_ASSIGNMENT_REPLACED',
        v_actor_identity_id, 'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key,
        jsonb_build_object('ended_assignment_id', v_assignment.id, 'ending_id', v_ending_id,
        'replacement_assignment_id', v_new_assignment_id, 'replacement_person_id', p_replacement_person_id), v_now
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'REPLACE_PARTICIPANT_ASSIGNMENT', p_idempotency_key, v_hash,
        jsonb_build_object('assignment_id', v_new_assignment_id)
    );
    RETURN v_new_assignment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_appointment_status(
    p_session_token text,
    p_idempotency_key text,
    p_appointment_id uuid,
    p_command_type text,
    p_event_type text,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_appointment medialab_core.appointments%ROWTYPE;
    v_state text; v_hash text; v_replay jsonb; v_event_id uuid := gen_random_uuid();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_appointment FROM medialab_core.appointments WHERE id = p_appointment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Appointment is unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_appointment.organization_id);
    IF p_event_type NOT IN ('APPOINTMENT_CANCELLED', 'NO_SHOW', 'INACCESSIBLE_PROPERTY', 'UNABLE_TO_COMPLETE', 'WEATHER_DELAYED') THEN
        RAISE EXCEPTION 'Appointment status evidence type is invalid' USING ERRCODE = '22023'; END IF;
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'Appointment outcome reason is invalid' USING ERRCODE = '22023'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_object('appointment_id', p_appointment_id, 'event_type', p_event_type, 'reason', p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, p_command_type, p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'event_id')::uuid; END IF;
    v_state := medialab_core.current_appointment_state(v_appointment.id);
    IF v_state NOT IN ('CONFIRMED', 'WEATHER_DELAYED') OR
       (v_state = 'WEATHER_DELAYED' AND p_event_type = 'WEATHER_DELAYED') THEN
        RAISE EXCEPTION 'Appointment transition from % to % is invalid', v_state, p_event_type USING ERRCODE = '23514'; END IF;
    INSERT INTO medialab_core.appointment_events (
        id, appointment_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key
    ) VALUES (
        v_event_id, v_appointment.id, v_appointment.organization_id, p_event_type,
        v_actor_identity_id, 'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key
    );
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, p_command_type, p_idempotency_key, v_hash, jsonb_build_object('event_id', v_event_id)
    );
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.cancel_appointment(text, text, uuid, text)
RETURNS uuid AS $$
    SELECT medialab_core.record_appointment_status($1, $2, $3, 'CANCEL_APPOINTMENT', 'APPOINTMENT_CANCELLED', $4);
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_appointment_no_show(text, text, uuid, text)
RETURNS uuid AS $$
    SELECT medialab_core.record_appointment_status($1, $2, $3, 'RECORD_NO_SHOW', 'NO_SHOW', $4);
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_appointment_unable_to_complete(
    p_session_token text, p_idempotency_key text, p_appointment_id uuid, p_outcome text, p_reason text
)
RETURNS uuid AS $$
BEGIN
    IF p_outcome NOT IN ('INACCESSIBLE_PROPERTY', 'UNABLE_TO_COMPLETE') THEN
        RAISE EXCEPTION 'Operational outcome must be INACCESSIBLE_PROPERTY or UNABLE_TO_COMPLETE' USING ERRCODE = '22023';
    END IF;
    RETURN medialab_core.record_appointment_status(
        p_session_token, p_idempotency_key, p_appointment_id,
        'RECORD_' || p_outcome, p_outcome, p_reason
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_appointment_weather_delay(text, text, uuid, text)
RETURNS uuid AS $$
    SELECT medialab_core.record_appointment_status($1, $2, $3, 'RECORD_WEATHER_DELAY', 'WEATHER_DELAYED', $4);
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.supersede_and_reschedule_appointment(
    p_session_token text,
    p_idempotency_key text,
    p_appointment_id uuid,
    p_accepting_customer_identity_id uuid,
    p_acceptance_method text,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_iana_timezone text,
    p_local_starts_at timestamp without time zone,
    p_local_ends_at timestamp without time zone,
    p_reason text,
    p_note text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_old medialab_core.appointments%ROWTYPE;
    v_old_request medialab_core.scheduling_requests%ROWTYPE;
    v_request_id uuid := gen_random_uuid(); v_window_id uuid := gen_random_uuid();
    v_acceptance_id uuid := gen_random_uuid(); v_appointment_id uuid := gen_random_uuid();
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_old FROM medialab_core.appointments WHERE id = p_appointment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Appointment is unavailable' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_old_request FROM medialab_core.scheduling_requests WHERE id = v_old.scheduling_request_id;
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, v_old.organization_id);
    IF NOT medialab_core.actor_is_order_customer(
        p_accepting_customer_identity_id, v_old.order_id, v_old.organization_id, false
    ) THEN RAISE EXCEPTION 'Asserted accepting customer lacks customer-side Order authority' USING ERRCODE = '42501'; END IF;
    IF p_acceptance_method NOT IN ('PHONE', 'TEXT', 'EMAIL', 'IN_PERSON', 'OTHER') THEN
        RAISE EXCEPTION 'Reschedule acceptance method is invalid' USING ERRCODE = '22023'; END IF;
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'Reschedule reason is invalid' USING ERRCODE = '22023'; END IF;
    IF p_note IS NOT NULL AND (p_note <> btrim(p_note) OR p_note = '' OR length(p_note) > 1000) THEN
        RAISE EXCEPTION 'Reschedule acceptance note is invalid' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.validate_scheduling_time_evidence(
        p_starts_at, p_ends_at, p_iana_timezone, p_local_starts_at, p_local_ends_at
    );
    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'appointment_id', p_appointment_id, 'customer_id', p_accepting_customer_identity_id,
        'method', p_acceptance_method, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
        'timezone', p_iana_timezone, 'local_starts_at', p_local_starts_at,
        'local_ends_at', p_local_ends_at, 'reason', p_reason, 'note', p_note
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_scheduling_idempotency(v_actor_identity_id, 'SUPERSEDE_AND_RESCHEDULE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'appointment_id')::uuid; END IF;
    IF medialab_core.current_appointment_state(v_old.id) NOT IN ('CONFIRMED', 'WEATHER_DELAYED') THEN
        RAISE EXCEPTION 'Only a nonterminal Appointment may be superseded' USING ERRCODE = '23514'; END IF;

    INSERT INTO medialab_core.scheduling_requests (
        id, organization_id, property_hub_id, order_id, customer_identity_id,
        created_by_identity_id, creation_mode, source_system, created_at
    ) VALUES (
        v_request_id, v_old.organization_id, v_old.property_hub_id, v_old.order_id,
        p_accepting_customer_identity_id, v_actor_identity_id, 'STAFF_RESCHEDULE', v_old.source_system, v_now
    );
    INSERT INTO medialab_core.scheduling_windows (
        id, scheduling_request_id, organization_id, window_kind, starts_at, ends_at,
        iana_timezone, local_starts_at, local_ends_at, recorded_by_identity_id, source_system, recorded_at
    ) VALUES (
        v_window_id, v_request_id, v_old.organization_id, 'STAFF_PROPOSED', p_starts_at, p_ends_at,
        p_iana_timezone, p_local_starts_at, p_local_ends_at, v_actor_identity_id, v_old.source_system, v_now
    );
    INSERT INTO medialab_core.scheduling_acceptances (
        id, scheduling_request_id, proposal_window_id, organization_id, acceptance_kind,
        accepting_customer_identity_id, recorded_by_identity_id, acceptance_method, attributable_note, accepted_at
    ) VALUES (
        v_acceptance_id, v_request_id, v_window_id, v_old.organization_id, 'STAFF_RECORDED',
        p_accepting_customer_identity_id, v_actor_identity_id, p_acceptance_method, p_note, v_now
    );
    INSERT INTO medialab_core.appointments (
        id, scheduling_request_id, organization_id, property_hub_id, order_id, confirmed_window_id,
        starts_at, ends_at, iana_timezone, local_starts_at, local_ends_at,
        confirmed_by_identity_id, source_system, confirmed_at
    ) VALUES (
        v_appointment_id, v_request_id, v_old.organization_id, v_old.property_hub_id, v_old.order_id,
        v_window_id, p_starts_at, p_ends_at, p_iana_timezone, p_local_starts_at, p_local_ends_at,
        v_actor_identity_id, v_old.source_system, v_now
    );
    INSERT INTO medialab_core.scheduling_request_events (
        id, scheduling_request_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, evidence, occurred_at
    ) VALUES
        (gen_random_uuid(), v_request_id, v_old.organization_id, 'REQUEST_CREATED', v_actor_identity_id,
         'STAFF_RESCHEDULE_WITH_CUSTOMER_ACCEPTANCE', 'Replacement Scheduling Request created', p_idempotency_key,
         jsonb_build_object('superseded_appointment_id', v_old.id), v_now),
        (gen_random_uuid(), v_request_id, v_old.organization_id, 'ALTERNATE_WINDOW_PROPOSED', v_actor_identity_id,
         'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key, jsonb_build_object('window_id', v_window_id), v_now),
        (gen_random_uuid(), v_request_id, v_old.organization_id, 'PROPOSAL_ACCEPTED', v_actor_identity_id,
         'STAFF_RECORDED_CUSTOMER_ACCEPTANCE', 'Staff recorded attributable reschedule acceptance', p_idempotency_key,
         jsonb_build_object('acceptance_id', v_acceptance_id, 'accepting_customer_identity_id', p_accepting_customer_identity_id,
         'method', p_acceptance_method), v_now),
        (gen_random_uuid(), v_request_id, v_old.organization_id, 'REQUEST_FULFILLED', v_actor_identity_id,
         'SCHEDULING_STAFF_PERMISSION', 'Replacement request fulfilled by replacement Appointment', p_idempotency_key,
         jsonb_build_object('appointment_id', v_appointment_id), v_now);
    INSERT INTO medialab_core.appointment_events (
        id, appointment_id, organization_id, event_type, actor_identity_id,
        authority_context, reason, idempotency_key, replacement_appointment_id, evidence, occurred_at
    ) VALUES
        (gen_random_uuid(), v_appointment_id, v_old.organization_id, 'APPOINTMENT_CONFIRMED', v_actor_identity_id,
         'SCHEDULING_STAFF_PERMISSION', 'Replacement Appointment confirmed', p_idempotency_key, NULL,
         jsonb_build_object('confirmed_window_id', v_window_id), v_now),
        (gen_random_uuid(), v_old.id, v_old.organization_id, 'APPOINTMENT_SUPERSEDED', v_actor_identity_id,
         'SCHEDULING_STAFF_PERMISSION', p_reason, p_idempotency_key, v_appointment_id,
         jsonb_build_object('replacement_request_id', v_request_id), v_now + interval '1 microsecond');
    PERFORM medialab_core.record_scheduling_idempotency(
        v_actor_identity_id, 'SUPERSEDE_AND_RESCHEDULE', p_idempotency_key, v_hash,
        jsonb_build_object('appointment_id', v_appointment_id, 'scheduling_request_id', v_request_id)
    );
    RETURN v_appointment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.actor_can_read_scheduling(
    p_actor_identity_id uuid,
    p_organization_id uuid,
    p_property_hub_id uuid,
    p_order_id uuid
)
RETURNS boolean AS $$
DECLARE v_person_id uuid;
BEGIN
    IF medialab_core.actor_is_order_customer(p_actor_identity_id, p_order_id, p_organization_id, false) OR
       medialab_core.actor_has_permission(p_actor_identity_id, p_organization_id, 'scheduling.staff.manage') OR
       medialab_core.actor_has_permission(p_actor_identity_id, p_organization_id, 'scheduling.read') THEN
        RETURN true;
    END IF;
    SELECT person_id INTO v_person_id FROM medialab_core.identities WHERE id = p_actor_identity_id AND status = 'ACTIVE';
    RETURN EXISTS (
        SELECT 1 FROM medialab_core.property_hub_participants hp
        JOIN medialab_core.memberships m ON m.id = hp.membership_id AND m.organization_id = hp.organization_id
        WHERE hp.property_hub_id = p_property_hub_id AND hp.organization_id = p_organization_id
          AND m.person_id = v_person_id AND m.status = 'ACTIVE'
    ) AND medialab_core.actor_has_permission(p_actor_identity_id, p_organization_id, 'property_hub.read');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_scheduling_request_record(
    p_session_token text, p_scheduling_request_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor_identity_id uuid; v_request medialab_core.scheduling_requests%ROWTYPE; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_request FROM medialab_core.scheduling_requests WHERE id = p_scheduling_request_id;
    IF NOT FOUND OR NOT medialab_core.actor_can_read_scheduling(
        v_actor_identity_id, v_request.organization_id, v_request.property_hub_id, v_request.order_id
    ) THEN RAISE EXCEPTION 'Scheduling Request is missing or unavailable' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object(
        'scheduling_request', to_jsonb(v_request),
        'current_state', medialab_core.current_scheduling_request_state(v_request.id),
        'windows', COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.recorded_at, w.id)
                              FROM medialab_core.scheduling_windows w WHERE w.scheduling_request_id = v_request.id), '[]'::jsonb),
        'acceptances', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.accepted_at, a.id)
                                  FROM medialab_core.scheduling_acceptances a WHERE a.scheduling_request_id = v_request.id), '[]'::jsonb),
        'appointments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.confirmed_at, a.id)
                                   FROM medialab_core.appointments a WHERE a.scheduling_request_id = v_request.id), '[]'::jsonb),
        'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at, e.id)
                            FROM medialab_core.scheduling_request_events e WHERE e.scheduling_request_id = v_request.id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_appointment_record(
    p_session_token text, p_appointment_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor_identity_id uuid; v_appointment medialab_core.appointments%ROWTYPE; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_appointment FROM medialab_core.appointments WHERE id = p_appointment_id;
    IF NOT FOUND OR NOT medialab_core.actor_can_read_scheduling(
        v_actor_identity_id, v_appointment.organization_id, v_appointment.property_hub_id, v_appointment.order_id
    ) THEN RAISE EXCEPTION 'Appointment is missing or unavailable' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object(
        'appointment', to_jsonb(v_appointment),
        'current_state', medialab_core.current_appointment_state(v_appointment.id),
        'assignments', COALESCE((
            SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object(
                'ending', (SELECT to_jsonb(e) FROM medialab_core.appointment_participant_assignment_endings e WHERE e.assignment_id = a.id)
            ) ORDER BY a.assigned_at, a.id)
            FROM medialab_core.appointment_participant_assignments a WHERE a.appointment_id = v_appointment.id
        ), '[]'::jsonb),
        'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at, e.id)
                            FROM medialab_core.appointment_events e WHERE e.appointment_id = v_appointment.id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER scheduling_windows_time_guard
    BEFORE INSERT ON medialab_core.scheduling_windows
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_scheduling_window_time();

CREATE TRIGGER scheduling_requests_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.scheduling_requests
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER scheduling_windows_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.scheduling_windows
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER scheduling_acceptances_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.scheduling_acceptances
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER appointments_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.appointments
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER appointment_assignments_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.appointment_participant_assignments
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER appointment_assignment_endings_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.appointment_participant_assignment_endings
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER scheduling_external_references_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.scheduling_external_references
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER scheduling_command_idempotency_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.scheduling_command_idempotency
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER scheduling_request_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.scheduling_request_events
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();
CREATE TRIGGER appointment_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.appointment_events
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_scheduling_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.scheduling_requests FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.scheduling_windows FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.scheduling_acceptances FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.appointments FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.appointment_participant_assignments FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.appointment_participant_assignment_endings FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.scheduling_external_references FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.scheduling_command_idempotency FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.scheduling_request_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.appointment_events FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_scheduling_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_scheduling_time_evidence(timestamptz, timestamptz, text, timestamp without time zone, timestamp without time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_scheduling_window_time() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.actor_has_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_scheduling_staff(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.actor_is_order_customer(uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.current_scheduling_request_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.current_appointment_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.check_scheduling_idempotency(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_scheduling_idempotency(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_appointment_status(text, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.actor_can_read_scheduling(uuid, uuid, uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.create_scheduling_request(text, text, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.add_scheduling_requested_window(text, text, uuid, timestamptz, timestamptz, text, timestamp without time zone, timestamp without time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.propose_scheduling_window(text, text, uuid, timestamptz, timestamptz, text, timestamp without time zone, timestamp without time zone, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.accept_scheduling_proposal(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_scheduling_offline_acceptance(text, text, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.withdraw_scheduling_request(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.close_scheduling_request(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.confirm_appointment(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.assign_appointment_participant(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.end_appointment_participant_assignment(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.replace_appointment_participant_assignment(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.cancel_appointment(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_appointment_no_show(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_appointment_unable_to_complete(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_appointment_weather_delay(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.supersede_and_reschedule_appointment(text, text, uuid, uuid, text, timestamptz, timestamptz, text, timestamp without time zone, timestamp without time zone, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_scheduling_request_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_appointment_record(text, uuid) FROM PUBLIC;
