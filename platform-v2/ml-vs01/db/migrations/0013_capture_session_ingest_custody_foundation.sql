-- P02-M10-A: provider-neutral Capture Session, ingest, and custody foundation.
-- Synthetic nonproduction database law only. No card scan, hashing, media bytes, provider I/O, or Desktop work occurs here.

CREATE TABLE medialab_core.capture_sessions (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    session_label text NOT NULL,
    intake_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT capture_sessions_id_org_key UNIQUE (id, organization_id),
    CONSTRAINT capture_sessions_label_check CHECK (
        session_label = btrim(session_label) AND session_label <> '' AND length(session_label) <= 300
    ),
    CONSTRAINT capture_sessions_context_check CHECK (jsonb_typeof(intake_context) = 'object')
);

CREATE TABLE medialab_core.capture_session_assignments (
    id uuid PRIMARY KEY,
    capture_session_id uuid NOT NULL UNIQUE,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    assignment_kind text NOT NULL,
    reason text NOT NULL,
    assigned_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_session_id, organization_id)
        REFERENCES medialab_core.capture_sessions(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT capture_session_assignments_id_org_job_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT capture_session_assignments_kind_check CHECK (assignment_kind IN ('INITIAL_ASSIGNMENT', 'QUARANTINE_ASSIGNMENT')),
    CONSTRAINT capture_session_assignments_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    )
);

CREATE TABLE medialab_core.capture_session_events (
    id uuid PRIMARY KEY,
    capture_session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_session_id, organization_id)
        REFERENCES medialab_core.capture_sessions(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT capture_session_events_type_check CHECK (event_type IN ('QUARANTINE_CREATED', 'ASSIGNED_CREATED', 'QUARANTINE_ASSIGNED', 'ITEM_PROMOTED')),
    CONSTRAINT capture_session_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT capture_session_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.capture_sources (
    id uuid PRIMARY KEY,
    capture_session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    source_kind text NOT NULL,
    source_label text NOT NULL,
    registered_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_session_id, organization_id)
        REFERENCES medialab_core.capture_sessions(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT capture_sources_id_org_session_key UNIQUE (id, organization_id, capture_session_id),
    CONSTRAINT capture_sources_kind_check CHECK (source_kind IN ('CARD', 'DEVICE', 'SOURCE_FOLDER', 'STAGING_SOURCE', 'OTHER_BOUNDED_SOURCE')),
    CONSTRAINT capture_sources_label_check CHECK (
        source_label = btrim(source_label) AND source_label <> '' AND length(source_label) <= 300 AND
        source_label !~ '(^/|^[A-Za-z]:[\\/]|://)'
    )
);

CREATE TABLE medialab_core.capture_source_observations (
    id uuid PRIMARY KEY,
    capture_source_id uuid NOT NULL,
    capture_session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    observation_type text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_source_id, organization_id, capture_session_id)
        REFERENCES medialab_core.capture_sources(id, organization_id, capture_session_id) ON DELETE RESTRICT,
    CONSTRAINT capture_source_observations_type_check CHECK (observation_type IN (
        'SOURCE_REGISTERED', 'SOURCE_REOBSERVED', 'SOURCE_LABEL_OBSERVED', 'SOURCE_REFERENCE_DIGEST_OBSERVED'
    )),
    CONSTRAINT capture_source_observations_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.capture_items (
    id uuid PRIMARY KEY,
    capture_session_id uuid NOT NULL,
    capture_source_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    discovered_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    discovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_source_id, organization_id, capture_session_id)
        REFERENCES medialab_core.capture_sources(id, organization_id, capture_session_id) ON DELETE RESTRICT,
    CONSTRAINT capture_items_id_org_session_key UNIQUE (id, organization_id, capture_session_id),
    CONSTRAINT capture_items_id_org_key UNIQUE (id, organization_id)
);

CREATE TABLE medialab_core.capture_item_observations (
    id uuid PRIMARY KEY,
    capture_item_id uuid NOT NULL,
    capture_session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    observed_filename text NOT NULL,
    observed_byte_size bigint NULL,
    observed_media_type text NULL,
    observed_capture_time timestamptz NULL,
    source_relative_reference text NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_item_id, organization_id, capture_session_id)
        REFERENCES medialab_core.capture_items(id, organization_id, capture_session_id) ON DELETE RESTRICT,
    CONSTRAINT capture_item_observations_filename_check CHECK (
        observed_filename = btrim(observed_filename) AND observed_filename <> '' AND length(observed_filename) <= 500 AND
        observed_filename !~ '[\\/]'
    ),
    CONSTRAINT capture_item_observations_size_check CHECK (observed_byte_size IS NULL OR observed_byte_size >= 0),
    CONSTRAINT capture_item_observations_media_type_check CHECK (
        observed_media_type IS NULL OR (
            observed_media_type = lower(btrim(observed_media_type)) AND
            observed_media_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
        )
    ),
    CONSTRAINT capture_item_observations_relative_reference_check CHECK (
        source_relative_reference IS NULL OR (
            source_relative_reference = btrim(source_relative_reference) AND source_relative_reference <> '' AND
            length(source_relative_reference) <= 1000 AND
            source_relative_reference !~ '(^/|^[A-Za-z]:[\\/]|://|(^|/)\.\.(/|$))'
        )
    ),
    CONSTRAINT capture_item_observations_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.capture_item_verification_events (
    id uuid PRIMARY KEY,
    capture_item_id uuid NOT NULL,
    capture_session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    verification_state text NOT NULL,
    verification_method text NOT NULL,
    observed_checksum_sha256 text NULL,
    observed_byte_size bigint NULL,
    observed_media_type text NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    verified_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_item_id, organization_id, capture_session_id)
        REFERENCES medialab_core.capture_items(id, organization_id, capture_session_id) ON DELETE RESTRICT,
    CONSTRAINT capture_item_verification_state_check CHECK (verification_state IN ('PENDING', 'VERIFIED', 'FAILED', 'CONFLICT')),
    CONSTRAINT capture_item_verification_method_check CHECK (verification_method ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT capture_item_verification_checksum_check CHECK (
        observed_checksum_sha256 IS NULL OR observed_checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT capture_item_verification_size_check CHECK (observed_byte_size IS NULL OR observed_byte_size >= 0),
    CONSTRAINT capture_item_verification_media_type_check CHECK (
        observed_media_type IS NULL OR (
            observed_media_type = lower(btrim(observed_media_type)) AND
            observed_media_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
        )
    ),
    CONSTRAINT capture_item_verification_complete_check CHECK (
        verification_state <> 'VERIFIED' OR
        (observed_checksum_sha256 IS NOT NULL AND observed_byte_size IS NOT NULL AND observed_media_type IS NOT NULL)
    ),
    CONSTRAINT capture_item_verification_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.capture_item_custody_events (
    id uuid PRIMARY KEY,
    capture_item_id uuid NOT NULL,
    capture_session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NULL,
    capture_source_id uuid NULL,
    media_operation_id uuid NULL,
    media_operation_receipt_id uuid NULL,
    custody_state text NOT NULL,
    observation_method text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_item_id, organization_id, capture_session_id)
        REFERENCES medialab_core.capture_items(id, organization_id, capture_session_id) ON DELETE RESTRICT,
    FOREIGN KEY (capture_source_id, organization_id, capture_session_id)
        REFERENCES medialab_core.capture_sources(id, organization_id, capture_session_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_operation_id, organization_id, job_id)
        REFERENCES medialab_core.media_operations(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_operation_receipt_id)
        REFERENCES medialab_core.media_operation_receipts(id) ON DELETE RESTRICT,
    CONSTRAINT capture_item_custody_state_check CHECK (custody_state IN (
        'ITEM_OBSERVED_AT_SOURCE', 'CUSTODY_COPY_OBSERVED', 'VERIFICATION_PENDING',
        'VERIFICATION_SUCCEEDED', 'VERIFICATION_FAILED', 'VERIFICATION_CONFLICT',
        'QUARANTINE_RETAINED', 'PROMOTED_TO_CANONICAL_ASSET'
    )),
    CONSTRAINT capture_item_custody_method_check CHECK (observation_method ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT capture_item_custody_operation_context_check CHECK (
        (media_operation_id IS NULL AND media_operation_receipt_id IS NULL) OR job_id IS NOT NULL
    ),
    CONSTRAINT capture_item_custody_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.capture_duplicate_evidence (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    left_capture_item_id uuid NOT NULL,
    right_capture_item_id uuid NOT NULL,
    evidence_classification text NOT NULL,
    basis text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (left_capture_item_id, organization_id)
        REFERENCES medialab_core.capture_items(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (right_capture_item_id, organization_id)
        REFERENCES medialab_core.capture_items(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT capture_duplicate_evidence_pair_type_key UNIQUE (
        left_capture_item_id, right_capture_item_id, evidence_classification, id
    ),
    CONSTRAINT capture_duplicate_evidence_distinct_check CHECK (left_capture_item_id <> right_capture_item_id),
    CONSTRAINT capture_duplicate_evidence_order_check CHECK (left_capture_item_id < right_capture_item_id),
    CONSTRAINT capture_duplicate_evidence_class_check CHECK (evidence_classification IN (
        'EXACT_BYTE_MATCH', 'REDUNDANT_CUSTODY_COPY', 'POSSIBLE_DUPLICATE'
    )),
    CONSTRAINT capture_duplicate_evidence_basis_check CHECK (
        basis = btrim(basis) AND basis <> '' AND length(basis) <= 500
    ),
    CONSTRAINT capture_duplicate_evidence_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT capture_duplicate_evidence_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.capture_item_promotions (
    id uuid PRIMARY KEY,
    capture_item_id uuid NOT NULL UNIQUE,
    capture_session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    media_asset_id uuid NOT NULL UNIQUE,
    media_asset_version_id uuid NOT NULL UNIQUE,
    verification_event_id uuid NOT NULL,
    promoted_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    promoted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (capture_item_id, organization_id, capture_session_id)
        REFERENCES medialab_core.capture_items(id, organization_id, capture_session_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_id, organization_id, job_id)
        REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (verification_event_id)
        REFERENCES medialab_core.capture_item_verification_events(id) ON DELETE RESTRICT
);

CREATE INDEX capture_session_assignments_job_idx ON medialab_core.capture_session_assignments (job_id, assigned_at, id);
CREATE INDEX capture_session_events_session_idx ON medialab_core.capture_session_events (capture_session_id, recorded_at, id);
CREATE INDEX capture_sources_session_idx ON medialab_core.capture_sources (capture_session_id, registered_at, id);
CREATE INDEX capture_source_observations_source_idx ON medialab_core.capture_source_observations (capture_source_id, observed_at, id);
CREATE INDEX capture_items_source_idx ON medialab_core.capture_items (capture_source_id, discovered_at, id);
CREATE INDEX capture_item_observations_item_idx ON medialab_core.capture_item_observations (capture_item_id, observed_at, id);
CREATE INDEX capture_item_verification_item_idx ON medialab_core.capture_item_verification_events (capture_item_id, verified_at, id);
CREATE INDEX capture_item_custody_item_idx ON medialab_core.capture_item_custody_events (capture_item_id, observed_at, id);
CREATE INDEX capture_duplicate_job_idx ON medialab_core.capture_duplicate_evidence (job_id, recorded_at, id);
CREATE INDEX capture_promotions_job_idx ON medialab_core.capture_item_promotions (job_id, promoted_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_capture_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable append-only evidence: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_capture_permission(
    p_actor_identity_id uuid, p_organization_id uuid, p_permission_code text
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

CREATE OR REPLACE FUNCTION medialab_core.validate_capture_safe_json(p_evidence jsonb)
RETURNS void AS $$
BEGIN
    IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
        RAISE EXCEPTION 'Capture evidence must be a JSON object' USING ERRCODE = '22023';
    END IF;
    IF p_evidence::text ~* '"([a-z0-9_]*credential[a-z0-9_]*|[a-z0-9_]*password[a-z0-9_]*|[a-z0-9_]*secret[a-z0-9_]*|[a-z0-9_]*token[a-z0-9_]*|access_key|private_key|signed_url|signed_uri|provider_payload|raw_payload|media_bytes|file_bytes|base64|absolute_path|url|uri)"[[:space:]]*:' OR
       p_evidence::text ~* '(https?://|file://|data:[a-z0-9.+-]+/[a-z0-9.+-]+;base64,|[?&](signature|token|credential|secret|access_key)=|:[[:space:]]*"(/|[A-Za-z]:[\\]))' THEN
        RAISE EXCEPTION 'Credentials, signed references, URLs, unrestricted payloads, absolute paths, and media bytes are prohibited from capture evidence'
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.capture_session_assignment(p_capture_session_id uuid)
RETURNS TABLE (organization_id uuid, job_id uuid) AS $$
    SELECT a.organization_id, a.job_id
      FROM medialab_core.capture_session_assignments a
     WHERE a.capture_session_id = p_capture_session_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_capture_session(
    p_session_token text, p_idempotency_key text, p_organization_id uuid, p_job_id uuid,
    p_session_label text, p_reason text, p_intake_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_job medialab_core.jobs%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb; v_event text;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_capture_permission(v_actor, p_organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_intake_context);
    IF p_job_id IS NOT NULL THEN
        SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id AND organization_id = p_organization_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing, cross-tenant, or unavailable' USING ERRCODE = '42501'; END IF;
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_organization_id, p_job_id, p_session_label, p_reason, p_intake_context)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'CREATE_CAPTURE_SESSION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'capture_session_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_sessions
        (id, organization_id, session_label, intake_context, created_by_identity_id)
    VALUES (v_id, p_organization_id, p_session_label, p_intake_context, v_actor);
    IF p_job_id IS NULL THEN
        v_event := 'QUARANTINE_CREATED';
    ELSE
        INSERT INTO medialab_core.capture_session_assignments
            (id, capture_session_id, organization_id, job_id, assignment_kind, reason, assigned_by_identity_id)
        VALUES (gen_random_uuid(), v_id, p_organization_id, p_job_id, 'INITIAL_ASSIGNMENT', p_reason, v_actor);
        v_event := 'ASSIGNED_CREATED';
    END IF;
    INSERT INTO medialab_core.capture_session_events
        (id, capture_session_id, organization_id, job_id, event_type, reason, evidence, recorded_by_identity_id)
    VALUES (gen_random_uuid(), v_id, p_organization_id, p_job_id, v_event, p_reason, p_intake_context, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'CREATE_CAPTURE_SESSION', p_idempotency_key, v_hash,
        jsonb_build_object('capture_session_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.assign_capture_session(
    p_session_token text, p_idempotency_key text, p_capture_session_id uuid, p_job_id uuid, p_reason text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_session medialab_core.capture_sessions%ROWTYPE; v_job medialab_core.jobs%ROWTYPE;
        v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_session FROM medialab_core.capture_sessions WHERE id = p_capture_session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture Session is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_session.organization_id, 'media_capture.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_session_id, p_job_id, p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'ASSIGN_CAPTURE_SESSION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'assignment_id')::uuid; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.capture_session_assignments WHERE capture_session_id = v_session.id) THEN
        RAISE EXCEPTION 'Capture Session assignment is one-time and reassignment is prohibited' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id AND organization_id = v_session.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing, cross-tenant, or unavailable' USING ERRCODE = '42501'; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_session_assignments
        (id, capture_session_id, organization_id, job_id, assignment_kind, reason, assigned_by_identity_id)
    VALUES (v_id, v_session.id, v_session.organization_id, v_job.id, 'QUARANTINE_ASSIGNMENT', p_reason, v_actor);
    INSERT INTO medialab_core.capture_session_events
        (id, capture_session_id, organization_id, job_id, event_type, reason, evidence, recorded_by_identity_id)
    VALUES (gen_random_uuid(), v_session.id, v_session.organization_id, v_job.id, 'QUARANTINE_ASSIGNED', p_reason,
            '{}'::jsonb, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'ASSIGN_CAPTURE_SESSION', p_idempotency_key, v_hash,
        jsonb_build_object('assignment_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.register_capture_source(
    p_session_token text, p_idempotency_key text, p_capture_session_id uuid,
    p_source_kind text, p_source_label text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_session medialab_core.capture_sessions%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_session FROM medialab_core.capture_sessions WHERE id = p_capture_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture Session is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_session.organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_session_id, p_source_kind, p_source_label, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'REGISTER_CAPTURE_SOURCE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'capture_source_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_sources
        (id, capture_session_id, organization_id, source_kind, source_label, registered_by_identity_id)
    VALUES (v_id, v_session.id, v_session.organization_id, p_source_kind, p_source_label, v_actor);
    INSERT INTO medialab_core.capture_source_observations
        (id, capture_source_id, capture_session_id, organization_id, observation_type, evidence, observed_by_identity_id)
    VALUES (gen_random_uuid(), v_id, v_session.id, v_session.organization_id, 'SOURCE_REGISTERED', p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'REGISTER_CAPTURE_SOURCE', p_idempotency_key, v_hash,
        jsonb_build_object('capture_source_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_capture_source_observation(
    p_session_token text, p_idempotency_key text, p_capture_source_id uuid,
    p_observation_type text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_source medialab_core.capture_sources%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_source FROM medialab_core.capture_sources WHERE id = p_capture_source_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture source is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_source.organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_source_id, p_observation_type, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_CAPTURE_SOURCE_OBSERVATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'source_observation_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_source_observations
        (id, capture_source_id, capture_session_id, organization_id, observation_type, evidence, observed_by_identity_id)
    VALUES (v_id, v_source.id, v_source.capture_session_id, v_source.organization_id, p_observation_type, p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_CAPTURE_SOURCE_OBSERVATION', p_idempotency_key, v_hash,
        jsonb_build_object('source_observation_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.register_capture_item(
    p_session_token text, p_idempotency_key text, p_capture_source_id uuid, p_observed_filename text,
    p_observed_byte_size bigint, p_observed_media_type text, p_observed_capture_time timestamptz,
    p_source_relative_reference text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_source medialab_core.capture_sources%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_source FROM medialab_core.capture_sources WHERE id = p_capture_source_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture source is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_source.organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_source_id, p_observed_filename,
        p_observed_byte_size, p_observed_media_type, p_observed_capture_time, p_source_relative_reference, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'REGISTER_CAPTURE_ITEM', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'capture_item_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_items
        (id, capture_session_id, capture_source_id, organization_id, discovered_by_identity_id)
    VALUES (v_id, v_source.capture_session_id, v_source.id, v_source.organization_id, v_actor);
    INSERT INTO medialab_core.capture_item_observations
        (id, capture_item_id, capture_session_id, organization_id, observed_filename, observed_byte_size,
         observed_media_type, observed_capture_time, source_relative_reference, evidence, observed_by_identity_id)
    VALUES (gen_random_uuid(), v_id, v_source.capture_session_id, v_source.organization_id, p_observed_filename,
            p_observed_byte_size, p_observed_media_type, p_observed_capture_time, p_source_relative_reference, p_evidence, v_actor);
    INSERT INTO medialab_core.capture_item_custody_events
        (id, capture_item_id, capture_session_id, organization_id, job_id, capture_source_id, custody_state,
         observation_method, evidence, observed_by_identity_id)
    SELECT gen_random_uuid(), v_id, v_source.capture_session_id, v_source.organization_id, a.job_id, v_source.id,
           'ITEM_OBSERVED_AT_SOURCE', 'SYNTHETIC_DATABASE_OBSERVATION', p_evidence, v_actor
      FROM (SELECT NULL::uuid AS job_id) q
      LEFT JOIN medialab_core.capture_session_assignments a ON a.capture_session_id = v_source.capture_session_id;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'REGISTER_CAPTURE_ITEM', p_idempotency_key, v_hash,
        jsonb_build_object('capture_item_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_capture_item_observation(
    p_session_token text, p_idempotency_key text, p_capture_item_id uuid, p_observed_filename text,
    p_observed_byte_size bigint, p_observed_media_type text, p_observed_capture_time timestamptz,
    p_source_relative_reference text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_item medialab_core.capture_items%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_item FROM medialab_core.capture_items WHERE id = p_capture_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture item is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_item.organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_item_id, p_observed_filename,
        p_observed_byte_size, p_observed_media_type, p_observed_capture_time, p_source_relative_reference, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_CAPTURE_ITEM_OBSERVATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'item_observation_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_item_observations
        (id, capture_item_id, capture_session_id, organization_id, observed_filename, observed_byte_size,
         observed_media_type, observed_capture_time, source_relative_reference, evidence, observed_by_identity_id)
    VALUES (v_id, v_item.id, v_item.capture_session_id, v_item.organization_id, p_observed_filename,
            p_observed_byte_size, p_observed_media_type, p_observed_capture_time, p_source_relative_reference, p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_CAPTURE_ITEM_OBSERVATION', p_idempotency_key, v_hash,
        jsonb_build_object('item_observation_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_capture_item_verification(
    p_session_token text, p_idempotency_key text, p_capture_item_id uuid, p_verification_state text,
    p_verification_method text, p_observed_checksum_sha256 text, p_observed_byte_size bigint,
    p_observed_media_type text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_item medialab_core.capture_items%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
        v_effective_state text; v_job_id uuid;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_item FROM medialab_core.capture_items WHERE id = p_capture_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture item is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_item.organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_item_id, p_verification_state,
        p_verification_method, p_observed_checksum_sha256, p_observed_byte_size, p_observed_media_type, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_CAPTURE_ITEM_VERIFICATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'verification_event_id')::uuid; END IF;
    v_effective_state := p_verification_state;
    IF p_verification_state = 'VERIFIED' AND EXISTS (
        SELECT 1 FROM medialab_core.capture_item_verification_events e
         WHERE e.capture_item_id = v_item.id AND e.verification_state = 'VERIFIED'
           AND (e.observed_checksum_sha256, e.observed_byte_size, e.observed_media_type)
               IS DISTINCT FROM (p_observed_checksum_sha256, p_observed_byte_size, p_observed_media_type)
    ) THEN v_effective_state := 'CONFLICT'; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_item_verification_events
        (id, capture_item_id, capture_session_id, organization_id, verification_state, verification_method,
         observed_checksum_sha256, observed_byte_size, observed_media_type, evidence, verified_by_identity_id)
    VALUES (v_id, v_item.id, v_item.capture_session_id, v_item.organization_id, v_effective_state,
            p_verification_method, p_observed_checksum_sha256, p_observed_byte_size, p_observed_media_type, p_evidence, v_actor);
    SELECT job_id INTO v_job_id FROM medialab_core.capture_session_assignments WHERE capture_session_id = v_item.capture_session_id;
    INSERT INTO medialab_core.capture_item_custody_events
        (id, capture_item_id, capture_session_id, organization_id, job_id, capture_source_id, custody_state,
         observation_method, evidence, observed_by_identity_id)
    VALUES (gen_random_uuid(), v_item.id, v_item.capture_session_id, v_item.organization_id, v_job_id,
            v_item.capture_source_id,
            CASE v_effective_state WHEN 'PENDING' THEN 'VERIFICATION_PENDING' WHEN 'VERIFIED' THEN 'VERIFICATION_SUCCEEDED'
                 WHEN 'FAILED' THEN 'VERIFICATION_FAILED' ELSE 'VERIFICATION_CONFLICT' END,
            p_verification_method, p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_CAPTURE_ITEM_VERIFICATION', p_idempotency_key, v_hash,
        jsonb_build_object('verification_event_id', v_id, 'verification_state', v_effective_state));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_capture_item_custody(
    p_session_token text, p_idempotency_key text, p_capture_item_id uuid, p_custody_state text,
    p_capture_source_id uuid, p_media_operation_id uuid, p_media_operation_receipt_id uuid,
    p_observation_method text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_item medialab_core.capture_items%ROWTYPE; v_source medialab_core.capture_sources%ROWTYPE;
        v_operation medialab_core.media_operations%ROWTYPE; v_receipt medialab_core.media_operation_receipts%ROWTYPE;
        v_job_id uuid; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_item FROM medialab_core.capture_items WHERE id = p_capture_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture item is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_item.organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_evidence);
    IF p_custody_state NOT IN ('CUSTODY_COPY_OBSERVED', 'QUARANTINE_RETAINED') THEN
        RAISE EXCEPTION 'Ordinary custody commands may record only bounded copy or quarantine observations'
            USING ERRCODE = '22023';
    END IF;
    SELECT job_id INTO v_job_id FROM medialab_core.capture_session_assignments WHERE capture_session_id = v_item.capture_session_id;
    IF p_capture_source_id IS NOT NULL THEN
        SELECT * INTO v_source FROM medialab_core.capture_sources
         WHERE id = p_capture_source_id AND capture_session_id = v_item.capture_session_id AND organization_id = v_item.organization_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Custody source is missing, cross-tenant, or outside the Capture Session' USING ERRCODE = '42501'; END IF;
    END IF;
    IF p_media_operation_id IS NOT NULL THEN
        SELECT * INTO v_operation FROM medialab_core.media_operations
         WHERE id = p_media_operation_id AND organization_id = v_item.organization_id AND job_id = v_job_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Referenced operation is missing, cross-tenant, or cross-Job' USING ERRCODE = '42501'; END IF;
    END IF;
    IF p_media_operation_receipt_id IS NOT NULL THEN
        SELECT r.* INTO v_receipt FROM medialab_core.media_operation_receipts r
        JOIN medialab_core.media_operation_attempts a ON a.id = r.attempt_id
         WHERE r.id = p_media_operation_receipt_id AND a.operation_id = p_media_operation_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Referenced receipt does not belong to the referenced operation' USING ERRCODE = '42501'; END IF;
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_item_id, p_custody_state, p_capture_source_id,
        p_media_operation_id, p_media_operation_receipt_id, p_observation_method, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_CAPTURE_ITEM_CUSTODY', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'custody_event_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_item_custody_events
        (id, capture_item_id, capture_session_id, organization_id, job_id, capture_source_id,
         media_operation_id, media_operation_receipt_id, custody_state, observation_method, evidence, observed_by_identity_id)
    VALUES (v_id, v_item.id, v_item.capture_session_id, v_item.organization_id, v_job_id, p_capture_source_id,
            p_media_operation_id, p_media_operation_receipt_id, p_custody_state, p_observation_method, p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_CAPTURE_ITEM_CUSTODY', p_idempotency_key, v_hash,
        jsonb_build_object('custody_event_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_capture_duplicate_evidence(
    p_session_token text, p_idempotency_key text, p_left_capture_item_id uuid, p_right_capture_item_id uuid,
    p_evidence_classification text, p_basis text, p_reason text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_left medialab_core.capture_items%ROWTYPE; v_right medialab_core.capture_items%ROWTYPE;
        v_left_job uuid; v_right_job uuid; v_low uuid; v_high uuid; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_left FROM medialab_core.capture_items WHERE id = p_left_capture_item_id;
    SELECT * INTO v_right FROM medialab_core.capture_items WHERE id = p_right_capture_item_id;
    IF v_left.id IS NULL OR v_right.id IS NULL OR v_left.organization_id <> v_right.organization_id THEN
        RAISE EXCEPTION 'Duplicate evidence items are missing or cross-tenant' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_left.organization_id, 'media_capture.manage');
    PERFORM medialab_core.validate_capture_safe_json(p_evidence);
    SELECT job_id INTO v_left_job FROM medialab_core.capture_session_assignments WHERE capture_session_id = v_left.capture_session_id;
    SELECT job_id INTO v_right_job FROM medialab_core.capture_session_assignments WHERE capture_session_id = v_right.capture_session_id;
    IF v_left_job IS NULL OR v_right_job IS NULL OR v_left_job <> v_right_job THEN
        RAISE EXCEPTION 'Duplicate evidence requires assigned items in the same organization and Job' USING ERRCODE = '42501';
    END IF;
    v_low := LEAST(p_left_capture_item_id, p_right_capture_item_id);
    v_high := GREATEST(p_left_capture_item_id, p_right_capture_item_id);
    v_hash := encode(sha256(convert_to(jsonb_build_array(v_low, v_high, p_evidence_classification,
        p_basis, p_reason, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_CAPTURE_DUPLICATE_EVIDENCE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'duplicate_evidence_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.capture_duplicate_evidence
        (id, organization_id, job_id, left_capture_item_id, right_capture_item_id, evidence_classification,
         basis, reason, evidence, recorded_by_identity_id)
    VALUES (v_id, v_left.organization_id, v_left_job, v_low, v_high, p_evidence_classification,
            p_basis, p_reason, p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_CAPTURE_DUPLICATE_EVIDENCE', p_idempotency_key, v_hash,
        jsonb_build_object('duplicate_evidence_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.promote_capture_item(
    p_session_token text, p_idempotency_key text, p_capture_item_id uuid, p_source_provenance text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_item medialab_core.capture_items%ROWTYPE; v_assignment medialab_core.capture_session_assignments%ROWTYPE;
        v_observation medialab_core.capture_item_observations%ROWTYPE; v_verification medialab_core.capture_item_verification_events%ROWTYPE;
        v_asset_id uuid; v_version_id uuid; v_promotion_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_item FROM medialab_core.capture_items WHERE id = p_capture_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture item is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_item.organization_id, 'media_capture.manage');
    PERFORM medialab_core.require_media_permission(v_actor, v_item.organization_id, 'media_asset.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_capture_item_id, p_source_provenance)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'PROMOTE_CAPTURE_ITEM', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    SELECT * INTO v_assignment FROM medialab_core.capture_session_assignments
     WHERE capture_session_id = v_item.capture_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unassigned quarantine items cannot be promoted' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.capture_item_promotions WHERE capture_item_id = v_item.id) THEN
        RAISE EXCEPTION 'Capture item has already been promoted' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.capture_item_verification_events
               WHERE capture_item_id = v_item.id AND verification_state = 'CONFLICT') THEN
        RAISE EXCEPTION 'Unresolved verification conflict blocks promotion' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_verification FROM medialab_core.capture_item_verification_events
     WHERE capture_item_id = v_item.id AND verification_state = 'VERIFIED'
     ORDER BY verified_at DESC, id DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assigned item must have complete verified checksum, byte size, and media type before promotion' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(DISTINCT (observed_checksum_sha256, observed_byte_size, observed_media_type))
          FROM medialab_core.capture_item_verification_events
         WHERE capture_item_id = v_item.id AND verification_state = 'VERIFIED') <> 1 THEN
        RAISE EXCEPTION 'Conflicting verified evidence blocks promotion' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_observation FROM medialab_core.capture_item_observations
     WHERE capture_item_id = v_item.id ORDER BY observed_at DESC, id DESC LIMIT 1;
    IF NOT FOUND OR v_observation.observed_byte_size IS DISTINCT FROM v_verification.observed_byte_size OR
       v_observation.observed_media_type IS DISTINCT FROM v_verification.observed_media_type THEN
        RAISE EXCEPTION 'Latest item observation does not match verified byte size and media type' USING ERRCODE = '22023';
    END IF;
    IF p_source_provenance IS NULL OR p_source_provenance <> btrim(p_source_provenance) OR
       p_source_provenance = '' OR length(p_source_provenance) > 1000 OR
       p_source_provenance ~* '(password|secret|credential|token|https?://|file://)' THEN
        RAISE EXCEPTION 'Bounded safe source provenance is required' USING ERRCODE = '22023';
    END IF;
    v_asset_id := gen_random_uuid(); v_version_id := gen_random_uuid(); v_promotion_id := gen_random_uuid();
    INSERT INTO medialab_core.media_assets
        (id, organization_id, job_id, source_context, created_by_identity_id)
    VALUES (v_asset_id, v_item.organization_id, v_assignment.job_id,
        jsonb_build_object('capture_session_id', v_item.capture_session_id, 'capture_item_id', v_item.id), v_actor);
    INSERT INTO medialab_core.media_asset_versions
        (id, asset_id, organization_id, job_id, version_number, version_kind, observed_filename,
         byte_size, media_type, checksum_sha256, source_provenance, created_by_identity_id)
    VALUES (v_version_id, v_asset_id, v_item.organization_id, v_assignment.job_id, 1, 'ORIGINAL',
        v_observation.observed_filename, v_verification.observed_byte_size, v_verification.observed_media_type,
        v_verification.observed_checksum_sha256, p_source_provenance, v_actor);
    INSERT INTO medialab_core.capture_item_promotions
        (id, capture_item_id, capture_session_id, organization_id, job_id, media_asset_id,
         media_asset_version_id, verification_event_id, promoted_by_identity_id)
    VALUES (v_promotion_id, v_item.id, v_item.capture_session_id, v_item.organization_id, v_assignment.job_id,
        v_asset_id, v_version_id, v_verification.id, v_actor);
    INSERT INTO medialab_core.capture_item_custody_events
        (id, capture_item_id, capture_session_id, organization_id, job_id, capture_source_id, custody_state,
         observation_method, evidence, observed_by_identity_id)
    VALUES (gen_random_uuid(), v_item.id, v_item.capture_session_id, v_item.organization_id, v_assignment.job_id,
        v_item.capture_source_id, 'PROMOTED_TO_CANONICAL_ASSET', 'CONTROLLED_IDENTITY_PROMOTION',
        jsonb_build_object('media_asset_id', v_asset_id, 'media_asset_version_id', v_version_id), v_actor);
    INSERT INTO medialab_core.capture_session_events
        (id, capture_session_id, organization_id, job_id, event_type, reason, evidence, recorded_by_identity_id)
    VALUES (gen_random_uuid(), v_item.capture_session_id, v_item.organization_id, v_assignment.job_id,
        'ITEM_PROMOTED', 'Verified capture item promoted to immutable ORIGINAL asset version',
        jsonb_build_object('capture_item_id', v_item.id, 'media_asset_id', v_asset_id,
            'media_asset_version_id', v_version_id), v_actor);
    v_replay := jsonb_build_object('promotion_id', v_promotion_id, 'capture_item_id', v_item.id,
        'media_asset_id', v_asset_id, 'media_asset_version_id', v_version_id);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'PROMOTE_CAPTURE_ITEM', p_idempotency_key, v_hash, v_replay);
    RETURN v_replay;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_capture_session_record(p_session_token text, p_capture_session_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_session medialab_core.capture_sessions%ROWTYPE; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_session FROM medialab_core.capture_sessions WHERE id = p_capture_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture Session is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_session.organization_id, 'media_capture.read');
    SELECT jsonb_build_object(
        'session', to_jsonb(v_session),
        'projection', jsonb_build_object(
            'state', CASE WHEN a.id IS NULL THEN 'UNASSIGNED_QUARANTINE' ELSE 'ASSIGNED' END,
            'job_id', a.job_id
        ),
        'assignment', CASE WHEN a.id IS NULL THEN NULL ELSE to_jsonb(a) END,
        'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at, e.id)
            FROM medialab_core.capture_session_events e WHERE e.capture_session_id = v_session.id), '[]'::jsonb),
        'sources', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.registered_at, s.id)
            FROM medialab_core.capture_sources s WHERE s.capture_session_id = v_session.id), '[]'::jsonb),
        'items', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.discovered_at, i.id)
            FROM medialab_core.capture_items i WHERE i.capture_session_id = v_session.id), '[]'::jsonb)
    ) INTO v_result
      FROM (SELECT 1) q LEFT JOIN medialab_core.capture_session_assignments a ON a.capture_session_id = v_session.id;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_capture_item_record(p_session_token text, p_capture_item_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_item medialab_core.capture_items%ROWTYPE; v_state text;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_item FROM medialab_core.capture_items WHERE id = p_capture_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Capture item is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_capture_permission(v_actor, v_item.organization_id, 'media_capture.read');
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM medialab_core.capture_item_promotions p WHERE p.capture_item_id = v_item.id) THEN 'PROMOTED'
        WHEN EXISTS (SELECT 1 FROM medialab_core.capture_item_verification_events e WHERE e.capture_item_id = v_item.id AND e.verification_state = 'CONFLICT') THEN 'VERIFICATION_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM medialab_core.capture_item_verification_events e WHERE e.capture_item_id = v_item.id AND e.verification_state = 'VERIFIED') THEN 'VERIFIED'
        WHEN EXISTS (SELECT 1 FROM medialab_core.capture_item_verification_events e WHERE e.capture_item_id = v_item.id AND e.verification_state = 'FAILED') THEN 'VERIFICATION_FAILED'
        ELSE 'OBSERVED'
    END INTO v_state;
    RETURN jsonb_build_object(
        'item', to_jsonb(v_item), 'projection', jsonb_build_object('state', v_state),
        'observations', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.observed_at, o.id)
            FROM medialab_core.capture_item_observations o WHERE o.capture_item_id = v_item.id), '[]'::jsonb),
        'verifications', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.verified_at, e.id)
            FROM medialab_core.capture_item_verification_events e WHERE e.capture_item_id = v_item.id), '[]'::jsonb),
        'custody', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.observed_at, c.id)
            FROM medialab_core.capture_item_custody_events c WHERE c.capture_item_id = v_item.id), '[]'::jsonb),
        'duplicate_evidence', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.recorded_at, d.id)
            FROM medialab_core.capture_duplicate_evidence d
            WHERE d.left_capture_item_id = v_item.id OR d.right_capture_item_id = v_item.id), '[]'::jsonb),
        'promotion', (SELECT to_jsonb(p) FROM medialab_core.capture_item_promotions p WHERE p.capture_item_id = v_item.id)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_capture_sessions(
    p_session_token text, p_organization_id uuid, p_job_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_capture_permission(v_actor, p_organization_id, 'media_capture.read');
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'capture_session_id', s.id, 'session_label', s.session_label,
            'state', CASE WHEN a.id IS NULL THEN 'UNASSIGNED_QUARANTINE' ELSE 'ASSIGNED' END,
            'job_id', a.job_id, 'created_at', s.created_at
        ) ORDER BY s.created_at, s.id)
          FROM medialab_core.capture_sessions s
          LEFT JOIN medialab_core.capture_session_assignments a ON a.capture_session_id = s.id
         WHERE s.organization_id = p_organization_id AND (p_job_id IS NULL OR a.job_id = p_job_id)
    ), '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER capture_sessions_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_sessions
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_session_assignments_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_session_assignments
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_session_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_session_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_sources_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_sources
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_source_observations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_source_observations
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_items_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_items
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_item_observations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_item_observations
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_item_verification_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_item_verification_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_item_custody_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_item_custody_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_duplicate_evidence_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_duplicate_evidence
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();
CREATE TRIGGER capture_item_promotions_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.capture_item_promotions
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_capture_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.capture_sessions FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_session_assignments FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_session_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_sources FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_source_observations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_items FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_item_observations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_item_verification_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_item_custody_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_duplicate_evidence FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.capture_item_promotions FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_capture_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_capture_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_capture_safe_json(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.capture_session_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_capture_session(text, text, uuid, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.assign_capture_session(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.register_capture_source(text, text, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_capture_source_observation(text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.register_capture_item(text, text, uuid, text, bigint, text, timestamptz, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_capture_item_observation(text, text, uuid, text, bigint, text, timestamptz, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_capture_item_verification(text, text, uuid, text, text, text, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_capture_item_custody(text, text, uuid, text, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_capture_duplicate_evidence(text, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.promote_capture_item(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_capture_session_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_capture_item_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_capture_sessions(text, uuid, uuid) FROM PUBLIC;
