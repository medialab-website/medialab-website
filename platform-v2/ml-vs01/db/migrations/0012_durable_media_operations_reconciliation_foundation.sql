-- P02-M09-A: durable provider-neutral media operations and reconciliation foundation.
-- This migration records synthetic/nonproduction evidence only. It performs no media or provider I/O.

ALTER TABLE medialab_core.media_manifests
    ADD CONSTRAINT media_manifests_id_org_job_key UNIQUE (id, organization_id, job_id);

CREATE TABLE medialab_core.media_operations (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    operation_family text NOT NULL,
    operation_subtype text NOT NULL,
    requested_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    request_reason text NOT NULL,
    request_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT media_operations_id_org_job_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT media_operations_family_check CHECK (operation_family ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_operations_subtype_check CHECK (operation_subtype ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_operations_reason_check CHECK (
        request_reason = btrim(request_reason) AND request_reason <> '' AND length(request_reason) <= 1000
    ),
    CONSTRAINT media_operations_evidence_check CHECK (
        jsonb_typeof(request_evidence) = 'object' AND
        request_evidence::text !~* '"([a-z0-9_]*(credential|password|secret|token|private_key|access_key|signed_url|media_bytes|base64|provider_payload)[a-z0-9_]*|path|url|filename)"[[:space:]]*:' AND
        request_evidence::text !~* '(https?://|[?&](token|signature|credential|secret|access_key|private_key)=)'
    )
);

CREATE TABLE medialab_core.media_operation_targets (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    attached_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    attached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (operation_id, organization_id, job_id)
        REFERENCES medialab_core.media_operations(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_targets_operation_target_key UNIQUE (operation_id, target_type, target_id),
    CONSTRAINT media_operation_targets_id_operation_key UNIQUE (id, operation_id),
    CONSTRAINT media_operation_targets_type_check CHECK (target_type IN (
        'MEDIA_ASSET', 'MEDIA_ASSET_VERSION', 'MEDIA_STORAGE_OBJECT', 'MEDIA_MANIFEST'
    ))
);

CREATE TABLE medialab_core.media_operation_events (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_sequence integer NOT NULL,
    event_type text NOT NULL,
    attempt_id uuid NULL,
    actor_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    worker_key text NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (operation_id, organization_id, job_id)
        REFERENCES medialab_core.media_operations(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_events_operation_sequence_key UNIQUE (operation_id, event_sequence),
    CONSTRAINT media_operation_events_sequence_check CHECK (event_sequence > 0),
    CONSTRAINT media_operation_events_type_check CHECK (event_type IN (
        'REQUESTED', 'TARGET_ATTACHED', 'READY', 'CLAIMED', 'STARTED', 'CHECKPOINTED',
        'RECEIPT_RECORDED', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'RETRY_SCHEDULED',
        'STOP_REQUESTED', 'CANCELLATION_REQUESTED', 'STOPPED', 'CANCELLED',
        'OVERRIDE_RECORDED', 'MANUAL_FALLBACK_RECORDED', 'RECONCILIATION_REQUIRED', 'RECONCILED'
    )),
    CONSTRAINT media_operation_events_authority_check CHECK (
        (actor_identity_id IS NOT NULL AND worker_key IS NULL) OR
        (actor_identity_id IS NULL AND worker_key IS NOT NULL)
    ),
    CONSTRAINT media_operation_events_worker_check CHECK (
        worker_key IS NULL OR worker_key ~ '^[A-Z][A-Z0-9_.:-]{1,199}$'
    ),
    CONSTRAINT media_operation_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT media_operation_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.media_operation_attempts (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    worker_key text NOT NULL,
    lease_expires_at timestamptz NOT NULL,
    retry_of_attempt_id uuid NULL,
    claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (operation_id, organization_id, job_id)
        REFERENCES medialab_core.media_operations(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_attempts_id_operation_key UNIQUE (id, operation_id),
    CONSTRAINT media_operation_attempts_operation_number_key UNIQUE (operation_id, attempt_number),
    FOREIGN KEY (retry_of_attempt_id, operation_id)
        REFERENCES medialab_core.media_operation_attempts(id, operation_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_attempts_number_check CHECK (attempt_number > 0),
    CONSTRAINT media_operation_attempts_worker_check CHECK (worker_key ~ '^[A-Z][A-Z0-9_.:-]{1,199}$'),
    CONSTRAINT media_operation_attempts_lease_check CHECK (lease_expires_at > claimed_at)
);

ALTER TABLE medialab_core.media_operation_events
    ADD CONSTRAINT media_operation_events_attempt_fk
    FOREIGN KEY (attempt_id, operation_id)
    REFERENCES medialab_core.media_operation_attempts(id, operation_id) ON DELETE RESTRICT;

CREATE TABLE medialab_core.media_operation_checkpoints (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    checkpoint_sequence integer NOT NULL,
    checkpoint_type text NOT NULL,
    worker_key text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (attempt_id, operation_id)
        REFERENCES medialab_core.media_operation_attempts(id, operation_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_checkpoints_attempt_sequence_key UNIQUE (attempt_id, checkpoint_sequence),
    CONSTRAINT media_operation_checkpoints_sequence_check CHECK (checkpoint_sequence > 0),
    CONSTRAINT media_operation_checkpoints_type_check CHECK (checkpoint_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_operation_checkpoints_worker_check CHECK (worker_key ~ '^[A-Z][A-Z0-9_.:-]{1,199}$'),
    CONSTRAINT media_operation_checkpoints_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.media_operation_receipts (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    target_id uuid NOT NULL,
    receipt_sequence integer NOT NULL,
    receipt_type text NOT NULL,
    provider_neutral_reference text NOT NULL,
    observed_byte_size bigint NULL,
    observed_checksum_sha256 text NULL,
    observed_media_type text NULL,
    observed_manifest_sha256 text NULL,
    provider_response_class text NULL,
    verification_state text NOT NULL,
    worker_key text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (attempt_id, operation_id)
        REFERENCES medialab_core.media_operation_attempts(id, operation_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_id, operation_id)
        REFERENCES medialab_core.media_operation_targets(id, operation_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_receipts_attempt_sequence_key UNIQUE (attempt_id, receipt_sequence),
    CONSTRAINT media_operation_receipts_sequence_check CHECK (receipt_sequence > 0),
    CONSTRAINT media_operation_receipts_type_check CHECK (receipt_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_operation_receipts_reference_check CHECK (
        provider_neutral_reference = btrim(provider_neutral_reference) AND provider_neutral_reference <> '' AND
        length(provider_neutral_reference) <= 500 AND provider_neutral_reference !~ '://' AND
        provider_neutral_reference !~* '(^|[?&])(token|signature|credential|password|secret|access_key|private_key)='
    ),
    CONSTRAINT media_operation_receipts_size_check CHECK (observed_byte_size IS NULL OR observed_byte_size >= 0),
    CONSTRAINT media_operation_receipts_checksum_check CHECK (
        observed_checksum_sha256 IS NULL OR observed_checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT media_operation_receipts_manifest_check CHECK (
        observed_manifest_sha256 IS NULL OR observed_manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT media_operation_receipts_media_type_check CHECK (
        observed_media_type IS NULL OR
        (observed_media_type = lower(btrim(observed_media_type)) AND
         observed_media_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$')
    ),
    CONSTRAINT media_operation_receipts_response_check CHECK (
        provider_response_class IS NULL OR provider_response_class ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT media_operation_receipts_state_check CHECK (verification_state IN (
        'PROVISIONAL', 'VERIFIED', 'CONFLICTING', 'SUPERSEDED_BY_RECONCILIATION'
    )),
    CONSTRAINT media_operation_receipts_worker_check CHECK (worker_key ~ '^[A-Z][A-Z0-9_.:-]{1,199}$'),
    CONSTRAINT media_operation_receipts_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.media_operation_control_requests (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    request_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    requested_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (operation_id, organization_id, job_id)
        REFERENCES medialab_core.media_operations(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_control_requests_type_check CHECK (request_type IN (
        'STOP_REQUESTED', 'CANCELLATION_REQUESTED', 'OVERRIDE_RECORDED', 'MANUAL_FALLBACK_RECORDED'
    )),
    CONSTRAINT media_operation_control_requests_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT media_operation_control_requests_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.media_operation_reconciliations (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    attempt_id uuid NULL,
    target_id uuid NULL,
    finding_type text NOT NULL,
    outcome text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    reconciled_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reconciled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (attempt_id, operation_id)
        REFERENCES medialab_core.media_operation_attempts(id, operation_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_id, operation_id)
        REFERENCES medialab_core.media_operation_targets(id, operation_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_reconciliations_finding_check CHECK (finding_type IN (
        'EXPECTED_EFFECT_VERIFIED', 'EXPECTED_OBJECT_MISSING', 'UNEXPECTED_OBJECT_PRESENT',
        'ORPHANED_OBJECT_PRESENT', 'CHECKSUM_CONFLICT', 'BYTE_SIZE_CONFLICT', 'MEDIA_TYPE_CONFLICT',
        'MANIFEST_CONFLICT', 'LOCATION_CONFLICT', 'LATE_SUCCESS_AFTER_FAILURE',
        'DUPLICATE_TECHNICAL_EFFECT', 'STALE_CANONICAL_PROJECTION', 'RETRY_AMBIGUITY',
        'MANUAL_REVIEW_REQUIRED', 'MANUAL_FALLBACK_ACCEPTED', 'OVERRIDE_ACCEPTED'
    )),
    CONSTRAINT media_operation_reconciliations_outcome_check CHECK (outcome IN (
        'OPEN', 'MANUAL_REVIEW_REQUIRED', 'EXPECTED_EFFECT_VERIFIED', 'ACCEPTED_FALLBACK',
        'ACCEPTED_OVERRIDE', 'CONFLICT_RESOLVED', 'NO_EFFECT_CONFIRMED'
    )),
    CONSTRAINT media_operation_reconciliations_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.media_operation_projections (
    operation_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    current_state text NOT NULL,
    last_event_sequence integer NOT NULL,
    next_eligible_at timestamptz NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (operation_id, organization_id, job_id)
        REFERENCES medialab_core.media_operations(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_operation_projections_state_check CHECK (current_state IN (
        'REQUESTED', 'READY', 'CLAIMED', 'STARTED', 'SUCCEEDED', 'FAILED', 'ABANDONED',
        'RETRY_SCHEDULED', 'STOP_REQUESTED', 'CANCELLATION_REQUESTED', 'STOPPED', 'CANCELLED',
        'MANUAL_FALLBACK_RECORDED', 'RECONCILIATION_REQUIRED', 'RECONCILED'
    )),
    CONSTRAINT media_operation_projections_sequence_check CHECK (last_event_sequence > 0)
);

CREATE TABLE medialab_core.media_operation_runtime_idempotency (
    id uuid PRIMARY KEY,
    worker_key text NOT NULL,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT media_operation_runtime_idempotency_worker_key UNIQUE (worker_key, command_type, idempotency_key),
    CONSTRAINT media_operation_runtime_idempotency_worker_check CHECK (worker_key ~ '^[A-Z][A-Z0-9_.:-]{1,199}$'),
    CONSTRAINT media_operation_runtime_idempotency_command_check CHECK (command_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_operation_runtime_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT media_operation_runtime_idempotency_hash_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_operation_runtime_idempotency_result_check CHECK (jsonb_typeof(result) = 'object')
);

CREATE INDEX media_operations_job_idx ON medialab_core.media_operations (job_id, requested_at, id);
CREATE INDEX media_operation_targets_operation_idx ON medialab_core.media_operation_targets (operation_id, attached_at, id);
CREATE INDEX media_operation_events_operation_idx ON medialab_core.media_operation_events (operation_id, event_sequence, id);
CREATE INDEX media_operation_attempts_operation_idx ON medialab_core.media_operation_attempts (operation_id, attempt_number, id);
CREATE INDEX media_operation_receipts_target_idx ON medialab_core.media_operation_receipts (target_id, received_at, id);
CREATE INDEX media_operation_reconciliations_operation_idx ON medialab_core.media_operation_reconciliations (operation_id, reconciled_at, id);
CREATE INDEX media_operation_claimable_idx ON medialab_core.media_operation_projections (next_eligible_at, updated_at, operation_id)
    WHERE current_state IN ('READY', 'RETRY_SCHEDULED');

CREATE OR REPLACE FUNCTION medialab_core.reject_media_operation_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable append-only evidence: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_media_operation_projection_mutation()
RETURNS trigger AS $$
BEGIN
    IF current_setting('medialab.operation_projection_write', true) IS DISTINCT FROM 'allowed' THEN
        RAISE EXCEPTION 'Media operation projections may change only through controlled commands'
            USING ERRCODE = '42501';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_media_operation_permission(
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

CREATE OR REPLACE FUNCTION medialab_core.validate_media_operation_safe_json(p_evidence jsonb)
RETURNS void AS $$
BEGIN
    IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
        RAISE EXCEPTION 'Media operation evidence must be a JSON object' USING ERRCODE = '22023';
    END IF;
    IF p_evidence::text ~* '"([a-z0-9_]*(credential|password|secret|token|private_key|access_key|signed_url|media_bytes|base64|provider_payload)[a-z0-9_]*|path|url|filename)"[[:space:]]*:' OR
       p_evidence::text ~* '(https?://|[?&](token|signature|credential|secret|access_key|private_key)=)' THEN
        RAISE EXCEPTION 'Credentials, signed references, provider payloads, media bytes, paths, URLs, and filenames are prohibited from media operation evidence'
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.check_media_operation_runtime_idempotency(
    p_worker_key text, p_command_type text, p_idempotency_key text, p_request_sha256 text
)
RETURNS jsonb AS $$
DECLARE v_row medialab_core.media_operation_runtime_idempotency%ROWTYPE;
BEGIN
    IF p_worker_key IS NULL OR p_worker_key !~ '^[A-Z][A-Z0-9_.:-]{1,199}$' THEN
        RAISE EXCEPTION 'A bounded provider-neutral worker key is required' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'A bounded runtime idempotency key is required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_worker_key || ':' || p_command_type || ':' || p_idempotency_key, 0)
    );
    SELECT * INTO v_row FROM medialab_core.media_operation_runtime_idempotency
     WHERE worker_key = p_worker_key AND command_type = p_command_type AND idempotency_key = p_idempotency_key;
    IF FOUND AND v_row.request_sha256 <> p_request_sha256 THEN
        RAISE EXCEPTION 'Runtime idempotency key conflicts with a different request fingerprint' USING ERRCODE = '22023';
    END IF;
    RETURN CASE WHEN FOUND THEN v_row.result ELSE NULL END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_operation_runtime_idempotency(
    p_worker_key text, p_command_type text, p_idempotency_key text, p_request_sha256 text, p_result jsonb
)
RETURNS void AS $$
BEGIN
    INSERT INTO medialab_core.media_operation_runtime_idempotency
        (id, worker_key, command_type, idempotency_key, request_sha256, result)
    VALUES (gen_random_uuid(), p_worker_key, p_command_type, p_idempotency_key, p_request_sha256, p_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_media_operation_target()
RETURNS trigger AS $$
BEGIN
    IF NEW.target_type = 'MEDIA_ASSET' AND NOT EXISTS (
        SELECT 1 FROM medialab_core.media_assets
         WHERE id = NEW.target_id AND organization_id = NEW.organization_id AND job_id = NEW.job_id
    ) THEN
        RAISE EXCEPTION 'Media operation target is cross-tenant, cross-Job, missing, or inconsistent' USING ERRCODE = '42501';
    ELSIF NEW.target_type = 'MEDIA_ASSET_VERSION' AND NOT EXISTS (
        SELECT 1 FROM medialab_core.media_asset_versions
         WHERE id = NEW.target_id AND organization_id = NEW.organization_id AND job_id = NEW.job_id
    ) THEN
        RAISE EXCEPTION 'Media operation target is cross-tenant, cross-Job, missing, or inconsistent' USING ERRCODE = '42501';
    ELSIF NEW.target_type = 'MEDIA_STORAGE_OBJECT' AND NOT EXISTS (
        SELECT 1 FROM medialab_core.media_storage_objects
         WHERE id = NEW.target_id AND organization_id = NEW.organization_id AND job_id = NEW.job_id
    ) THEN
        RAISE EXCEPTION 'Media operation target is cross-tenant, cross-Job, missing, or inconsistent' USING ERRCODE = '42501';
    ELSIF NEW.target_type = 'MEDIA_MANIFEST' AND NOT EXISTS (
        SELECT 1 FROM medialab_core.media_manifests
         WHERE id = NEW.target_id AND organization_id = NEW.organization_id AND job_id = NEW.job_id
    ) THEN
        RAISE EXCEPTION 'Media operation target is cross-tenant, cross-Job, missing, or inconsistent' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.append_media_operation_event(
    p_operation_id uuid, p_event_type text, p_attempt_id uuid, p_actor_identity_id uuid,
    p_worker_key text, p_reason text, p_evidence jsonb, p_next_eligible_at timestamptz DEFAULT NULL
)
RETURNS integer AS $$
DECLARE v_projection medialab_core.media_operation_projections%ROWTYPE; v_sequence integer; v_new_state text;
BEGIN
    PERFORM medialab_core.validate_media_operation_safe_json(p_evidence);
    SELECT * INTO v_projection FROM medialab_core.media_operation_projections
     WHERE operation_id = p_operation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media operation projection is missing' USING ERRCODE = '42501'; END IF;
    v_sequence := v_projection.last_event_sequence + 1;
    v_new_state := CASE p_event_type
        WHEN 'TARGET_ATTACHED' THEN v_projection.current_state
        WHEN 'CHECKPOINTED' THEN v_projection.current_state
        WHEN 'RECEIPT_RECORDED' THEN v_projection.current_state
        WHEN 'OVERRIDE_RECORDED' THEN v_projection.current_state
        ELSE p_event_type
    END;
    IF p_event_type = 'READY' AND v_projection.current_state <> 'REQUESTED' THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to READY', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'CLAIMED' AND v_projection.current_state NOT IN ('READY', 'RETRY_SCHEDULED') THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to CLAIMED', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'STARTED' AND v_projection.current_state <> 'CLAIMED' THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to STARTED', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type IN ('SUCCEEDED', 'FAILED') AND v_projection.current_state <> 'STARTED' THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to %', v_projection.current_state, p_event_type USING ERRCODE = '22023';
    ELSIF p_event_type = 'ABANDONED' AND v_projection.current_state NOT IN ('CLAIMED', 'STARTED') THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to ABANDONED', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'RETRY_SCHEDULED' AND v_projection.current_state NOT IN ('FAILED', 'ABANDONED') THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to RETRY_SCHEDULED', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type IN ('CHECKPOINTED') AND v_projection.current_state <> 'STARTED' THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to CHECKPOINTED', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'RECEIPT_RECORDED' AND v_projection.current_state NOT IN ('STARTED', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'RECONCILIATION_REQUIRED') THEN
        RAISE EXCEPTION 'Invalid media operation receipt state %', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'TARGET_ATTACHED' AND v_projection.current_state <> 'REQUESTED' THEN
        RAISE EXCEPTION 'Targets may be attached only while an operation is REQUESTED' USING ERRCODE = '22023';
    ELSIF p_event_type IN ('STOP_REQUESTED', 'CANCELLATION_REQUESTED') AND v_projection.current_state IN ('STOPPED', 'CANCELLED', 'RECONCILED') THEN
        RAISE EXCEPTION 'Invalid control request for terminal media operation state %', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'STOPPED' AND v_projection.current_state NOT IN ('STOP_REQUESTED', 'STARTED') THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to STOPPED', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'CANCELLED' AND v_projection.current_state NOT IN ('CANCELLATION_REQUESTED', 'REQUESTED', 'READY') THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to CANCELLED', v_projection.current_state USING ERRCODE = '22023';
    ELSIF p_event_type = 'RECONCILED' AND v_projection.current_state <> 'RECONCILIATION_REQUIRED' THEN
        RAISE EXCEPTION 'Invalid media operation transition from % to RECONCILED', v_projection.current_state USING ERRCODE = '22023';
    END IF;
    INSERT INTO medialab_core.media_operation_events
        (id, operation_id, organization_id, job_id, event_sequence, event_type, attempt_id,
         actor_identity_id, worker_key, reason, evidence)
    SELECT gen_random_uuid(), o.id, o.organization_id, o.job_id, v_sequence, p_event_type, p_attempt_id,
           p_actor_identity_id, p_worker_key, p_reason, p_evidence
      FROM medialab_core.media_operations o WHERE o.id = p_operation_id;
    PERFORM set_config('medialab.operation_projection_write', 'allowed', true);
    UPDATE medialab_core.media_operation_projections
       SET current_state = v_new_state, last_event_sequence = v_sequence,
           next_eligible_at = CASE WHEN p_event_type IN ('READY', 'RETRY_SCHEDULED')
                                   THEN coalesce(p_next_eligible_at, clock_timestamp()) ELSE NULL END,
           updated_at = clock_timestamp()
     WHERE operation_id = p_operation_id;
    RETURN v_sequence;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.request_media_operation(
    p_session_token text, p_idempotency_key text, p_job_id uuid, p_service_workstream_id uuid,
    p_operation_family text, p_operation_subtype text, p_reason text, p_request_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_job medialab_core.jobs%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_operation_permission(v_actor, v_job.organization_id, 'media_operation.manage');
    PERFORM medialab_core.validate_media_operation_safe_json(p_request_evidence);
    IF p_service_workstream_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.service_workstreams
         WHERE id = p_service_workstream_id AND job_id = v_job.id AND organization_id = v_job.organization_id
    ) THEN RAISE EXCEPTION 'Workstream is cross-tenant, cross-Job, or missing' USING ERRCODE = '42501'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_job_id, p_service_workstream_id, p_operation_family,
        p_operation_subtype, p_reason, p_request_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'REQUEST_MEDIA_OPERATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'operation_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_operations
        (id, organization_id, job_id, service_workstream_id, operation_family, operation_subtype,
         requested_by_identity_id, request_reason, request_evidence)
    VALUES (v_id, v_job.organization_id, v_job.id, p_service_workstream_id, p_operation_family,
            p_operation_subtype, v_actor, p_reason, p_request_evidence);
    INSERT INTO medialab_core.media_operation_events
        (id, operation_id, organization_id, job_id, event_sequence, event_type,
         actor_identity_id, reason, evidence)
    VALUES (gen_random_uuid(), v_id, v_job.organization_id, v_job.id, 1, 'REQUESTED',
            v_actor, p_reason, p_request_evidence);
    PERFORM set_config('medialab.operation_projection_write', 'allowed', true);
    INSERT INTO medialab_core.media_operation_projections
        (operation_id, organization_id, job_id, current_state, last_event_sequence)
    VALUES (v_id, v_job.organization_id, v_job.id, 'REQUESTED', 1);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'REQUEST_MEDIA_OPERATION', p_idempotency_key,
        v_hash, jsonb_build_object('operation_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.attach_media_operation_target(
    p_session_token text, p_idempotency_key text, p_operation_id uuid, p_target_type text, p_target_id uuid
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_operation medialab_core.media_operations%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_operation FROM medialab_core.media_operations WHERE id = p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media operation is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_operation_permission(v_actor, v_operation.organization_id, 'media_operation.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_operation_id, p_target_type, p_target_id)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'ATTACH_MEDIA_OPERATION_TARGET', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'target_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_operation_targets
        (id, operation_id, organization_id, job_id, target_type, target_id, attached_by_identity_id)
    VALUES (v_id, v_operation.id, v_operation.organization_id, v_operation.job_id,
            p_target_type, p_target_id, v_actor);
    PERFORM medialab_core.append_media_operation_event(v_operation.id, 'TARGET_ATTACHED', NULL, v_actor, NULL,
        'Validated explicit operation target attached', jsonb_build_object('operation_target_id', v_id, 'target_type', p_target_type));
    PERFORM medialab_core.record_media_idempotency(v_actor, 'ATTACH_MEDIA_OPERATION_TARGET', p_idempotency_key,
        v_hash, jsonb_build_object('target_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.ready_media_operation(
    p_session_token text, p_idempotency_key text, p_operation_id uuid, p_reason text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_operation medialab_core.media_operations%ROWTYPE; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_operation FROM medialab_core.media_operations WHERE id = p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media operation is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_operation_permission(v_actor, v_operation.organization_id, 'media_operation.manage');
    IF NOT EXISTS (SELECT 1 FROM medialab_core.media_operation_targets WHERE operation_id = p_operation_id) THEN
        RAISE EXCEPTION 'A media operation requires at least one explicit validated target before READY' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_operation_id, p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'READY_MEDIA_OPERATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'operation_id')::uuid; END IF;
    PERFORM medialab_core.append_media_operation_event(p_operation_id, 'READY', NULL, v_actor, NULL, p_reason, '{}'::jsonb);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'READY_MEDIA_OPERATION', p_idempotency_key,
        v_hash, jsonb_build_object('operation_id', p_operation_id));
    RETURN p_operation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.request_media_operation_control(
    p_session_token text, p_idempotency_key text, p_operation_id uuid,
    p_request_type text, p_reason text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_operation medialab_core.media_operations%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_operation FROM medialab_core.media_operations WHERE id = p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media operation is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_operation_permission(v_actor, v_operation.organization_id, 'media_operation.manage');
    PERFORM medialab_core.validate_media_operation_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_operation_id, p_request_type, p_reason, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'REQUEST_MEDIA_OPERATION_CONTROL', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'control_request_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_operation_control_requests
        (id, operation_id, organization_id, job_id, request_type, reason, evidence, requested_by_identity_id)
    VALUES (v_id, v_operation.id, v_operation.organization_id, v_operation.job_id,
            p_request_type, p_reason, p_evidence, v_actor);
    PERFORM medialab_core.append_media_operation_event(p_operation_id, p_request_type, NULL, v_actor, NULL,
        p_reason, jsonb_build_object('control_request_id', v_id));
    PERFORM medialab_core.record_media_idempotency(v_actor, 'REQUEST_MEDIA_OPERATION_CONTROL', p_idempotency_key,
        v_hash, jsonb_build_object('control_request_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_claimable_media_operations(p_limit integer DEFAULT 50)
RETURNS TABLE (operation_id uuid, organization_id uuid, job_id uuid, operation_family text,
               operation_subtype text, current_state text, next_eligible_at timestamptz) AS $$
BEGIN
    IF p_limit < 1 OR p_limit > 200 THEN RAISE EXCEPTION 'Claim projection limit must be between 1 and 200' USING ERRCODE = '22023'; END IF;
    RETURN QUERY
    SELECT o.id, o.organization_id, o.job_id, o.operation_family, o.operation_subtype,
           p.current_state, p.next_eligible_at
      FROM medialab_core.media_operation_projections p
      JOIN medialab_core.media_operations o ON o.id = p.operation_id
     WHERE p.current_state IN ('READY', 'RETRY_SCHEDULED')
       AND p.next_eligible_at <= clock_timestamp()
     ORDER BY p.next_eligible_at, o.requested_at, o.id
     LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.claim_media_operation(
    p_worker_key text, p_idempotency_key text, p_lease_seconds integer
)
RETURNS jsonb AS $$
DECLARE v_operation_id uuid; v_attempt_id uuid; v_attempt_number integer; v_retry_of uuid;
        v_hash text; v_replay jsonb; v_result jsonb;
BEGIN
    IF p_lease_seconds < 5 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'Claim lease must be between 5 and 3600 seconds' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_lease_seconds)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_operation_runtime_idempotency(p_worker_key, 'CLAIM_MEDIA_OPERATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    SELECT p.operation_id INTO v_operation_id
      FROM medialab_core.media_operation_projections p
      JOIN medialab_core.media_operations o ON o.id = p.operation_id
     WHERE p.current_state IN ('READY', 'RETRY_SCHEDULED') AND p.next_eligible_at <= clock_timestamp()
     ORDER BY p.next_eligible_at, o.requested_at, o.id
     FOR UPDATE OF p SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN
        v_result := jsonb_build_object('claimed', false);
        PERFORM medialab_core.record_media_operation_runtime_idempotency(p_worker_key, 'CLAIM_MEDIA_OPERATION',
            p_idempotency_key, v_hash, v_result);
        RETURN v_result;
    END IF;
    SELECT coalesce(max(attempt_number), 0) + 1,
           (array_agg(id ORDER BY attempt_number DESC))[1]
      INTO v_attempt_number, v_retry_of
      FROM medialab_core.media_operation_attempts WHERE operation_id = v_operation_id;
    IF v_attempt_number = 1 THEN v_retry_of := NULL; END IF;
    v_attempt_id := gen_random_uuid();
    INSERT INTO medialab_core.media_operation_attempts
        (id, operation_id, organization_id, job_id, attempt_number, worker_key, lease_expires_at, retry_of_attempt_id)
    SELECT v_attempt_id, o.id, o.organization_id, o.job_id, v_attempt_number, p_worker_key,
           clock_timestamp() + make_interval(secs => p_lease_seconds), v_retry_of
      FROM medialab_core.media_operations o WHERE o.id = v_operation_id;
    PERFORM medialab_core.append_media_operation_event(v_operation_id, 'CLAIMED', v_attempt_id, NULL, p_worker_key,
        'Eligible media operation claimed atomically', jsonb_build_object('attempt_number', v_attempt_number));
    v_result := jsonb_build_object('claimed', true, 'operation_id', v_operation_id,
        'attempt_id', v_attempt_id, 'attempt_number', v_attempt_number);
    PERFORM medialab_core.record_media_operation_runtime_idempotency(p_worker_key, 'CLAIM_MEDIA_OPERATION',
        p_idempotency_key, v_hash, v_result);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.start_media_operation_attempt(
    p_worker_key text, p_idempotency_key text, p_attempt_id uuid
)
RETURNS uuid AS $$
DECLARE v_attempt medialab_core.media_operation_attempts%ROWTYPE; v_hash text; v_replay jsonb;
BEGIN
    SELECT * INTO v_attempt FROM medialab_core.media_operation_attempts WHERE id = p_attempt_id;
    IF NOT FOUND OR v_attempt.worker_key <> p_worker_key THEN
        RAISE EXCEPTION 'Attempt is missing or unavailable to this worker' USING ERRCODE = '42501';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_attempt_id)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_operation_runtime_idempotency(p_worker_key, 'START_MEDIA_OPERATION_ATTEMPT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'attempt_id')::uuid; END IF;
    PERFORM medialab_core.append_media_operation_event(v_attempt.operation_id, 'STARTED', v_attempt.id, NULL, p_worker_key,
        'Media operation attempt started', '{}'::jsonb);
    PERFORM medialab_core.record_media_operation_runtime_idempotency(p_worker_key, 'START_MEDIA_OPERATION_ATTEMPT',
        p_idempotency_key, v_hash, jsonb_build_object('attempt_id', p_attempt_id));
    RETURN p_attempt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_operation_checkpoint(
    p_worker_key text, p_idempotency_key text, p_attempt_id uuid, p_checkpoint_type text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_attempt medialab_core.media_operation_attempts%ROWTYPE; v_id uuid; v_sequence integer; v_hash text; v_replay jsonb;
BEGIN
    SELECT * INTO v_attempt FROM medialab_core.media_operation_attempts WHERE id = p_attempt_id;
    IF NOT FOUND OR v_attempt.worker_key <> p_worker_key THEN
        RAISE EXCEPTION 'Attempt is missing or unavailable to this worker' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.validate_media_operation_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_attempt_id, p_checkpoint_type, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_operation_runtime_idempotency(p_worker_key, 'RECORD_MEDIA_OPERATION_CHECKPOINT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'checkpoint_id')::uuid; END IF;
    PERFORM 1 FROM medialab_core.media_operation_attempts WHERE id = p_attempt_id FOR UPDATE;
    SELECT coalesce(max(checkpoint_sequence), 0) + 1 INTO v_sequence
      FROM medialab_core.media_operation_checkpoints WHERE attempt_id = p_attempt_id;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_operation_checkpoints
        (id, operation_id, attempt_id, checkpoint_sequence, checkpoint_type, worker_key, evidence)
    VALUES (v_id, v_attempt.operation_id, v_attempt.id, v_sequence, p_checkpoint_type, p_worker_key, p_evidence);
    PERFORM medialab_core.append_media_operation_event(v_attempt.operation_id, 'CHECKPOINTED', v_attempt.id, NULL, p_worker_key,
        'Ordered attempt checkpoint recorded', jsonb_build_object('checkpoint_id', v_id, 'checkpoint_sequence', v_sequence));
    PERFORM medialab_core.record_media_operation_runtime_idempotency(p_worker_key, 'RECORD_MEDIA_OPERATION_CHECKPOINT',
        p_idempotency_key, v_hash, jsonb_build_object('checkpoint_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_operation_receipt(
    p_worker_key text, p_idempotency_key text, p_attempt_id uuid, p_target_id uuid,
    p_receipt_type text, p_provider_neutral_reference text, p_observed_byte_size bigint,
    p_observed_checksum_sha256 text, p_observed_media_type text, p_observed_manifest_sha256 text,
    p_provider_response_class text, p_verification_state text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_attempt medialab_core.media_operation_attempts%ROWTYPE; v_id uuid; v_sequence integer; v_hash text; v_replay jsonb;
BEGIN
    SELECT * INTO v_attempt FROM medialab_core.media_operation_attempts WHERE id = p_attempt_id;
    IF NOT FOUND OR v_attempt.worker_key <> p_worker_key THEN
        RAISE EXCEPTION 'Attempt is missing or unavailable to this worker' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM medialab_core.media_operation_targets WHERE id = p_target_id AND operation_id = v_attempt.operation_id) THEN
        RAISE EXCEPTION 'Receipt target is missing or belongs to another operation' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.validate_media_operation_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_attempt_id, p_target_id, p_receipt_type,
        p_provider_neutral_reference, p_observed_byte_size, p_observed_checksum_sha256, p_observed_media_type,
        p_observed_manifest_sha256, p_provider_response_class, p_verification_state, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_operation_runtime_idempotency(p_worker_key, 'RECORD_MEDIA_OPERATION_RECEIPT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'receipt_id')::uuid; END IF;
    PERFORM 1 FROM medialab_core.media_operation_attempts WHERE id = p_attempt_id FOR UPDATE;
    SELECT coalesce(max(receipt_sequence), 0) + 1 INTO v_sequence
      FROM medialab_core.media_operation_receipts WHERE attempt_id = p_attempt_id;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_operation_receipts
        (id, operation_id, attempt_id, target_id, receipt_sequence, receipt_type,
         provider_neutral_reference, observed_byte_size, observed_checksum_sha256, observed_media_type,
         observed_manifest_sha256, provider_response_class, verification_state, worker_key, evidence)
    VALUES (v_id, v_attempt.operation_id, v_attempt.id, p_target_id, v_sequence, p_receipt_type,
            p_provider_neutral_reference, p_observed_byte_size, p_observed_checksum_sha256,
            p_observed_media_type, p_observed_manifest_sha256, p_provider_response_class,
            p_verification_state, p_worker_key, p_evidence);
    PERFORM medialab_core.append_media_operation_event(v_attempt.operation_id, 'RECEIPT_RECORDED', v_attempt.id, NULL, p_worker_key,
        'Immutable target-specific technical receipt recorded', jsonb_build_object('receipt_id', v_id, 'receipt_sequence', v_sequence));
    PERFORM medialab_core.record_media_operation_runtime_idempotency(p_worker_key, 'RECORD_MEDIA_OPERATION_RECEIPT',
        p_idempotency_key, v_hash, jsonb_build_object('receipt_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.complete_media_operation_attempt(
    p_worker_key text, p_idempotency_key text, p_attempt_id uuid, p_result text, p_reason text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_attempt medialab_core.media_operation_attempts%ROWTYPE; v_hash text; v_replay jsonb;
BEGIN
    SELECT * INTO v_attempt FROM medialab_core.media_operation_attempts WHERE id = p_attempt_id;
    IF NOT FOUND OR v_attempt.worker_key <> p_worker_key THEN
        RAISE EXCEPTION 'Attempt is missing or unavailable to this worker' USING ERRCODE = '42501';
    END IF;
    IF p_result NOT IN ('SUCCEEDED', 'FAILED', 'STOPPED', 'CANCELLED', 'ABANDONED') THEN
        RAISE EXCEPTION 'Unsupported attempt terminal result' USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_media_operation_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_attempt_id, p_result, p_reason, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_operation_runtime_idempotency(p_worker_key, 'COMPLETE_MEDIA_OPERATION_ATTEMPT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'attempt_id')::uuid; END IF;
    PERFORM medialab_core.append_media_operation_event(v_attempt.operation_id, p_result, v_attempt.id, NULL, p_worker_key,
        p_reason, p_evidence);
    PERFORM medialab_core.record_media_operation_runtime_idempotency(p_worker_key, 'COMPLETE_MEDIA_OPERATION_ATTEMPT',
        p_idempotency_key, v_hash, jsonb_build_object('attempt_id', p_attempt_id));
    RETURN p_attempt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.schedule_media_operation_retry(
    p_worker_key text, p_idempotency_key text, p_operation_id uuid,
    p_prior_attempt_id uuid, p_reason text, p_next_eligible_at timestamptz
)
RETURNS uuid AS $$
DECLARE v_prior medialab_core.media_operation_attempts%ROWTYPE; v_hash text; v_replay jsonb;
BEGIN
    SELECT * INTO v_prior FROM medialab_core.media_operation_attempts
     WHERE id = p_prior_attempt_id AND operation_id = p_operation_id;
    IF NOT FOUND OR v_prior.worker_key <> p_worker_key THEN
        RAISE EXCEPTION 'Prior attempt is missing or unavailable to this worker' USING ERRCODE = '42501';
    END IF;
    IF p_next_eligible_at < clock_timestamp() OR p_next_eligible_at > clock_timestamp() + interval '30 days' THEN
        RAISE EXCEPTION 'Retry eligibility time must be bounded between now and thirty days' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_operation_id, p_prior_attempt_id, p_reason, p_next_eligible_at)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_operation_runtime_idempotency(p_worker_key, 'SCHEDULE_MEDIA_OPERATION_RETRY', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'operation_id')::uuid; END IF;
    PERFORM medialab_core.append_media_operation_event(p_operation_id, 'RETRY_SCHEDULED', p_prior_attempt_id, NULL,
        p_worker_key, p_reason, jsonb_build_object('retry_of_attempt_id', p_prior_attempt_id), p_next_eligible_at);
    PERFORM medialab_core.record_media_operation_runtime_idempotency(p_worker_key, 'SCHEDULE_MEDIA_OPERATION_RETRY',
        p_idempotency_key, v_hash, jsonb_build_object('operation_id', p_operation_id));
    RETURN p_operation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_operation_reconciliation(
    p_session_token text, p_idempotency_key text, p_operation_id uuid, p_attempt_id uuid,
    p_target_id uuid, p_finding_type text, p_outcome text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_operation medialab_core.media_operations%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb; v_event text;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_operation FROM medialab_core.media_operations WHERE id = p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media operation is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_operation_permission(v_actor, v_operation.organization_id, 'media_operation.manage');
    PERFORM medialab_core.validate_media_operation_safe_json(p_evidence);
    IF p_attempt_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.media_operation_attempts WHERE id = p_attempt_id AND operation_id = p_operation_id
    ) THEN RAISE EXCEPTION 'Reconciliation attempt belongs to another operation or is missing' USING ERRCODE = '42501'; END IF;
    IF p_target_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.media_operation_targets WHERE id = p_target_id AND operation_id = p_operation_id
    ) THEN RAISE EXCEPTION 'Reconciliation target belongs to another operation or is missing' USING ERRCODE = '42501'; END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_operation_id, p_attempt_id, p_target_id,
        p_finding_type, p_outcome, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_MEDIA_OPERATION_RECONCILIATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'reconciliation_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_operation_reconciliations
        (id, operation_id, attempt_id, target_id, finding_type, outcome, evidence, reconciled_by_identity_id)
    VALUES (v_id, p_operation_id, p_attempt_id, p_target_id, p_finding_type, p_outcome, p_evidence, v_actor);
    v_event := CASE WHEN p_outcome IN ('OPEN', 'MANUAL_REVIEW_REQUIRED')
                    THEN 'RECONCILIATION_REQUIRED' ELSE 'RECONCILED' END;
    IF v_event = 'RECONCILED' AND
       (SELECT current_state FROM medialab_core.media_operation_projections WHERE operation_id = p_operation_id) <> 'RECONCILIATION_REQUIRED' THEN
        PERFORM medialab_core.append_media_operation_event(p_operation_id, 'RECONCILIATION_REQUIRED', p_attempt_id,
            v_actor, NULL, 'Reconciliation comparison recorded before resolution', jsonb_build_object('reconciliation_id', v_id));
    END IF;
    PERFORM medialab_core.append_media_operation_event(p_operation_id, v_event, p_attempt_id, v_actor, NULL,
        'Reconciliation finding and outcome recorded', jsonb_build_object('reconciliation_id', v_id,
        'finding_type', p_finding_type, 'outcome', p_outcome));
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_MEDIA_OPERATION_RECONCILIATION', p_idempotency_key,
        v_hash, jsonb_build_object('reconciliation_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_media_operation_record(p_session_token text, p_operation_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_operation medialab_core.media_operations%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_operation FROM medialab_core.media_operations WHERE id = p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media operation is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_operation_permission(v_actor, v_operation.organization_id, 'media_operation.read');
    RETURN jsonb_build_object(
        'operation', to_jsonb(v_operation),
        'projection', (SELECT to_jsonb(p) FROM medialab_core.media_operation_projections p WHERE p.operation_id = v_operation.id),
        'targets', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.attached_at, t.id)
            FROM medialab_core.media_operation_targets t WHERE t.operation_id = v_operation.id), '[]'::jsonb),
        'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_sequence, e.id)
            FROM medialab_core.media_operation_events e WHERE e.operation_id = v_operation.id), '[]'::jsonb),
        'attempts', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attempt_number, a.id)
            FROM medialab_core.media_operation_attempts a WHERE a.operation_id = v_operation.id), '[]'::jsonb),
        'checkpoints', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.attempt_id, c.checkpoint_sequence, c.id)
            FROM medialab_core.media_operation_checkpoints c WHERE c.operation_id = v_operation.id), '[]'::jsonb),
        'receipts', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.attempt_id, r.receipt_sequence, r.id)
            FROM medialab_core.media_operation_receipts r WHERE r.operation_id = v_operation.id), '[]'::jsonb),
        'control_requests', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.requested_at, c.id)
            FROM medialab_core.media_operation_control_requests c WHERE c.operation_id = v_operation.id), '[]'::jsonb),
        'reconciliations', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.reconciled_at, r.id)
            FROM medialab_core.media_operation_reconciliations r WHERE r.operation_id = v_operation.id), '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_media_operations(
    p_session_token text, p_organization_id uuid, p_job_id uuid DEFAULT NULL
)
RETURNS TABLE (operation_id uuid, job_id uuid, operation_family text, operation_subtype text,
               current_state text, requested_at timestamptz, updated_at timestamptz) AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_media_operation_permission(v_actor, p_organization_id, 'media_operation.read');
    RETURN QUERY
    SELECT o.id, o.job_id, o.operation_family, o.operation_subtype, p.current_state, o.requested_at, p.updated_at
      FROM medialab_core.media_operations o
      JOIN medialab_core.media_operation_projections p ON p.operation_id = o.id
     WHERE o.organization_id = p_organization_id AND (p_job_id IS NULL OR o.job_id = p_job_id)
     ORDER BY o.requested_at, o.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER media_operation_targets_validation_guard
BEFORE INSERT ON medialab_core.media_operation_targets
FOR EACH ROW EXECUTE FUNCTION medialab_core.validate_media_operation_target();

CREATE TRIGGER media_operation_projections_control_guard
BEFORE INSERT OR UPDATE OR DELETE ON medialab_core.media_operation_projections
FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_media_operation_projection_mutation();

CREATE TRIGGER media_operations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operations
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_targets_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_targets
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_attempts_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_attempts
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_checkpoints_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_checkpoints
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_receipts_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_receipts
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_control_requests_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_control_requests
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_reconciliations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_reconciliations
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();
CREATE TRIGGER media_operation_runtime_idempotency_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_operation_runtime_idempotency
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_operation_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.media_operations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_targets FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_attempts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_checkpoints FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_receipts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_control_requests FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_reconciliations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_projections FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_operation_runtime_idempotency FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_media_operation_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_media_operation_projection_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_media_operation_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_media_operation_safe_json(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.check_media_operation_runtime_idempotency(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_operation_runtime_idempotency(text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_media_operation_target() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.append_media_operation_event(uuid, text, uuid, uuid, text, text, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.request_media_operation(text, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.attach_media_operation_target(text, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.ready_media_operation(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.request_media_operation_control(text, text, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_claimable_media_operations(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.claim_media_operation(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.start_media_operation_attempt(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_operation_checkpoint(text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_operation_receipt(text, text, uuid, uuid, text, text, bigint, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.complete_media_operation_attempt(text, text, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.schedule_media_operation_retry(text, text, uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_operation_reconciliation(text, text, uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_media_operation_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_media_operations(text, uuid, uuid) FROM PUBLIC;
