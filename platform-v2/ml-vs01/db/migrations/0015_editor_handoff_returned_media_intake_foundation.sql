-- P02-M12-A: provider-neutral editor handoff and returned-media intake foundation.
-- This packet stores synthetic database evidence only. It performs no provider or media I/O.

CREATE TABLE medialab_core.editor_handoff_batches (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    lane text NOT NULL,
    source_cull_workspace_id uuid NOT NULL UNIQUE,
    source_cull_manifest_id uuid NOT NULL,
    destination_type text NOT NULL,
    destination_reference text NOT NULL,
    destination_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_cull_workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_cull_manifest_id)
        REFERENCES medialab_core.media_manifests(id) ON DELETE RESTRICT,
    CONSTRAINT editor_handoff_batches_scope_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT editor_handoff_batches_lane_check CHECK (lane IN ('PHOTO', 'VIDEO')),
    CONSTRAINT editor_handoff_batches_destination_type_check CHECK (
        destination_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT editor_handoff_batches_destination_reference_check CHECK (
        destination_reference = btrim(destination_reference) AND destination_reference <> '' AND
        length(destination_reference) <= 500 AND destination_reference !~ '://' AND
        destination_reference !~ '(^/|^[A-Za-z]:[\\/])' AND
        destination_reference !~* '(password|credential|secret|token|signed[_ -]?url|private[_ -]?key|access[_ -]?key)'
    ),
    CONSTRAINT editor_handoff_batches_context_check CHECK (jsonb_typeof(destination_context) = 'object')
);

CREATE TABLE medialab_core.editor_handoff_events (
    id uuid PRIMARY KEY,
    handoff_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (handoff_batch_id, organization_id, job_id)
        REFERENCES medialab_core.editor_handoff_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT editor_handoff_events_type_check CHECK (event_type IN (
        'CREATED', 'DISPATCHED', 'ACKNOWLEDGED', 'RETURN_INTAKE_OPENED',
        'RETURNS_PARTIAL', 'RETURNS_COMPLETE', 'RECONCILIATION_REQUIRED', 'CANCELLED'
    )),
    CONSTRAINT editor_handoff_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT editor_handoff_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.editor_handoff_current (
    handoff_batch_id uuid PRIMARY KEY REFERENCES medialab_core.editor_handoff_batches(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    current_state text NOT NULL,
    outbound_manifest_id uuid NOT NULL UNIQUE REFERENCES medialab_core.media_manifests(id) ON DELETE RESTRICT,
    item_count integer NOT NULL,
    returned_source_count integer NOT NULL DEFAULT 0,
    outstanding_source_count integer NOT NULL,
    unresolved_return_count integer NOT NULL DEFAULT 0,
    lifecycle_generation bigint NOT NULL DEFAULT 0,
    return_generation bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (handoff_batch_id, organization_id, job_id)
        REFERENCES medialab_core.editor_handoff_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT editor_handoff_current_state_check CHECK (current_state IN (
        'PREPARED', 'DISPATCHED', 'ACKNOWLEDGED', 'PARTIAL_RETURN',
        'RECONCILIATION_REQUIRED', 'RETURNS_COMPLETE', 'CANCELLED'
    )),
    CONSTRAINT editor_handoff_current_counts_check CHECK (
        item_count > 0 AND returned_source_count >= 0 AND outstanding_source_count >= 0 AND
        unresolved_return_count >= 0 AND returned_source_count + outstanding_source_count = item_count
    )
);

CREATE TABLE medialab_core.editor_handoff_items (
    id uuid PRIMARY KEY,
    handoff_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    ordinal integer NOT NULL,
    media_asset_id uuid NOT NULL,
    source_media_asset_version_id uuid NOT NULL,
    source_checksum_sha256 text NOT NULL,
    source_byte_size bigint NOT NULL,
    source_media_type text NOT NULL,
    source_observed_filename text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (handoff_batch_id, organization_id, job_id)
        REFERENCES medialab_core.editor_handoff_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_id, organization_id, job_id)
        REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT editor_handoff_items_batch_ordinal_key UNIQUE (handoff_batch_id, ordinal),
    CONSTRAINT editor_handoff_items_batch_version_key UNIQUE (handoff_batch_id, source_media_asset_version_id),
    CONSTRAINT editor_handoff_items_batch_id_key UNIQUE (handoff_batch_id, id),
    CONSTRAINT editor_handoff_items_scope_key UNIQUE (id, handoff_batch_id, organization_id, job_id),
    CONSTRAINT editor_handoff_items_ordinal_check CHECK (ordinal > 0),
    CONSTRAINT editor_handoff_items_checksum_check CHECK (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT editor_handoff_items_size_check CHECK (source_byte_size >= 0),
    CONSTRAINT editor_handoff_items_media_type_check CHECK (
        source_media_type = lower(btrim(source_media_type)) AND
        source_media_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
    )
);

CREATE TABLE medialab_core.editor_handoff_item_current (
    handoff_item_id uuid PRIMARY KEY REFERENCES medialab_core.editor_handoff_items(id) ON DELETE RESTRICT,
    handoff_batch_id uuid NOT NULL,
    return_count integer NOT NULL DEFAULT 0,
    latest_returned_version_id uuid NULL REFERENCES medialab_core.media_asset_versions(id) ON DELETE RESTRICT,
    latest_match_event_id uuid NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (handoff_batch_id, handoff_item_id)
        REFERENCES medialab_core.editor_handoff_items(handoff_batch_id, id) ON DELETE RESTRICT,
    CONSTRAINT editor_handoff_item_current_count_check CHECK (return_count >= 0),
    CONSTRAINT editor_handoff_item_current_version_check CHECK (
        (return_count = 0 AND latest_returned_version_id IS NULL AND latest_match_event_id IS NULL) OR
        (return_count > 0 AND latest_returned_version_id IS NOT NULL AND latest_match_event_id IS NOT NULL)
    )
);

ALTER TABLE medialab_core.media_manifests DROP CONSTRAINT media_manifests_purpose_check;
ALTER TABLE medialab_core.media_manifests DROP CONSTRAINT media_manifests_cull_source_check;
ALTER TABLE medialab_core.media_manifests
    ADD COLUMN source_editor_handoff_batch_id uuid NULL
        REFERENCES medialab_core.editor_handoff_batches(id) ON DELETE RESTRICT,
    ADD CONSTRAINT media_manifests_purpose_check CHECK (
        manifest_purpose IN ('JOB_MEDIA_INVENTORY', 'CULL_SELECTION', 'EDITOR_HANDOFF')
    ),
    ADD CONSTRAINT media_manifests_source_check CHECK (
        (manifest_purpose = 'JOB_MEDIA_INVENTORY' AND source_cull_workspace_id IS NULL AND source_editor_handoff_batch_id IS NULL) OR
        (manifest_purpose = 'CULL_SELECTION' AND source_cull_workspace_id IS NOT NULL AND source_editor_handoff_batch_id IS NULL) OR
        (manifest_purpose = 'EDITOR_HANDOFF' AND source_cull_workspace_id IS NULL AND source_editor_handoff_batch_id IS NOT NULL)
    );
CREATE UNIQUE INDEX media_manifests_one_editor_handoff_idx
    ON medialab_core.media_manifests (source_editor_handoff_batch_id)
    WHERE manifest_purpose = 'EDITOR_HANDOFF';

CREATE TABLE medialab_core.returned_media_intake_batches (
    id uuid PRIMARY KEY,
    handoff_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    intake_reference text NOT NULL,
    intake_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (handoff_batch_id, organization_id, job_id)
        REFERENCES medialab_core.editor_handoff_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_media_intake_batches_scope_key UNIQUE (id, handoff_batch_id, organization_id, job_id),
    CONSTRAINT returned_media_intake_batches_reference_check CHECK (
        intake_reference = btrim(intake_reference) AND intake_reference <> '' AND length(intake_reference) <= 500 AND
        intake_reference !~ '://' AND intake_reference !~ '(^/|^[A-Za-z]:[\\/])' AND
        intake_reference !~* '(password|credential|secret|token|signed[_ -]?url|private[_ -]?key|access[_ -]?key)'
    ),
    CONSTRAINT returned_media_intake_batches_context_check CHECK (jsonb_typeof(intake_context) = 'object')
);

CREATE TABLE medialab_core.returned_media_intake_events (
    id uuid PRIMARY KEY,
    intake_batch_id uuid NOT NULL,
    handoff_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (intake_batch_id, handoff_batch_id, organization_id, job_id)
        REFERENCES medialab_core.returned_media_intake_batches(id, handoff_batch_id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_media_intake_events_type_check CHECK (event_type IN ('OPENED', 'ITEM_OBSERVED', 'CLOSED')),
    CONSTRAINT returned_media_intake_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT returned_media_intake_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.returned_media_items (
    id uuid PRIMARY KEY,
    intake_batch_id uuid NOT NULL,
    handoff_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    observed_filename text NOT NULL,
    observed_byte_size bigint NOT NULL,
    observed_media_type text NOT NULL,
    observed_checksum_sha256 text NOT NULL,
    observation_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (intake_batch_id, handoff_batch_id, organization_id, job_id)
        REFERENCES medialab_core.returned_media_intake_batches(id, handoff_batch_id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_media_items_intake_item_key UNIQUE (intake_batch_id, id),
    CONSTRAINT returned_media_items_filename_check CHECK (
        observed_filename = btrim(observed_filename) AND observed_filename <> '' AND length(observed_filename) <= 500 AND
        observed_filename !~ '(^/|^[A-Za-z]:[\\/])'
    ),
    CONSTRAINT returned_media_items_size_check CHECK (observed_byte_size >= 0),
    CONSTRAINT returned_media_items_media_type_check CHECK (
        observed_media_type = lower(btrim(observed_media_type)) AND
        observed_media_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
    ),
    CONSTRAINT returned_media_items_checksum_check CHECK (observed_checksum_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT returned_media_items_context_check CHECK (jsonb_typeof(observation_context) = 'object')
);

CREATE TABLE medialab_core.returned_media_match_events (
    id uuid PRIMARY KEY,
    returned_item_id uuid NOT NULL REFERENCES medialab_core.returned_media_items(id) ON DELETE RESTRICT,
    intake_batch_id uuid NOT NULL,
    handoff_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    outcome text NOT NULL,
    match_basis text NOT NULL,
    handoff_item_id uuid NULL,
    returned_media_asset_version_id uuid NULL,
    supersedes_match_event_id uuid NULL REFERENCES medialab_core.returned_media_match_events(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (intake_batch_id, returned_item_id)
        REFERENCES medialab_core.returned_media_items(intake_batch_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (handoff_item_id, handoff_batch_id, organization_id, job_id)
        REFERENCES medialab_core.editor_handoff_items(id, handoff_batch_id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (returned_media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_media_match_events_outcome_check CHECK (outcome IN (
        'EXACT_MATCH', 'CONFIDENT_MATCH', 'AMBIGUOUS', 'UNMATCHED', 'CONFLICTING', 'REPEATED_RETURN'
    )),
    CONSTRAINT returned_media_match_events_basis_check CHECK (match_basis IN (
        'MANIFEST_REFERENCE', 'RETURN_TOKEN', 'CHECKSUM_AND_SIZE', 'EXPLICIT_HANDOFF_ITEM',
        'MULTIPLE_CANDIDATES', 'NO_CANDIDATE', 'CONFLICTING_EVIDENCE', 'FILENAME_ONLY'
    )),
    CONSTRAINT returned_media_match_events_resolution_check CHECK (
        (outcome IN ('EXACT_MATCH', 'CONFIDENT_MATCH', 'REPEATED_RETURN') AND
         match_basis IN ('MANIFEST_REFERENCE', 'RETURN_TOKEN', 'CHECKSUM_AND_SIZE', 'EXPLICIT_HANDOFF_ITEM') AND
         handoff_item_id IS NOT NULL AND returned_media_asset_version_id IS NOT NULL) OR
        (outcome IN ('AMBIGUOUS', 'UNMATCHED', 'CONFLICTING') AND returned_media_asset_version_id IS NULL)
    ),
    CONSTRAINT returned_media_match_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT returned_media_match_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.returned_media_item_current (
    returned_item_id uuid PRIMARY KEY REFERENCES medialab_core.returned_media_items(id) ON DELETE RESTRICT,
    intake_batch_id uuid NOT NULL,
    handoff_batch_id uuid NOT NULL,
    current_match_event_id uuid NOT NULL REFERENCES medialab_core.returned_media_match_events(id) ON DELETE RESTRICT,
    current_outcome text NOT NULL,
    handoff_item_id uuid NULL,
    returned_media_asset_version_id uuid NULL,
    match_generation bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (intake_batch_id, returned_item_id)
        REFERENCES medialab_core.returned_media_items(intake_batch_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (handoff_item_id) REFERENCES medialab_core.editor_handoff_items(id) ON DELETE RESTRICT,
    CONSTRAINT returned_media_item_current_outcome_check CHECK (current_outcome IN (
        'EXACT_MATCH', 'CONFIDENT_MATCH', 'AMBIGUOUS', 'UNMATCHED', 'CONFLICTING', 'REPEATED_RETURN'
    ))
);

ALTER TABLE medialab_core.editor_handoff_item_current
    ADD CONSTRAINT editor_handoff_item_current_match_fk
    FOREIGN KEY (latest_match_event_id) REFERENCES medialab_core.returned_media_match_events(id) ON DELETE RESTRICT;

CREATE INDEX editor_handoff_batches_scope_idx
    ON medialab_core.editor_handoff_batches (organization_id, job_id, service_workstream_id, lane, created_at, id);
CREATE INDEX editor_handoff_events_batch_idx
    ON medialab_core.editor_handoff_events (handoff_batch_id, recorded_at, id);
CREATE INDEX editor_handoff_items_batch_idx
    ON medialab_core.editor_handoff_items (handoff_batch_id, ordinal, id);
CREATE INDEX returned_media_intake_batches_handoff_idx
    ON medialab_core.returned_media_intake_batches (handoff_batch_id, created_at, id);
CREATE INDEX returned_media_items_handoff_idx
    ON medialab_core.returned_media_items (handoff_batch_id, recorded_at, id);
CREATE INDEX returned_media_match_events_item_idx
    ON medialab_core.returned_media_match_events (returned_item_id, recorded_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable append-only editor handoff evidence: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_editor_handoff_permission(
    p_actor_identity_id uuid, p_organization_id uuid, p_permission_code text
)
RETURNS void AS $$
BEGIN
    IF NOT medialab_core.actor_has_permission(p_actor_identity_id, p_organization_id, p_permission_code) THEN
        RAISE EXCEPTION 'Actor lacks active % authority for the target organization', p_permission_code
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_editor_handoff_reason(p_reason text)
RETURNS void AS $$
BEGIN
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 OR
       p_reason ~* '(password|credential|secret|token|access[_ -]?key|private[_ -]?key|signed[_ -]?url|https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/])' THEN
        RAISE EXCEPTION 'A bounded provider-neutral reason without secrets, URLs, or absolute paths is required'
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_editor_handoff_safe_json(p_evidence jsonb)
RETURNS void AS $$
BEGIN
    IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
        RAISE EXCEPTION 'Editor handoff evidence must be a JSON object' USING ERRCODE = '22023';
    END IF;
    IF length(p_evidence::text) > 20000 OR
       p_evidence::text ~* '"([a-z0-9_]*(credential|password|secret|token|access_key|private_key|signed_url|signature|oauth|binary|bytes|base64|thumbnail|proxy|preview|provider_payload)[a-z0-9_]*)"[[:space:]]*:' OR
       p_evidence::text ~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])' THEN
        RAISE EXCEPTION 'Editor handoff evidence contains prohibited secrets, provider payloads, URLs, paths, or media data'
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.recompute_editor_handoff_current(p_handoff_batch_id uuid)
RETURNS void AS $$
DECLARE v_returned integer; v_total integer; v_unresolved integer; v_state text;
BEGIN
    SELECT item_count INTO v_total FROM medialab_core.editor_handoff_current
     WHERE handoff_batch_id = p_handoff_batch_id FOR UPDATE;
    SELECT count(*)::integer INTO v_returned FROM medialab_core.editor_handoff_item_current
     WHERE handoff_batch_id = p_handoff_batch_id AND return_count > 0;
    SELECT count(*)::integer INTO v_unresolved FROM medialab_core.returned_media_item_current
     WHERE handoff_batch_id = p_handoff_batch_id
       AND current_outcome IN ('AMBIGUOUS', 'UNMATCHED', 'CONFLICTING');
    SELECT current_state INTO v_state FROM medialab_core.editor_handoff_current
     WHERE handoff_batch_id = p_handoff_batch_id;
    IF v_state NOT IN ('RETURNS_COMPLETE', 'CANCELLED') THEN
        v_state := CASE WHEN v_unresolved > 0 THEN 'RECONCILIATION_REQUIRED'
                        WHEN v_returned = 0 THEN v_state
                        WHEN v_returned < v_total THEN 'PARTIAL_RETURN'
                        ELSE 'ACKNOWLEDGED' END;
    END IF;
    UPDATE medialab_core.editor_handoff_current
       SET returned_source_count = v_returned, outstanding_source_count = v_total - v_returned,
           unresolved_return_count = v_unresolved, current_state = v_state,
           return_generation = return_generation + 1, updated_at = clock_timestamp()
     WHERE handoff_batch_id = p_handoff_batch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_editor_handoff_batch(
    p_session_token text, p_idempotency_key text, p_cull_workspace_id uuid,
    p_destination_type text, p_destination_reference text, p_reason text, p_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE;
        v_completion medialab_core.cull_workspace_completions%ROWTYPE; v_id uuid; v_manifest_id uuid;
        v_manifest_version integer; v_items jsonb; v_count integer; v_manifest jsonb; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_cull_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_editor_handoff_permission(v_actor, v_workspace.organization_id, 'media_editor_handoff.manage');
    SELECT * INTO v_completion FROM medialab_core.cull_workspace_completions WHERE workspace_id = v_workspace.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace must be completed before editor handoff' USING ERRCODE = '22023'; END IF;
    IF v_completion.selected_count <= 0 THEN RAISE EXCEPTION 'Editor handoff requires at least one selected source version' USING ERRCODE = '22023'; END IF;
    IF p_destination_type IS NULL OR p_destination_type !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
       p_destination_reference IS NULL OR p_destination_reference <> btrim(p_destination_reference) OR
       p_destination_reference = '' OR length(p_destination_reference) > 500 OR
       p_destination_reference ~ '://' OR p_destination_reference ~ '(^/|^[A-Za-z]:[\\/])' OR
       p_destination_reference ~* '(password|credential|secret|token|signed[_ -]?url|private[_ -]?key|access[_ -]?key)' THEN
        RAISE EXCEPTION 'A bounded provider-neutral destination reference is required' USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_editor_handoff_reason(p_reason);
    PERFORM medialab_core.validate_editor_handoff_safe_json(p_context);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_cull_workspace_id,p_destination_type,p_destination_reference,p_reason,p_context)::text,'UTF8')),'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor,'CREATE_EDITOR_HANDOFF_BATCH',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'handoff_batch_id')::uuid; END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.editor_handoff_batches WHERE source_cull_workspace_id=v_workspace.id) THEN
        RAISE EXCEPTION 'Completed Cull Workspace already has an editor handoff batch' USING ERRCODE = '23505';
    END IF;
    SELECT jsonb_agg(jsonb_build_object(
             'ordinal', q.ordinal, 'media_asset_id', q.media_asset_id,
             'media_asset_version_id', q.media_asset_version_id,
             'checksum_sha256', q.checksum_sha256, 'byte_size', q.byte_size,
             'media_type', q.media_type, 'observed_filename', q.observed_filename
           ) ORDER BY q.ordinal), count(*)::integer
      INTO v_items, v_count
      FROM (
        SELECT row_number() OVER (ORDER BY c.media_asset_version_id)::integer ordinal,
               c.media_asset_id, c.media_asset_version_id, v.checksum_sha256, v.byte_size,
               v.media_type, v.observed_filename
          FROM medialab_core.cull_candidates c
          JOIN medialab_core.cull_candidate_current cc ON cc.candidate_id=c.id
          JOIN medialab_core.media_asset_versions v ON v.id=c.media_asset_version_id
         WHERE c.workspace_id=v_workspace.id AND cc.active AND cc.current_outcome='KEEP'
      ) q;
    IF v_count <> v_completion.selected_count THEN RAISE EXCEPTION 'Selected Cull evidence is inconsistent' USING ERRCODE = '22023'; END IF;
    v_id := gen_random_uuid(); v_manifest_id := gen_random_uuid();
    v_manifest := jsonb_build_object('schema','EDITOR_HANDOFF_V1','handoff_batch_id',v_id,
      'organization_id',v_workspace.organization_id,'job_id',v_workspace.job_id,'lane',v_workspace.lane,
      'source_cull_workspace_id',v_workspace.id,'item_count',v_count,'items',v_items);
    PERFORM 1 FROM medialab_core.jobs WHERE id=v_workspace.job_id FOR UPDATE;
    SELECT COALESCE(max(manifest_version),0)+1 INTO v_manifest_version FROM medialab_core.media_manifests WHERE job_id=v_workspace.job_id;
    INSERT INTO medialab_core.editor_handoff_batches
      (id,organization_id,job_id,service_workstream_id,lane,source_cull_workspace_id,source_cull_manifest_id,
       destination_type,destination_reference,destination_context,created_by_identity_id)
    VALUES (v_id,v_workspace.organization_id,v_workspace.job_id,v_workspace.service_workstream_id,v_workspace.lane,
      v_workspace.id,v_completion.media_manifest_id,p_destination_type,p_destination_reference,p_context,v_actor);
    INSERT INTO medialab_core.media_manifests
      (id,organization_id,job_id,manifest_version,schema_version,manifest_json,integrity_sha256,
       created_by_identity_id,manifest_purpose,source_cull_workspace_id,source_editor_handoff_batch_id)
    VALUES (v_manifest_id,v_workspace.organization_id,v_workspace.job_id,v_manifest_version,'MEDIA_MANIFEST_V1',v_manifest,
      encode(sha256(convert_to(v_manifest::text,'UTF8')),'hex'),v_actor,'EDITOR_HANDOFF',NULL,v_id);
    INSERT INTO medialab_core.editor_handoff_items
      (id,handoff_batch_id,organization_id,job_id,ordinal,media_asset_id,source_media_asset_version_id,
       source_checksum_sha256,source_byte_size,source_media_type,source_observed_filename,created_by_identity_id)
    SELECT gen_random_uuid(),v_id,v_workspace.organization_id,v_workspace.job_id,
      (x->>'ordinal')::integer,(x->>'media_asset_id')::uuid,(x->>'media_asset_version_id')::uuid,
      x->>'checksum_sha256',(x->>'byte_size')::bigint,x->>'media_type',x->>'observed_filename',v_actor
      FROM jsonb_array_elements(v_items) x;
    INSERT INTO medialab_core.editor_handoff_item_current(handoff_item_id,handoff_batch_id)
      SELECT id,v_id FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=v_id;
    INSERT INTO medialab_core.editor_handoff_events
      (id,handoff_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id)
    VALUES (gen_random_uuid(),v_id,v_workspace.organization_id,v_workspace.job_id,'CREATED',p_reason,
      jsonb_build_object('outbound_manifest_id',v_manifest_id,'item_count',v_count),v_actor);
    INSERT INTO medialab_core.editor_handoff_current
      (handoff_batch_id,organization_id,job_id,current_state,outbound_manifest_id,item_count,outstanding_source_count)
    VALUES (v_id,v_workspace.organization_id,v_workspace.job_id,'PREPARED',v_manifest_id,v_count,v_count);
    PERFORM medialab_core.record_media_idempotency(v_actor,'CREATE_EDITOR_HANDOFF_BATCH',p_idempotency_key,v_hash,
      jsonb_build_object('handoff_batch_id',v_id,'outbound_manifest_id',v_manifest_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_editor_handoff_event(
    p_session_token text, p_idempotency_key text, p_handoff_batch_id uuid,
    p_event_type text, p_expected_generation bigint, p_reason text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_batch medialab_core.editor_handoff_batches%ROWTYPE;
        v_current medialab_core.editor_handoff_current%ROWTYPE; v_event_id uuid; v_hash text; v_replay jsonb; v_state text;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_batch FROM medialab_core.editor_handoff_batches WHERE id=p_handoff_batch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Editor handoff batch is missing or unavailable' USING ERRCODE='42501'; END IF;
    PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_batch.organization_id,'media_editor_handoff.manage');
    PERFORM medialab_core.validate_editor_handoff_reason(p_reason); PERFORM medialab_core.validate_editor_handoff_safe_json(p_evidence);
    IF p_event_type NOT IN ('DISPATCHED','ACKNOWLEDGED','CANCELLED') THEN RAISE EXCEPTION 'Unsupported editor handoff event' USING ERRCODE='22023'; END IF;
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_handoff_batch_id,p_event_type,p_expected_generation,p_reason,p_evidence)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'RECORD_EDITOR_HANDOFF_EVENT',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=v_batch.id FOR UPDATE;
    IF v_current.lifecycle_generation<>p_expected_generation THEN RAISE EXCEPTION 'Stale editor handoff generation' USING ERRCODE='40001'; END IF;
    IF v_current.current_state IN ('RETURNS_COMPLETE','CANCELLED') THEN RAISE EXCEPTION 'Completed or cancelled handoff is immutable' USING ERRCODE='22023'; END IF;
    IF p_event_type='DISPATCHED' AND v_current.current_state<>'PREPARED' THEN RAISE EXCEPTION 'Only prepared handoff may be dispatched' USING ERRCODE='22023';
    ELSIF p_event_type='ACKNOWLEDGED' AND v_current.current_state<>'DISPATCHED' THEN RAISE EXCEPTION 'Only dispatched handoff may be acknowledged' USING ERRCODE='22023';
    END IF;
    v_state:=CASE p_event_type WHEN 'DISPATCHED' THEN 'DISPATCHED' WHEN 'ACKNOWLEDGED' THEN 'ACKNOWLEDGED' ELSE 'CANCELLED' END;
    v_event_id:=gen_random_uuid();
    INSERT INTO medialab_core.editor_handoff_events(id,handoff_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id)
      VALUES(v_event_id,v_batch.id,v_batch.organization_id,v_batch.job_id,p_event_type,p_reason,p_evidence,v_actor);
    UPDATE medialab_core.editor_handoff_current SET current_state=v_state,lifecycle_generation=lifecycle_generation+1,updated_at=clock_timestamp()
      WHERE handoff_batch_id=v_batch.id;
    PERFORM medialab_core.record_media_idempotency(v_actor,'RECORD_EDITOR_HANDOFF_EVENT',p_idempotency_key,v_hash,jsonb_build_object('event_id',v_event_id));
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_returned_media_intake_batch(
    p_session_token text, p_idempotency_key text, p_handoff_batch_id uuid,
    p_intake_reference text, p_reason text, p_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_batch medialab_core.editor_handoff_batches%ROWTYPE;
        v_current medialab_core.editor_handoff_current%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_batch FROM medialab_core.editor_handoff_batches WHERE id=p_handoff_batch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Editor handoff batch is missing or unavailable' USING ERRCODE='42501'; END IF;
    PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_batch.organization_id,'media_editor_handoff.manage');
    IF p_intake_reference IS NULL OR p_intake_reference<>btrim(p_intake_reference) OR p_intake_reference='' OR
       length(p_intake_reference)>500 OR p_intake_reference~'://' OR p_intake_reference~'(^/|^[A-Za-z]:[\\/])' OR
       p_intake_reference~*'(password|credential|secret|token|signed[_ -]?url|private[_ -]?key|access[_ -]?key)' THEN
       RAISE EXCEPTION 'A bounded provider-neutral intake reference is required' USING ERRCODE='22023'; END IF;
    PERFORM medialab_core.validate_editor_handoff_reason(p_reason); PERFORM medialab_core.validate_editor_handoff_safe_json(p_context);
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_handoff_batch_id,p_intake_reference,p_reason,p_context)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'CREATE_RETURNED_MEDIA_INTAKE_BATCH',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'intake_batch_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=v_batch.id FOR UPDATE;
    IF v_current.current_state IN ('PREPARED','CANCELLED','RETURNS_COMPLETE') THEN RAISE EXCEPTION 'Handoff is not open for returned-media intake' USING ERRCODE='22023'; END IF;
    v_id:=gen_random_uuid();
    INSERT INTO medialab_core.returned_media_intake_batches
      (id,handoff_batch_id,organization_id,job_id,intake_reference,intake_context,created_by_identity_id)
    VALUES(v_id,v_batch.id,v_batch.organization_id,v_batch.job_id,p_intake_reference,p_context,v_actor);
    INSERT INTO medialab_core.returned_media_intake_events
      (id,intake_batch_id,handoff_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id)
    VALUES(gen_random_uuid(),v_id,v_batch.id,v_batch.organization_id,v_batch.job_id,'OPENED',p_reason,'{}',v_actor);
    INSERT INTO medialab_core.editor_handoff_events
      (id,handoff_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id)
    VALUES(gen_random_uuid(),v_batch.id,v_batch.organization_id,v_batch.job_id,'RETURN_INTAKE_OPENED',p_reason,
      jsonb_build_object('intake_batch_id',v_id),v_actor);
    PERFORM medialab_core.record_media_idempotency(v_actor,'CREATE_RETURNED_MEDIA_INTAKE_BATCH',p_idempotency_key,v_hash,jsonb_build_object('intake_batch_id',v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_returned_version_for_match(
    p_actor uuid, p_handoff_item_id uuid, p_observed_filename text, p_byte_size bigint,
    p_media_type text, p_checksum text, p_reason text, p_match_event_id uuid
)
RETURNS uuid AS $$
DECLARE v_item medialab_core.editor_handoff_items%ROWTYPE; v_current medialab_core.editor_handoff_item_current%ROWTYPE;
        v_version_id uuid; v_number integer; v_kind text;
BEGIN
    SELECT * INTO v_item FROM medialab_core.editor_handoff_items WHERE id=p_handoff_item_id;
    SELECT * INTO v_current FROM medialab_core.editor_handoff_item_current WHERE handoff_item_id=v_item.id FOR UPDATE;
    SELECT COALESCE(max(version_number),0)+1 INTO v_number FROM medialab_core.media_asset_versions WHERE asset_id=v_item.media_asset_id;
    v_kind:=CASE WHEN v_current.return_count=0 THEN 'EDITOR_RETURN' ELSE 'REVISION_RETURN' END;
    v_version_id:=gen_random_uuid();
    INSERT INTO medialab_core.media_asset_versions
      (id,asset_id,organization_id,job_id,version_number,version_kind,observed_filename,byte_size,media_type,
       checksum_sha256,source_provenance,created_by_identity_id)
    VALUES(v_version_id,v_item.media_asset_id,v_item.organization_id,v_item.job_id,v_number,v_kind,p_observed_filename,
      p_byte_size,p_media_type,p_checksum,'P02_M12_A_RETURNED_MEDIA_INTAKE',p_actor);
    INSERT INTO medialab_core.media_asset_lineage
      (id,organization_id,job_id,source_version_id,target_version_id,relationship_type,reason,recorded_by_identity_id)
    VALUES(gen_random_uuid(),v_item.organization_id,v_item.job_id,v_item.source_media_asset_version_id,v_version_id,
      'ORIGINAL_TO_EDITOR_RETURN',p_reason,p_actor);
    IF v_current.latest_returned_version_id IS NOT NULL THEN
      INSERT INTO medialab_core.media_asset_lineage
        (id,organization_id,job_id,source_version_id,target_version_id,relationship_type,reason,recorded_by_identity_id)
      VALUES(gen_random_uuid(),v_item.organization_id,v_item.job_id,v_current.latest_returned_version_id,v_version_id,
        'PARENT_TO_CHILD',p_reason,p_actor);
    END IF;
    RETURN v_version_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_returned_media_item(
    p_session_token text, p_idempotency_key text, p_intake_batch_id uuid,
    p_observed_filename text, p_observed_byte_size bigint, p_observed_media_type text,
    p_observed_checksum_sha256 text, p_outcome text, p_match_basis text, p_handoff_item_id uuid,
    p_expected_return_generation bigint, p_reason text, p_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_intake medialab_core.returned_media_intake_batches%ROWTYPE;
        v_handoff medialab_core.editor_handoff_batches%ROWTYPE; v_current medialab_core.editor_handoff_current%ROWTYPE;
        v_item medialab_core.editor_handoff_items%ROWTYPE; v_return_id uuid; v_match_id uuid; v_version_id uuid;
        v_hash text; v_replay jsonb; v_resolved boolean;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_intake FROM medialab_core.returned_media_intake_batches WHERE id=p_intake_batch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Return intake batch is missing or unavailable' USING ERRCODE='42501'; END IF;
    SELECT * INTO v_handoff FROM medialab_core.editor_handoff_batches WHERE id=v_intake.handoff_batch_id;
    PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_handoff.organization_id,'media_editor_handoff.manage');
    IF p_outcome IN ('EXACT_MATCH','CONFIDENT_MATCH','REPEATED_RETURN') THEN
      PERFORM medialab_core.require_media_permission(v_actor,v_handoff.organization_id,'media_asset.manage');
    END IF;
    IF p_observed_filename IS NULL OR p_observed_filename<>btrim(p_observed_filename) OR p_observed_filename='' OR
       length(p_observed_filename)>500 OR p_observed_filename~'(^/|^[A-Za-z]:[\\/])' OR
       p_observed_byte_size<0 OR p_observed_media_type<>lower(btrim(p_observed_media_type)) OR
       p_observed_media_type!~'^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' OR
       p_observed_checksum_sha256!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Bounded returned-media observations are required' USING ERRCODE='22023'; END IF;
    IF p_outcome NOT IN ('EXACT_MATCH','CONFIDENT_MATCH','AMBIGUOUS','UNMATCHED','CONFLICTING','REPEATED_RETURN') THEN RAISE EXCEPTION 'Unsupported return match outcome' USING ERRCODE='22023'; END IF;
    v_resolved:=p_outcome IN ('EXACT_MATCH','CONFIDENT_MATCH','REPEATED_RETURN');
    IF v_resolved AND (p_match_basis NOT IN ('MANIFEST_REFERENCE','RETURN_TOKEN','CHECKSUM_AND_SIZE','EXPLICIT_HANDOFF_ITEM') OR p_handoff_item_id IS NULL) THEN
      RAISE EXCEPTION 'A strong explicit match basis and handoff item are required' USING ERRCODE='22023';
    END IF;
    IF NOT v_resolved AND p_match_basis NOT IN ('MULTIPLE_CANDIDATES','NO_CANDIDATE','CONFLICTING_EVIDENCE','FILENAME_ONLY') THEN
      RAISE EXCEPTION 'Unresolved return requires an explicit unresolved basis' USING ERRCODE='22023'; END IF;
    PERFORM medialab_core.validate_editor_handoff_reason(p_reason); PERFORM medialab_core.validate_editor_handoff_safe_json(p_context);
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_intake_batch_id,p_observed_filename,p_observed_byte_size,p_observed_media_type,
      p_observed_checksum_sha256,p_outcome,p_match_basis,p_handoff_item_id,p_expected_return_generation,p_reason,p_context)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'RECORD_RETURNED_MEDIA_ITEM',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'returned_item_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=v_handoff.id FOR UPDATE;
    IF v_current.return_generation<>p_expected_return_generation THEN RAISE EXCEPTION 'Stale returned-media generation' USING ERRCODE='40001'; END IF;
    IF v_current.current_state IN ('PREPARED','CANCELLED','RETURNS_COMPLETE') THEN RAISE EXCEPTION 'Handoff is not open for returned-media evidence' USING ERRCODE='22023'; END IF;
    IF p_handoff_item_id IS NOT NULL THEN
      SELECT * INTO v_item FROM medialab_core.editor_handoff_items WHERE id=p_handoff_item_id AND handoff_batch_id=v_handoff.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Handoff item is cross-Job, cross-lane, or missing' USING ERRCODE='42501'; END IF;
      IF (v_handoff.lane='PHOTO' AND p_observed_media_type LIKE 'video/%') OR
         (v_handoff.lane='VIDEO' AND p_observed_media_type NOT LIKE 'video/%') THEN
        RAISE EXCEPTION 'Returned media cannot mix PHOTO and VIDEO lanes' USING ERRCODE='22023'; END IF;
    END IF;
    v_return_id:=gen_random_uuid(); v_match_id:=gen_random_uuid();
    INSERT INTO medialab_core.returned_media_items
      (id,intake_batch_id,handoff_batch_id,organization_id,job_id,observed_filename,observed_byte_size,
       observed_media_type,observed_checksum_sha256,observation_context,recorded_by_identity_id)
    VALUES(v_return_id,v_intake.id,v_handoff.id,v_handoff.organization_id,v_handoff.job_id,p_observed_filename,
      p_observed_byte_size,p_observed_media_type,p_observed_checksum_sha256,p_context,v_actor);
    IF v_resolved THEN
      v_version_id:=medialab_core.create_returned_version_for_match(v_actor,p_handoff_item_id,p_observed_filename,
        p_observed_byte_size,p_observed_media_type,p_observed_checksum_sha256,p_reason,v_match_id);
    END IF;
    INSERT INTO medialab_core.returned_media_match_events
      (id,returned_item_id,intake_batch_id,handoff_batch_id,organization_id,job_id,outcome,match_basis,handoff_item_id,
       returned_media_asset_version_id,reason,evidence,recorded_by_identity_id)
    VALUES(v_match_id,v_return_id,v_intake.id,v_handoff.id,v_handoff.organization_id,v_handoff.job_id,p_outcome,p_match_basis,
      p_handoff_item_id,v_version_id,p_reason,p_context,v_actor);
    INSERT INTO medialab_core.returned_media_item_current
      (returned_item_id,intake_batch_id,handoff_batch_id,current_match_event_id,current_outcome,handoff_item_id,returned_media_asset_version_id)
    VALUES(v_return_id,v_intake.id,v_handoff.id,v_match_id,p_outcome,p_handoff_item_id,v_version_id);
    IF v_resolved THEN
      UPDATE medialab_core.editor_handoff_item_current
         SET return_count=return_count+1,latest_returned_version_id=v_version_id,latest_match_event_id=v_match_id,updated_at=clock_timestamp()
       WHERE handoff_item_id=p_handoff_item_id;
    END IF;
    INSERT INTO medialab_core.returned_media_intake_events
      (id,intake_batch_id,handoff_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id)
    VALUES(gen_random_uuid(),v_intake.id,v_handoff.id,v_handoff.organization_id,v_handoff.job_id,'ITEM_OBSERVED',p_reason,
      jsonb_build_object('returned_item_id',v_return_id,'match_event_id',v_match_id,'outcome',p_outcome),v_actor);
    PERFORM medialab_core.recompute_editor_handoff_current(v_handoff.id);
    PERFORM medialab_core.record_media_idempotency(v_actor,'RECORD_RETURNED_MEDIA_ITEM',p_idempotency_key,v_hash,
      jsonb_build_object('returned_item_id',v_return_id,'match_event_id',v_match_id,'returned_media_asset_version_id',v_version_id));
    RETURN v_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.resolve_returned_media_match(
    p_session_token text, p_idempotency_key text, p_returned_item_id uuid, p_outcome text,
    p_match_basis text, p_handoff_item_id uuid, p_expected_match_generation bigint,
    p_expected_return_generation bigint, p_reason text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_return medialab_core.returned_media_items%ROWTYPE; v_handoff medialab_core.editor_handoff_batches%ROWTYPE;
        v_current medialab_core.returned_media_item_current%ROWTYPE; v_handoff_current medialab_core.editor_handoff_current%ROWTYPE;
        v_item medialab_core.editor_handoff_items%ROWTYPE; v_event_id uuid; v_version_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_return FROM medialab_core.returned_media_items WHERE id=p_returned_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Returned media item is missing or unavailable' USING ERRCODE='42501'; END IF;
    SELECT * INTO v_handoff FROM medialab_core.editor_handoff_batches WHERE id=v_return.handoff_batch_id;
    PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_handoff.organization_id,'media_editor_handoff.manage');
    PERFORM medialab_core.require_media_permission(v_actor,v_handoff.organization_id,'media_asset.manage');
    IF p_outcome NOT IN ('EXACT_MATCH','CONFIDENT_MATCH','REPEATED_RETURN') OR
       p_match_basis NOT IN ('MANIFEST_REFERENCE','RETURN_TOKEN','CHECKSUM_AND_SIZE','EXPLICIT_HANDOFF_ITEM') THEN
      RAISE EXCEPTION 'Resolution requires a strong explicit matching outcome and basis' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_item FROM medialab_core.editor_handoff_items WHERE id=p_handoff_item_id AND handoff_batch_id=v_handoff.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Handoff item is cross-Job, cross-lane, or missing' USING ERRCODE='42501'; END IF;
    IF (v_handoff.lane='PHOTO' AND v_return.observed_media_type LIKE 'video/%') OR
       (v_handoff.lane='VIDEO' AND v_return.observed_media_type NOT LIKE 'video/%') THEN
      RAISE EXCEPTION 'Returned media cannot mix PHOTO and VIDEO lanes' USING ERRCODE='22023'; END IF;
    PERFORM medialab_core.validate_editor_handoff_reason(p_reason); PERFORM medialab_core.validate_editor_handoff_safe_json(p_evidence);
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_returned_item_id,p_outcome,p_match_basis,p_handoff_item_id,
      p_expected_match_generation,p_expected_return_generation,p_reason,p_evidence)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'RESOLVE_RETURNED_MEDIA_MATCH',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'match_event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.returned_media_item_current WHERE returned_item_id=v_return.id FOR UPDATE;
    SELECT * INTO v_handoff_current FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=v_handoff.id FOR UPDATE;
    IF v_current.match_generation<>p_expected_match_generation OR v_handoff_current.return_generation<>p_expected_return_generation THEN
      RAISE EXCEPTION 'Stale returned-media match generation' USING ERRCODE='40001'; END IF;
    IF v_current.current_outcome NOT IN ('AMBIGUOUS','UNMATCHED','CONFLICTING') THEN RAISE EXCEPTION 'Resolved return match is immutable' USING ERRCODE='22023'; END IF;
    IF v_handoff_current.current_state IN ('RETURNS_COMPLETE','CANCELLED') THEN RAISE EXCEPTION 'Completed or cancelled handoff is immutable' USING ERRCODE='22023'; END IF;
    v_event_id:=gen_random_uuid();
    v_version_id:=medialab_core.create_returned_version_for_match(v_actor,v_item.id,v_return.observed_filename,
      v_return.observed_byte_size,v_return.observed_media_type,v_return.observed_checksum_sha256,p_reason,v_event_id);
    INSERT INTO medialab_core.returned_media_match_events
      (id,returned_item_id,intake_batch_id,handoff_batch_id,organization_id,job_id,outcome,match_basis,handoff_item_id,
       returned_media_asset_version_id,supersedes_match_event_id,reason,evidence,recorded_by_identity_id)
    VALUES(v_event_id,v_return.id,v_return.intake_batch_id,v_handoff.id,v_handoff.organization_id,v_handoff.job_id,p_outcome,
      p_match_basis,v_item.id,v_version_id,v_current.current_match_event_id,p_reason,p_evidence,v_actor);
    UPDATE medialab_core.returned_media_item_current SET current_match_event_id=v_event_id,current_outcome=p_outcome,
      handoff_item_id=v_item.id,returned_media_asset_version_id=v_version_id,match_generation=match_generation+1,updated_at=clock_timestamp()
      WHERE returned_item_id=v_return.id;
    UPDATE medialab_core.editor_handoff_item_current SET return_count=return_count+1,latest_returned_version_id=v_version_id,
      latest_match_event_id=v_event_id,updated_at=clock_timestamp() WHERE handoff_item_id=v_item.id;
    PERFORM medialab_core.recompute_editor_handoff_current(v_handoff.id);
    PERFORM medialab_core.record_media_idempotency(v_actor,'RESOLVE_RETURNED_MEDIA_MATCH',p_idempotency_key,v_hash,
      jsonb_build_object('match_event_id',v_event_id,'returned_media_asset_version_id',v_version_id));
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.complete_editor_handoff_returns(
    p_session_token text, p_idempotency_key text, p_handoff_batch_id uuid,
    p_expected_return_generation bigint, p_reason text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_batch medialab_core.editor_handoff_batches%ROWTYPE; v_current medialab_core.editor_handoff_current%ROWTYPE;
        v_event_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_batch FROM medialab_core.editor_handoff_batches WHERE id=p_handoff_batch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Editor handoff batch is missing or unavailable' USING ERRCODE='42501'; END IF;
    PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_batch.organization_id,'media_editor_handoff.manage');
    PERFORM medialab_core.validate_editor_handoff_reason(p_reason);
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_handoff_batch_id,p_expected_return_generation,p_reason)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'COMPLETE_EDITOR_HANDOFF_RETURNS',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=v_batch.id FOR UPDATE;
    IF v_current.return_generation<>p_expected_return_generation THEN RAISE EXCEPTION 'Stale returned-media generation' USING ERRCODE='40001'; END IF;
    IF v_current.outstanding_source_count<>0 OR v_current.unresolved_return_count<>0 THEN
      RAISE EXCEPTION 'All source items must have a resolved return before return completion' USING ERRCODE='22023'; END IF;
    IF v_current.current_state IN ('RETURNS_COMPLETE','CANCELLED') THEN RAISE EXCEPTION 'Completed or cancelled handoff is immutable' USING ERRCODE='22023'; END IF;
    v_event_id:=gen_random_uuid();
    INSERT INTO medialab_core.editor_handoff_events(id,handoff_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id)
      VALUES(v_event_id,v_batch.id,v_batch.organization_id,v_batch.job_id,'RETURNS_COMPLETE',p_reason,
        jsonb_build_object('returned_source_count',v_current.returned_source_count),v_actor);
    UPDATE medialab_core.editor_handoff_current SET current_state='RETURNS_COMPLETE',lifecycle_generation=lifecycle_generation+1,
      updated_at=clock_timestamp() WHERE handoff_batch_id=v_batch.id;
    PERFORM medialab_core.record_media_idempotency(v_actor,'COMPLETE_EDITOR_HANDOFF_RETURNS',p_idempotency_key,v_hash,jsonb_build_object('event_id',v_event_id));
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_editor_handoff_batch(p_session_token text,p_handoff_batch_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_batch medialab_core.editor_handoff_batches%ROWTYPE; v_result jsonb;
BEGIN
  SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
  SELECT * INTO v_batch FROM medialab_core.editor_handoff_batches WHERE id=p_handoff_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Editor handoff batch is missing or unavailable' USING ERRCODE='42501'; END IF;
  PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_batch.organization_id,'media_editor_handoff.read');
  SELECT jsonb_build_object('batch',to_jsonb(b),'current',to_jsonb(c),'items',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('item',to_jsonb(i),'current',to_jsonb(ic)) ORDER BY i.ordinal)
      FROM medialab_core.editor_handoff_items i JOIN medialab_core.editor_handoff_item_current ic ON ic.handoff_item_id=i.id
     WHERE i.handoff_batch_id=b.id),'[]'::jsonb)) INTO v_result
    FROM medialab_core.editor_handoff_batches b JOIN medialab_core.editor_handoff_current c ON c.handoff_batch_id=b.id WHERE b.id=v_batch.id;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_editor_handoff_batches(p_session_token text,p_job_id uuid,p_lane text)
RETURNS SETOF jsonb AS $$
DECLARE v_actor uuid; v_job medialab_core.jobs%ROWTYPE;
BEGIN
  SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
  SELECT * INTO v_job FROM medialab_core.jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE='42501'; END IF;
  PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_job.organization_id,'media_editor_handoff.read');
  IF p_lane IS NOT NULL AND p_lane NOT IN ('PHOTO','VIDEO') THEN RAISE EXCEPTION 'Lane must be PHOTO or VIDEO' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT jsonb_build_object('batch',to_jsonb(b),'current',to_jsonb(c))
    FROM medialab_core.editor_handoff_batches b JOIN medialab_core.editor_handoff_current c ON c.handoff_batch_id=b.id
   WHERE b.job_id=v_job.id AND (p_lane IS NULL OR b.lane=p_lane) ORDER BY b.created_at,b.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_returned_media_history(p_session_token text,p_handoff_batch_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_batch medialab_core.editor_handoff_batches%ROWTYPE; v_result jsonb;
BEGIN
  SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
  SELECT * INTO v_batch FROM medialab_core.editor_handoff_batches WHERE id=p_handoff_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Editor handoff batch is missing or unavailable' USING ERRCODE='42501'; END IF;
  PERFORM medialab_core.require_editor_handoff_permission(v_actor,v_batch.organization_id,'media_editor_handoff.read');
  SELECT jsonb_build_object(
    'intake_batches',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id) FROM medialab_core.returned_media_intake_batches x WHERE x.handoff_batch_id=v_batch.id),'[]'::jsonb),
    'returned_items',COALESCE((SELECT jsonb_agg(jsonb_build_object('item',to_jsonb(r),'current',to_jsonb(c)) ORDER BY r.recorded_at,r.id)
      FROM medialab_core.returned_media_items r JOIN medialab_core.returned_media_item_current c ON c.returned_item_id=r.id WHERE r.handoff_batch_id=v_batch.id),'[]'::jsonb),
    'match_events',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.recorded_at,m.id) FROM medialab_core.returned_media_match_events m WHERE m.handoff_batch_id=v_batch.id),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE TRIGGER editor_handoff_batches_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.editor_handoff_batches
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation();
CREATE TRIGGER editor_handoff_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.editor_handoff_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation();
CREATE TRIGGER editor_handoff_items_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.editor_handoff_items
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation();
CREATE TRIGGER returned_media_intake_batches_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_media_intake_batches
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation();
CREATE TRIGGER returned_media_intake_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_media_intake_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation();
CREATE TRIGGER returned_media_items_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_media_items
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation();
CREATE TRIGGER returned_media_match_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_media_match_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editor_handoff_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.editor_handoff_batches, medialab_core.editor_handoff_events,
  medialab_core.editor_handoff_current, medialab_core.editor_handoff_items, medialab_core.editor_handoff_item_current,
  medialab_core.returned_media_intake_batches, medialab_core.returned_media_intake_events,
  medialab_core.returned_media_items, medialab_core.returned_media_match_events,
  medialab_core.returned_media_item_current FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_editor_handoff_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_editor_handoff_permission(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_editor_handoff_reason(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_editor_handoff_safe_json(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.recompute_editor_handoff_current(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_returned_version_for_match(uuid,uuid,text,bigint,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_editor_handoff_batch(text,text,uuid,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_editor_handoff_event(text,text,uuid,text,bigint,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_returned_media_intake_batch(text,text,uuid,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_returned_media_item(text,text,uuid,text,bigint,text,text,text,text,uuid,bigint,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.resolve_returned_media_match(text,text,uuid,text,text,uuid,bigint,bigint,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.complete_editor_handoff_returns(text,text,uuid,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_editor_handoff_batch(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_editor_handoff_batches(text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_returned_media_history(text,uuid) FROM PUBLIC;
