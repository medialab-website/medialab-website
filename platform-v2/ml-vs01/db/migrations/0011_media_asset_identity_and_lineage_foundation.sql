-- P02-M08-A: provider-neutral media asset identity and lineage foundation.
-- This packet stores synthetic database evidence only. It performs no ingest, provider I/O, or media processing.

CREATE TABLE medialab_core.media_assets (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT media_assets_id_org_job_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT media_assets_context_check CHECK (
        jsonb_typeof(source_context) = 'object' AND
        source_context::text !~* '"([a-z0-9_]*credential[a-z0-9_]*|[a-z0-9_]*password[a-z0-9_]*|[a-z0-9_]*secret[a-z0-9_]*|[a-z0-9_]*token[a-z0-9_]*|access_key|private_key)"[[:space:]]*:'
    )
);

CREATE TABLE medialab_core.media_asset_versions (
    id uuid PRIMARY KEY,
    asset_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    version_number integer NOT NULL,
    version_kind text NOT NULL,
    observed_filename text NOT NULL,
    byte_size bigint NOT NULL,
    media_type text NOT NULL,
    checksum_sha256 text NOT NULL,
    source_provenance text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (asset_id, organization_id, job_id)
        REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_asset_versions_id_org_job_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT media_asset_versions_asset_number_key UNIQUE (asset_id, version_number),
    CONSTRAINT media_asset_versions_number_check CHECK (version_number > 0),
    CONSTRAINT media_asset_versions_kind_check CHECK (version_kind IN (
        'ORIGINAL', 'SELECTED_RAW', 'EDITOR_RETURN', 'REVISION_RETURN', 'QUICK_EDIT_CORRECTION',
        'GENERATED_DERIVATIVE', 'DELIVERY_RENDITION', 'REPLACEMENT_VERSION'
    )),
    CONSTRAINT media_asset_versions_filename_check CHECK (
        observed_filename = btrim(observed_filename) AND observed_filename <> '' AND length(observed_filename) <= 500
    ),
    CONSTRAINT media_asset_versions_size_check CHECK (byte_size >= 0),
    CONSTRAINT media_asset_versions_media_type_check CHECK (
        media_type = lower(btrim(media_type)) AND media_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
    ),
    CONSTRAINT media_asset_versions_checksum_check CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_asset_versions_provenance_check CHECK (
        source_provenance = btrim(source_provenance) AND source_provenance <> '' AND length(source_provenance) <= 1000
    )
);
CREATE UNIQUE INDEX media_asset_versions_one_original_idx
    ON medialab_core.media_asset_versions (asset_id) WHERE version_kind = 'ORIGINAL';

CREATE TABLE medialab_core.media_asset_lineage (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    target_version_id uuid NOT NULL,
    relationship_type text NOT NULL,
    reason text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (source_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_asset_lineage_pair_type_key UNIQUE (source_version_id, target_version_id, relationship_type),
    CONSTRAINT media_asset_lineage_distinct_check CHECK (source_version_id <> target_version_id),
    CONSTRAINT media_asset_lineage_type_check CHECK (relationship_type IN (
        'SOURCE_TO_DERIVATIVE', 'PARENT_TO_CHILD', 'REPLACES', 'SUPERSEDES',
        'ORIGINAL_TO_EDITOR_RETURN', 'EDITOR_RETURN_TO_CORRECTED_VERSION', 'APPROVED_FINAL_SOURCE'
    )),
    CONSTRAINT media_asset_lineage_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    )
);

CREATE TABLE medialab_core.media_capture_relationships (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    left_version_id uuid NOT NULL,
    right_version_id uuid NOT NULL,
    relationship_type text NOT NULL,
    group_key text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (left_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (right_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_capture_relationships_pair_key UNIQUE (left_version_id, right_version_id, relationship_type, group_key),
    CONSTRAINT media_capture_relationships_distinct_check CHECK (left_version_id <> right_version_id),
    CONSTRAINT media_capture_relationships_type_check CHECK (relationship_type IN (
        'HDR_BRACKET', 'CAPTURE_GROUP', 'JPEG_RAW_PAIR', 'DRONE_JPEG_DNG_PAIR',
        'RELATED_CAPTURE', 'SELECTED_MEDIA'
    )),
    CONSTRAINT media_capture_relationships_group_check CHECK (
        group_key = btrim(group_key) AND group_key <> '' AND length(group_key) <= 200
    )
);

CREATE TABLE medialab_core.media_storage_objects (
    id uuid PRIMARY KEY,
    version_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    provider text NOT NULL,
    storage_namespace text NOT NULL,
    provider_object_identifier text NOT NULL,
    checksum_sha256 text NOT NULL,
    byte_size bigint NOT NULL,
    media_type text NOT NULL,
    source_provenance text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_storage_objects_id_org_job_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT media_storage_objects_provider_key UNIQUE (organization_id, provider, storage_namespace, provider_object_identifier),
    CONSTRAINT media_storage_objects_provider_check CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_storage_objects_namespace_check CHECK (
        storage_namespace = btrim(storage_namespace) AND storage_namespace <> '' AND length(storage_namespace) <= 300
    ),
    CONSTRAINT media_storage_objects_identifier_check CHECK (
        provider_object_identifier = btrim(provider_object_identifier) AND provider_object_identifier <> '' AND
        length(provider_object_identifier) <= 1000 AND provider_object_identifier !~ '://' AND
        provider_object_identifier !~* '(^|[?&])(token|signature|credential|password|secret|access_key|private_key)='
    ),
    CONSTRAINT media_storage_objects_checksum_check CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_storage_objects_size_check CHECK (byte_size >= 0),
    CONSTRAINT media_storage_objects_media_type_check CHECK (
        media_type = lower(btrim(media_type)) AND media_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
    ),
    CONSTRAINT media_storage_objects_provenance_check CHECK (
        source_provenance = btrim(source_provenance) AND source_provenance <> '' AND length(source_provenance) <= 1000 AND
        source_provenance !~* '(password|secret|credential|access[_ -]?token|private[_ -]?key|access[_ -]?key)'
    )
);

CREATE TABLE medialab_core.media_location_observations (
    id uuid PRIMARY KEY,
    storage_object_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    location_identifier text NOT NULL,
    observation_state text NOT NULL,
    source_provenance text NOT NULL,
    observed_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (storage_object_id, organization_id, job_id)
        REFERENCES medialab_core.media_storage_objects(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_location_observations_state_check CHECK (observation_state IN (
        'OBSERVED_PRESENT', 'OBSERVED_MISSING', 'MOVED', 'COPIED', 'REMOVED'
    )),
    CONSTRAINT media_location_observations_identifier_check CHECK (
        location_identifier = btrim(location_identifier) AND location_identifier <> '' AND length(location_identifier) <= 1500 AND
        location_identifier !~* '(^|[?&])(token|signature|credential|password|secret|access_key|private_key)='
    ),
    CONSTRAINT media_location_observations_provenance_check CHECK (
        source_provenance = btrim(source_provenance) AND source_provenance <> '' AND length(source_provenance) <= 1000
    )
);

CREATE TABLE medialab_core.media_verification_events (
    id uuid PRIMARY KEY,
    version_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    verification_method text NOT NULL,
    verification_state text NOT NULL,
    observed_checksum_sha256 text NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    verified_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_verification_events_method_check CHECK (verification_method ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_verification_events_state_check CHECK (verification_state IN (
        'PENDING', 'VERIFIED', 'FAILED', 'CONFLICT'
    )),
    CONSTRAINT media_verification_events_checksum_check CHECK (
        observed_checksum_sha256 IS NULL OR observed_checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT media_verification_events_evidence_check CHECK (
        jsonb_typeof(evidence) = 'object' AND
        evidence::text !~* '"([a-z0-9_]*credential[a-z0-9_]*|[a-z0-9_]*password[a-z0-9_]*|[a-z0-9_]*secret[a-z0-9_]*|[a-z0-9_]*token[a-z0-9_]*|access_key|private_key)"[[:space:]]*:'
    )
);

CREATE TABLE medialab_core.media_transfer_events (
    id uuid PRIMARY KEY,
    storage_object_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    transfer_type text NOT NULL,
    transfer_state text NOT NULL,
    attempt_number integer NOT NULL,
    retry_key text NOT NULL,
    receipt_identifier text NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (storage_object_id, organization_id, job_id)
        REFERENCES medialab_core.media_storage_objects(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_transfer_events_attempt_key UNIQUE (storage_object_id, transfer_type, retry_key, attempt_number),
    CONSTRAINT media_transfer_events_type_check CHECK (transfer_type IN ('MOVE', 'COPY', 'UPLOAD', 'DOWNLOAD', 'HANDOFF', 'RETURN')),
    CONSTRAINT media_transfer_events_state_check CHECK (transfer_state IN ('ATTEMPTED', 'SUCCEEDED', 'FAILED', 'RETRY_SCHEDULED', 'CONFLICT')),
    CONSTRAINT media_transfer_events_attempt_check CHECK (attempt_number > 0),
    CONSTRAINT media_transfer_events_retry_key_check CHECK (
        retry_key = btrim(retry_key) AND retry_key <> '' AND length(retry_key) <= 200
    ),
    CONSTRAINT media_transfer_events_receipt_check CHECK (
        receipt_identifier IS NULL OR (receipt_identifier = btrim(receipt_identifier) AND receipt_identifier <> '' AND length(receipt_identifier) <= 500)
    ),
    CONSTRAINT media_transfer_events_evidence_check CHECK (
        jsonb_typeof(evidence) = 'object' AND
        evidence::text !~* '"([a-z0-9_]*credential[a-z0-9_]*|[a-z0-9_]*password[a-z0-9_]*|[a-z0-9_]*secret[a-z0-9_]*|[a-z0-9_]*token[a-z0-9_]*|access_key|private_key)"[[:space:]]*:'
    )
);

CREATE TABLE medialab_core.media_approved_source_designations (
    id uuid PRIMARY KEY,
    version_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    purpose text NOT NULL,
    designation text NOT NULL,
    supersedes_designation_id uuid NULL,
    reason text NOT NULL,
    designated_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    designated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_approved_source_designations_id_org_job_key UNIQUE (id, organization_id, job_id, purpose),
    FOREIGN KEY (supersedes_designation_id, organization_id, job_id, purpose)
        REFERENCES medialab_core.media_approved_source_designations(id, organization_id, job_id, purpose) ON DELETE RESTRICT,
    CONSTRAINT media_approved_source_designations_purpose_check CHECK (purpose ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_approved_source_designations_value_check CHECK (designation IN (
        'ACCEPTED_VERSION', 'FINAL_SOURCE', 'USE_ORIGINAL', 'SKIP_QUICK_EDIT', 'REPLACEMENT_SOURCE'
    )),
    CONSTRAINT media_approved_source_designations_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    )
);

CREATE TABLE medialab_core.media_manifests (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    manifest_version integer NOT NULL,
    schema_version text NOT NULL,
    manifest_json jsonb NOT NULL,
    integrity_sha256 text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT media_manifests_job_version_key UNIQUE (job_id, manifest_version),
    CONSTRAINT media_manifests_version_check CHECK (manifest_version > 0),
    CONSTRAINT media_manifests_schema_check CHECK (schema_version ~ '^MEDIA_MANIFEST_V[0-9]+$'),
    CONSTRAINT media_manifests_json_check CHECK (jsonb_typeof(manifest_json) = 'object'),
    CONSTRAINT media_manifests_hash_check CHECK (integrity_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.media_command_idempotency (
    id uuid PRIMARY KEY,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT media_command_idempotency_actor_key UNIQUE (actor_identity_id, command_type, idempotency_key),
    CONSTRAINT media_command_idempotency_command_check CHECK (command_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_command_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT media_command_idempotency_hash_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_command_idempotency_result_check CHECK (jsonb_typeof(result) = 'object')
);

CREATE INDEX media_asset_versions_asset_idx ON medialab_core.media_asset_versions (asset_id, version_number, id);
CREATE INDEX media_asset_lineage_target_idx ON medialab_core.media_asset_lineage (target_version_id, recorded_at, id);
CREATE INDEX media_capture_relationships_group_idx ON medialab_core.media_capture_relationships (job_id, group_key, relationship_type, id);
CREATE INDEX media_storage_objects_version_idx ON medialab_core.media_storage_objects (version_id, recorded_at, id);
CREATE INDEX media_location_observations_object_idx ON medialab_core.media_location_observations (storage_object_id, observed_at, id);
CREATE INDEX media_verification_events_version_idx ON medialab_core.media_verification_events (version_id, verified_at, id);
CREATE INDEX media_transfer_events_object_idx ON medialab_core.media_transfer_events (storage_object_id, recorded_at, id);
CREATE INDEX media_designations_job_idx ON medialab_core.media_approved_source_designations (job_id, purpose, designated_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_media_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable append-only evidence: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_media_permission(
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

CREATE OR REPLACE FUNCTION medialab_core.validate_media_safe_json(p_evidence jsonb)
RETURNS void AS $$
BEGIN
    IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
        RAISE EXCEPTION 'Media evidence must be a JSON object' USING ERRCODE = '22023';
    END IF;
    IF p_evidence::text ~* '"([a-z0-9_]*credential[a-z0-9_]*|[a-z0-9_]*password[a-z0-9_]*|[a-z0-9_]*secret[a-z0-9_]*|[a-z0-9_]*token[a-z0-9_]*|access_key|private_key)"[[:space:]]*:' THEN
        RAISE EXCEPTION 'Provider credentials and secrets are prohibited from media evidence' USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.check_media_idempotency(
    p_actor_identity_id uuid, p_command_type text, p_idempotency_key text, p_request_sha256 text
)
RETURNS jsonb AS $$
DECLARE v_row medialab_core.media_command_idempotency%ROWTYPE;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'A bounded idempotency key is required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_actor_identity_id::text || ':' || p_command_type || ':' || p_idempotency_key, 0)
    );
    SELECT * INTO v_row FROM medialab_core.media_command_idempotency
     WHERE actor_identity_id = p_actor_identity_id AND command_type = p_command_type AND idempotency_key = p_idempotency_key;
    IF FOUND AND v_row.request_sha256 <> p_request_sha256 THEN
        RAISE EXCEPTION 'Idempotency key conflicts with a different request fingerprint' USING ERRCODE = '22023';
    END IF;
    RETURN CASE WHEN FOUND THEN v_row.result ELSE NULL END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_idempotency(
    p_actor_identity_id uuid, p_command_type text, p_idempotency_key text, p_request_sha256 text, p_result jsonb
)
RETURNS void AS $$
BEGIN
    INSERT INTO medialab_core.media_command_idempotency
        (id, actor_identity_id, command_type, idempotency_key, request_sha256, result)
    VALUES (gen_random_uuid(), p_actor_identity_id, p_command_type, p_idempotency_key, p_request_sha256, p_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_media_asset(
    p_session_token text, p_idempotency_key text, p_job_id uuid, p_service_workstream_id uuid, p_source_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_job medialab_core.jobs%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_job.organization_id, 'media_asset.manage');
    IF p_service_workstream_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.service_workstreams
         WHERE id = p_service_workstream_id AND job_id = v_job.id AND organization_id = v_job.organization_id
    ) THEN RAISE EXCEPTION 'Service Workstream is cross-tenant, cross-Job, or missing' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.validate_media_safe_json(p_source_context);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_job_id, p_service_workstream_id, p_source_context)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'CREATE_MEDIA_ASSET', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'asset_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_assets
        (id, organization_id, job_id, service_workstream_id, source_context, created_by_identity_id)
    VALUES (v_id, v_job.organization_id, v_job.id, p_service_workstream_id, p_source_context, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'CREATE_MEDIA_ASSET', p_idempotency_key, v_hash, jsonb_build_object('asset_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.add_media_asset_version(
    p_session_token text, p_idempotency_key text, p_asset_id uuid, p_version_kind text,
    p_observed_filename text, p_byte_size bigint, p_media_type text, p_checksum_sha256 text, p_source_provenance text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_asset medialab_core.media_assets%ROWTYPE; v_id uuid; v_number integer; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_asset FROM medialab_core.media_assets WHERE id = p_asset_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media asset is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_asset.organization_id, 'media_asset.manage');
    IF p_version_kind <> 'ORIGINAL' AND NOT EXISTS (SELECT 1 FROM medialab_core.media_asset_versions WHERE asset_id = p_asset_id) THEN
        RAISE EXCEPTION 'The first version of a logical asset must be ORIGINAL' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_asset_id, p_version_kind, p_observed_filename, p_byte_size, lower(p_media_type), p_checksum_sha256, p_source_provenance)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'ADD_MEDIA_ASSET_VERSION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'version_id')::uuid; END IF;
    SELECT coalesce(max(version_number), 0) + 1 INTO v_number FROM medialab_core.media_asset_versions WHERE asset_id = p_asset_id;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_asset_versions
        (id, asset_id, organization_id, job_id, version_number, version_kind, observed_filename,
         byte_size, media_type, checksum_sha256, source_provenance, created_by_identity_id)
    VALUES (v_id, v_asset.id, v_asset.organization_id, v_asset.job_id, v_number, p_version_kind,
            p_observed_filename, p_byte_size, lower(p_media_type), p_checksum_sha256, p_source_provenance, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'ADD_MEDIA_ASSET_VERSION', p_idempotency_key, v_hash, jsonb_build_object('version_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_lineage(
    p_session_token text, p_idempotency_key text, p_source_version_id uuid, p_target_version_id uuid,
    p_relationship_type text, p_reason text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_source medialab_core.media_asset_versions%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_source FROM medialab_core.media_asset_versions WHERE id = p_source_version_id;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM medialab_core.media_asset_versions WHERE id = p_target_version_id
          AND organization_id = v_source.organization_id AND job_id = v_source.job_id
    ) THEN RAISE EXCEPTION 'Lineage versions are cross-tenant, cross-Job, or missing' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_source.organization_id, 'media_asset.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_source_version_id, p_target_version_id, p_relationship_type, p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_MEDIA_LINEAGE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'lineage_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_asset_lineage
        (id, organization_id, job_id, source_version_id, target_version_id, relationship_type, reason, recorded_by_identity_id)
    VALUES (v_id, v_source.organization_id, v_source.job_id, p_source_version_id, p_target_version_id, p_relationship_type, p_reason, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_MEDIA_LINEAGE', p_idempotency_key, v_hash, jsonb_build_object('lineage_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_capture_relationship(
    p_session_token text, p_idempotency_key text, p_left_version_id uuid, p_right_version_id uuid,
    p_relationship_type text, p_group_key text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_left medialab_core.media_asset_versions%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_left FROM medialab_core.media_asset_versions WHERE id = p_left_version_id;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM medialab_core.media_asset_versions WHERE id = p_right_version_id
          AND organization_id = v_left.organization_id AND job_id = v_left.job_id
    ) THEN RAISE EXCEPTION 'Capture relationship versions are cross-tenant, cross-Job, or missing' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_left.organization_id, 'media_asset.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_left_version_id, p_right_version_id, p_relationship_type, p_group_key)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_MEDIA_CAPTURE_RELATIONSHIP', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'relationship_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_capture_relationships
        (id, organization_id, job_id, left_version_id, right_version_id, relationship_type, group_key, recorded_by_identity_id)
    VALUES (v_id, v_left.organization_id, v_left.job_id, p_left_version_id, p_right_version_id, p_relationship_type, p_group_key, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_MEDIA_CAPTURE_RELATIONSHIP', p_idempotency_key, v_hash, jsonb_build_object('relationship_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_storage_object(
    p_session_token text, p_idempotency_key text, p_version_id uuid, p_provider text,
    p_storage_namespace text, p_provider_object_identifier text, p_checksum_sha256 text,
    p_byte_size bigint, p_media_type text, p_source_provenance text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_version medialab_core.media_asset_versions%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_version FROM medialab_core.media_asset_versions WHERE id = p_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media version is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_version.organization_id, 'media_asset.manage');
    IF p_checksum_sha256 <> v_version.checksum_sha256 OR p_byte_size <> v_version.byte_size OR lower(p_media_type) <> v_version.media_type THEN
        RAISE EXCEPTION 'Storage object identity conflicts with immutable version evidence' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_version_id, p_provider, p_storage_namespace, p_provider_object_identifier, p_checksum_sha256, p_byte_size, lower(p_media_type), p_source_provenance)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_MEDIA_STORAGE_OBJECT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'storage_object_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_storage_objects
        (id, version_id, organization_id, job_id, provider, storage_namespace, provider_object_identifier,
         checksum_sha256, byte_size, media_type, source_provenance, recorded_by_identity_id)
    VALUES (v_id, v_version.id, v_version.organization_id, v_version.job_id, p_provider, p_storage_namespace,
            p_provider_object_identifier, p_checksum_sha256, p_byte_size, lower(p_media_type), p_source_provenance, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_MEDIA_STORAGE_OBJECT', p_idempotency_key, v_hash, jsonb_build_object('storage_object_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_location_observation(
    p_session_token text, p_idempotency_key text, p_storage_object_id uuid,
    p_location_identifier text, p_observation_state text, p_source_provenance text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_object medialab_core.media_storage_objects%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_object FROM medialab_core.media_storage_objects WHERE id = p_storage_object_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Storage object is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_object.organization_id, 'media_asset.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_storage_object_id, p_location_identifier, p_observation_state, p_source_provenance)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_MEDIA_LOCATION_OBSERVATION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'location_observation_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_location_observations
        (id, storage_object_id, organization_id, job_id, location_identifier, observation_state, source_provenance, observed_by_identity_id)
    VALUES (v_id, v_object.id, v_object.organization_id, v_object.job_id, p_location_identifier, p_observation_state, p_source_provenance, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_MEDIA_LOCATION_OBSERVATION', p_idempotency_key, v_hash, jsonb_build_object('location_observation_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_verification_event(
    p_session_token text, p_idempotency_key text, p_version_id uuid, p_verification_method text,
    p_verification_state text, p_observed_checksum_sha256 text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_version medialab_core.media_asset_versions%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_version FROM medialab_core.media_asset_versions WHERE id = p_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media version is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_version.organization_id, 'media_asset.manage');
    PERFORM medialab_core.validate_media_safe_json(p_evidence);
    IF p_verification_state = 'VERIFIED' AND p_observed_checksum_sha256 IS DISTINCT FROM v_version.checksum_sha256 THEN
        RAISE EXCEPTION 'Verified checksum must match immutable version evidence' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_version_id, p_verification_method, p_verification_state, p_observed_checksum_sha256, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_MEDIA_VERIFICATION_EVENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'verification_event_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_verification_events
        (id, version_id, organization_id, job_id, verification_method, verification_state,
         observed_checksum_sha256, evidence, verified_by_identity_id)
    VALUES (v_id, v_version.id, v_version.organization_id, v_version.job_id, p_verification_method,
            p_verification_state, p_observed_checksum_sha256, p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_MEDIA_VERIFICATION_EVENT', p_idempotency_key, v_hash, jsonb_build_object('verification_event_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_transfer_event(
    p_session_token text, p_idempotency_key text, p_storage_object_id uuid, p_transfer_type text,
    p_transfer_state text, p_attempt_number integer, p_retry_key text, p_receipt_identifier text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_object medialab_core.media_storage_objects%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_object FROM medialab_core.media_storage_objects WHERE id = p_storage_object_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Storage object is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_object.organization_id, 'media_asset.manage');
    PERFORM medialab_core.validate_media_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_storage_object_id, p_transfer_type, p_transfer_state, p_attempt_number, p_retry_key, p_receipt_identifier, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'RECORD_MEDIA_TRANSFER_EVENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'transfer_event_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_transfer_events
        (id, storage_object_id, organization_id, job_id, transfer_type, transfer_state, attempt_number,
         retry_key, receipt_identifier, evidence, recorded_by_identity_id)
    VALUES (v_id, v_object.id, v_object.organization_id, v_object.job_id, p_transfer_type, p_transfer_state,
            p_attempt_number, p_retry_key, p_receipt_identifier, p_evidence, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'RECORD_MEDIA_TRANSFER_EVENT', p_idempotency_key, v_hash, jsonb_build_object('transfer_event_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.designate_media_approved_source(
    p_session_token text, p_idempotency_key text, p_version_id uuid, p_purpose text,
    p_designation text, p_supersedes_designation_id uuid, p_reason text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_version medialab_core.media_asset_versions%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_version FROM medialab_core.media_asset_versions WHERE id = p_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media version is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_version.organization_id, 'media_asset.manage');
    IF p_supersedes_designation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.media_approved_source_designations
         WHERE id = p_supersedes_designation_id AND organization_id = v_version.organization_id
           AND job_id = v_version.job_id AND purpose = p_purpose
    ) THEN RAISE EXCEPTION 'Superseded designation is cross-tenant, cross-Job, missing, or for another purpose' USING ERRCODE = '42501'; END IF;
    IF p_designation = 'USE_ORIGINAL' AND v_version.version_kind <> 'ORIGINAL' THEN
        RAISE EXCEPTION 'USE_ORIGINAL must designate an ORIGINAL version' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_version_id, p_purpose, p_designation, p_supersedes_designation_id, p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'DESIGNATE_MEDIA_APPROVED_SOURCE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'designation_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_approved_source_designations
        (id, version_id, organization_id, job_id, purpose, designation, supersedes_designation_id,
         reason, designated_by_identity_id)
    VALUES (v_id, v_version.id, v_version.organization_id, v_version.job_id, p_purpose, p_designation,
            p_supersedes_designation_id, p_reason, v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'DESIGNATE_MEDIA_APPROVED_SOURCE', p_idempotency_key, v_hash, jsonb_build_object('designation_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_media_manifest(
    p_session_token text, p_idempotency_key text, p_job_id uuid, p_schema_version text
)
RETURNS uuid AS $$
DECLARE
    v_actor uuid; v_job medialab_core.jobs%ROWTYPE; v_id uuid; v_version integer; v_hash text; v_replay jsonb;
    v_manifest jsonb; v_integrity text;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_job.organization_id, 'media_asset.manage');
    IF p_schema_version IS NULL OR p_schema_version !~ '^MEDIA_MANIFEST_V[0-9]+$' THEN
        RAISE EXCEPTION 'A versioned media manifest schema identifier is required' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_job_id, p_schema_version)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'CREATE_MEDIA_MANIFEST', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'manifest_id')::uuid; END IF;
    SELECT coalesce(max(manifest_version), 0) + 1 INTO v_version FROM medialab_core.media_manifests WHERE job_id = p_job_id;
    v_manifest := jsonb_build_object(
        'schema_version', p_schema_version,
        'manifest_version', v_version,
        'organization_id', v_job.organization_id,
        'job_id', v_job.id,
        'assets', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'asset_id', a.id, 'service_workstream_id', a.service_workstream_id,
            'source_context', a.source_context, 'created_by_identity_id', a.created_by_identity_id,
            'created_at', a.created_at
        ) ORDER BY a.id) FROM medialab_core.media_assets a WHERE a.job_id = v_job.id), '[]'::jsonb),
        'versions', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'version_id', x.id, 'asset_id', x.asset_id, 'version_number', x.version_number,
            'version_kind', x.version_kind, 'observed_filename', x.observed_filename,
            'byte_size', x.byte_size, 'media_type', x.media_type, 'checksum_sha256', x.checksum_sha256,
            'source_provenance', x.source_provenance, 'created_by_identity_id', x.created_by_identity_id,
            'created_at', x.created_at
        ) ORDER BY x.asset_id, x.version_number, x.id) FROM medialab_core.media_asset_versions x WHERE x.job_id = v_job.id), '[]'::jsonb),
        'lineage', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.source_version_id, l.target_version_id, l.relationship_type, l.id)
            FROM medialab_core.media_asset_lineage l WHERE l.job_id = v_job.id), '[]'::jsonb),
        'capture_relationships', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.group_key, r.relationship_type, r.left_version_id, r.right_version_id, r.id)
            FROM medialab_core.media_capture_relationships r WHERE r.job_id = v_job.id), '[]'::jsonb),
        'storage_objects', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.version_id, s.provider, s.storage_namespace, s.provider_object_identifier, s.id)
            FROM medialab_core.media_storage_objects s WHERE s.job_id = v_job.id), '[]'::jsonb),
        'location_observations', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.storage_object_id, o.observed_at, o.id)
            FROM medialab_core.media_location_observations o WHERE o.job_id = v_job.id), '[]'::jsonb),
        'verification_events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.version_id, e.verified_at, e.id)
            FROM medialab_core.media_verification_events e WHERE e.job_id = v_job.id), '[]'::jsonb),
        'transfer_events', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.storage_object_id, t.retry_key, t.attempt_number, t.id)
            FROM medialab_core.media_transfer_events t WHERE t.job_id = v_job.id), '[]'::jsonb),
        'approved_source_designations', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.purpose, d.designated_at, d.id)
            FROM medialab_core.media_approved_source_designations d WHERE d.job_id = v_job.id), '[]'::jsonb)
    );
    v_integrity := encode(sha256(convert_to(v_manifest::text, 'UTF8')), 'hex');
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_manifests
        (id, organization_id, job_id, manifest_version, schema_version, manifest_json,
         integrity_sha256, created_by_identity_id)
    VALUES (v_id, v_job.organization_id, v_job.id, v_version, p_schema_version, v_manifest, v_integrity, v_actor);
    IF (SELECT integrity_sha256 FROM medialab_core.media_manifests WHERE id = v_id) <>
       encode(sha256(convert_to((SELECT manifest_json FROM medialab_core.media_manifests WHERE id = v_id)::text, 'UTF8')), 'hex') THEN
        RAISE EXCEPTION 'Media manifest readback hash mismatch' USING ERRCODE = 'XX000';
    END IF;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'CREATE_MEDIA_MANIFEST', p_idempotency_key, v_hash, jsonb_build_object('manifest_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_media_asset_record(p_session_token text, p_asset_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_asset medialab_core.media_assets%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_asset FROM medialab_core.media_assets WHERE id = p_asset_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media asset is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_asset.organization_id, 'media_asset.read');
    RETURN jsonb_build_object(
        'asset', to_jsonb(v_asset),
        'versions', coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version_number, v.id)
            FROM medialab_core.media_asset_versions v WHERE v.asset_id = v_asset.id), '[]'::jsonb),
        'lineage', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.recorded_at, l.id)
            FROM medialab_core.media_asset_lineage l JOIN medialab_core.media_asset_versions v ON v.id = l.target_version_id
            WHERE v.asset_id = v_asset.id), '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_media_manifest(p_session_token text, p_manifest_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_manifest medialab_core.media_manifests%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_manifest FROM medialab_core.media_manifests WHERE id = p_manifest_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media manifest is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_media_permission(v_actor, v_manifest.organization_id, 'media_asset.read');
    RETURN jsonb_build_object('manifest_id', v_manifest.id, 'integrity_sha256', v_manifest.integrity_sha256, 'manifest', v_manifest.manifest_json);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER media_assets_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_assets
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_asset_versions_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_asset_versions
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_asset_lineage_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_asset_lineage
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_capture_relationships_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_capture_relationships
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_storage_objects_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_storage_objects
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_location_observations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_location_observations
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_verification_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_verification_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_transfer_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_transfer_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_designations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_approved_source_designations
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_manifests_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_manifests
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER media_command_idempotency_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_command_idempotency
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.media_assets FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_asset_versions FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_asset_lineage FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_capture_relationships FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_storage_objects FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_location_observations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_verification_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_transfer_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_approved_source_designations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_manifests FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_command_idempotency FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_media_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_media_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_media_safe_json(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.check_media_idempotency(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_idempotency(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_media_asset(text, text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.add_media_asset_version(text, text, uuid, text, text, bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_lineage(text, text, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_capture_relationship(text, text, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_storage_object(text, text, uuid, text, text, text, text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_location_observation(text, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_verification_event(text, text, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_transfer_event(text, text, uuid, text, text, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.designate_media_approved_source(text, text, uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_media_manifest(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_media_asset_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_media_manifest(text, uuid) FROM PUBLIC;
