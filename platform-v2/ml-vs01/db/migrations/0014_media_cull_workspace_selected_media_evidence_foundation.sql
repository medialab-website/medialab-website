-- P02-M11-A: provider-neutral Media Cull Workspace and selected-media evidence foundation.
-- This packet stores synthetic database evidence only. It performs no media or provider I/O.

CREATE TABLE medialab_core.cull_workspaces (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    lane text NOT NULL,
    label text NOT NULL,
    predecessor_workspace_id uuid NULL UNIQUE,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (predecessor_workspace_id)
        REFERENCES medialab_core.cull_workspaces(id) ON DELETE RESTRICT,
    CONSTRAINT cull_workspaces_id_org_job_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT cull_workspaces_lane_check CHECK (lane IN ('PHOTO', 'VIDEO')),
    CONSTRAINT cull_workspaces_label_check CHECK (
        label = btrim(label) AND label <> '' AND length(label) <= 200
    ),
    CONSTRAINT cull_workspaces_context_check CHECK (jsonb_typeof(context) = 'object')
);

CREATE TABLE medialab_core.cull_workspace_events (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_workspace_events_type_check CHECK (
        event_type IN ('CREATED', 'INVENTORY_SEALED', 'COMPLETED', 'SUPERSEDED')
    ),
    CONSTRAINT cull_workspace_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT cull_workspace_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.cull_workspace_current (
    workspace_id uuid PRIMARY KEY REFERENCES medialab_core.cull_workspaces(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    current_state text NOT NULL,
    inventory_sealed boolean NOT NULL DEFAULT false,
    active_candidate_count integer NOT NULL DEFAULT 0,
    inventory_sha256 text NULL,
    inventory_generation bigint NOT NULL DEFAULT 0,
    decision_generation bigint NOT NULL DEFAULT 0,
    selected_manifest_id uuid NULL,
    completion_id uuid NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_workspace_current_state_check CHECK (
        current_state IN ('DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETE', 'SUPERSEDED')
    ),
    CONSTRAINT cull_workspace_current_count_check CHECK (active_candidate_count >= 0),
    CONSTRAINT cull_workspace_current_inventory_hash_check CHECK (
        inventory_sha256 IS NULL OR inventory_sha256 ~ '^[0-9a-f]{64}$'
    )
);

CREATE TABLE medialab_core.cull_candidates (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    admitted_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_id, organization_id, job_id)
        REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_candidates_workspace_version_key UNIQUE (workspace_id, media_asset_version_id),
    CONSTRAINT cull_candidates_workspace_candidate_key UNIQUE (workspace_id, id),
    CONSTRAINT cull_candidates_context_check CHECK (jsonb_typeof(admitted_context) = 'object')
);

CREATE TABLE medialab_core.cull_candidate_inventory_events (
    id uuid PRIMARY KEY,
    candidate_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, candidate_id)
        REFERENCES medialab_core.cull_candidates(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_candidate_inventory_events_type_check CHECK (event_type IN ('ADMIT', 'WITHDRAW')),
    CONSTRAINT cull_candidate_inventory_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT cull_candidate_inventory_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.cull_candidate_current (
    candidate_id uuid PRIMARY KEY REFERENCES medialab_core.cull_candidates(id) ON DELETE RESTRICT,
    workspace_id uuid NOT NULL,
    active boolean NOT NULL,
    latest_inventory_event_id uuid NOT NULL REFERENCES medialab_core.cull_candidate_inventory_events(id) ON DELETE RESTRICT,
    current_decision_event_id uuid NULL,
    current_outcome text NULL,
    decision_generation bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, candidate_id)
        REFERENCES medialab_core.cull_candidates(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT cull_candidate_current_outcome_check CHECK (
        current_outcome IS NULL OR current_outcome IN ('KEEP', 'REJECT')
    ),
    CONSTRAINT cull_candidate_current_decision_check CHECK (
        (current_decision_event_id IS NULL AND current_outcome IS NULL) OR
        (current_decision_event_id IS NOT NULL)
    )
);

CREATE TABLE medialab_core.cull_candidate_relationship_contexts (
    id uuid PRIMARY KEY,
    candidate_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    media_capture_relationship_id uuid NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, candidate_id)
        REFERENCES medialab_core.cull_candidates(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (media_capture_relationship_id)
        REFERENCES medialab_core.media_capture_relationships(id) ON DELETE RESTRICT,
    CONSTRAINT cull_candidate_relationship_contexts_key UNIQUE (candidate_id, media_capture_relationship_id)
);

CREATE TABLE medialab_core.cull_inventory_seals (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL UNIQUE,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    candidate_count integer NOT NULL,
    inventory_sha256 text NOT NULL,
    reason text NOT NULL,
    sealed_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    sealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_inventory_seals_count_check CHECK (candidate_count > 0),
    CONSTRAINT cull_inventory_seals_hash_check CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT cull_inventory_seals_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    )
);

CREATE TABLE medialab_core.cull_decision_batches (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    action text NOT NULL,
    outcome text NULL,
    is_synchronized boolean NOT NULL,
    candidate_count integer NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_decision_batches_action_check CHECK (action IN ('SET', 'CLEAR')),
    CONSTRAINT cull_decision_batches_outcome_check CHECK (
        (action = 'SET' AND outcome IN ('KEEP', 'REJECT')) OR
        (action = 'CLEAR' AND outcome IS NULL)
    ),
    CONSTRAINT cull_decision_batches_count_check CHECK (candidate_count > 0),
    CONSTRAINT cull_decision_batches_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT cull_decision_batches_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.cull_decision_events (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES medialab_core.cull_decision_batches(id) ON DELETE RESTRICT,
    candidate_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    action text NOT NULL,
    outcome text NULL,
    supersedes_decision_event_id uuid NULL REFERENCES medialab_core.cull_decision_events(id) ON DELETE RESTRICT,
    relationship_context_id uuid NULL REFERENCES medialab_core.media_capture_relationships(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, candidate_id)
        REFERENCES medialab_core.cull_candidates(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_id, organization_id, job_id)
        REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_decision_events_action_check CHECK (action IN ('SET', 'CLEAR')),
    CONSTRAINT cull_decision_events_outcome_check CHECK (
        (action = 'SET' AND outcome IN ('KEEP', 'REJECT')) OR
        (action = 'CLEAR' AND outcome IS NULL)
    ),
    CONSTRAINT cull_decision_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT cull_decision_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

ALTER TABLE medialab_core.cull_candidate_current
    ADD CONSTRAINT cull_candidate_current_decision_fk
    FOREIGN KEY (current_decision_event_id)
    REFERENCES medialab_core.cull_decision_events(id) ON DELETE RESTRICT;

ALTER TABLE medialab_core.media_manifests
    ADD COLUMN manifest_purpose text NOT NULL DEFAULT 'JOB_MEDIA_INVENTORY',
    ADD COLUMN source_cull_workspace_id uuid NULL
        REFERENCES medialab_core.cull_workspaces(id) ON DELETE RESTRICT,
    ADD CONSTRAINT media_manifests_purpose_check CHECK (
        manifest_purpose IN ('JOB_MEDIA_INVENTORY', 'CULL_SELECTION')
    ),
    ADD CONSTRAINT media_manifests_cull_source_check CHECK (
        (manifest_purpose = 'JOB_MEDIA_INVENTORY' AND source_cull_workspace_id IS NULL) OR
        (manifest_purpose = 'CULL_SELECTION' AND source_cull_workspace_id IS NOT NULL)
    );

CREATE UNIQUE INDEX media_manifests_one_cull_selection_idx
    ON medialab_core.media_manifests (source_cull_workspace_id)
    WHERE manifest_purpose = 'CULL_SELECTION';

CREATE TABLE medialab_core.cull_workspace_completions (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL UNIQUE,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    media_manifest_id uuid NOT NULL UNIQUE REFERENCES medialab_core.media_manifests(id) ON DELETE RESTRICT,
    inventory_sha256 text NOT NULL,
    selection_sha256 text NOT NULL,
    selected_count integer NOT NULL,
    rejected_count integer NOT NULL,
    empty_selection_override boolean NOT NULL,
    empty_selection_reason text NULL,
    reason text NOT NULL,
    completed_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_workspace_completions_inventory_hash_check CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT cull_workspace_completions_selection_hash_check CHECK (selection_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT cull_workspace_completions_counts_check CHECK (selected_count >= 0 AND rejected_count >= 0),
    CONSTRAINT cull_workspace_completions_empty_check CHECK (
        (selected_count > 0 AND empty_selection_override = false AND empty_selection_reason IS NULL) OR
        (selected_count = 0 AND empty_selection_override = true AND
         empty_selection_reason = btrim(empty_selection_reason) AND
         empty_selection_reason <> '' AND length(empty_selection_reason) <= 1000)
    ),
    CONSTRAINT cull_workspace_completions_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    )
);

CREATE TABLE medialab_core.cull_selection_designation_events (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    lane text NOT NULL,
    workspace_id uuid NOT NULL,
    media_manifest_id uuid NOT NULL REFERENCES medialab_core.media_manifests(id) ON DELETE RESTRICT,
    designation_type text NOT NULL,
    superseded_workspace_id uuid NULL REFERENCES medialab_core.cull_workspaces(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT cull_selection_designation_lane_check CHECK (lane IN ('PHOTO', 'VIDEO')),
    CONSTRAINT cull_selection_designation_type_check CHECK (designation_type IN ('CURRENT', 'SUPERSEDED')),
    CONSTRAINT cull_selection_designation_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    )
);

CREATE TABLE medialab_core.cull_current_selections (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    lane text NOT NULL,
    workspace_id uuid NOT NULL UNIQUE REFERENCES medialab_core.cull_workspaces(id) ON DELETE RESTRICT,
    media_manifest_id uuid NOT NULL UNIQUE REFERENCES medialab_core.media_manifests(id) ON DELETE RESTRICT,
    designation_event_id uuid NOT NULL REFERENCES medialab_core.cull_selection_designation_events(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT cull_current_selections_lane_check CHECK (lane IN ('PHOTO', 'VIDEO'))
);

ALTER TABLE medialab_core.cull_workspace_current
    ADD CONSTRAINT cull_workspace_current_manifest_fkey
        FOREIGN KEY (selected_manifest_id) REFERENCES medialab_core.media_manifests(id) ON DELETE RESTRICT,
    ADD CONSTRAINT cull_workspace_current_completion_fkey
        FOREIGN KEY (completion_id) REFERENCES medialab_core.cull_workspace_completions(id) ON DELETE RESTRICT;

ALTER TABLE medialab_core.cull_current_selections
    ADD CONSTRAINT cull_current_selections_workspace_scope_fkey
        FOREIGN KEY (workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX cull_current_selections_job_lane_idx
    ON medialab_core.cull_current_selections (organization_id, job_id, lane)
    WHERE service_workstream_id IS NULL;
CREATE UNIQUE INDEX cull_current_selections_workstream_lane_idx
    ON medialab_core.cull_current_selections (organization_id, job_id, service_workstream_id, lane)
    WHERE service_workstream_id IS NOT NULL;

CREATE INDEX cull_workspaces_scope_idx
    ON medialab_core.cull_workspaces (organization_id, job_id, service_workstream_id, lane, created_at, id);
CREATE INDEX cull_workspace_events_workspace_idx
    ON medialab_core.cull_workspace_events (workspace_id, recorded_at, id);
CREATE INDEX cull_candidates_workspace_idx
    ON medialab_core.cull_candidates (workspace_id, media_asset_version_id, id);
CREATE INDEX cull_inventory_events_candidate_idx
    ON medialab_core.cull_candidate_inventory_events (candidate_id, recorded_at, id);
CREATE INDEX cull_decision_events_candidate_idx
    ON medialab_core.cull_decision_events (candidate_id, recorded_at, id);
CREATE INDEX cull_designation_events_scope_idx
    ON medialab_core.cull_selection_designation_events
       (organization_id, job_id, service_workstream_id, lane, recorded_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_cull_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable append-only cull evidence: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_cull_permission(
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

CREATE OR REPLACE FUNCTION medialab_core.validate_cull_reason(p_reason text)
RETURNS void AS $$
BEGIN
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 OR
       p_reason ~* '(password|credential|secret|token|access[_ -]?key|private[_ -]?key|https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/])' THEN
        RAISE EXCEPTION 'A bounded provider-neutral reason without secrets, URLs, or absolute paths is required'
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_cull_safe_json(p_evidence jsonb)
RETURNS void AS $$
BEGIN
    IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
        RAISE EXCEPTION 'Cull evidence must be a JSON object' USING ERRCODE = '22023';
    END IF;
    IF length(p_evidence::text) > 20000 OR
       p_evidence::text ~* '"([a-z0-9_]*(credential|password|secret|token|access_key|private_key|signed_url|signature|oauth|binary|bytes|base64|thumbnail|proxy|preview|provider_payload)[a-z0-9_]*)"[[:space:]]*:' OR
       p_evidence::text ~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])' THEN
        RAISE EXCEPTION 'Cull evidence contains prohibited secrets, provider payloads, URLs, paths, or media data'
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_cull_workspace(
    p_session_token text, p_idempotency_key text, p_job_id uuid, p_service_workstream_id uuid,
    p_lane text, p_label text, p_reason text, p_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_job medialab_core.jobs%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_job.organization_id, 'media_cull.manage');
    IF p_service_workstream_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.service_workstreams
         WHERE id = p_service_workstream_id AND job_id = v_job.id AND organization_id = v_job.organization_id
    ) THEN
        RAISE EXCEPTION 'Service Workstream is cross-tenant, cross-Job, or missing' USING ERRCODE = '42501';
    END IF;
    IF p_lane NOT IN ('PHOTO', 'VIDEO') THEN
        RAISE EXCEPTION 'Cull lane must be PHOTO or VIDEO' USING ERRCODE = '22023';
    END IF;
    IF p_label IS NULL OR p_label <> btrim(p_label) OR p_label = '' OR length(p_label) > 200 THEN
        RAISE EXCEPTION 'A bounded workspace label is required' USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_cull_reason(p_reason);
    PERFORM medialab_core.validate_cull_safe_json(p_context);
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_job_id, p_service_workstream_id, p_lane, p_label, p_reason, p_context
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'CREATE_CULL_WORKSPACE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'workspace_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_workspaces
        (id, organization_id, job_id, service_workstream_id, lane, label, context, created_by_identity_id)
    VALUES (v_id, v_job.organization_id, v_job.id, p_service_workstream_id, p_lane, p_label, p_context, v_actor);
    INSERT INTO medialab_core.cull_workspace_events
        (id, workspace_id, organization_id, job_id, event_type, reason, evidence, recorded_by_identity_id)
    VALUES (gen_random_uuid(), v_id, v_job.organization_id, v_job.id, 'CREATED', p_reason,
            jsonb_build_object('lane', p_lane, 'service_workstream_id', p_service_workstream_id), v_actor);
    INSERT INTO medialab_core.cull_workspace_current
        (workspace_id, organization_id, job_id, current_state)
    VALUES (v_id, v_job.organization_id, v_job.id, 'DRAFT');
    PERFORM medialab_core.record_media_idempotency(v_actor, 'CREATE_CULL_WORKSPACE', p_idempotency_key, v_hash,
        jsonb_build_object('workspace_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.withdraw_cull_candidate(
    p_session_token text, p_idempotency_key text, p_candidate_id uuid, p_reason text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_candidate medialab_core.cull_candidates%ROWTYPE;
        v_workspace medialab_core.cull_workspaces%ROWTYPE; v_current medialab_core.cull_workspace_current%ROWTYPE;
        v_candidate_current medialab_core.cull_candidate_current%ROWTYPE;
        v_event_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_candidate FROM medialab_core.cull_candidates WHERE id = p_candidate_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull candidate is missing or unavailable' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = v_candidate.workspace_id;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    PERFORM medialab_core.validate_cull_reason(p_reason);
    PERFORM medialab_core.validate_cull_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_candidate_id, p_reason, p_evidence)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'WITHDRAW_CULL_CANDIDATE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'inventory_event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_workspace.id FOR UPDATE;
    IF v_current.current_state <> 'DRAFT' OR v_current.inventory_sealed THEN
        RAISE EXCEPTION 'Candidates may change only before inventory sealing' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_candidate_current FROM medialab_core.cull_candidate_current
     WHERE candidate_id = v_candidate.id FOR UPDATE;
    IF NOT v_candidate_current.active THEN
        RAISE EXCEPTION 'Cull candidate is already withdrawn' USING ERRCODE = '22023';
    END IF;
    v_event_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_candidate_inventory_events
        (id, candidate_id, workspace_id, organization_id, job_id, event_type, reason, evidence,
         recorded_by_identity_id)
    VALUES (v_event_id, v_candidate.id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            'WITHDRAW', p_reason, p_evidence, v_actor);
    UPDATE medialab_core.cull_candidate_current
       SET active = false, latest_inventory_event_id = v_event_id, updated_at = clock_timestamp()
     WHERE candidate_id = v_candidate.id;
    UPDATE medialab_core.cull_workspace_current
       SET active_candidate_count = active_candidate_count - 1,
           inventory_generation = inventory_generation + 1, updated_at = clock_timestamp()
     WHERE workspace_id = v_workspace.id;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'WITHDRAW_CULL_CANDIDATE', p_idempotency_key, v_hash,
        jsonb_build_object('inventory_event_id', v_event_id, 'candidate_id', v_candidate.id));
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.seal_cull_inventory(
    p_session_token text, p_idempotency_key text, p_workspace_id uuid, p_reason text
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE;
        v_current medialab_core.cull_workspace_current%ROWTYPE; v_inventory jsonb;
        v_count integer; v_inventory_hash text; v_seal_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    PERFORM medialab_core.validate_cull_reason(p_reason);
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_workspace_id, p_reason)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'SEAL_CULL_INVENTORY', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'seal_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_workspace.id FOR UPDATE;
    IF v_current.current_state <> 'DRAFT' OR v_current.inventory_sealed THEN
        RAISE EXCEPTION 'Cull inventory may be sealed exactly once from DRAFT' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::integer,
           coalesce(jsonb_agg(jsonb_build_object(
               'candidate_id', c.id,
               'media_asset_id', c.media_asset_id,
               'media_asset_version_id', c.media_asset_version_id
           ) ORDER BY c.media_asset_version_id, c.id), '[]'::jsonb)
      INTO v_count, v_inventory
      FROM medialab_core.cull_candidates c
      JOIN medialab_core.cull_candidate_current cc ON cc.candidate_id = c.id AND cc.active
     WHERE c.workspace_id = v_workspace.id;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'An empty candidate inventory cannot be sealed' USING ERRCODE = '22023';
    END IF;
    v_inventory_hash := encode(sha256(convert_to(v_inventory::text, 'UTF8')), 'hex');
    v_seal_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_inventory_seals
        (id, workspace_id, organization_id, job_id, candidate_count, inventory_sha256,
         reason, sealed_by_identity_id)
    VALUES (v_seal_id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            v_count, v_inventory_hash, p_reason, v_actor);
    INSERT INTO medialab_core.cull_workspace_events
        (id, workspace_id, organization_id, job_id, event_type, reason, evidence, recorded_by_identity_id)
    VALUES (gen_random_uuid(), v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            'INVENTORY_SEALED', p_reason,
            jsonb_build_object('seal_id', v_seal_id, 'candidate_count', v_count,
                               'inventory_sha256', v_inventory_hash), v_actor);
    UPDATE medialab_core.cull_workspace_current
       SET current_state = 'READY', inventory_sealed = true, active_candidate_count = v_count,
           inventory_sha256 = v_inventory_hash, updated_at = clock_timestamp()
     WHERE workspace_id = v_workspace.id;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'SEAL_CULL_INVENTORY', p_idempotency_key, v_hash,
        jsonb_build_object('seal_id', v_seal_id, 'inventory_sha256', v_inventory_hash));
    RETURN v_seal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.decide_cull_candidate(
    p_session_token text, p_idempotency_key text, p_candidate_id uuid, p_outcome text,
    p_reason text, p_expected_decision_generation bigint, p_relationship_context_id uuid, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_candidate medialab_core.cull_candidates%ROWTYPE;
        v_workspace medialab_core.cull_workspaces%ROWTYPE; v_current medialab_core.cull_workspace_current%ROWTYPE;
        v_candidate_current medialab_core.cull_candidate_current%ROWTYPE;
        v_batch_id uuid; v_event_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_candidate FROM medialab_core.cull_candidates WHERE id = p_candidate_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull candidate is missing or unavailable' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = v_candidate.workspace_id;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    IF p_outcome NOT IN ('KEEP', 'REJECT') THEN
        RAISE EXCEPTION 'Cull outcome must be KEEP or REJECT' USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_cull_reason(p_reason);
    PERFORM medialab_core.validate_cull_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_candidate_id, p_outcome, p_reason, p_expected_decision_generation,
        p_relationship_context_id, p_evidence
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'DECIDE_CULL_CANDIDATE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'decision_event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_workspace.id FOR UPDATE;
    IF v_current.current_state NOT IN ('READY', 'IN_PROGRESS') OR NOT v_current.inventory_sealed THEN
        RAISE EXCEPTION 'Decisions require a sealed incomplete Cull Workspace' USING ERRCODE = '22023';
    END IF;
    IF v_current.decision_generation <> p_expected_decision_generation THEN
        RAISE EXCEPTION 'Stale Cull Workspace decision generation' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO v_candidate_current FROM medialab_core.cull_candidate_current
     WHERE candidate_id = v_candidate.id FOR UPDATE;
    IF NOT v_candidate_current.active THEN
        RAISE EXCEPTION 'Withdrawn candidates cannot receive decisions' USING ERRCODE = '22023';
    END IF;
    IF p_relationship_context_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.cull_candidate_relationship_contexts
         WHERE candidate_id = v_candidate.id AND media_capture_relationship_id = p_relationship_context_id
    ) THEN
        RAISE EXCEPTION 'Decision relationship context was not explicitly registered for this candidate'
            USING ERRCODE = '22023';
    END IF;
    v_batch_id := gen_random_uuid(); v_event_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_decision_batches
        (id, workspace_id, organization_id, job_id, action, outcome, is_synchronized,
         candidate_count, reason, evidence, recorded_by_identity_id)
    VALUES (v_batch_id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            'SET', p_outcome, false, 1, p_reason, p_evidence, v_actor);
    INSERT INTO medialab_core.cull_decision_events
        (id, batch_id, candidate_id, workspace_id, organization_id, job_id,
         media_asset_id, media_asset_version_id, action, outcome, supersedes_decision_event_id,
         relationship_context_id, reason, evidence, recorded_by_identity_id)
    VALUES (v_event_id, v_batch_id, v_candidate.id, v_workspace.id, v_workspace.organization_id,
            v_workspace.job_id, v_candidate.media_asset_id, v_candidate.media_asset_version_id,
            'SET', p_outcome, v_candidate_current.current_decision_event_id,
            p_relationship_context_id, p_reason, p_evidence, v_actor);
    UPDATE medialab_core.cull_candidate_current
       SET current_decision_event_id = v_event_id, current_outcome = p_outcome,
           decision_generation = decision_generation + 1, updated_at = clock_timestamp()
     WHERE candidate_id = v_candidate.id;
    UPDATE medialab_core.cull_workspace_current
       SET current_state = 'IN_PROGRESS', decision_generation = decision_generation + 1,
           updated_at = clock_timestamp()
     WHERE workspace_id = v_workspace.id;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'DECIDE_CULL_CANDIDATE', p_idempotency_key, v_hash,
        jsonb_build_object('decision_event_id', v_event_id, 'batch_id', v_batch_id));
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.clear_cull_candidate_decision(
    p_session_token text, p_idempotency_key text, p_candidate_id uuid, p_reason text,
    p_expected_decision_generation bigint, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_candidate medialab_core.cull_candidates%ROWTYPE;
        v_workspace medialab_core.cull_workspaces%ROWTYPE; v_current medialab_core.cull_workspace_current%ROWTYPE;
        v_candidate_current medialab_core.cull_candidate_current%ROWTYPE;
        v_batch_id uuid; v_event_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_candidate FROM medialab_core.cull_candidates WHERE id = p_candidate_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull candidate is missing or unavailable' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = v_candidate.workspace_id;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    PERFORM medialab_core.validate_cull_reason(p_reason);
    PERFORM medialab_core.validate_cull_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_candidate_id, p_reason, p_expected_decision_generation, p_evidence
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'CLEAR_CULL_DECISION', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'decision_event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_workspace.id FOR UPDATE;
    IF v_current.current_state <> 'IN_PROGRESS' OR NOT v_current.inventory_sealed THEN
        RAISE EXCEPTION 'Decision correction requires a sealed in-progress Cull Workspace' USING ERRCODE = '22023';
    END IF;
    IF v_current.decision_generation <> p_expected_decision_generation THEN
        RAISE EXCEPTION 'Stale Cull Workspace decision generation' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO v_candidate_current FROM medialab_core.cull_candidate_current
     WHERE candidate_id = v_candidate.id FOR UPDATE;
    IF NOT v_candidate_current.active OR v_candidate_current.current_decision_event_id IS NULL THEN
        RAISE EXCEPTION 'Only an active resolved candidate may be cleared' USING ERRCODE = '22023';
    END IF;
    v_batch_id := gen_random_uuid(); v_event_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_decision_batches
        (id, workspace_id, organization_id, job_id, action, outcome, is_synchronized,
         candidate_count, reason, evidence, recorded_by_identity_id)
    VALUES (v_batch_id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            'CLEAR', NULL, false, 1, p_reason, p_evidence, v_actor);
    INSERT INTO medialab_core.cull_decision_events
        (id, batch_id, candidate_id, workspace_id, organization_id, job_id,
         media_asset_id, media_asset_version_id, action, outcome, supersedes_decision_event_id,
         reason, evidence, recorded_by_identity_id)
    VALUES (v_event_id, v_batch_id, v_candidate.id, v_workspace.id, v_workspace.organization_id,
            v_workspace.job_id, v_candidate.media_asset_id, v_candidate.media_asset_version_id,
            'CLEAR', NULL, v_candidate_current.current_decision_event_id, p_reason, p_evidence, v_actor);
    UPDATE medialab_core.cull_candidate_current
       SET current_decision_event_id = v_event_id, current_outcome = NULL,
           decision_generation = decision_generation + 1, updated_at = clock_timestamp()
     WHERE candidate_id = v_candidate.id;
    UPDATE medialab_core.cull_workspace_current
       SET decision_generation = decision_generation + 1, updated_at = clock_timestamp()
     WHERE workspace_id = v_workspace.id;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'CLEAR_CULL_DECISION', p_idempotency_key, v_hash,
        jsonb_build_object('decision_event_id', v_event_id, 'batch_id', v_batch_id));
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_cull_successor_workspace(
    p_session_token text, p_idempotency_key text, p_predecessor_workspace_id uuid,
    p_label text, p_reason text, p_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_predecessor medialab_core.cull_workspaces%ROWTYPE;
        v_current medialab_core.cull_workspace_current%ROWTYPE; v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_predecessor FROM medialab_core.cull_workspaces WHERE id = p_predecessor_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Predecessor Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_predecessor.organization_id, 'media_cull.manage');
    SELECT * INTO v_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_predecessor.id FOR UPDATE;
    IF v_current.current_state <> 'COMPLETE' THEN
        RAISE EXCEPTION 'A successor requires a completed current predecessor' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.cull_workspaces WHERE predecessor_workspace_id = v_predecessor.id) THEN
        RAISE EXCEPTION 'The predecessor already has a successor workspace' USING ERRCODE = '22023';
    END IF;
    IF p_label IS NULL OR p_label <> btrim(p_label) OR p_label = '' OR length(p_label) > 200 THEN
        RAISE EXCEPTION 'A bounded workspace label is required' USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_cull_reason(p_reason);
    PERFORM medialab_core.validate_cull_safe_json(p_context);
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_predecessor_workspace_id, p_label, p_reason, p_context
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'CREATE_CULL_SUCCESSOR', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'workspace_id')::uuid; END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_workspaces
        (id, organization_id, job_id, service_workstream_id, lane, label,
         predecessor_workspace_id, context, created_by_identity_id)
    VALUES (v_id, v_predecessor.organization_id, v_predecessor.job_id,
            v_predecessor.service_workstream_id, v_predecessor.lane, p_label,
            v_predecessor.id, p_context, v_actor);
    INSERT INTO medialab_core.cull_workspace_events
        (id, workspace_id, organization_id, job_id, event_type, reason, evidence, recorded_by_identity_id)
    VALUES (gen_random_uuid(), v_id, v_predecessor.organization_id, v_predecessor.job_id, 'CREATED', p_reason,
            jsonb_build_object('predecessor_workspace_id', v_predecessor.id), v_actor);
    INSERT INTO medialab_core.cull_workspace_current
        (workspace_id, organization_id, job_id, current_state)
    VALUES (v_id, v_predecessor.organization_id, v_predecessor.job_id, 'DRAFT');
    PERFORM medialab_core.record_media_idempotency(v_actor, 'CREATE_CULL_SUCCESSOR', p_idempotency_key, v_hash,
        jsonb_build_object('workspace_id', v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.admit_cull_candidate(
    p_session_token text, p_idempotency_key text, p_workspace_id uuid, p_media_asset_id uuid,
    p_media_asset_version_id uuid, p_relationship_context_ids uuid[], p_context jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE;
        v_workspace_current medialab_core.cull_workspace_current%ROWTYPE;
        v_asset medialab_core.media_assets%ROWTYPE; v_version medialab_core.media_asset_versions%ROWTYPE;
        v_candidate medialab_core.cull_candidates%ROWTYPE; v_event_id uuid; v_hash text; v_replay jsonb;
        v_relationship_id uuid;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    SELECT * INTO v_workspace_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_workspace.id FOR UPDATE;
    IF v_workspace_current.current_state <> 'DRAFT' OR v_workspace_current.inventory_sealed THEN
        RAISE EXCEPTION 'Candidates may change only before inventory sealing' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_asset FROM medialab_core.media_assets
     WHERE id = p_media_asset_id AND organization_id = v_workspace.organization_id AND job_id = v_workspace.job_id;
    IF NOT FOUND OR (v_workspace.service_workstream_id IS NOT NULL AND
                     v_asset.service_workstream_id IS DISTINCT FROM v_workspace.service_workstream_id) THEN
        RAISE EXCEPTION 'Candidate asset is cross-tenant, cross-Job, wrong-Workstream, or missing' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_version FROM medialab_core.media_asset_versions
     WHERE id = p_media_asset_version_id AND asset_id = v_asset.id
       AND organization_id = v_workspace.organization_id AND job_id = v_workspace.job_id;
    IF NOT FOUND OR v_version.version_kind <> 'ORIGINAL' THEN
        RAISE EXCEPTION 'Cull candidates must be exact immutable ORIGINAL asset versions' USING ERRCODE = '22023';
    END IF;
    IF (v_workspace.lane = 'PHOTO' AND v_version.media_type NOT LIKE 'image/%') OR
       (v_workspace.lane = 'VIDEO' AND v_version.media_type NOT LIKE 'video/%') THEN
        RAISE EXCEPTION 'Candidate media type does not match the Cull Workspace lane' USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_cull_safe_json(p_context);
    IF cardinality(coalesce(p_relationship_context_ids, ARRAY[]::uuid[])) > 100 OR
       cardinality(coalesce(p_relationship_context_ids, ARRAY[]::uuid[])) <>
       (SELECT count(DISTINCT x) FROM unnest(coalesce(p_relationship_context_ids, ARRAY[]::uuid[])) x) THEN
        RAISE EXCEPTION 'Relationship context must be a bounded distinct explicit list' USING ERRCODE = '22023';
    END IF;
    FOREACH v_relationship_id IN ARRAY coalesce(p_relationship_context_ids, ARRAY[]::uuid[]) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM medialab_core.media_capture_relationships r
             WHERE r.id = v_relationship_id
               AND r.organization_id = v_workspace.organization_id AND r.job_id = v_workspace.job_id
               AND (r.left_version_id = v_version.id OR r.right_version_id = v_version.id)
        ) THEN
            RAISE EXCEPTION 'Relationship context is missing, cross-scope, or unrelated to the candidate version'
                USING ERRCODE = '22023';
        END IF;
    END LOOP;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_workspace_id, p_media_asset_id, p_media_asset_version_id,
        to_jsonb(coalesce(p_relationship_context_ids, ARRAY[]::uuid[])), p_context
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'ADMIT_CULL_CANDIDATE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'candidate_id')::uuid; END IF;
    SELECT * INTO v_candidate FROM medialab_core.cull_candidates
     WHERE workspace_id = v_workspace.id AND media_asset_version_id = v_version.id;
    IF FOUND AND EXISTS (
        SELECT 1 FROM medialab_core.cull_candidate_current WHERE candidate_id = v_candidate.id AND active
    ) THEN
        RAISE EXCEPTION 'The exact version is already an active candidate in this workspace' USING ERRCODE = '23505';
    END IF;
    IF NOT FOUND THEN
        v_candidate.id := gen_random_uuid();
        INSERT INTO medialab_core.cull_candidates
            (id, workspace_id, organization_id, job_id, media_asset_id, media_asset_version_id,
             admitted_context, created_by_identity_id)
        VALUES (v_candidate.id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
                v_asset.id, v_version.id, p_context, v_actor);
    END IF;
    v_event_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_candidate_inventory_events
        (id, candidate_id, workspace_id, organization_id, job_id, event_type, reason, evidence,
         recorded_by_identity_id)
    VALUES (v_event_id, v_candidate.id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            'ADMIT', 'Exact immutable ORIGINAL version admitted to cull inventory', p_context, v_actor);
    INSERT INTO medialab_core.cull_candidate_current
        (candidate_id, workspace_id, active, latest_inventory_event_id)
    VALUES (v_candidate.id, v_workspace.id, true, v_event_id)
    ON CONFLICT (candidate_id) DO UPDATE SET
        active = true, latest_inventory_event_id = EXCLUDED.latest_inventory_event_id,
        updated_at = clock_timestamp();
    FOREACH v_relationship_id IN ARRAY coalesce(p_relationship_context_ids, ARRAY[]::uuid[]) LOOP
        INSERT INTO medialab_core.cull_candidate_relationship_contexts
            (id, candidate_id, workspace_id, media_asset_version_id, media_capture_relationship_id,
             recorded_by_identity_id)
        VALUES (gen_random_uuid(), v_candidate.id, v_workspace.id, v_version.id, v_relationship_id, v_actor)
        ON CONFLICT (candidate_id, media_capture_relationship_id) DO NOTHING;
    END LOOP;
    UPDATE medialab_core.cull_workspace_current
       SET active_candidate_count = active_candidate_count + 1,
           inventory_generation = inventory_generation + 1, updated_at = clock_timestamp()
     WHERE workspace_id = v_workspace.id;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'ADMIT_CULL_CANDIDATE', p_idempotency_key, v_hash,
        jsonb_build_object('candidate_id', v_candidate.id));
    RETURN v_candidate.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.admit_cull_candidates(
    p_session_token text, p_idempotency_key text, p_workspace_id uuid, p_candidates jsonb
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE; v_hash text; v_replay jsonb;
        v_item jsonb; v_ids jsonb := '[]'::jsonb; v_candidate_id uuid; v_inner_key text;
        v_relationship_ids uuid[];
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    IF p_candidates IS NULL OR jsonb_typeof(p_candidates) <> 'array' OR
       jsonb_array_length(p_candidates) = 0 OR jsonb_array_length(p_candidates) > 500 THEN
        RAISE EXCEPTION 'An explicit bounded candidate array is required' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_workspace_id, p_candidates)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'ADMIT_CULL_CANDIDATES', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
        IF jsonb_typeof(v_item) <> 'object' OR NOT (v_item ? 'media_asset_id') OR
           NOT (v_item ? 'media_asset_version_id') THEN
            RAISE EXCEPTION 'Every batch candidate must enumerate exact asset and version identities'
                USING ERRCODE = '22023';
        END IF;
        SELECT coalesce(array_agg(value::uuid), ARRAY[]::uuid[]) INTO v_relationship_ids
          FROM jsonb_array_elements_text(coalesce(v_item->'relationship_context_ids', '[]'::jsonb));
        v_inner_key := encode(sha256(convert_to(
            p_idempotency_key || ':' || (v_item->>'media_asset_version_id'), 'UTF8'
        )), 'hex');
        v_candidate_id := medialab_core.admit_cull_candidate(
            p_session_token, v_inner_key, p_workspace_id,
            (v_item->>'media_asset_id')::uuid, (v_item->>'media_asset_version_id')::uuid,
            v_relationship_ids, coalesce(v_item->'context', '{}'::jsonb)
        );
        v_ids := v_ids || jsonb_build_array(v_candidate_id);
    END LOOP;
    v_replay := jsonb_build_object('candidate_ids', v_ids);
    PERFORM medialab_core.record_media_idempotency(v_actor, 'ADMIT_CULL_CANDIDATES', p_idempotency_key, v_hash, v_replay);
    RETURN v_replay;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.decide_cull_candidates(
    p_session_token text, p_idempotency_key text, p_workspace_id uuid, p_candidate_ids uuid[],
    p_outcome text, p_reason text, p_expected_decision_generation bigint, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE;
        v_current medialab_core.cull_workspace_current%ROWTYPE;
        v_candidate medialab_core.cull_candidates%ROWTYPE;
        v_candidate_current medialab_core.cull_candidate_current%ROWTYPE;
        v_candidate_id uuid; v_batch_id uuid; v_event_id uuid;
        v_hash text; v_replay jsonb; v_count integer;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    IF p_outcome NOT IN ('KEEP', 'REJECT') THEN
        RAISE EXCEPTION 'Cull outcome must be KEEP or REJECT' USING ERRCODE = '22023';
    END IF;
    IF cardinality(coalesce(p_candidate_ids, ARRAY[]::uuid[])) = 0 OR
       cardinality(coalesce(p_candidate_ids, ARRAY[]::uuid[])) > 500 OR
       cardinality(p_candidate_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_candidate_ids) x) THEN
        RAISE EXCEPTION 'Synchronized decisions require a bounded distinct explicit candidate list'
            USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_cull_reason(p_reason);
    PERFORM medialab_core.validate_cull_safe_json(p_evidence);
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_workspace_id, to_jsonb(p_candidate_ids), p_outcome, p_reason,
        p_expected_decision_generation, p_evidence
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'DECIDE_CULL_CANDIDATES', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'batch_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_workspace.id FOR UPDATE;
    IF v_current.current_state NOT IN ('READY', 'IN_PROGRESS') OR NOT v_current.inventory_sealed THEN
        RAISE EXCEPTION 'Decisions require a sealed incomplete Cull Workspace' USING ERRCODE = '22023';
    END IF;
    IF v_current.decision_generation <> p_expected_decision_generation THEN
        RAISE EXCEPTION 'Stale Cull Workspace decision generation' USING ERRCODE = '40001';
    END IF;
    SELECT count(*)::integer INTO v_count
      FROM medialab_core.cull_candidates c
      JOIN medialab_core.cull_candidate_current cc ON cc.candidate_id = c.id
     WHERE c.workspace_id = v_workspace.id AND cc.active AND c.id = ANY(p_candidate_ids);
    IF v_count <> cardinality(p_candidate_ids) THEN
        RAISE EXCEPTION 'A synchronized decision included a missing, withdrawn, or wrong-workspace candidate'
            USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM medialab_core.cull_candidate_current
     WHERE candidate_id = ANY(p_candidate_ids) ORDER BY candidate_id FOR UPDATE;
    v_batch_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_decision_batches
        (id, workspace_id, organization_id, job_id, action, outcome, is_synchronized,
         candidate_count, reason, evidence, recorded_by_identity_id)
    VALUES (v_batch_id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            'SET', p_outcome, true, cardinality(p_candidate_ids), p_reason, p_evidence, v_actor);
    FOREACH v_candidate_id IN ARRAY p_candidate_ids LOOP
        SELECT * INTO v_candidate FROM medialab_core.cull_candidates WHERE id = v_candidate_id;
        SELECT * INTO v_candidate_current FROM medialab_core.cull_candidate_current
         WHERE candidate_id = v_candidate.id;
        v_event_id := gen_random_uuid();
        INSERT INTO medialab_core.cull_decision_events
            (id, batch_id, candidate_id, workspace_id, organization_id, job_id,
             media_asset_id, media_asset_version_id, action, outcome, supersedes_decision_event_id,
             reason, evidence, recorded_by_identity_id)
        VALUES (v_event_id, v_batch_id, v_candidate.id, v_workspace.id, v_workspace.organization_id,
                v_workspace.job_id, v_candidate.media_asset_id, v_candidate.media_asset_version_id,
                'SET', p_outcome, v_candidate_current.current_decision_event_id,
                p_reason, p_evidence, v_actor);
        UPDATE medialab_core.cull_candidate_current
           SET current_decision_event_id = v_event_id, current_outcome = p_outcome,
               decision_generation = decision_generation + 1, updated_at = clock_timestamp()
         WHERE candidate_id = v_candidate.id;
    END LOOP;
    UPDATE medialab_core.cull_workspace_current
       SET current_state = 'IN_PROGRESS', decision_generation = decision_generation + 1,
           updated_at = clock_timestamp()
     WHERE workspace_id = v_workspace.id;
    PERFORM medialab_core.record_media_idempotency(v_actor, 'DECIDE_CULL_CANDIDATES', p_idempotency_key, v_hash,
        jsonb_build_object('batch_id', v_batch_id));
    RETURN v_batch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.finalize_cull_workspace(
    p_session_token text, p_idempotency_key text, p_workspace_id uuid, p_reason text,
    p_expected_decision_generation bigint, p_empty_selection_override boolean,
    p_empty_selection_reason text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE;
        v_current medialab_core.cull_workspace_current%ROWTYPE;
        v_predecessor_current medialab_core.cull_workspace_current%ROWTYPE;
        v_manifest jsonb; v_selection_hash text; v_manifest_id uuid; v_manifest_version integer;
        v_completion_id uuid; v_designation_id uuid; v_selected integer; v_rejected integer;
        v_unresolved integer; v_hash text; v_replay jsonb; v_existing_current uuid;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.manage');
    PERFORM medialab_core.require_media_permission(v_actor, v_workspace.organization_id, 'media_asset.manage');
    PERFORM medialab_core.validate_cull_reason(p_reason);
    IF p_empty_selection_reason IS NOT NULL THEN
        PERFORM medialab_core.validate_cull_reason(p_empty_selection_reason);
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_workspace_id, p_reason, p_expected_decision_generation,
        p_empty_selection_override, p_empty_selection_reason
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'FINALIZE_CULL_WORKSPACE', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    SELECT * INTO v_current FROM medialab_core.cull_workspace_current
     WHERE workspace_id = v_workspace.id FOR UPDATE;
    IF v_current.current_state NOT IN ('READY', 'IN_PROGRESS') OR NOT v_current.inventory_sealed THEN
        RAISE EXCEPTION 'Finalization requires a sealed incomplete Cull Workspace' USING ERRCODE = '22023';
    END IF;
    IF v_current.decision_generation <> p_expected_decision_generation THEN
        RAISE EXCEPTION 'Stale Cull Workspace decision generation' USING ERRCODE = '40001';
    END IF;
    SELECT count(*) FILTER (WHERE cc.current_outcome IS NULL)::integer,
           count(*) FILTER (WHERE cc.current_outcome = 'KEEP')::integer,
           count(*) FILTER (WHERE cc.current_outcome = 'REJECT')::integer
      INTO v_unresolved, v_selected, v_rejected
      FROM medialab_core.cull_candidates c
      JOIN medialab_core.cull_candidate_current cc ON cc.candidate_id = c.id AND cc.active
     WHERE c.workspace_id = v_workspace.id;
    IF v_unresolved <> 0 OR v_selected + v_rejected <> v_current.active_candidate_count THEN
        RAISE EXCEPTION 'Every active candidate must have one effective decision before completion'
            USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM medialab_core.cull_candidates c
          JOIN medialab_core.cull_candidate_current cc ON cc.candidate_id = c.id AND cc.active
          JOIN medialab_core.capture_item_promotions p ON p.media_asset_version_id = c.media_asset_version_id
          JOIN medialab_core.capture_item_verification_events v ON v.capture_item_id = p.capture_item_id
         WHERE c.workspace_id = v_workspace.id AND v.verification_state = 'CONFLICT'
    ) THEN
        RAISE EXCEPTION 'Unresolved promoted-capture verification conflict blocks cull completion'
            USING ERRCODE = '22023';
    END IF;
    IF v_selected = 0 AND (
        NOT coalesce(p_empty_selection_override, false) OR p_empty_selection_reason IS NULL OR
        p_empty_selection_reason <> btrim(p_empty_selection_reason) OR p_empty_selection_reason = ''
    ) THEN
        RAISE EXCEPTION 'An empty selected set requires an explicit reason-bearing override'
            USING ERRCODE = '22023';
    END IF;
    IF v_selected > 0 AND (coalesce(p_empty_selection_override, false) OR p_empty_selection_reason IS NOT NULL) THEN
        RAISE EXCEPTION 'Empty-selection override evidence is valid only for an empty selected set'
            USING ERRCODE = '22023';
    END IF;
    SELECT jsonb_build_object(
        'schema_version', 'CULL_SELECTION_V1',
        'purpose', 'CULL_SELECTION',
        'workspace_id', v_workspace.id,
        'organization_id', v_workspace.organization_id,
        'job_id', v_workspace.job_id,
        'service_workstream_id', v_workspace.service_workstream_id,
        'lane', v_workspace.lane,
        'inventory_sha256', v_current.inventory_sha256,
        'selected_count', v_selected,
        'rejected_count', v_rejected,
        'selected_versions', coalesce(jsonb_agg(jsonb_build_object(
            'media_asset_id', c.media_asset_id,
            'media_asset_version_id', c.media_asset_version_id
        ) ORDER BY c.media_asset_version_id, c.media_asset_id)
        FILTER (WHERE cc.current_outcome = 'KEEP'), '[]'::jsonb)
    ) INTO v_manifest
      FROM medialab_core.cull_candidates c
      JOIN medialab_core.cull_candidate_current cc ON cc.candidate_id = c.id AND cc.active
     WHERE c.workspace_id = v_workspace.id;
    v_selection_hash := encode(sha256(convert_to(v_manifest::text, 'UTF8')), 'hex');
    SELECT coalesce(max(manifest_version), 0) + 1 INTO v_manifest_version
      FROM medialab_core.media_manifests WHERE job_id = v_workspace.job_id;
    v_manifest_id := gen_random_uuid(); v_completion_id := gen_random_uuid();
    INSERT INTO medialab_core.media_manifests
        (id, organization_id, job_id, manifest_version, schema_version, manifest_json,
         integrity_sha256, created_by_identity_id, manifest_purpose, source_cull_workspace_id)
    VALUES (v_manifest_id, v_workspace.organization_id, v_workspace.job_id, v_manifest_version,
            'MEDIA_MANIFEST_V1', v_manifest, v_selection_hash, v_actor,
            'CULL_SELECTION', v_workspace.id);
    IF (SELECT integrity_sha256 FROM medialab_core.media_manifests WHERE id = v_manifest_id) <>
       encode(sha256(convert_to((SELECT manifest_json FROM medialab_core.media_manifests
                                 WHERE id = v_manifest_id)::text, 'UTF8')), 'hex') THEN
        RAISE EXCEPTION 'Selected-media manifest readback hash mismatch' USING ERRCODE = 'XX000';
    END IF;
    INSERT INTO medialab_core.cull_workspace_completions
        (id, workspace_id, organization_id, job_id, media_manifest_id, inventory_sha256,
         selection_sha256, selected_count, rejected_count, empty_selection_override,
         empty_selection_reason, reason, completed_by_identity_id)
    VALUES (v_completion_id, v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            v_manifest_id, v_current.inventory_sha256, v_selection_hash, v_selected, v_rejected,
            coalesce(p_empty_selection_override, false), p_empty_selection_reason, p_reason, v_actor);
    IF v_workspace.predecessor_workspace_id IS NULL THEN
        SELECT workspace_id INTO v_existing_current
          FROM medialab_core.cull_current_selections
         WHERE organization_id = v_workspace.organization_id AND job_id = v_workspace.job_id
           AND service_workstream_id IS NOT DISTINCT FROM v_workspace.service_workstream_id
           AND lane = v_workspace.lane FOR UPDATE;
        IF FOUND THEN
            RAISE EXCEPTION 'A current completed selection already exists; create an explicit successor recull'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        SELECT * INTO v_predecessor_current FROM medialab_core.cull_workspace_current
         WHERE workspace_id = v_workspace.predecessor_workspace_id FOR UPDATE;
        IF v_predecessor_current.current_state <> 'COMPLETE' THEN
            RAISE EXCEPTION 'Successor completion requires a completed predecessor' USING ERRCODE = '22023';
        END IF;
        SELECT workspace_id INTO v_existing_current
          FROM medialab_core.cull_current_selections
         WHERE organization_id = v_workspace.organization_id AND job_id = v_workspace.job_id
           AND service_workstream_id IS NOT DISTINCT FROM v_workspace.service_workstream_id
           AND lane = v_workspace.lane FOR UPDATE;
        IF NOT FOUND OR v_existing_current <> v_workspace.predecessor_workspace_id THEN
            RAISE EXCEPTION 'The predecessor is no longer the current selection for this exact scope'
                USING ERRCODE = '40001';
        END IF;
        INSERT INTO medialab_core.cull_selection_designation_events
            (id, organization_id, job_id, service_workstream_id, lane, workspace_id,
             media_manifest_id, designation_type, superseded_workspace_id, reason, recorded_by_identity_id)
        VALUES (gen_random_uuid(), v_workspace.organization_id, v_workspace.job_id,
                v_workspace.service_workstream_id, v_workspace.lane,
                v_workspace.predecessor_workspace_id, v_predecessor_current.selected_manifest_id,
                'SUPERSEDED', v_workspace.predecessor_workspace_id, p_reason, v_actor);
        INSERT INTO medialab_core.cull_workspace_events
            (id, workspace_id, organization_id, job_id, event_type, reason, evidence,
             recorded_by_identity_id)
        VALUES (gen_random_uuid(), v_workspace.predecessor_workspace_id,
                v_workspace.organization_id, v_workspace.job_id, 'SUPERSEDED', p_reason,
                jsonb_build_object('successor_workspace_id', v_workspace.id,
                                   'successor_manifest_id', v_manifest_id), v_actor);
        UPDATE medialab_core.cull_workspace_current
           SET current_state = 'SUPERSEDED', updated_at = clock_timestamp()
         WHERE workspace_id = v_workspace.predecessor_workspace_id;
    END IF;
    v_designation_id := gen_random_uuid();
    INSERT INTO medialab_core.cull_selection_designation_events
        (id, organization_id, job_id, service_workstream_id, lane, workspace_id,
         media_manifest_id, designation_type, superseded_workspace_id, reason, recorded_by_identity_id)
    VALUES (v_designation_id, v_workspace.organization_id, v_workspace.job_id,
            v_workspace.service_workstream_id, v_workspace.lane, v_workspace.id,
            v_manifest_id, 'CURRENT', v_workspace.predecessor_workspace_id, p_reason, v_actor);
    IF v_workspace.predecessor_workspace_id IS NULL THEN
        INSERT INTO medialab_core.cull_current_selections
            (id, organization_id, job_id, service_workstream_id, lane, workspace_id,
             media_manifest_id, designation_event_id)
        VALUES (gen_random_uuid(), v_workspace.organization_id, v_workspace.job_id,
                v_workspace.service_workstream_id, v_workspace.lane, v_workspace.id,
                v_manifest_id, v_designation_id);
    ELSE
        UPDATE medialab_core.cull_current_selections
           SET workspace_id = v_workspace.id, media_manifest_id = v_manifest_id,
               designation_event_id = v_designation_id, updated_at = clock_timestamp()
         WHERE workspace_id = v_workspace.predecessor_workspace_id;
    END IF;
    INSERT INTO medialab_core.cull_workspace_events
        (id, workspace_id, organization_id, job_id, event_type, reason, evidence, recorded_by_identity_id)
    VALUES (gen_random_uuid(), v_workspace.id, v_workspace.organization_id, v_workspace.job_id,
            'COMPLETED', p_reason,
            jsonb_build_object('completion_id', v_completion_id, 'media_manifest_id', v_manifest_id,
                               'selection_sha256', v_selection_hash,
                               'selected_count', v_selected, 'rejected_count', v_rejected), v_actor);
    UPDATE medialab_core.cull_workspace_current
       SET current_state = 'COMPLETE', selected_manifest_id = v_manifest_id,
           completion_id = v_completion_id, updated_at = clock_timestamp()
     WHERE workspace_id = v_workspace.id;
    v_replay := jsonb_build_object(
        'workspace_id', v_workspace.id, 'completion_id', v_completion_id,
        'media_manifest_id', v_manifest_id, 'selection_sha256', v_selection_hash,
        'selected_count', v_selected, 'rejected_count', v_rejected
    );
    PERFORM medialab_core.record_media_idempotency(v_actor, 'FINALIZE_CULL_WORKSPACE', p_idempotency_key, v_hash, v_replay);
    RETURN v_replay;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_cull_workspace(
    p_session_token text, p_workspace_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.read');
    RETURN jsonb_build_object(
        'workspace', to_jsonb(v_workspace),
        'current', (SELECT to_jsonb(x) FROM medialab_core.cull_workspace_current x
                    WHERE x.workspace_id = v_workspace.id),
        'inventory_seal', (SELECT to_jsonb(s) FROM medialab_core.cull_inventory_seals s
                           WHERE s.workspace_id = v_workspace.id),
        'candidates', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'candidate', to_jsonb(c),
            'current', to_jsonb(cc),
            'relationship_contexts', (SELECT coalesce(jsonb_agg(to_jsonb(rc)
                ORDER BY rc.recorded_at, rc.id), '[]'::jsonb)
                FROM medialab_core.cull_candidate_relationship_contexts rc
                WHERE rc.candidate_id = c.id)
        ) ORDER BY c.media_asset_version_id, c.id), '[]'::jsonb)
        FROM medialab_core.cull_candidates c
        JOIN medialab_core.cull_candidate_current cc ON cc.candidate_id = c.id
        WHERE c.workspace_id = v_workspace.id),
        'completion', (SELECT to_jsonb(c) FROM medialab_core.cull_workspace_completions c
                       WHERE c.workspace_id = v_workspace.id),
        'is_current_selection', EXISTS (
            SELECT 1 FROM medialab_core.cull_current_selections cs WHERE cs.workspace_id = v_workspace.id
        )
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_cull_candidate_history(
    p_session_token text, p_candidate_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_candidate medialab_core.cull_candidates%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_candidate FROM medialab_core.cull_candidates WHERE id = p_candidate_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull candidate is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_candidate.organization_id, 'media_cull.read');
    RETURN jsonb_build_object(
        'candidate', to_jsonb(v_candidate),
        'current', (SELECT to_jsonb(x) FROM medialab_core.cull_candidate_current x
                    WHERE x.candidate_id = v_candidate.id),
        'inventory_events', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at, e.id), '[]'::jsonb)
                             FROM medialab_core.cull_candidate_inventory_events e
                             WHERE e.candidate_id = v_candidate.id),
        'decision_events', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.recorded_at, d.id), '[]'::jsonb)
                            FROM medialab_core.cull_decision_events d
                            WHERE d.candidate_id = v_candidate.id)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_cull_workspaces(
    p_session_token text, p_job_id uuid, p_service_workstream_id uuid, p_lane text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_job medialab_core.jobs%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_job.organization_id, 'media_cull.read');
    IF p_service_workstream_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.service_workstreams
         WHERE id = p_service_workstream_id AND job_id = v_job.id AND organization_id = v_job.organization_id
    ) THEN
        RAISE EXCEPTION 'Service Workstream is cross-tenant, cross-Job, or missing' USING ERRCODE = '42501';
    END IF;
    IF p_lane IS NOT NULL AND p_lane NOT IN ('PHOTO', 'VIDEO') THEN
        RAISE EXCEPTION 'Cull lane filter must be PHOTO or VIDEO' USING ERRCODE = '22023';
    END IF;
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'workspace', to_jsonb(w),
            'current', to_jsonb(c),
            'is_current_selection', cs.workspace_id IS NOT NULL
        ) ORDER BY w.created_at, w.id)
          FROM medialab_core.cull_workspaces w
          JOIN medialab_core.cull_workspace_current c ON c.workspace_id = w.id
          LEFT JOIN medialab_core.cull_current_selections cs ON cs.workspace_id = w.id
         WHERE w.organization_id = v_job.organization_id AND w.job_id = v_job.id
           AND w.service_workstream_id IS NOT DISTINCT FROM p_service_workstream_id
           AND (p_lane IS NULL OR w.lane = p_lane)
    ), '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_cull_selected_media(
    p_session_token text, p_workspace_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_workspace medialab_core.cull_workspaces%ROWTYPE;
        v_completion medialab_core.cull_workspace_completions%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace is missing or unavailable' USING ERRCODE = '42501'; END IF;
    PERFORM medialab_core.require_cull_permission(v_actor, v_workspace.organization_id, 'media_cull.read');
    SELECT * INTO v_completion FROM medialab_core.cull_workspace_completions
     WHERE workspace_id = v_workspace.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull Workspace has no completed selected-media result' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object(
        'workspace_id', v_workspace.id,
        'completion', to_jsonb(v_completion),
        'manifest', (SELECT m.manifest_json FROM medialab_core.media_manifests m
                     WHERE m.id = v_completion.media_manifest_id),
        'manifest_integrity_sha256', (SELECT m.integrity_sha256 FROM medialab_core.media_manifests m
                                     WHERE m.id = v_completion.media_manifest_id),
        'is_current_selection', EXISTS (
            SELECT 1 FROM medialab_core.cull_current_selections cs WHERE cs.workspace_id = v_workspace.id
        )
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER cull_workspaces_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_workspaces
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_workspace_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_workspace_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_candidates_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_candidates
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_candidate_inventory_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_candidate_inventory_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_candidate_relationship_contexts_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_candidate_relationship_contexts
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_inventory_seals_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_inventory_seals
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_decision_batches_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_decision_batches
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_decision_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_decision_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_workspace_completions_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_workspace_completions
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();
CREATE TRIGGER cull_selection_designation_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.cull_selection_designation_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_cull_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.cull_workspaces FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_workspace_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_workspace_current FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_candidates FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_candidate_inventory_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_candidate_current FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_candidate_relationship_contexts FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_inventory_seals FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_decision_batches FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_decision_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_workspace_completions FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_selection_designation_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.cull_current_selections FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_cull_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_cull_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_cull_reason(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_cull_safe_json(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_cull_workspace(text, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_cull_successor_workspace(text, text, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.admit_cull_candidate(text, text, uuid, uuid, uuid, uuid[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.admit_cull_candidates(text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.withdraw_cull_candidate(text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.seal_cull_inventory(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.decide_cull_candidate(text, text, uuid, text, text, bigint, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.decide_cull_candidates(text, text, uuid, uuid[], text, text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.clear_cull_candidate_decision(text, text, uuid, text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.finalize_cull_workspace(text, text, uuid, text, bigint, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_cull_workspace(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_cull_candidate_history(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_cull_workspaces(text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_cull_selected_media(text, uuid) FROM PUBLIC;
