ALTER TABLE medialab_core.job_appointments
    ADD CONSTRAINT job_appointments_mission_plan_identity_key
    UNIQUE (id, job_id, appointment_id, organization_id, order_id);

CREATE TABLE medialab_core.mission_plans (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    job_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    job_appointment_id uuid NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id, order_id)
        REFERENCES medialab_core.jobs(id, organization_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (property_hub_id, organization_id)
        REFERENCES medialab_core.property_hubs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (appointment_id, organization_id, order_id)
        REFERENCES medialab_core.appointments(id, organization_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_appointment_id, job_id, appointment_id, organization_id, order_id)
        REFERENCES medialab_core.job_appointments(id, job_id, appointment_id, organization_id, order_id) ON DELETE RESTRICT,
    CONSTRAINT mission_plans_job_appointment_key UNIQUE (job_appointment_id),
    CONSTRAINT mission_plans_id_org_key UNIQUE (id, organization_id),
    CONSTRAINT mission_plans_id_job_org_key UNIQUE (id, job_id, organization_id)
);

CREATE TABLE medialab_core.mission_plan_drafts (
    mission_plan_id uuid PRIMARY KEY REFERENCES medialab_core.mission_plans(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    structured_content jsonb NOT NULL,
    weather_status text NOT NULL,
    weather_evidence jsonb NULL,
    weather_unavailable_reason text NULL,
    source_fingerprint_sha256 text NOT NULL,
    draft_generation integer NOT NULL DEFAULT 1 CHECK (draft_generation > 0),
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (mission_plan_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_drafts_content_check CHECK (jsonb_typeof(structured_content) = 'object'),
    CONSTRAINT mission_plan_drafts_weather_status_check CHECK (weather_status IN ('AVAILABLE', 'UNAVAILABLE', 'NOT_REQUESTED')),
    CONSTRAINT mission_plan_drafts_weather_shape_check CHECK (
        (weather_status = 'AVAILABLE' AND weather_evidence IS NOT NULL AND jsonb_typeof(weather_evidence) = 'object' AND weather_unavailable_reason IS NULL) OR
        (weather_status = 'UNAVAILABLE' AND weather_evidence IS NULL AND weather_unavailable_reason IS NOT NULL AND
         weather_unavailable_reason = btrim(weather_unavailable_reason) AND weather_unavailable_reason <> '' AND length(weather_unavailable_reason) <= 500) OR
        (weather_status = 'NOT_REQUESTED' AND weather_evidence IS NULL AND weather_unavailable_reason IS NULL)
    ),
    CONSTRAINT mission_plan_drafts_fingerprint_check CHECK (source_fingerprint_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.mission_plan_draft_workstreams (
    mission_plan_id uuid NOT NULL,
    service_workstream_id uuid NOT NULL,
    job_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    selected_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (mission_plan_id, service_workstream_id),
    FOREIGN KEY (mission_plan_id, job_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, job_id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE medialab_core.mission_plan_draft_contacts (
    id uuid PRIMARY KEY,
    mission_plan_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    contact_method_id uuid NOT NULL REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    contact_role text NOT NULL,
    visibility_classification text NOT NULL,
    snapshot_contact_type text NOT NULL,
    snapshot_submitted_value text NOT NULL,
    snapshot_normalized_value text NOT NULL,
    snapshot_lifecycle_state text NOT NULL,
    selected_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (mission_plan_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_draft_contacts_key UNIQUE (mission_plan_id, contact_method_id, contact_role),
    CONSTRAINT mission_plan_draft_contacts_role_check CHECK (
        contact_role = btrim(contact_role) AND contact_role <> '' AND length(contact_role) <= 100
    ),
    CONSTRAINT mission_plan_draft_contacts_visibility_check CHECK (visibility_classification IN (
        'INTERNAL_STAFF_ONLY', 'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE'
    ))
);

CREATE TABLE medialab_core.mission_plan_sensitive_envelopes (
    id uuid PRIMARY KEY,
    mission_plan_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    supersedes_envelope_id uuid NULL,
    classification text NOT NULL,
    envelope_format_version text NOT NULL,
    algorithm_identifier text NOT NULL,
    key_reference_identifier text NOT NULL,
    nonce_or_iv text NULL,
    opaque_ciphertext bytea NOT NULL,
    ciphertext_sha256 text NOT NULL,
    trusted_payload_sha256 text NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (mission_plan_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_envelope_id) REFERENCES medialab_core.mission_plan_sensitive_envelopes(id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_sensitive_envelopes_supersession_key UNIQUE (supersedes_envelope_id),
    CONSTRAINT mission_plan_sensitive_envelopes_classification_check CHECK (classification = 'INTERNAL_STAFF_ONLY'),
    CONSTRAINT mission_plan_sensitive_envelopes_format_check CHECK (
        envelope_format_version = btrim(envelope_format_version) AND envelope_format_version <> '' AND length(envelope_format_version) <= 80
    ),
    CONSTRAINT mission_plan_sensitive_envelopes_algorithm_check CHECK (
        algorithm_identifier = btrim(algorithm_identifier) AND algorithm_identifier <> '' AND length(algorithm_identifier) <= 120
    ),
    CONSTRAINT mission_plan_sensitive_envelopes_key_reference_check CHECK (
        key_reference_identifier = btrim(key_reference_identifier) AND key_reference_identifier <> '' AND length(key_reference_identifier) <= 300
    ),
    CONSTRAINT mission_plan_sensitive_envelopes_nonce_check CHECK (
        nonce_or_iv IS NULL OR (nonce_or_iv = btrim(nonce_or_iv) AND nonce_or_iv <> '' AND length(nonce_or_iv) <= 300)
    ),
    CONSTRAINT mission_plan_sensitive_envelopes_ciphertext_check CHECK (octet_length(opaque_ciphertext) > 0),
    CONSTRAINT mission_plan_sensitive_envelopes_hash_check CHECK (
        ciphertext_sha256 ~ '^[0-9a-f]{64}$' AND (trusted_payload_sha256 IS NULL OR trusted_payload_sha256 ~ '^[0-9a-f]{64}$')
    )
);

CREATE TABLE medialab_core.mission_plan_notes (
    id uuid PRIMARY KEY,
    mission_plan_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    visibility_classification text NOT NULL,
    note_text text NOT NULL,
    author_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (mission_plan_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_notes_visibility_check CHECK (visibility_classification IN (
        'INTERNAL_STAFF_ONLY', 'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE'
    )),
    CONSTRAINT mission_plan_notes_text_check CHECK (
        note_text = btrim(note_text) AND note_text <> '' AND length(note_text) <= 4000
    )
);

CREATE TABLE medialab_core.mission_plan_versions (
    id uuid PRIMARY KEY,
    mission_plan_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    version_number integer NOT NULL CHECK (version_number > 0),
    supersedes_version_id uuid NULL,
    schema_version integer NOT NULL CHECK (schema_version = 1),
    draft_generation integer NOT NULL CHECK (draft_generation > 0),
    source_fingerprint_sha256 text NOT NULL,
    canonical_json jsonb NOT NULL,
    canonical_json_sha256 text NOT NULL,
    issued_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (mission_plan_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_version_id) REFERENCES medialab_core.mission_plan_versions(id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_versions_plan_number_key UNIQUE (mission_plan_id, version_number),
    CONSTRAINT mission_plan_versions_id_plan_key UNIQUE (id, mission_plan_id),
    CONSTRAINT mission_plan_versions_fingerprint_check CHECK (source_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT mission_plan_versions_json_check CHECK (jsonb_typeof(canonical_json) = 'object'),
    CONSTRAINT mission_plan_versions_json_hash_check CHECK (canonical_json_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.mission_plan_version_workstreams (
    mission_plan_version_id uuid NOT NULL,
    mission_plan_id uuid NOT NULL,
    service_workstream_id uuid NOT NULL,
    job_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    frozen_state text NOT NULL,
    frozen_source_description text NOT NULL,
    frozen_source_quantity numeric(12,3) NOT NULL,
    frozen_source_commercial_unit text NOT NULL,
    frozen_source_item_kind text NOT NULL,
    PRIMARY KEY (mission_plan_version_id, service_workstream_id),
    FOREIGN KEY (mission_plan_version_id, mission_plan_id)
        REFERENCES medialab_core.mission_plan_versions(id, mission_plan_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE medialab_core.mission_plan_version_contacts (
    id uuid PRIMARY KEY,
    mission_plan_version_id uuid NOT NULL,
    mission_plan_id uuid NOT NULL,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    contact_method_id uuid NOT NULL REFERENCES medialab_core.contact_methods(id) ON DELETE RESTRICT,
    contact_role text NOT NULL,
    visibility_classification text NOT NULL,
    snapshot_contact_type text NOT NULL,
    snapshot_submitted_value text NOT NULL,
    snapshot_normalized_value text NOT NULL,
    snapshot_lifecycle_state text NOT NULL,
    FOREIGN KEY (mission_plan_version_id, mission_plan_id)
        REFERENCES medialab_core.mission_plan_versions(id, mission_plan_id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_version_contacts_key UNIQUE (mission_plan_version_id, contact_method_id, contact_role),
    CONSTRAINT mission_plan_version_contacts_visibility_check CHECK (visibility_classification IN (
        'INTERNAL_STAFF_ONLY', 'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE'
    ))
);

CREATE TABLE medialab_core.mission_plan_version_notes (
    mission_plan_version_id uuid NOT NULL,
    mission_plan_id uuid NOT NULL,
    mission_plan_note_id uuid NOT NULL,
    visibility_classification text NOT NULL,
    frozen_note_text text NOT NULL,
    author_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authored_at timestamptz NOT NULL,
    PRIMARY KEY (mission_plan_version_id, mission_plan_note_id),
    FOREIGN KEY (mission_plan_version_id, mission_plan_id)
        REFERENCES medialab_core.mission_plan_versions(id, mission_plan_id) ON DELETE RESTRICT,
    FOREIGN KEY (mission_plan_note_id) REFERENCES medialab_core.mission_plan_notes(id) ON DELETE RESTRICT
);

CREATE TABLE medialab_core.mission_plan_events (
    id uuid PRIMARY KEY,
    mission_plan_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    mission_plan_version_id uuid NULL,
    event_type text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (mission_plan_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (mission_plan_version_id, mission_plan_id)
        REFERENCES medialab_core.mission_plan_versions(id, mission_plan_id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_events_type_check CHECK (event_type IN (
        'DRAFT_CREATED', 'DRAFT_REVISED', 'WORKSTREAM_SELECTION_REPLACED', 'CONTACT_SELECTION_REPLACED',
        'SENSITIVE_ENVELOPE_RECORDED', 'NOTE_ADDED', 'DRAFT_REFRESHED', 'VERSION_ISSUED'
    )),
    CONSTRAINT mission_plan_events_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT mission_plan_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.mission_plan_open_events (
    id uuid PRIMARY KEY,
    mission_plan_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    mission_plan_version_id uuid NULL,
    event_type text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (mission_plan_id, organization_id)
        REFERENCES medialab_core.mission_plans(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (mission_plan_version_id, mission_plan_id)
        REFERENCES medialab_core.mission_plan_versions(id, mission_plan_id) ON DELETE RESTRICT,
    CONSTRAINT mission_plan_open_events_type_check CHECK (event_type IN ('OPENED', 'ACKNOWLEDGED')),
    CONSTRAINT mission_plan_open_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.mission_plan_command_idempotency (
    id uuid PRIMARY KEY,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT mission_plan_command_idempotency_command_check CHECK (command_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT mission_plan_command_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT mission_plan_command_idempotency_hash_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT mission_plan_command_idempotency_result_check CHECK (jsonb_typeof(result) = 'object'),
    CONSTRAINT mission_plan_command_idempotency_actor_key UNIQUE (actor_identity_id, command_type, idempotency_key)
);

CREATE INDEX mission_plan_versions_plan_idx ON medialab_core.mission_plan_versions (mission_plan_id, version_number DESC);
CREATE INDEX mission_plan_notes_plan_idx ON medialab_core.mission_plan_notes (mission_plan_id, authored_at, id);
CREATE INDEX mission_plan_events_plan_idx ON medialab_core.mission_plan_events (mission_plan_id, occurred_at, id);
CREATE INDEX mission_plan_open_events_plan_idx ON medialab_core.mission_plan_open_events (mission_plan_id, occurred_at, id);
CREATE INDEX mission_plan_envelopes_plan_idx ON medialab_core.mission_plan_sensitive_envelopes (mission_plan_id, recorded_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_mission_plan_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable append-only evidence: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_mission_plan_draft_update()
RETURNS trigger AS $$
BEGIN
    IF OLD.mission_plan_id IS DISTINCT FROM NEW.mission_plan_id OR
       OLD.organization_id IS DISTINCT FROM NEW.organization_id OR
       OLD.schema_version IS DISTINCT FROM NEW.schema_version OR
       OLD.created_by_identity_id IS DISTINCT FROM NEW.created_by_identity_id OR
       OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Mission Plan draft identity evidence is immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.draft_generation <= OLD.draft_generation THEN
        RAISE EXCEPTION 'Mission Plan draft generation must advance monotonically' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_mission_plan_permission(
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

CREATE OR REPLACE FUNCTION medialab_core.validate_mission_plan_content(p_content jsonb)
RETURNS void AS $$
DECLARE v_section jsonb;
BEGIN
    IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' OR
       jsonb_typeof(p_content->'sections') <> 'array' THEN
        RAISE EXCEPTION 'Mission Plan content must be an object with a sections array' USING ERRCODE = '22023';
    END IF;
    IF p_content::text ~* '"(plaintext_secret|password|access_token|private_key|ciphertext)"[[:space:]]*:' THEN
        RAISE EXCEPTION 'Protected secret material is prohibited from Mission Plan structured content' USING ERRCODE = '22023';
    END IF;
    FOR v_section IN SELECT value FROM jsonb_array_elements(p_content->'sections') LOOP
        IF jsonb_typeof(v_section) <> 'object' OR
           COALESCE(v_section->>'visibility', '') NOT IN (
             'INTERNAL_STAFF_ONLY', 'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE'
           ) OR COALESCE(btrim(v_section->>'label'), '') = '' OR NOT (v_section ? 'content') THEN
            RAISE EXCEPTION 'Each Mission Plan section requires label, content, and an approved visibility classification'
                USING ERRCODE = '22023';
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.check_mission_plan_idempotency(
    p_actor_identity_id uuid,
    p_command_type text,
    p_idempotency_key text,
    p_request_sha256 text
)
RETURNS jsonb AS $$
DECLARE v_record medialab_core.mission_plan_command_idempotency%ROWTYPE;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'A bounded idempotency key is required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_actor_identity_id::text || ':' || p_command_type || ':' || p_idempotency_key, 0)
    );
    SELECT * INTO v_record FROM medialab_core.mission_plan_command_idempotency
     WHERE actor_identity_id = p_actor_identity_id AND command_type = p_command_type AND idempotency_key = p_idempotency_key;
    IF FOUND AND v_record.request_sha256 <> p_request_sha256 THEN
        RAISE EXCEPTION 'Idempotency key conflicts with a different request fingerprint' USING ERRCODE = '22023';
    END IF;
    RETURN CASE WHEN FOUND THEN v_record.result ELSE NULL END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id uuid)
RETURNS text AS $$
DECLARE v_material jsonb;
BEGIN
    SELECT jsonb_build_object(
        'mission_plan_id', mp.id,
        'organization_id', mp.organization_id,
        'order_id', mp.order_id,
        'property_hub_id', mp.property_hub_id,
        'job_id', mp.job_id,
        'job_state', j.current_state,
        'job_updated_at', j.updated_at,
        'appointment_id', mp.appointment_id,
        'appointment_starts_at', a.starts_at,
        'appointment_ends_at', a.ends_at,
        'appointment_timezone', a.iana_timezone,
        'workstreams', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', sw.id, 'state', sw.current_state, 'updated_at', sw.updated_at,
                'description', sw.frozen_source_description, 'quantity', sw.frozen_source_quantity,
                'unit', sw.frozen_source_commercial_unit, 'kind', sw.frozen_source_item_kind
            ) ORDER BY sw.id)
            FROM medialab_core.mission_plan_draft_workstreams dws
            JOIN medialab_core.service_workstreams sw ON sw.id = dws.service_workstream_id
            WHERE dws.mission_plan_id = mp.id
        ), '[]'::jsonb),
        'contacts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'contact_method_id', dc.contact_method_id, 'role', dc.contact_role,
                'current_value', cm.normalized_value, 'current_state', cm.lifecycle_state
            ) ORDER BY dc.contact_method_id, dc.contact_role)
            FROM medialab_core.mission_plan_draft_contacts dc
            JOIN medialab_core.contact_methods cm ON cm.id = dc.contact_method_id
            WHERE dc.mission_plan_id = mp.id
        ), '[]'::jsonb),
        'notes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', n.id, 'visibility', n.visibility_classification, 'text', n.note_text,
                'author', n.author_identity_id, 'authored_at', n.authored_at
            ) ORDER BY n.authored_at, n.id)
            FROM medialab_core.mission_plan_notes n WHERE n.mission_plan_id = mp.id
        ), '[]'::jsonb),
        'envelopes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'supersedes_envelope_id', e.supersedes_envelope_id,
                'format', e.envelope_format_version, 'algorithm', e.algorithm_identifier,
                'key_reference', e.key_reference_identifier, 'ciphertext_sha256', e.ciphertext_sha256,
                'trusted_payload_sha256', e.trusted_payload_sha256, 'classification', e.classification
            ) ORDER BY e.recorded_at, e.id)
            FROM medialab_core.mission_plan_sensitive_envelopes e WHERE e.mission_plan_id = mp.id
        ), '[]'::jsonb)
    ) INTO v_material
    FROM medialab_core.mission_plans mp
    JOIN medialab_core.jobs j ON j.id = mp.job_id
    JOIN medialab_core.appointments a ON a.id = mp.appointment_id
    WHERE mp.id = p_mission_plan_id;
    IF v_material IS NULL THEN
        RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023';
    END IF;
    RETURN encode(sha256(convert_to(v_material::text, 'UTF8')), 'hex');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.actor_can_read_mission_plan(
    p_actor_identity_id uuid,
    p_mission_plan_id uuid
)
RETURNS text AS $$
DECLARE v_plan medialab_core.mission_plans%ROWTYPE; v_person_id uuid;
BEGIN
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF medialab_core.actor_has_permission(p_actor_identity_id, v_plan.organization_id, 'mission_plan.read') THEN
        RETURN 'INTERNAL_STAFF';
    END IF;
    SELECT person_id INTO v_person_id FROM medialab_core.identities WHERE id = p_actor_identity_id AND status = 'ACTIVE';
    IF EXISTS (
        SELECT 1 FROM medialab_core.appointment_participant_assignments apa
        WHERE apa.appointment_id = v_plan.appointment_id AND apa.organization_id = v_plan.organization_id
          AND apa.person_id = v_person_id
          AND NOT EXISTS (
              SELECT 1 FROM medialab_core.appointment_participant_assignment_endings ending
              WHERE ending.assignment_id = apa.id
          )
    ) THEN RETURN 'ASSIGNED_CREW'; END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_mission_plan_draft(
    p_session_token text,
    p_idempotency_key text,
    p_job_appointment_id uuid,
    p_structured_content jsonb,
    p_weather_status text,
    p_weather_evidence jsonb,
    p_weather_unavailable_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor uuid; v_link record; v_plan_id uuid; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT ja.*, j.property_hub_id AS job_property_hub_id,
           a.property_hub_id AS appointment_property_hub_id INTO v_link
      FROM medialab_core.job_appointments ja
      JOIN medialab_core.jobs j ON j.id = ja.job_id
      JOIN medialab_core.appointments a ON a.id = ja.appointment_id
     WHERE ja.id = p_job_appointment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mission Plan requires an existing Job-Appointment relationship' USING ERRCODE = '22023';
    END IF;
    IF v_link.job_property_hub_id IS NOT NULL AND
       v_link.job_property_hub_id <> v_link.appointment_property_hub_id THEN
        RAISE EXCEPTION 'Job and Appointment Property Hub relationships are incompatible' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_link.organization_id, 'mission_plan.manage');
    PERFORM medialab_core.validate_mission_plan_content(p_structured_content);
    IF p_weather_status NOT IN ('AVAILABLE', 'UNAVAILABLE', 'NOT_REQUESTED') OR
       (p_weather_status = 'AVAILABLE' AND (p_weather_evidence IS NULL OR jsonb_typeof(p_weather_evidence) <> 'object' OR p_weather_unavailable_reason IS NOT NULL)) OR
       (p_weather_status = 'UNAVAILABLE' AND (p_weather_evidence IS NOT NULL OR COALESCE(btrim(p_weather_unavailable_reason), '') = '')) OR
       (p_weather_status = 'NOT_REQUESTED' AND (p_weather_evidence IS NOT NULL OR p_weather_unavailable_reason IS NOT NULL)) THEN
        RAISE EXCEPTION 'Weather evidence must be AVAILABLE, attributable UNAVAILABLE, or NOT_REQUESTED' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_job_appointment_id, p_structured_content, p_weather_status, p_weather_evidence, p_weather_unavailable_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'CREATE_MISSION_PLAN_DRAFT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'mission_plan_id')::uuid; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.mission_plans WHERE job_appointment_id = p_job_appointment_id) THEN
        RAISE EXCEPTION 'A Mission Plan already exists for this Job-Appointment relationship' USING ERRCODE = '23505';
    END IF;
    v_plan_id := gen_random_uuid();
    INSERT INTO medialab_core.mission_plans
        (id, organization_id, order_id, property_hub_id, job_id, appointment_id, job_appointment_id, created_by_identity_id, created_at)
    VALUES (v_plan_id, v_link.organization_id, v_link.order_id, v_link.appointment_property_hub_id,
            v_link.job_id, v_link.appointment_id, p_job_appointment_id, v_actor, v_now);
    INSERT INTO medialab_core.mission_plan_draft_workstreams
        (mission_plan_id, service_workstream_id, job_id, organization_id, selected_by_identity_id, selected_at)
    SELECT v_plan_id, sw.id, sw.job_id, sw.organization_id, v_actor, v_now
      FROM medialab_core.service_workstreams sw
     WHERE sw.job_id = v_link.job_id AND sw.organization_id = v_link.organization_id
       AND sw.current_state NOT IN ('COMPLETED', 'CANCELLED')
     ORDER BY sw.id;
    INSERT INTO medialab_core.mission_plan_drafts
        (mission_plan_id, organization_id, structured_content, weather_status, weather_evidence,
         weather_unavailable_reason, source_fingerprint_sha256, created_by_identity_id, created_at,
         updated_by_identity_id, updated_at)
    VALUES (v_plan_id, v_link.organization_id, p_structured_content, p_weather_status, p_weather_evidence,
            p_weather_unavailable_reason, medialab_core.compute_mission_plan_source_fingerprint(v_plan_id),
            v_actor, v_now, v_actor, v_now);
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, event_type, actor_identity_id, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), v_plan_id, v_link.organization_id, 'DRAFT_CREATED', v_actor, p_idempotency_key,
            jsonb_build_object('job_appointment_id', p_job_appointment_id, 'default_selection', 'ALL_ELIGIBLE_NONTERMINAL'), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'CREATE_MISSION_PLAN_DRAFT', p_idempotency_key, v_hash,
        jsonb_build_object('mission_plan_id', v_plan_id));
    RETURN v_plan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revise_mission_plan_draft(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid,
    p_structured_content jsonb,
    p_weather_status text,
    p_weather_evidence jsonb,
    p_weather_unavailable_reason text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    PERFORM medialab_core.validate_mission_plan_content(p_structured_content);
    IF p_weather_status NOT IN ('AVAILABLE', 'UNAVAILABLE', 'NOT_REQUESTED') OR
       (p_weather_status = 'AVAILABLE' AND (p_weather_evidence IS NULL OR jsonb_typeof(p_weather_evidence) <> 'object' OR p_weather_unavailable_reason IS NOT NULL)) OR
       (p_weather_status = 'UNAVAILABLE' AND (p_weather_evidence IS NOT NULL OR COALESCE(btrim(p_weather_unavailable_reason), '') = '')) OR
       (p_weather_status = 'NOT_REQUESTED' AND (p_weather_evidence IS NOT NULL OR p_weather_unavailable_reason IS NOT NULL)) THEN
        RAISE EXCEPTION 'Weather evidence must be AVAILABLE, attributable UNAVAILABLE, or NOT_REQUESTED' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_mission_plan_id, p_structured_content, p_weather_status, p_weather_evidence, p_weather_unavailable_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'REVISE_MISSION_PLAN_DRAFT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'mission_plan_id')::uuid; END IF;
    UPDATE medialab_core.mission_plan_drafts SET
        structured_content = p_structured_content, weather_status = p_weather_status,
        weather_evidence = p_weather_evidence, weather_unavailable_reason = p_weather_unavailable_reason,
        source_fingerprint_sha256 = medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id),
        draft_generation = draft_generation + 1, updated_by_identity_id = v_actor, updated_at = v_now
    WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, event_type, actor_identity_id, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, 'DRAFT_REVISED', v_actor, p_idempotency_key,
            jsonb_build_object('weather_status', p_weather_status), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'REVISE_MISSION_PLAN_DRAFT', p_idempotency_key, v_hash,
        jsonb_build_object('mission_plan_id', p_mission_plan_id));
    RETURN p_mission_plan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_mission_plan_idempotency(
    p_actor_identity_id uuid,
    p_command_type text,
    p_idempotency_key text,
    p_request_sha256 text,
    p_result jsonb
)
RETURNS void AS $$
BEGIN
    INSERT INTO medialab_core.mission_plan_command_idempotency
        (id, actor_identity_id, command_type, idempotency_key, request_sha256, result)
    VALUES (gen_random_uuid(), p_actor_identity_id, p_command_type, p_idempotency_key, p_request_sha256, p_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.replace_mission_plan_draft_workstreams(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid,
    p_service_workstream_ids uuid[]
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    IF p_service_workstream_ids IS NULL OR cardinality(p_service_workstream_ids) = 0 OR
       cardinality(p_service_workstream_ids) <> (SELECT count(DISTINCT item) FROM unnest(p_service_workstream_ids) item) THEN
        RAISE EXCEPTION 'An explicit nonempty unique Workstream selection is required' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM unnest(p_service_workstream_ids) requested(id)
        LEFT JOIN medialab_core.service_workstreams sw ON sw.id = requested.id
        WHERE sw.id IS NULL OR sw.job_id <> v_plan.job_id OR sw.organization_id <> v_plan.organization_id OR
              sw.current_state IN ('COMPLETED', 'CANCELLED')
    ) THEN
        RAISE EXCEPTION 'Selected Workstream is cross-tenant, cross-Job, missing, or terminal' USING ERRCODE = '42501';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_mission_plan_id, (SELECT jsonb_agg(item ORDER BY item) FROM unnest(p_service_workstream_ids) item)
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'REPLACE_MISSION_PLAN_WORKSTREAMS', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'mission_plan_id')::uuid; END IF;
    DELETE FROM medialab_core.mission_plan_draft_workstreams WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_draft_workstreams
        (mission_plan_id, service_workstream_id, job_id, organization_id, selected_by_identity_id, selected_at)
    SELECT p_mission_plan_id, sw.id, sw.job_id, sw.organization_id, v_actor, v_now
      FROM medialab_core.service_workstreams sw WHERE sw.id = ANY(p_service_workstream_ids) ORDER BY sw.id;
    UPDATE medialab_core.mission_plan_drafts SET
        source_fingerprint_sha256 = medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id),
        draft_generation = draft_generation + 1, updated_by_identity_id = v_actor, updated_at = v_now
    WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, event_type, actor_identity_id, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, 'WORKSTREAM_SELECTION_REPLACED', v_actor,
            p_idempotency_key, jsonb_build_object('selected_count', cardinality(p_service_workstream_ids)), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'REPLACE_MISSION_PLAN_WORKSTREAMS', p_idempotency_key,
        v_hash, jsonb_build_object('mission_plan_id', p_mission_plan_id));
    RETURN p_mission_plan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.replace_mission_plan_draft_contacts(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid,
    p_contacts jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    IF p_contacts IS NULL OR jsonb_typeof(p_contacts) <> 'array' THEN
        RAISE EXCEPTION 'Mission Plan contacts must be an array' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_contacts) AS requested(
            person_id uuid, contact_method_id uuid, contact_role text, visibility_classification text
        )
        LEFT JOIN medialab_core.contact_methods cm
          ON cm.id = requested.contact_method_id AND cm.person_id = requested.person_id
        WHERE cm.id IS NULL OR cm.lifecycle_state <> 'ACTIVE' OR
              COALESCE(btrim(requested.contact_role), '') = '' OR length(requested.contact_role) > 100 OR
              requested.visibility_classification NOT IN (
                'INTERNAL_STAFF_ONLY', 'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE'
              )
    ) THEN
        RAISE EXCEPTION 'Contact selection contains an invalid canonical identity reference, inactive value, role, or visibility'
            USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM jsonb_to_recordset(p_contacts) AS x(person_id uuid, contact_method_id uuid, contact_role text, visibility_classification text)) <>
       (SELECT count(*) FROM (
           SELECT DISTINCT contact_method_id, contact_role FROM jsonb_to_recordset(p_contacts)
             AS x(person_id uuid, contact_method_id uuid, contact_role text, visibility_classification text)
       ) unique_contacts) THEN
        RAISE EXCEPTION 'Duplicate Mission Plan contact selections are prohibited' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_mission_plan_id, p_contacts)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'REPLACE_MISSION_PLAN_CONTACTS', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'mission_plan_id')::uuid; END IF;
    DELETE FROM medialab_core.mission_plan_draft_contacts WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_draft_contacts
        (id, mission_plan_id, organization_id, person_id, contact_method_id, contact_role,
         visibility_classification, snapshot_contact_type, snapshot_submitted_value, snapshot_normalized_value,
         snapshot_lifecycle_state, selected_by_identity_id, selected_at)
    SELECT gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, requested.person_id, cm.id,
           requested.contact_role, requested.visibility_classification, cm.contact_type, cm.submitted_value,
           cm.normalized_value, cm.lifecycle_state, v_actor, v_now
      FROM jsonb_to_recordset(p_contacts) AS requested(
            person_id uuid, contact_method_id uuid, contact_role text, visibility_classification text
      ) JOIN medialab_core.contact_methods cm
        ON cm.id = requested.contact_method_id AND cm.person_id = requested.person_id
     ORDER BY cm.id, requested.contact_role;
    UPDATE medialab_core.mission_plan_drafts SET
        source_fingerprint_sha256 = medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id),
        draft_generation = draft_generation + 1, updated_by_identity_id = v_actor, updated_at = v_now
    WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, event_type, actor_identity_id, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, 'CONTACT_SELECTION_REPLACED', v_actor,
            p_idempotency_key, jsonb_build_object('selected_count', jsonb_array_length(p_contacts)), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'REPLACE_MISSION_PLAN_CONTACTS', p_idempotency_key,
        v_hash, jsonb_build_object('mission_plan_id', p_mission_plan_id));
    RETURN p_mission_plan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_mission_plan_sensitive_envelope(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid,
    p_supersedes_envelope_id uuid,
    p_envelope_format_version text,
    p_algorithm_identifier text,
    p_key_reference_identifier text,
    p_nonce_or_iv text,
    p_opaque_ciphertext_base64 text,
    p_ciphertext_sha256 text,
    p_trusted_payload_sha256 text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_hash text; v_replay jsonb; v_id uuid; v_bytes bytea; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    BEGIN v_bytes := decode(p_opaque_ciphertext_base64, 'base64');
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Opaque ciphertext must be valid base64' USING ERRCODE = '22023'; END;
    IF octet_length(v_bytes) = 0 OR p_ciphertext_sha256 !~ '^[0-9a-f]{64}$' OR
       encode(sha256(v_bytes), 'hex') <> p_ciphertext_sha256 OR
       (p_trusted_payload_sha256 IS NOT NULL AND p_trusted_payload_sha256 !~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'Sensitive envelope ciphertext hash or trusted payload hash is invalid' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_mission_plan_id, p_supersedes_envelope_id, p_envelope_format_version, p_algorithm_identifier, p_key_reference_identifier,
        p_nonce_or_iv, p_ciphertext_sha256, p_trusted_payload_sha256
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'RECORD_MISSION_PLAN_ENVELOPE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'envelope_id')::uuid; END IF;
    IF p_supersedes_envelope_id IS NULL AND EXISTS (
        SELECT 1 FROM medialab_core.mission_plan_sensitive_envelopes current_envelope
        WHERE current_envelope.mission_plan_id = p_mission_plan_id
          AND NOT EXISTS (
              SELECT 1 FROM medialab_core.mission_plan_sensitive_envelopes successor
              WHERE successor.supersedes_envelope_id = current_envelope.id
          )
    ) THEN
        RAISE EXCEPTION 'Replacing a protected envelope requires the current envelope reference' USING ERRCODE = '22023';
    END IF;
    IF p_supersedes_envelope_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.mission_plan_sensitive_envelopes current_envelope
        WHERE current_envelope.id = p_supersedes_envelope_id
          AND current_envelope.mission_plan_id = p_mission_plan_id
          AND NOT EXISTS (
              SELECT 1 FROM medialab_core.mission_plan_sensitive_envelopes successor
              WHERE successor.supersedes_envelope_id = current_envelope.id
          )
    ) THEN
        RAISE EXCEPTION 'Protected envelope replacement reference is missing, foreign, or already superseded' USING ERRCODE = '42501';
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.mission_plan_sensitive_envelopes
        (id, mission_plan_id, organization_id, supersedes_envelope_id, classification, envelope_format_version, algorithm_identifier,
         key_reference_identifier, nonce_or_iv, opaque_ciphertext, ciphertext_sha256, trusted_payload_sha256,
         recorded_by_identity_id, recorded_at)
    VALUES (v_id, p_mission_plan_id, v_plan.organization_id, p_supersedes_envelope_id,
            'INTERNAL_STAFF_ONLY', p_envelope_format_version,
            p_algorithm_identifier, p_key_reference_identifier, p_nonce_or_iv, v_bytes, p_ciphertext_sha256,
            p_trusted_payload_sha256, v_actor, v_now);
    UPDATE medialab_core.mission_plan_drafts SET
        source_fingerprint_sha256 = medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id),
        draft_generation = draft_generation + 1, updated_by_identity_id = v_actor, updated_at = v_now
    WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, event_type, actor_identity_id, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, 'SENSITIVE_ENVELOPE_RECORDED', v_actor,
            p_idempotency_key, jsonb_build_object('envelope_id', v_id,
              'supersedes_envelope_id', p_supersedes_envelope_id, 'ciphertext_sha256', p_ciphertext_sha256), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'RECORD_MISSION_PLAN_ENVELOPE', p_idempotency_key,
        v_hash, jsonb_build_object('envelope_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.add_mission_plan_note(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid,
    p_visibility_classification text,
    p_note_text text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_hash text; v_replay jsonb; v_id uuid; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    IF p_visibility_classification NOT IN ('INTERNAL_STAFF_ONLY', 'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE') OR
       COALESCE(btrim(p_note_text), '') = '' OR length(p_note_text) > 4000 THEN
        RAISE EXCEPTION 'Mission Plan note requires approved visibility and bounded attributable text' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_mission_plan_id, p_visibility_classification, p_note_text
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'ADD_MISSION_PLAN_NOTE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'note_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.mission_plan_notes
        (id, mission_plan_id, organization_id, visibility_classification, note_text, author_identity_id, authored_at)
    VALUES (v_id, p_mission_plan_id, v_plan.organization_id, p_visibility_classification, p_note_text, v_actor, v_now);
    UPDATE medialab_core.mission_plan_drafts SET
        source_fingerprint_sha256 = medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id),
        draft_generation = draft_generation + 1, updated_by_identity_id = v_actor, updated_at = v_now
    WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, event_type, actor_identity_id, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, 'NOTE_ADDED', v_actor, p_idempotency_key,
            jsonb_build_object('note_id', v_id, 'visibility', p_visibility_classification), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'ADD_MISSION_PLAN_NOTE', p_idempotency_key,
        v_hash, jsonb_build_object('note_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.refresh_mission_plan_draft(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_mission_plan_id)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'REFRESH_MISSION_PLAN_DRAFT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'mission_plan_id')::uuid; END IF;
    UPDATE medialab_core.mission_plan_draft_contacts dc SET
        snapshot_contact_type = cm.contact_type,
        snapshot_submitted_value = cm.submitted_value,
        snapshot_normalized_value = cm.normalized_value,
        snapshot_lifecycle_state = cm.lifecycle_state,
        selected_by_identity_id = v_actor,
        selected_at = v_now
    FROM medialab_core.contact_methods cm
    WHERE dc.mission_plan_id = p_mission_plan_id AND cm.id = dc.contact_method_id;
    UPDATE medialab_core.mission_plan_drafts SET
        source_fingerprint_sha256 = medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id),
        draft_generation = draft_generation + 1, updated_by_identity_id = v_actor, updated_at = v_now
    WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, event_type, actor_identity_id, idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, 'DRAFT_REFRESHED', v_actor, p_idempotency_key,
            jsonb_build_object('source_fingerprint_refreshed', true), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'REFRESH_MISSION_PLAN_DRAFT', p_idempotency_key,
        v_hash, jsonb_build_object('mission_plan_id', p_mission_plan_id));
    RETURN p_mission_plan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_mission_plan_superseding_draft(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid,
    p_base_version_id uuid
)
RETURNS uuid AS $$
DECLARE
    v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_base medialab_core.mission_plan_versions%ROWTYPE;
    v_hash text; v_replay jsonb; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    SELECT * INTO v_base FROM medialab_core.mission_plan_versions
     WHERE id = p_base_version_id AND mission_plan_id = p_mission_plan_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Superseding draft requires an issued version from the same Mission Plan' USING ERRCODE = '42501';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_mission_plan_id, p_base_version_id)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'CREATE_MISSION_PLAN_SUPERSEDING_DRAFT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'mission_plan_id')::uuid; END IF;
    DELETE FROM medialab_core.mission_plan_draft_workstreams WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_draft_workstreams
        (mission_plan_id, service_workstream_id, job_id, organization_id, selected_by_identity_id, selected_at)
    SELECT p_mission_plan_id, vw.service_workstream_id, vw.job_id, vw.organization_id, v_actor, v_now
      FROM medialab_core.mission_plan_version_workstreams vw
      JOIN medialab_core.service_workstreams sw ON sw.id = vw.service_workstream_id
     WHERE vw.mission_plan_version_id = p_base_version_id
       AND sw.current_state NOT IN ('COMPLETED', 'CANCELLED')
     ORDER BY vw.service_workstream_id;
    DELETE FROM medialab_core.mission_plan_draft_contacts WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_draft_contacts
        (id, mission_plan_id, organization_id, person_id, contact_method_id, contact_role,
         visibility_classification, snapshot_contact_type, snapshot_submitted_value, snapshot_normalized_value,
         snapshot_lifecycle_state, selected_by_identity_id, selected_at)
    SELECT gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, vc.person_id, vc.contact_method_id,
           vc.contact_role, vc.visibility_classification, cm.contact_type, cm.submitted_value,
           cm.normalized_value, cm.lifecycle_state, v_actor, v_now
      FROM medialab_core.mission_plan_version_contacts vc
      JOIN medialab_core.contact_methods cm ON cm.id = vc.contact_method_id
     WHERE vc.mission_plan_version_id = p_base_version_id
     ORDER BY vc.contact_method_id, vc.contact_role;
    UPDATE medialab_core.mission_plan_drafts SET
        structured_content = v_base.canonical_json->'content',
        weather_status = v_base.canonical_json->'weather'->>'status',
        weather_evidence = NULLIF(v_base.canonical_json->'weather'->'evidence', 'null'::jsonb),
        weather_unavailable_reason = v_base.canonical_json->'weather'->>'unavailable_reason',
        source_fingerprint_sha256 = medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id),
        draft_generation = draft_generation + 1,
        updated_by_identity_id = v_actor,
        updated_at = v_now
    WHERE mission_plan_id = p_mission_plan_id;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, mission_plan_version_id, event_type, actor_identity_id,
         idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, p_base_version_id,
            'DRAFT_REVISED', v_actor, p_idempotency_key,
            jsonb_build_object('superseding_draft_base_version_id', p_base_version_id), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'CREATE_MISSION_PLAN_SUPERSEDING_DRAFT',
        p_idempotency_key, v_hash, jsonb_build_object('mission_plan_id', p_mission_plan_id));
    RETURN p_mission_plan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.issue_mission_plan_version(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid
)
RETURNS uuid AS $$
DECLARE
    v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_draft medialab_core.mission_plan_drafts%ROWTYPE;
    v_hash text; v_replay jsonb; v_current_fingerprint text; v_version_id uuid; v_previous_id uuid;
    v_version_number integer; v_canonical jsonb; v_canonical_hash text; v_readback_hash text;
    v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_mission_plan_id)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'ISSUE_MISSION_PLAN_VERSION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'mission_plan_version_id')::uuid; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mission-plan-issue:' || p_mission_plan_id::text, 0));
    SELECT * INTO v_draft FROM medialab_core.mission_plan_drafts WHERE mission_plan_id = p_mission_plan_id FOR UPDATE;
    v_current_fingerprint := medialab_core.compute_mission_plan_source_fingerprint(p_mission_plan_id);
    IF v_draft.source_fingerprint_sha256 <> v_current_fingerprint THEN
        RAISE EXCEPTION 'Mission Plan draft is stale; refresh is required before issuance' USING ERRCODE = '40001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM medialab_core.mission_plan_draft_workstreams WHERE mission_plan_id = p_mission_plan_id) THEN
        RAISE EXCEPTION 'Mission Plan issuance requires at least one selected eligible Workstream' USING ERRCODE = '22023';
    END IF;
    SELECT id, version_number INTO v_previous_id, v_version_number
      FROM medialab_core.mission_plan_versions WHERE mission_plan_id = p_mission_plan_id
     ORDER BY version_number DESC LIMIT 1;
    v_version_number := COALESCE(v_version_number, 0) + 1;
    v_version_id := gen_random_uuid();
    v_canonical := jsonb_build_object(
        'schema_version', v_draft.schema_version,
        'mission_plan_id', p_mission_plan_id,
        'mission_plan_version_id', v_version_id,
        'version_number', v_version_number,
        'supersedes_version_id', v_previous_id,
        'issued_at', v_now,
        'issued_by_identity_id', v_actor,
        'source_fingerprint_sha256', v_current_fingerprint,
        'relationship', jsonb_build_object(
            'organization_id', v_plan.organization_id, 'order_id', v_plan.order_id,
            'property_hub_id', v_plan.property_hub_id, 'job_id', v_plan.job_id,
            'appointment_id', v_plan.appointment_id, 'job_appointment_id', v_plan.job_appointment_id
        ),
        'content', v_draft.structured_content,
        'weather', jsonb_build_object(
            'status', v_draft.weather_status, 'evidence', v_draft.weather_evidence,
            'unavailable_reason', v_draft.weather_unavailable_reason,
            'attributed_by_identity_id', v_draft.updated_by_identity_id,
            'attributed_at', v_draft.updated_at
        ),
        'selected_workstreams', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'service_workstream_id', sw.id, 'state', sw.current_state,
                'source_description', sw.frozen_source_description, 'source_quantity', sw.frozen_source_quantity,
                'source_commercial_unit', sw.frozen_source_commercial_unit, 'source_item_kind', sw.frozen_source_item_kind
            ) ORDER BY sw.id)
            FROM medialab_core.mission_plan_draft_workstreams dws
            JOIN medialab_core.service_workstreams sw ON sw.id = dws.service_workstream_id
            WHERE dws.mission_plan_id = p_mission_plan_id
        ), '[]'::jsonb),
        'contacts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'person_id', dc.person_id, 'contact_method_id', dc.contact_method_id,
                'role', dc.contact_role, 'visibility', dc.visibility_classification,
                'contact_type', dc.snapshot_contact_type, 'submitted_value', dc.snapshot_submitted_value,
                'normalized_value', dc.snapshot_normalized_value, 'lifecycle_state', dc.snapshot_lifecycle_state
            ) ORDER BY dc.contact_method_id, dc.contact_role)
            FROM medialab_core.mission_plan_draft_contacts dc WHERE dc.mission_plan_id = p_mission_plan_id
        ), '[]'::jsonb),
        'notes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'mission_plan_note_id', n.id, 'visibility', n.visibility_classification,
                'text', n.note_text, 'author_identity_id', n.author_identity_id, 'authored_at', n.authored_at
            ) ORDER BY n.authored_at, n.id)
            FROM medialab_core.mission_plan_notes n WHERE n.mission_plan_id = p_mission_plan_id
        ), '[]'::jsonb),
        'sensitive_envelope_evidence', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'envelope_id', e.id, 'classification', e.classification,
                'supersedes_envelope_id', e.supersedes_envelope_id,
                'envelope_format_version', e.envelope_format_version, 'algorithm_identifier', e.algorithm_identifier,
                'key_reference_identifier', e.key_reference_identifier, 'nonce_or_iv_present', e.nonce_or_iv IS NOT NULL,
                'ciphertext_sha256', e.ciphertext_sha256, 'trusted_payload_sha256', e.trusted_payload_sha256,
                'recorded_by_identity_id', e.recorded_by_identity_id, 'recorded_at', e.recorded_at
            ) ORDER BY e.recorded_at, e.id)
            FROM medialab_core.mission_plan_sensitive_envelopes e WHERE e.mission_plan_id = p_mission_plan_id
        ), '[]'::jsonb)
    );
    IF v_canonical::text ~* '"(plaintext_secret|password|access_token|private_key|ciphertext)"[[:space:]]*:' THEN
        RAISE EXCEPTION 'Canonical Mission Plan JSON contains prohibited protected-secret material' USING ERRCODE = '22023';
    END IF;
    v_canonical_hash := encode(sha256(convert_to(v_canonical::text, 'UTF8')), 'hex');
    INSERT INTO medialab_core.mission_plan_versions
        (id, mission_plan_id, organization_id, version_number, supersedes_version_id, schema_version,
         draft_generation, source_fingerprint_sha256, canonical_json, canonical_json_sha256,
         issued_by_identity_id, issued_at)
    VALUES (v_version_id, p_mission_plan_id, v_plan.organization_id, v_version_number, v_previous_id,
            v_draft.schema_version, v_draft.draft_generation, v_current_fingerprint, v_canonical,
            v_canonical_hash, v_actor, v_now);
    INSERT INTO medialab_core.mission_plan_version_workstreams
        (mission_plan_version_id, mission_plan_id, service_workstream_id, job_id, organization_id,
         frozen_state, frozen_source_description, frozen_source_quantity, frozen_source_commercial_unit,
         frozen_source_item_kind)
    SELECT v_version_id, p_mission_plan_id, sw.id, sw.job_id, sw.organization_id, sw.current_state,
           sw.frozen_source_description, sw.frozen_source_quantity, sw.frozen_source_commercial_unit,
           sw.frozen_source_item_kind
      FROM medialab_core.mission_plan_draft_workstreams dws
      JOIN medialab_core.service_workstreams sw ON sw.id = dws.service_workstream_id
     WHERE dws.mission_plan_id = p_mission_plan_id ORDER BY sw.id;
    INSERT INTO medialab_core.mission_plan_version_contacts
        (id, mission_plan_version_id, mission_plan_id, person_id, contact_method_id, contact_role,
         visibility_classification, snapshot_contact_type, snapshot_submitted_value, snapshot_normalized_value,
         snapshot_lifecycle_state)
    SELECT gen_random_uuid(), v_version_id, p_mission_plan_id, person_id, contact_method_id, contact_role,
           visibility_classification, snapshot_contact_type, snapshot_submitted_value, snapshot_normalized_value,
           snapshot_lifecycle_state
      FROM medialab_core.mission_plan_draft_contacts WHERE mission_plan_id = p_mission_plan_id
     ORDER BY contact_method_id, contact_role;
    INSERT INTO medialab_core.mission_plan_version_notes
        (mission_plan_version_id, mission_plan_id, mission_plan_note_id, visibility_classification,
         frozen_note_text, author_identity_id, authored_at)
    SELECT v_version_id, p_mission_plan_id, id, visibility_classification, note_text, author_identity_id, authored_at
      FROM medialab_core.mission_plan_notes WHERE mission_plan_id = p_mission_plan_id ORDER BY authored_at, id;
    SELECT encode(sha256(convert_to(canonical_json::text, 'UTF8')), 'hex') INTO v_readback_hash
      FROM medialab_core.mission_plan_versions WHERE id = v_version_id;
    IF v_readback_hash <> v_canonical_hash THEN
        RAISE EXCEPTION 'Mission Plan canonical JSON readback hash mismatch' USING ERRCODE = 'XX001';
    END IF;
    INSERT INTO medialab_core.mission_plan_events
        (id, mission_plan_id, organization_id, mission_plan_version_id, event_type, actor_identity_id,
         idempotency_key, evidence, occurred_at)
    VALUES (gen_random_uuid(), p_mission_plan_id, v_plan.organization_id, v_version_id, 'VERSION_ISSUED', v_actor,
            p_idempotency_key, jsonb_build_object('version_number', v_version_number,
              'canonical_json_sha256', v_canonical_hash, 'supersedes_version_id', v_previous_id), v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'ISSUE_MISSION_PLAN_VERSION', p_idempotency_key,
        v_hash, jsonb_build_object('mission_plan_version_id', v_version_id));
    RETURN v_version_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_mission_plan_open_event(
    p_session_token text,
    p_idempotency_key text,
    p_mission_plan_id uuid,
    p_mission_plan_version_id uuid,
    p_event_type text,
    p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE; v_scope text; v_hash text; v_replay jsonb; v_id uuid; v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    v_scope := medialab_core.actor_can_read_mission_plan(v_actor, p_mission_plan_id);
    IF v_scope IS NULL THEN RAISE EXCEPTION 'Actor lacks Mission Plan read authority' USING ERRCODE = '42501'; END IF;
    IF p_event_type NOT IN ('OPENED', 'ACKNOWLEDGED') OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' OR
       (p_mission_plan_version_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM medialab_core.mission_plan_versions WHERE id = p_mission_plan_version_id AND mission_plan_id = p_mission_plan_id
       )) THEN
        RAISE EXCEPTION 'Mission Plan open event type, evidence, or version reference is invalid' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_mission_plan_id, p_mission_plan_version_id, p_event_type, p_evidence
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_mission_plan_idempotency(v_actor, 'RECORD_MISSION_PLAN_OPEN_EVENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'open_event_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.mission_plan_open_events
        (id, mission_plan_id, organization_id, mission_plan_version_id, event_type, actor_identity_id, evidence, occurred_at)
    VALUES (v_id, p_mission_plan_id, v_plan.organization_id, p_mission_plan_version_id, p_event_type, v_actor, p_evidence, v_now);
    PERFORM medialab_core.record_mission_plan_idempotency(v_actor, 'RECORD_MISSION_PLAN_OPEN_EVENT', p_idempotency_key,
        v_hash, jsonb_build_object('open_event_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_mission_plan_record(
    p_session_token text,
    p_mission_plan_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_scope text; v_plan medialab_core.mission_plans%ROWTYPE; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    v_scope := medialab_core.actor_can_read_mission_plan(v_actor, p_mission_plan_id);
    IF v_scope IS NULL THEN RAISE EXCEPTION 'Actor lacks Mission Plan read authority' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object(
        'mission_plan_id', v_plan.id,
        'organization_id', v_plan.organization_id,
        'order_id', v_plan.order_id,
        'property_hub_id', v_plan.property_hub_id,
        'job_id', v_plan.job_id,
        'appointment_id', v_plan.appointment_id,
        'job_appointment_id', v_plan.job_appointment_id,
        'audience_scope', v_scope,
        'draft', CASE WHEN v_scope = 'INTERNAL_STAFF' THEN (
            SELECT jsonb_build_object(
                'schema_version', d.schema_version, 'draft_generation', d.draft_generation,
                'source_fingerprint_sha256', d.source_fingerprint_sha256,
                'content', d.structured_content, 'weather_status', d.weather_status,
                'weather_evidence', d.weather_evidence, 'weather_unavailable_reason', d.weather_unavailable_reason
            ) FROM medialab_core.mission_plan_drafts d WHERE d.mission_plan_id = v_plan.id
        ) ELSE NULL END,
        'versions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'mission_plan_version_id', v.id, 'version_number', v.version_number,
                'supersedes_version_id', v.supersedes_version_id,
                'canonical_json_sha256', v.canonical_json_sha256, 'issued_at', v.issued_at,
                'content', jsonb_build_object(
                    'schema_version', v.canonical_json->'schema_version',
                    'mission_plan_id', v.canonical_json->'mission_plan_id',
                    'mission_plan_version_id', v.canonical_json->'mission_plan_version_id',
                    'version_number', v.canonical_json->'version_number',
                    'relationship', v.canonical_json->'relationship',
                    'weather', v.canonical_json->'weather',
                    'selected_workstreams', v.canonical_json->'selected_workstreams',
                    'sections', COALESCE((
                        SELECT jsonb_agg(section ORDER BY ordinal)
                        FROM jsonb_array_elements(v.canonical_json->'content'->'sections') WITH ORDINALITY AS s(section, ordinal)
                        WHERE v_scope = 'INTERNAL_STAFF' OR section->>'visibility' IN ('ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE')
                    ), '[]'::jsonb),
                    'contacts', COALESCE((
                        SELECT jsonb_agg(contact ORDER BY ordinal)
                        FROM jsonb_array_elements(v.canonical_json->'contacts') WITH ORDINALITY AS c(contact, ordinal)
                        WHERE v_scope = 'INTERNAL_STAFF' OR contact->>'visibility' IN ('ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE')
                    ), '[]'::jsonb),
                    'notes', COALESCE((
                        SELECT jsonb_agg(note ORDER BY ordinal)
                        FROM jsonb_array_elements(v.canonical_json->'notes') WITH ORDINALITY AS n(note, ordinal)
                        WHERE v_scope = 'INTERNAL_STAFF' OR note->>'visibility' IN ('ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE')
                    ), '[]'::jsonb)
                )
            ) ORDER BY v.version_number)
            FROM medialab_core.mission_plan_versions v WHERE v.mission_plan_id = v_plan.id
        ), '[]'::jsonb),
        'open_events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', oe.id, 'mission_plan_version_id', oe.mission_plan_version_id,
                'event_type', oe.event_type, 'actor_identity_id', oe.actor_identity_id,
                'evidence', oe.evidence, 'occurred_at', oe.occurred_at
            ) ORDER BY oe.occurred_at, oe.id)
            FROM medialab_core.mission_plan_open_events oe WHERE oe.mission_plan_id = v_plan.id
        ), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_mission_plans(
    p_session_token text,
    p_job_id uuid,
    p_appointment_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_result jsonb; v_matching_count integer; v_visible_count integer;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    IF (p_job_id IS NULL) = (p_appointment_id IS NULL) THEN
        RAISE EXCEPTION 'Exactly one Job or Appointment filter is required' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::integer,
           count(*) FILTER (WHERE medialab_core.actor_can_read_mission_plan(v_actor, mp.id) IS NOT NULL)::integer
      INTO v_matching_count, v_visible_count
      FROM medialab_core.mission_plans mp
     WHERE (p_job_id IS NOT NULL AND mp.job_id = p_job_id) OR
           (p_appointment_id IS NOT NULL AND mp.appointment_id = p_appointment_id);
    IF v_matching_count > 0 AND v_visible_count = 0 THEN
        RAISE EXCEPTION 'Actor lacks Mission Plan read authority' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'mission_plan_id', mp.id,
        'organization_id', mp.organization_id,
        'order_id', mp.order_id,
        'property_hub_id', mp.property_hub_id,
        'job_id', mp.job_id,
        'appointment_id', mp.appointment_id,
        'job_appointment_id', mp.job_appointment_id,
        'version_count', (SELECT count(*) FROM medialab_core.mission_plan_versions v WHERE v.mission_plan_id = mp.id),
        'latest_version_number', (SELECT max(v.version_number) FROM medialab_core.mission_plan_versions v WHERE v.mission_plan_id = mp.id)
    ) ORDER BY mp.created_at, mp.id), '[]'::jsonb) INTO v_result
      FROM medialab_core.mission_plans mp
     WHERE ((p_job_id IS NOT NULL AND mp.job_id = p_job_id) OR
            (p_appointment_id IS NOT NULL AND mp.appointment_id = p_appointment_id))
       AND medialab_core.actor_can_read_mission_plan(v_actor, mp.id) IS NOT NULL;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_mission_plan_sensitive_envelopes(
    p_session_token text,
    p_mission_plan_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_plan medialab_core.mission_plans%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.sensitive_read');
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', e.id, 'classification', e.classification,
            'supersedes_envelope_id', e.supersedes_envelope_id,
            'envelope_format_version', e.envelope_format_version,
            'algorithm_identifier', e.algorithm_identifier,
            'key_reference_identifier', e.key_reference_identifier,
            'nonce_or_iv', e.nonce_or_iv,
            'opaque_ciphertext_base64', encode(e.opaque_ciphertext, 'base64'),
            'ciphertext_sha256', e.ciphertext_sha256,
            'trusted_payload_sha256', e.trusted_payload_sha256,
            'recorded_by_identity_id', e.recorded_by_identity_id,
            'recorded_at', e.recorded_at
        ) ORDER BY e.recorded_at, e.id)
        FROM medialab_core.mission_plan_sensitive_envelopes e WHERE e.mission_plan_id = p_mission_plan_id
    ), '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER mission_plans_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plans
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_drafts_update_guard BEFORE UPDATE ON medialab_core.mission_plan_drafts
FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_mission_plan_draft_update();
CREATE TRIGGER mission_plan_drafts_delete_guard BEFORE DELETE ON medialab_core.mission_plan_drafts
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_sensitive_envelopes_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_sensitive_envelopes
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_notes_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_notes
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_versions_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_versions
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_version_workstreams_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_version_workstreams
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_version_contacts_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_version_contacts
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_version_notes_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_version_notes
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_open_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_open_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();
CREATE TRIGGER mission_plan_command_idempotency_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.mission_plan_command_idempotency
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_mission_plan_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.mission_plans FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_drafts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_draft_workstreams FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_draft_contacts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_sensitive_envelopes FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_notes FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_versions FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_version_workstreams FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_version_contacts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_version_notes FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_open_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.mission_plan_command_idempotency FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_mission_plan_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_mission_plan_draft_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_mission_plan_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_mission_plan_content(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.check_mission_plan_idempotency(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_mission_plan_idempotency(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.compute_mission_plan_source_fingerprint(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.actor_can_read_mission_plan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_mission_plan_draft(text, text, uuid, jsonb, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.revise_mission_plan_draft(text, text, uuid, jsonb, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.replace_mission_plan_draft_workstreams(text, text, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.replace_mission_plan_draft_contacts(text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_mission_plan_sensitive_envelope(text, text, uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.add_mission_plan_note(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.refresh_mission_plan_draft(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_mission_plan_superseding_draft(text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.issue_mission_plan_version(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_mission_plan_open_event(text, text, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_mission_plan_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_mission_plans(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_mission_plan_sensitive_envelopes(text, uuid) FROM PUBLIC;
