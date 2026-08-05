ALTER TABLE medialab_core.order_items
    ADD CONSTRAINT order_items_id_order_key UNIQUE (id, order_id);

ALTER TABLE medialab_core.appointments
    ADD CONSTRAINT appointments_id_organization_order_key UNIQUE (id, organization_id, order_id);

CREATE TABLE medialab_core.jobs (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL,
    property_hub_id uuid NULL,
    current_state text NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (order_id, organization_id)
        REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (property_hub_id, organization_id)
        REFERENCES medialab_core.property_hubs(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT jobs_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT jobs_id_organization_order_key UNIQUE (id, organization_id, order_id),
    CONSTRAINT jobs_state_check CHECK (current_state IN (
        'DRAFT', 'READY', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED'
    )),
    CONSTRAINT jobs_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE TABLE medialab_core.service_workstreams (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    order_id uuid NOT NULL,
    source_order_item_id uuid NOT NULL,
    current_state text NOT NULL,
    frozen_source_description text NOT NULL,
    frozen_source_quantity numeric(12,3) NOT NULL,
    frozen_source_commercial_unit text NOT NULL,
    frozen_source_item_kind text NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id, order_id)
        REFERENCES medialab_core.jobs(id, organization_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_order_item_id, order_id)
        REFERENCES medialab_core.order_items(id, order_id) ON DELETE RESTRICT,
    CONSTRAINT service_workstreams_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT service_workstreams_id_job_org_key UNIQUE (id, job_id, organization_id),
    CONSTRAINT service_workstreams_state_check CHECK (current_state IN (
        'PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'
    )),
    CONSTRAINT service_workstreams_description_check CHECK (
        frozen_source_description = btrim(frozen_source_description) AND
        frozen_source_description <> '' AND length(frozen_source_description) <= 500
    ),
    CONSTRAINT service_workstreams_quantity_check CHECK (frozen_source_quantity > 0),
    CONSTRAINT service_workstreams_unit_check CHECK (
        frozen_source_commercial_unit = btrim(frozen_source_commercial_unit) AND
        frozen_source_commercial_unit <> '' AND length(frozen_source_commercial_unit) <= 80
    ),
    CONSTRAINT service_workstreams_kind_check CHECK (frozen_source_item_kind IN ('CATALOG', 'CUSTOM')),
    CONSTRAINT service_workstreams_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE TABLE medialab_core.job_appointments (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    order_id uuid NOT NULL,
    linked_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id, order_id)
        REFERENCES medialab_core.jobs(id, organization_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (appointment_id, organization_id, order_id)
        REFERENCES medialab_core.appointments(id, organization_id, order_id) ON DELETE RESTRICT,
    CONSTRAINT job_appointments_job_appointment_key UNIQUE (job_id, appointment_id),
    CONSTRAINT job_appointments_id_job_org_key UNIQUE (id, job_id, organization_id)
);

CREATE TABLE medialab_core.job_service_external_references (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NULL,
    service_workstream_id uuid NULL,
    provider text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    provenance text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT job_service_external_references_subject_check CHECK (
        (job_id IS NOT NULL AND service_workstream_id IS NULL) OR
        (job_id IS NULL AND service_workstream_id IS NOT NULL)
    ),
    CONSTRAINT job_service_external_references_provider_check CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT job_service_external_references_type_check CHECK (external_record_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT job_service_external_references_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND external_identifier <> '' AND length(external_identifier) <= 200
    ),
    CONSTRAINT job_service_external_references_provenance_check CHECK (
        provenance = btrim(provenance) AND provenance <> '' AND length(provenance) <= 500
    ),
    CONSTRAINT job_service_external_references_source_key
        UNIQUE (organization_id, provider, external_record_type, external_identifier)
);

CREATE TABLE medialab_core.job_service_command_idempotency (
    id uuid PRIMARY KEY,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT job_service_command_idempotency_command_check CHECK (command_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT job_service_command_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT job_service_command_idempotency_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT job_service_command_idempotency_result_check CHECK (jsonb_typeof(result) = 'object'),
    CONSTRAINT job_service_command_idempotency_actor_command_key
        UNIQUE (actor_identity_id, command_type, idempotency_key)
);

CREATE TABLE medialab_core.job_events (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_state text NULL,
    resulting_state text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authority_context text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    related_appointment_id uuid NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (related_appointment_id, organization_id)
        REFERENCES medialab_core.appointments(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT job_events_type_check CHECK (event_type IN (
        'JOB_CREATED', 'JOB_STATE_CHANGED', 'JOB_CANCELLED', 'JOB_COMPLETED',
        'APPOINTMENT_LINKED', 'EXTERNAL_REFERENCE_RECORDED'
    )),
    CONSTRAINT job_events_previous_state_check CHECK (
        previous_state IS NULL OR previous_state IN ('DRAFT', 'READY', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED')
    ),
    CONSTRAINT job_events_resulting_state_check CHECK (
        resulting_state IN ('DRAFT', 'READY', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED')
    ),
    CONSTRAINT job_events_authority_check CHECK (
        authority_context = btrim(authority_context) AND authority_context <> '' AND length(authority_context) <= 200
    ),
    CONSTRAINT job_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT job_events_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT job_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.service_workstream_events (
    id uuid PRIMARY KEY,
    service_workstream_id uuid NOT NULL,
    job_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    order_id uuid NOT NULL,
    source_order_item_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_state text NULL,
    resulting_state text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authority_context text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_order_item_id, order_id) REFERENCES medialab_core.order_items(id, order_id) ON DELETE RESTRICT,
    CONSTRAINT service_workstream_events_order_evidence_check CHECK ((evidence->>'order_id') IS NOT NULL),
    CONSTRAINT service_workstream_events_type_check CHECK (event_type IN (
        'WORKSTREAM_CREATED', 'WORKSTREAM_STATE_CHANGED', 'WORKSTREAM_CANCELLED',
        'WORKSTREAM_COMPLETED', 'EXTERNAL_REFERENCE_RECORDED'
    )),
    CONSTRAINT service_workstream_events_previous_state_check CHECK (
        previous_state IS NULL OR previous_state IN ('PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED')
    ),
    CONSTRAINT service_workstream_events_resulting_state_check CHECK (
        resulting_state IN ('PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED')
    ),
    CONSTRAINT service_workstream_events_authority_check CHECK (
        authority_context = btrim(authority_context) AND authority_context <> '' AND length(authority_context) <= 200
    ),
    CONSTRAINT service_workstream_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT service_workstream_events_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT service_workstream_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE INDEX jobs_order_created_idx ON medialab_core.jobs (order_id, created_at, id);
CREATE INDEX jobs_hub_created_idx ON medialab_core.jobs (property_hub_id, created_at, id) WHERE property_hub_id IS NOT NULL;
CREATE INDEX service_workstreams_job_created_idx ON medialab_core.service_workstreams (job_id, created_at, id);
CREATE INDEX service_workstreams_order_item_idx ON medialab_core.service_workstreams (source_order_item_id, created_at, id);
CREATE INDEX job_appointments_job_idx ON medialab_core.job_appointments (job_id, linked_at, id);
CREATE INDEX job_events_job_idx ON medialab_core.job_events (job_id, occurred_at, id);
CREATE INDEX service_workstream_events_workstream_idx
    ON medialab_core.service_workstream_events (service_workstream_id, occurred_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_job_service_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are append-only: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_job_update()
RETURNS trigger AS $$
BEGIN
    IF OLD.id IS DISTINCT FROM NEW.id OR
       OLD.organization_id IS DISTINCT FROM NEW.organization_id OR
       OLD.order_id IS DISTINCT FROM NEW.order_id OR
       OLD.property_hub_id IS DISTINCT FROM NEW.property_hub_id OR
       OLD.source_system IS DISTINCT FROM NEW.source_system OR
       OLD.created_by_identity_id IS DISTINCT FROM NEW.created_by_identity_id OR
       OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Job commercial and relationship evidence is immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.current_state IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Terminal Job state cannot be reopened' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_service_workstream_update()
RETURNS trigger AS $$
BEGIN
    IF OLD.id IS DISTINCT FROM NEW.id OR OLD.job_id IS DISTINCT FROM NEW.job_id OR
       OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.order_id IS DISTINCT FROM NEW.order_id OR
       OLD.source_order_item_id IS DISTINCT FROM NEW.source_order_item_id OR
       OLD.frozen_source_description IS DISTINCT FROM NEW.frozen_source_description OR
       OLD.frozen_source_quantity IS DISTINCT FROM NEW.frozen_source_quantity OR
       OLD.frozen_source_commercial_unit IS DISTINCT FROM NEW.frozen_source_commercial_unit OR
       OLD.frozen_source_item_kind IS DISTINCT FROM NEW.frozen_source_item_kind OR
       OLD.source_system IS DISTINCT FROM NEW.source_system OR
       OLD.created_by_identity_id IS DISTINCT FROM NEW.created_by_identity_id OR
       OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Service Workstream source and relationship evidence is immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.current_state IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Terminal Service Workstream state cannot be reopened' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_job_service_permission(
    p_actor_identity_id uuid,
    p_organization_id uuid,
    p_permission_code text
)
RETURNS void AS $$
BEGIN
    IF NOT medialab_core.actor_has_permission(p_actor_identity_id, p_organization_id, p_permission_code) THEN
        RAISE EXCEPTION 'Actor lacks active % authority for the target organization', p_permission_code
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.check_job_service_idempotency(
    p_actor_identity_id uuid,
    p_command_type text,
    p_idempotency_key text,
    p_request_sha256 text
)
RETURNS jsonb AS $$
DECLARE v_record medialab_core.job_service_command_idempotency%ROWTYPE;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'A bounded idempotency key is required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_actor_identity_id::text || ':' || p_command_type || ':' || p_idempotency_key, 0)
    );
    SELECT * INTO v_record FROM medialab_core.job_service_command_idempotency
     WHERE actor_identity_id = p_actor_identity_id
       AND command_type = p_command_type
       AND idempotency_key = p_idempotency_key;
    IF FOUND AND v_record.request_sha256 <> p_request_sha256 THEN
        RAISE EXCEPTION 'Idempotency key conflicts with a different request fingerprint' USING ERRCODE = '22023';
    END IF;
    RETURN CASE WHEN FOUND THEN v_record.result ELSE NULL END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_job_service_idempotency(
    p_actor_identity_id uuid,
    p_command_type text,
    p_idempotency_key text,
    p_request_sha256 text,
    p_result jsonb
)
RETURNS void AS $$
BEGIN
    INSERT INTO medialab_core.job_service_command_idempotency
        (id, actor_identity_id, command_type, idempotency_key, request_sha256, result)
    VALUES (gen_random_uuid(), p_actor_identity_id, p_command_type, p_idempotency_key, p_request_sha256, p_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_job(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_order_id uuid,
    p_property_hub_id uuid,
    p_source_system text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_job_id uuid; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_job_service_permission(v_actor_identity_id, p_organization_id, 'job.manage');
    IF NOT EXISTS (SELECT 1 FROM medialab_core.orders WHERE id = p_order_id AND organization_id = p_organization_id AND current_state = 'ACCEPTED') THEN
        RAISE EXCEPTION 'Accepted Order is missing or outside the target organization' USING ERRCODE = '42501';
    END IF;
    IF p_property_hub_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.property_hub_orders
         WHERE property_hub_id = p_property_hub_id AND organization_id = p_organization_id AND order_id = p_order_id
    ) THEN
        RAISE EXCEPTION 'Property Hub is not related to the target Order and organization' USING ERRCODE = '42501';
    END IF;
    IF p_source_system IS NULL OR p_source_system <> btrim(p_source_system) OR p_source_system = '' OR length(p_source_system) > 100 THEN
        RAISE EXCEPTION 'A bounded provider-neutral source system is required' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_organization_id, p_order_id, p_property_hub_id, p_source_system
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_job_service_idempotency(v_actor_identity_id, 'CREATE_JOB', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'job_id')::uuid; END IF;
    v_job_id := gen_random_uuid();
    INSERT INTO medialab_core.jobs
        (id, organization_id, order_id, property_hub_id, current_state, source_system, created_by_identity_id, created_at, updated_at)
    VALUES (v_job_id, p_organization_id, p_order_id, p_property_hub_id, 'DRAFT', p_source_system, v_actor_identity_id, v_now, v_now);
    INSERT INTO medialab_core.job_events
        (id, job_id, organization_id, event_type, previous_state, resulting_state, actor_identity_id,
         authority_context, reason, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), v_job_id, p_organization_id, 'JOB_CREATED', NULL, 'DRAFT', v_actor_identity_id,
            'JOB_MANAGE_PERMISSION', 'Canonical Job created from accepted Order evidence', p_idempotency_key,
            jsonb_build_object('order_id', p_order_id, 'property_hub_id', p_property_hub_id, 'source_system', p_source_system), v_now);
    PERFORM medialab_core.record_job_service_idempotency(
        v_actor_identity_id, 'CREATE_JOB', p_idempotency_key, v_hash, jsonb_build_object('job_id', v_job_id)
    );
    RETURN v_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_service_workstream(
    p_session_token text,
    p_idempotency_key text,
    p_job_id uuid,
    p_source_order_item_id uuid,
    p_source_system text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_job medialab_core.jobs%ROWTYPE; v_item medialab_core.order_items%ROWTYPE;
    v_workstream_id uuid; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_job_service_permission(v_actor_identity_id, v_job.organization_id, 'job.manage');
    IF v_job.current_state IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cannot add a Workstream to a terminal Job' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_item FROM medialab_core.order_items
     WHERE id = p_source_order_item_id AND order_id = v_job.order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order Item is not immutable evidence for the Job Order' USING ERRCODE = '42501';
    END IF;
    IF p_source_system IS NULL OR p_source_system <> btrim(p_source_system) OR p_source_system = '' OR length(p_source_system) > 100 THEN
        RAISE EXCEPTION 'A bounded provider-neutral source system is required' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_job_id, p_source_order_item_id, p_source_system
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_job_service_idempotency(v_actor_identity_id, 'CREATE_WORKSTREAM', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'service_workstream_id')::uuid; END IF;
    v_workstream_id := gen_random_uuid();
    INSERT INTO medialab_core.service_workstreams
        (id, job_id, organization_id, order_id, source_order_item_id, current_state,
         frozen_source_description, frozen_source_quantity, frozen_source_commercial_unit,
         frozen_source_item_kind, source_system, created_by_identity_id, created_at, updated_at)
    VALUES (v_workstream_id, v_job.id, v_job.organization_id, v_job.order_id, v_item.id, 'PENDING',
            v_item.frozen_description, v_item.quantity, v_item.commercial_unit, v_item.item_kind,
            p_source_system, v_actor_identity_id, v_now, v_now);
    INSERT INTO medialab_core.service_workstream_events
        (id, service_workstream_id, job_id, organization_id, order_id, source_order_item_id, event_type,
         previous_state, resulting_state, actor_identity_id, authority_context, reason,
         idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), v_workstream_id, v_job.id, v_job.organization_id, v_job.order_id, v_item.id, 'WORKSTREAM_CREATED',
            NULL, 'PENDING', v_actor_identity_id, 'JOB_MANAGE_PERMISSION',
            'Service Workstream created from immutable accepted Order Item evidence', p_idempotency_key,
            jsonb_build_object('order_id', v_job.order_id, 'source_order_item_id', v_item.id,
              'frozen_source_description', v_item.frozen_description, 'frozen_source_quantity', v_item.quantity,
              'frozen_source_commercial_unit', v_item.commercial_unit, 'frozen_source_item_kind', v_item.item_kind), v_now);
    PERFORM medialab_core.record_job_service_idempotency(
        v_actor_identity_id, 'CREATE_WORKSTREAM', p_idempotency_key, v_hash,
        jsonb_build_object('service_workstream_id', v_workstream_id)
    );
    RETURN v_workstream_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.link_job_appointment(
    p_session_token text,
    p_idempotency_key text,
    p_job_id uuid,
    p_appointment_id uuid,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_job medialab_core.jobs%ROWTYPE; v_appointment medialab_core.appointments%ROWTYPE;
    v_link_id uuid; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_job_service_permission(v_actor_identity_id, v_job.organization_id, 'job.manage');
    SELECT * INTO v_appointment FROM medialab_core.appointments
     WHERE id = p_appointment_id AND organization_id = v_job.organization_id AND order_id = v_job.order_id;
    IF NOT FOUND OR (v_job.property_hub_id IS NOT NULL AND v_appointment.property_hub_id <> v_job.property_hub_id) THEN
        RAISE EXCEPTION 'Appointment is unrelated to the Job Order, Hub, or organization' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'An attributable bounded reason is required' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_job_id, p_appointment_id, p_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_job_service_idempotency(v_actor_identity_id, 'LINK_JOB_APPOINTMENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'job_appointment_id')::uuid; END IF;
    v_link_id := gen_random_uuid();
    INSERT INTO medialab_core.job_appointments
        (id, job_id, appointment_id, organization_id, order_id, linked_by_identity_id, linked_at)
    VALUES (v_link_id, v_job.id, v_appointment.id, v_job.organization_id, v_job.order_id, v_actor_identity_id, v_now);
    INSERT INTO medialab_core.job_events
        (id, job_id, organization_id, event_type, previous_state, resulting_state, actor_identity_id,
         authority_context, reason, idempotency_key, related_appointment_id, evidence, occurred_at)
    VALUES (gen_random_uuid(), v_job.id, v_job.organization_id, 'APPOINTMENT_LINKED', v_job.current_state,
            v_job.current_state, v_actor_identity_id, 'JOB_MANAGE_PERMISSION', p_reason, p_idempotency_key,
            v_appointment.id, jsonb_build_object('order_id', v_job.order_id, 'appointment_id', v_appointment.id), v_now);
    PERFORM medialab_core.record_job_service_idempotency(
        v_actor_identity_id, 'LINK_JOB_APPOINTMENT', p_idempotency_key, v_hash,
        jsonb_build_object('job_appointment_id', v_link_id)
    );
    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.transition_job_state(
    p_session_token text,
    p_idempotency_key text,
    p_job_id uuid,
    p_target_state text,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_job medialab_core.jobs%ROWTYPE; v_hash text; v_replay jsonb;
    v_event_id uuid; v_event_type text; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_job_service_permission(v_actor_identity_id, v_job.organization_id, 'job.manage');
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'An attributable bounded reason is required' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_job_id, p_target_state, p_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_job_service_idempotency(v_actor_identity_id, 'TRANSITION_JOB_STATE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'event_id')::uuid; END IF;
    IF NOT ((v_job.current_state = 'DRAFT' AND p_target_state IN ('READY', 'CANCELLED')) OR
            (v_job.current_state = 'READY' AND p_target_state IN ('ACTIVE', 'BLOCKED', 'CANCELLED')) OR
            (v_job.current_state = 'ACTIVE' AND p_target_state IN ('BLOCKED', 'COMPLETED', 'CANCELLED')) OR
            (v_job.current_state = 'BLOCKED' AND p_target_state IN ('READY', 'ACTIVE', 'CANCELLED'))) THEN
        RAISE EXCEPTION 'Invalid Job lifecycle transition from % to %', v_job.current_state, p_target_state USING ERRCODE = '22023';
    END IF;
    IF p_target_state = 'READY' AND NOT EXISTS (
        SELECT 1 FROM medialab_core.service_workstreams WHERE job_id = v_job.id
    ) THEN RAISE EXCEPTION 'A Job requires at least one Workstream before becoming ready' USING ERRCODE = '22023'; END IF;
    IF p_target_state = 'COMPLETED' AND EXISTS (
        SELECT 1 FROM medialab_core.service_workstreams
         WHERE job_id = v_job.id AND current_state NOT IN ('COMPLETED', 'CANCELLED')
    ) THEN RAISE EXCEPTION 'Job completion requires every Workstream to be terminal' USING ERRCODE = '22023'; END IF;
    v_event_type := CASE p_target_state WHEN 'COMPLETED' THEN 'JOB_COMPLETED' WHEN 'CANCELLED' THEN 'JOB_CANCELLED' ELSE 'JOB_STATE_CHANGED' END;
    v_event_id := gen_random_uuid();
    UPDATE medialab_core.jobs SET current_state = p_target_state, updated_at = v_now WHERE id = v_job.id;
    INSERT INTO medialab_core.job_events
        (id, job_id, organization_id, event_type, previous_state, resulting_state, actor_identity_id,
         authority_context, reason, idempotency_key, evidence, occurred_at)
    VALUES (v_event_id, v_job.id, v_job.organization_id, v_event_type, v_job.current_state, p_target_state,
            v_actor_identity_id, 'JOB_MANAGE_PERMISSION', p_reason, p_idempotency_key,
            jsonb_build_object('order_id', v_job.order_id), v_now);
    PERFORM medialab_core.record_job_service_idempotency(
        v_actor_identity_id, 'TRANSITION_JOB_STATE', p_idempotency_key, v_hash, jsonb_build_object('event_id', v_event_id)
    );
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.transition_service_workstream_state(
    p_session_token text,
    p_idempotency_key text,
    p_service_workstream_id uuid,
    p_target_state text,
    p_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_workstream medialab_core.service_workstreams%ROWTYPE; v_hash text; v_replay jsonb;
    v_event_id uuid; v_event_type text; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workstream FROM medialab_core.service_workstreams WHERE id = p_service_workstream_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service Workstream is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_job_service_permission(v_actor_identity_id, v_workstream.organization_id, 'job.manage');
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'An attributable bounded reason is required' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_service_workstream_id, p_target_state, p_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_job_service_idempotency(v_actor_identity_id, 'TRANSITION_WORKSTREAM_STATE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'event_id')::uuid; END IF;
    IF NOT ((v_workstream.current_state = 'PENDING' AND p_target_state IN ('READY', 'CANCELLED')) OR
            (v_workstream.current_state = 'READY' AND p_target_state IN ('IN_PROGRESS', 'BLOCKED', 'CANCELLED')) OR
            (v_workstream.current_state = 'IN_PROGRESS' AND p_target_state IN ('BLOCKED', 'COMPLETED', 'CANCELLED')) OR
            (v_workstream.current_state = 'BLOCKED' AND p_target_state IN ('READY', 'IN_PROGRESS', 'CANCELLED'))) THEN
        RAISE EXCEPTION 'Invalid Service Workstream lifecycle transition from % to %', v_workstream.current_state, p_target_state USING ERRCODE = '22023';
    END IF;
    v_event_type := CASE p_target_state WHEN 'COMPLETED' THEN 'WORKSTREAM_COMPLETED' WHEN 'CANCELLED' THEN 'WORKSTREAM_CANCELLED' ELSE 'WORKSTREAM_STATE_CHANGED' END;
    v_event_id := gen_random_uuid();
    UPDATE medialab_core.service_workstreams SET current_state = p_target_state, updated_at = v_now WHERE id = v_workstream.id;
    INSERT INTO medialab_core.service_workstream_events
        (id, service_workstream_id, job_id, organization_id, order_id, source_order_item_id, event_type,
         previous_state, resulting_state, actor_identity_id, authority_context, reason,
         idempotency_key, evidence, occurred_at)
    VALUES (v_event_id, v_workstream.id, v_workstream.job_id, v_workstream.organization_id,
            v_workstream.order_id, v_workstream.source_order_item_id, v_event_type, v_workstream.current_state, p_target_state,
            v_actor_identity_id, 'JOB_MANAGE_PERMISSION', p_reason, p_idempotency_key,
            jsonb_build_object('order_id', v_workstream.order_id, 'source_order_item_id', v_workstream.source_order_item_id), v_now);
    PERFORM medialab_core.record_job_service_idempotency(
        v_actor_identity_id, 'TRANSITION_WORKSTREAM_STATE', p_idempotency_key, v_hash, jsonb_build_object('event_id', v_event_id)
    );
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_job_service_external_reference(
    p_session_token text,
    p_idempotency_key text,
    p_job_id uuid,
    p_service_workstream_id uuid,
    p_provider text,
    p_external_record_type text,
    p_external_identifier text,
    p_provenance text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid; v_organization_id uuid; v_subject_state text; v_source_order_item_id uuid;
    v_reference_id uuid; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    IF (p_job_id IS NULL) = (p_service_workstream_id IS NULL) THEN
        RAISE EXCEPTION 'Exactly one Job or Service Workstream subject is required' USING ERRCODE = '22023';
    END IF;
    IF p_job_id IS NOT NULL THEN
        SELECT organization_id, current_state INTO v_organization_id, v_subject_state FROM medialab_core.jobs WHERE id = p_job_id;
    ELSE
        SELECT organization_id, current_state, source_order_item_id INTO v_organization_id, v_subject_state, v_source_order_item_id
          FROM medialab_core.service_workstreams WHERE id = p_service_workstream_id;
    END IF;
    IF v_organization_id IS NULL THEN RAISE EXCEPTION 'External reference subject is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_job_service_permission(v_actor_identity_id, v_organization_id, 'job.manage');
    IF p_provider !~ '^[A-Z][A-Z0-9_]{1,79}$' OR p_external_record_type !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
       p_external_identifier IS NULL OR p_external_identifier <> btrim(p_external_identifier) OR p_external_identifier = '' OR length(p_external_identifier) > 200 OR
       p_provenance IS NULL OR p_provenance <> btrim(p_provenance) OR p_provenance = '' OR length(p_provenance) > 500 THEN
        RAISE EXCEPTION 'Provider-neutral external reference evidence is invalid' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_job_id, p_service_workstream_id, p_provider, p_external_record_type,
        p_external_identifier, p_provenance
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_job_service_idempotency(v_actor_identity_id, 'RECORD_JOB_SERVICE_EXTERNAL_REFERENCE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'external_reference_id')::uuid; END IF;
    v_reference_id := gen_random_uuid();
    INSERT INTO medialab_core.job_service_external_references
        (id, organization_id, job_id, service_workstream_id, provider, external_record_type,
         external_identifier, provenance, recorded_by_identity_id, recorded_at)
    VALUES (v_reference_id, v_organization_id, p_job_id, p_service_workstream_id, p_provider,
            p_external_record_type, p_external_identifier, p_provenance, v_actor_identity_id, v_now);
    IF p_job_id IS NOT NULL THEN
        INSERT INTO medialab_core.job_events
            (id, job_id, organization_id, event_type, previous_state, resulting_state, actor_identity_id,
             authority_context, reason, idempotency_key, evidence, occurred_at)
        VALUES (gen_random_uuid(), p_job_id, v_organization_id, 'EXTERNAL_REFERENCE_RECORDED', v_subject_state,
                v_subject_state, v_actor_identity_id, 'JOB_MANAGE_PERMISSION', p_provenance, p_idempotency_key,
                jsonb_build_object('external_reference_id', v_reference_id, 'provider', p_provider,
                  'external_record_type', p_external_record_type, 'external_identifier', p_external_identifier), v_now);
    ELSE
        INSERT INTO medialab_core.service_workstream_events
            (id, service_workstream_id, job_id, organization_id, order_id, source_order_item_id, event_type,
             previous_state, resulting_state, actor_identity_id, authority_context, reason,
             idempotency_key, evidence, occurred_at)
        SELECT gen_random_uuid(), w.id, w.job_id, w.organization_id, w.order_id, w.source_order_item_id,
               'EXTERNAL_REFERENCE_RECORDED', w.current_state, w.current_state, v_actor_identity_id,
               'JOB_MANAGE_PERMISSION', p_provenance, p_idempotency_key,
               jsonb_build_object('order_id', w.order_id, 'external_reference_id', v_reference_id,
                 'provider', p_provider, 'external_record_type', p_external_record_type,
                 'external_identifier', p_external_identifier), v_now
          FROM medialab_core.service_workstreams w WHERE w.id = p_service_workstream_id;
    END IF;
    PERFORM medialab_core.record_job_service_idempotency(
        v_actor_identity_id, 'RECORD_JOB_SERVICE_EXTERNAL_REFERENCE', p_idempotency_key, v_hash,
        jsonb_build_object('external_reference_id', v_reference_id)
    );
    RETURN v_reference_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_job_record(p_session_token text, p_job_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor_identity_id uuid; v_job medialab_core.jobs%ROWTYPE; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id;
    IF NOT FOUND OR NOT (
        medialab_core.actor_has_permission(v_actor_identity_id, v_job.organization_id, 'job.manage') OR
        medialab_core.actor_has_permission(v_actor_identity_id, v_job.organization_id, 'job.read')
    ) THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object(
        'job', to_jsonb(v_job),
        'workstreams', COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.created_at, w.id)
          FROM medialab_core.service_workstreams w WHERE w.job_id = v_job.id), '[]'::jsonb),
        'appointments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.linked_at, a.id)
          FROM medialab_core.job_appointments a WHERE a.job_id = v_job.id), '[]'::jsonb),
        'external_references', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.recorded_at, r.id)
          FROM medialab_core.job_service_external_references r WHERE r.job_id = v_job.id), '[]'::jsonb),
        'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at, e.id)
          FROM medialab_core.job_events e WHERE e.job_id = v_job.id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_service_workstream_record(
    p_session_token text, p_service_workstream_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor_identity_id uuid; v_workstream medialab_core.service_workstreams%ROWTYPE; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workstream FROM medialab_core.service_workstreams WHERE id = p_service_workstream_id;
    IF NOT FOUND OR NOT (
        medialab_core.actor_has_permission(v_actor_identity_id, v_workstream.organization_id, 'job.manage') OR
        medialab_core.actor_has_permission(v_actor_identity_id, v_workstream.organization_id, 'job.read')
    ) THEN RAISE EXCEPTION 'Service Workstream is missing or unavailable' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object(
        'service_workstream', to_jsonb(v_workstream),
        'external_references', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.recorded_at, r.id)
          FROM medialab_core.job_service_external_references r WHERE r.service_workstream_id = v_workstream.id), '[]'::jsonb),
        'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at, e.id)
          FROM medialab_core.service_workstream_events e WHERE e.service_workstream_id = v_workstream.id), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER jobs_update_guard BEFORE UPDATE ON medialab_core.jobs
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_job_update();
CREATE TRIGGER jobs_delete_guard BEFORE DELETE ON medialab_core.jobs
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_job_service_evidence_mutation();
CREATE TRIGGER service_workstreams_update_guard BEFORE UPDATE ON medialab_core.service_workstreams
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_service_workstream_update();
CREATE TRIGGER service_workstreams_delete_guard BEFORE DELETE ON medialab_core.service_workstreams
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_job_service_evidence_mutation();
CREATE TRIGGER job_appointments_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.job_appointments
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_job_service_evidence_mutation();
CREATE TRIGGER job_service_external_references_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.job_service_external_references
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_job_service_evidence_mutation();
CREATE TRIGGER job_service_command_idempotency_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.job_service_command_idempotency
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_job_service_evidence_mutation();
CREATE TRIGGER job_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.job_events
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_job_service_evidence_mutation();
CREATE TRIGGER service_workstream_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.service_workstream_events
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_job_service_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.jobs FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.service_workstreams FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.job_appointments FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.job_service_external_references FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.job_service_command_idempotency FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.job_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.service_workstream_events FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_job_service_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_job_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_service_workstream_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_job_service_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.check_job_service_idempotency(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_job_service_idempotency(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_job(text, text, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_service_workstream(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.link_job_appointment(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.transition_job_state(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.transition_service_workstream_state(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_job_service_external_reference(text, text, uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_job_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_service_workstream_record(text, uuid) FROM PUBLIC;
