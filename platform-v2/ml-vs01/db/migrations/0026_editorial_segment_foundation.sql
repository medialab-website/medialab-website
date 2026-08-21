-- P02-M20-A: provider-neutral technical-media observation and editorial segment foundation.
-- Synthetic database evidence only. No media, provider, filesystem, or production operation occurs here.

CREATE TABLE medialab_core.media_technical_observations (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    observation_kind text NOT NULL,
    supersedes_observation_id uuid NULL UNIQUE,
    duration_ticks bigint NOT NULL,
    ticks_per_second bigint NOT NULL,
    frame_duration_ticks bigint NOT NULL,
    start_timecode_ticks bigint NULL,
    width_pixels integer NULL,
    height_pixels integer NULL,
    orientation text NULL,
    nominal_frame_rate_numerator integer NULL,
    nominal_frame_rate_denominator integer NULL,
    actual_frame_rate_numerator integer NULL,
    actual_frame_rate_denominator integer NULL,
    codec text NULL,
    bit_depth integer NULL,
    camera_make_model text NULL,
    device_identifier text NULL,
    lens text NULL,
    picture_profile text NULL,
    color_space text NULL,
    audio_channels integer NULL,
    audio_sample_rate_hz integer NULL,
    proxy_compatibility text NOT NULL,
    confidence text NOT NULL,
    evidence_source text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_observation_id)
        REFERENCES medialab_core.media_technical_observations(id) ON DELETE RESTRICT,
    CONSTRAINT media_technical_observations_id_scope_key
        UNIQUE (id, organization_id, job_id, media_asset_version_id),
    CONSTRAINT media_technical_observations_kind_check
        CHECK (observation_kind IN ('OBSERVED_METADATA', 'OPERATOR_CORRECTION')),
    CONSTRAINT media_technical_observations_duration_check
        CHECK (duration_ticks > 0 AND ticks_per_second > 0 AND frame_duration_ticks > 0 AND
               frame_duration_ticks <= duration_ticks AND duration_ticks % frame_duration_ticks = 0),
    CONSTRAINT media_technical_observations_timecode_check
        CHECK (start_timecode_ticks IS NULL OR start_timecode_ticks >= 0),
    CONSTRAINT media_technical_observations_dimensions_check
        CHECK ((width_pixels IS NULL AND height_pixels IS NULL) OR
               (width_pixels > 0 AND height_pixels > 0)),
    CONSTRAINT media_technical_observations_orientation_check
        CHECK (orientation IS NULL OR orientation IN ('LANDSCAPE', 'PORTRAIT', 'SQUARE', 'UNKNOWN')),
    CONSTRAINT media_technical_observations_nominal_rate_check
        CHECK ((nominal_frame_rate_numerator IS NULL AND nominal_frame_rate_denominator IS NULL) OR
               (nominal_frame_rate_numerator > 0 AND nominal_frame_rate_denominator > 0)),
    CONSTRAINT media_technical_observations_actual_rate_check
        CHECK ((actual_frame_rate_numerator IS NULL AND actual_frame_rate_denominator IS NULL) OR
               (actual_frame_rate_numerator > 0 AND actual_frame_rate_denominator > 0)),
    CONSTRAINT media_technical_observations_bit_depth_check CHECK (bit_depth IS NULL OR bit_depth BETWEEN 1 AND 64),
    CONSTRAINT media_technical_observations_audio_check
        CHECK ((audio_channels IS NULL AND audio_sample_rate_hz IS NULL) OR
               (audio_channels BETWEEN 0 AND 64 AND audio_sample_rate_hz > 0)),
    CONSTRAINT media_technical_observations_proxy_check
        CHECK (proxy_compatibility IN ('SUPPORTED', 'REQUIRES_PROXY', 'UNSUPPORTED', 'UNKNOWN')),
    CONSTRAINT media_technical_observations_confidence_check
        CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW', 'OPERATOR_CONFIRMED')),
    CONSTRAINT media_technical_observations_source_check
        CHECK (evidence_source ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_technical_observations_text_check CHECK (
        (codec IS NULL OR (codec = btrim(codec) AND codec <> '' AND length(codec) <= 200)) AND
        (camera_make_model IS NULL OR (camera_make_model = btrim(camera_make_model) AND camera_make_model <> '' AND length(camera_make_model) <= 300)) AND
        (device_identifier IS NULL OR (device_identifier = btrim(device_identifier) AND device_identifier <> '' AND length(device_identifier) <= 300)) AND
        (lens IS NULL OR (lens = btrim(lens) AND lens <> '' AND length(lens) <= 300)) AND
        (picture_profile IS NULL OR (picture_profile = btrim(picture_profile) AND picture_profile <> '' AND length(picture_profile) <= 200)) AND
        (color_space IS NULL OR (color_space = btrim(color_space) AND color_space <> '' AND length(color_space) <= 200))
    ),
    CONSTRAINT media_technical_observations_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.media_technical_observation_current (
    media_asset_version_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    current_observation_id uuid NOT NULL,
    observation_generation bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (current_observation_id, organization_id, job_id, media_asset_version_id)
        REFERENCES medialab_core.media_technical_observations(id, organization_id, job_id, media_asset_version_id)
        ON DELETE RESTRICT,
    CONSTRAINT media_technical_observation_current_generation_check CHECK (observation_generation > 0)
);

CREATE TABLE medialab_core.editorial_segments (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    cull_workspace_id uuid NOT NULL,
    cull_candidate_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id)
        REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
        REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (cull_workspace_id, organization_id, job_id)
        REFERENCES medialab_core.cull_workspaces(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (cull_workspace_id, cull_candidate_id)
        REFERENCES medialab_core.cull_candidates(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_id, organization_id, job_id)
        REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT editorial_segments_id_scope_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT editorial_segments_id_version_scope_key UNIQUE (id, organization_id, job_id, media_asset_version_id)
);

CREATE TABLE medialab_core.editorial_segment_versions (
    id uuid PRIMARY KEY,
    segment_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    technical_observation_id uuid NOT NULL,
    version_number integer NOT NULL,
    predecessor_version_id uuid NULL UNIQUE,
    source_in_ticks bigint NOT NULL,
    source_out_ticks bigint NOT NULL,
    ticks_per_second bigint NOT NULL,
    frame_duration_ticks bigint NOT NULL,
    leading_handle_ticks bigint NOT NULL DEFAULT 0,
    trailing_handle_ticks bigint NOT NULL DEFAULT 0,
    deterministic_name text NOT NULL,
    primary_story_section_code text NULL,
    role_code text NULL,
    order_key numeric(18,6) NULL,
    notes text NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (segment_id, organization_id, job_id, media_asset_version_id)
        REFERENCES medialab_core.editorial_segments(id, organization_id, job_id, media_asset_version_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (technical_observation_id, organization_id, job_id, media_asset_version_id)
        REFERENCES medialab_core.media_technical_observations(id, organization_id, job_id, media_asset_version_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (predecessor_version_id)
        REFERENCES medialab_core.editorial_segment_versions(id) ON DELETE RESTRICT,
    CONSTRAINT editorial_segment_versions_segment_number_key UNIQUE (segment_id, version_number),
    CONSTRAINT editorial_segment_versions_id_segment_key UNIQUE (id, segment_id),
    CONSTRAINT editorial_segment_versions_number_check CHECK (version_number > 0),
    CONSTRAINT editorial_segment_versions_range_check CHECK (
        source_in_ticks >= 0 AND source_out_ticks > source_in_ticks AND
        ticks_per_second > 0 AND frame_duration_ticks > 0 AND
        source_in_ticks % frame_duration_ticks = 0 AND source_out_ticks % frame_duration_ticks = 0 AND
        leading_handle_ticks >= 0 AND trailing_handle_ticks >= 0 AND
        leading_handle_ticks % frame_duration_ticks = 0 AND trailing_handle_ticks % frame_duration_ticks = 0
    ),
    CONSTRAINT editorial_segment_versions_name_check CHECK (
        deterministic_name = btrim(deterministic_name) AND deterministic_name <> '' AND
        length(deterministic_name) <= 200 AND deterministic_name !~ '[/\\]' AND
        deterministic_name NOT IN ('.', '..')
    ),
    CONSTRAINT editorial_segment_versions_story_check CHECK (
        primary_story_section_code IS NULL OR primary_story_section_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT editorial_segment_versions_role_check CHECK (
        role_code IS NULL OR role_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT editorial_segment_versions_notes_check CHECK (
        notes IS NULL OR (notes = btrim(notes) AND notes <> '' AND length(notes) <= 2000)
    ),
    CONSTRAINT editorial_segment_versions_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.editorial_segment_decision_events (
    id uuid PRIMARY KEY,
    segment_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    action text NOT NULL,
    decision_state text NULL,
    supersedes_decision_event_id uuid NULL UNIQUE,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (segment_id, organization_id, job_id)
        REFERENCES medialab_core.editorial_segments(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_decision_event_id)
        REFERENCES medialab_core.editorial_segment_decision_events(id) ON DELETE RESTRICT,
    CONSTRAINT editorial_segment_decision_events_action_check CHECK (action IN ('SET', 'CLEAR')),
    CONSTRAINT editorial_segment_decision_events_state_check CHECK (
        (action = 'SET' AND decision_state IN ('SELECTED', 'REJECTED', 'UNSELECTED', 'APPROVED_UNUSED', 'RESERVED')) OR
        (action = 'CLEAR' AND decision_state IS NULL)
    ),
    CONSTRAINT editorial_segment_decision_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT editorial_segment_decision_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.editorial_segment_current (
    segment_id uuid PRIMARY KEY REFERENCES medialab_core.editorial_segments(id) ON DELETE RESTRICT,
    current_version_id uuid NOT NULL,
    current_decision_event_id uuid NULL,
    current_decision_state text NULL,
    version_generation bigint NOT NULL DEFAULT 1,
    decision_generation bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (current_version_id, segment_id)
        REFERENCES medialab_core.editorial_segment_versions(id, segment_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_decision_event_id)
        REFERENCES medialab_core.editorial_segment_decision_events(id) ON DELETE RESTRICT,
    CONSTRAINT editorial_segment_current_decision_check CHECK (
        (current_decision_event_id IS NULL AND current_decision_state IS NULL) OR
        (current_decision_event_id IS NOT NULL AND current_decision_state IN
            ('SELECTED', 'REJECTED', 'UNSELECTED', 'APPROVED_UNUSED', 'RESERVED'))
    ),
    CONSTRAINT editorial_segment_current_generation_check CHECK (
        version_generation > 0 AND decision_generation >= 0
    )
);

CREATE INDEX media_technical_observations_version_idx
    ON medialab_core.media_technical_observations (media_asset_version_id, recorded_at, id);
CREATE INDEX editorial_segments_scope_idx
    ON medialab_core.editorial_segments (organization_id, job_id, service_workstream_id, cull_workspace_id, created_at, id);
CREATE INDEX editorial_segments_source_idx
    ON medialab_core.editorial_segments (media_asset_version_id, created_at, id);
CREATE INDEX editorial_segment_versions_segment_idx
    ON medialab_core.editorial_segment_versions (segment_id, version_number, id);
CREATE INDEX editorial_segment_decisions_segment_idx
    ON medialab_core.editorial_segment_decision_events (segment_id, recorded_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_editorial_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable append-only editorial evidence: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_editorial_permission(
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

CREATE OR REPLACE FUNCTION medialab_core.validate_editorial_safe_json(p_evidence jsonb)
RETURNS void AS $$
BEGIN
    IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' OR pg_column_size(p_evidence) > 32768 THEN
        RAISE EXCEPTION 'Editorial evidence must be a bounded JSON object' USING ERRCODE = '22023';
    END IF;
    IF p_evidence::text ~* '"([a-z0-9_]*credential[a-z0-9_]*|[a-z0-9_]*password[a-z0-9_]*|[a-z0-9_]*secret[a-z0-9_]*|[a-z0-9_]*token[a-z0-9_]*|access_key|private_key|signed_url|absolute_path)"[[:space:]]*:' OR
       p_evidence::text ~* '(https?://|file://|/Users/|/Volumes/|[A-Z]:\\)' THEN
        RAISE EXCEPTION 'Secrets, URLs, and absolute paths are prohibited from editorial evidence'
            USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_editorial_reason(p_reason text)
RETURNS void AS $$
BEGIN
    IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR p_reason = '' OR length(p_reason) > 1000 THEN
        RAISE EXCEPTION 'A bounded reason is required' USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_media_technical_observation(
    p_session_token text, p_idempotency_key text, p_media_asset_version_id uuid,
    p_observation_kind text, p_observation jsonb, p_evidence_source text,
    p_expected_generation bigint, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_version medialab_core.media_asset_versions%ROWTYPE;
        v_current medialab_core.media_technical_observation_current%ROWTYPE;
        v_id uuid; v_hash text; v_replay jsonb; v_duration bigint; v_tps bigint; v_frame bigint;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_version FROM medialab_core.media_asset_versions WHERE id = p_media_asset_version_id;
    IF NOT FOUND OR v_version.media_type NOT LIKE 'video/%' THEN
        RAISE EXCEPTION 'Technical observation source must be an available video asset version' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_editorial_permission(v_actor, v_version.organization_id, 'editorial_segment.manage');
    PERFORM medialab_core.validate_editorial_safe_json(p_observation);
    PERFORM medialab_core.validate_editorial_safe_json(p_evidence);
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_observation) k WHERE k NOT IN (
        'duration_ticks','ticks_per_second','frame_duration_ticks','start_timecode_ticks','width_pixels','height_pixels',
        'orientation','nominal_frame_rate_numerator','nominal_frame_rate_denominator',
        'actual_frame_rate_numerator','actual_frame_rate_denominator','codec','bit_depth','camera_make_model',
        'device_identifier','lens','picture_profile','color_space','audio_channels','audio_sample_rate_hz',
        'proxy_compatibility','confidence'
    )) OR NOT (p_observation ?& ARRAY['duration_ticks','ticks_per_second','frame_duration_ticks','proxy_compatibility','confidence']) THEN
        RAISE EXCEPTION 'Technical observation keys are unsupported or incomplete' USING ERRCODE = '22023';
    END IF;
    IF p_observation_kind NOT IN ('OBSERVED_METADATA', 'OPERATOR_CORRECTION') OR
       p_evidence_source IS NULL OR p_evidence_source !~ '^[A-Z][A-Z0-9_]{1,79}$' THEN
        RAISE EXCEPTION 'Technical observation kind or evidence source is invalid' USING ERRCODE = '22023';
    END IF;
    v_duration := (p_observation->>'duration_ticks')::bigint;
    v_tps := (p_observation->>'ticks_per_second')::bigint;
    v_frame := (p_observation->>'frame_duration_ticks')::bigint;
    IF v_duration <= 0 OR v_tps <= 0 OR v_frame <= 0 OR v_frame > v_duration OR v_duration % v_frame <> 0 THEN
        RAISE EXCEPTION 'Technical duration and frame timebase must be positive and frame-aligned' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(
        p_media_asset_version_id,p_observation_kind,p_observation,p_evidence_source,p_expected_generation,p_evidence
    )::text,'UTF8')),'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor,'RECORD_MEDIA_TECHNICAL_OBSERVATION',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'observation_id')::uuid; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('EDITORIAL_TECHNICAL:' || p_media_asset_version_id::text,0));
    SELECT * INTO v_current FROM medialab_core.media_technical_observation_current
     WHERE media_asset_version_id = p_media_asset_version_id FOR UPDATE;
    IF (NOT FOUND AND p_expected_generation <> 0) OR (FOUND AND v_current.observation_generation <> p_expected_generation) THEN
        RAISE EXCEPTION 'Stale technical observation generation' USING ERRCODE = '40001';
    END IF;
    IF p_observation_kind = 'OPERATOR_CORRECTION' AND NOT FOUND THEN
        RAISE EXCEPTION 'Operator correction requires an observed predecessor' USING ERRCODE = '22023';
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO medialab_core.media_technical_observations (
        id,organization_id,job_id,media_asset_version_id,observation_kind,supersedes_observation_id,
        duration_ticks,ticks_per_second,frame_duration_ticks,start_timecode_ticks,width_pixels,height_pixels,
        orientation,nominal_frame_rate_numerator,nominal_frame_rate_denominator,
        actual_frame_rate_numerator,actual_frame_rate_denominator,codec,bit_depth,camera_make_model,
        device_identifier,lens,picture_profile,color_space,audio_channels,audio_sample_rate_hz,
        proxy_compatibility,confidence,evidence_source,evidence,recorded_by_identity_id
    ) VALUES (
        v_id,v_version.organization_id,v_version.job_id,v_version.id,p_observation_kind,
        CASE WHEN v_current.current_observation_id IS NULL THEN NULL ELSE v_current.current_observation_id END,
        v_duration,v_tps,v_frame,(p_observation->>'start_timecode_ticks')::bigint,
        (p_observation->>'width_pixels')::integer,(p_observation->>'height_pixels')::integer,
        p_observation->>'orientation',(p_observation->>'nominal_frame_rate_numerator')::integer,
        (p_observation->>'nominal_frame_rate_denominator')::integer,
        (p_observation->>'actual_frame_rate_numerator')::integer,(p_observation->>'actual_frame_rate_denominator')::integer,
        p_observation->>'codec',(p_observation->>'bit_depth')::integer,p_observation->>'camera_make_model',
        p_observation->>'device_identifier',p_observation->>'lens',p_observation->>'picture_profile',
        p_observation->>'color_space',(p_observation->>'audio_channels')::integer,
        (p_observation->>'audio_sample_rate_hz')::integer,p_observation->>'proxy_compatibility',
        p_observation->>'confidence',p_evidence_source,p_evidence,v_actor
    );
    INSERT INTO medialab_core.media_technical_observation_current
        (media_asset_version_id,organization_id,job_id,current_observation_id,observation_generation)
    VALUES (v_version.id,v_version.organization_id,v_version.job_id,v_id,1)
    ON CONFLICT (media_asset_version_id) DO UPDATE SET current_observation_id=EXCLUDED.current_observation_id,
        observation_generation=medialab_core.media_technical_observation_current.observation_generation+1,
        updated_at=clock_timestamp();
    PERFORM medialab_core.record_media_idempotency(v_actor,'RECORD_MEDIA_TECHNICAL_OBSERVATION',p_idempotency_key,v_hash,
        jsonb_build_object('observation_id',v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_editorial_segment_scope(
    p_actor uuid, p_candidate_id uuid, p_technical_observation_id uuid
)
RETURNS jsonb AS $$
DECLARE v_candidate medialab_core.cull_candidates%ROWTYPE; v_workspace medialab_core.cull_workspaces%ROWTYPE;
        v_asset medialab_core.media_assets%ROWTYPE; v_version medialab_core.media_asset_versions%ROWTYPE;
        v_observation medialab_core.media_technical_observations%ROWTYPE;
BEGIN
    SELECT * INTO v_candidate FROM medialab_core.cull_candidates WHERE id=p_candidate_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cull candidate is missing or unavailable' USING ERRCODE='42501'; END IF;
    SELECT * INTO v_workspace FROM medialab_core.cull_workspaces WHERE id=v_candidate.workspace_id;
    PERFORM medialab_core.require_editorial_permission(p_actor,v_workspace.organization_id,'editorial_segment.manage');
    IF v_workspace.lane <> 'VIDEO' OR NOT EXISTS (
        SELECT 1 FROM medialab_core.cull_candidate_current WHERE candidate_id=v_candidate.id AND active
    ) THEN RAISE EXCEPTION 'Editorial segments require an active VIDEO Cull candidate' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_asset FROM medialab_core.media_assets WHERE id=v_candidate.media_asset_id;
    SELECT * INTO v_version FROM medialab_core.media_asset_versions WHERE id=v_candidate.media_asset_version_id;
    IF v_asset.organization_id<>v_workspace.organization_id OR v_asset.job_id<>v_workspace.job_id OR
       v_asset.service_workstream_id IS DISTINCT FROM v_workspace.service_workstream_id OR
       v_version.asset_id<>v_asset.id OR v_version.organization_id<>v_workspace.organization_id OR
       v_version.job_id<>v_workspace.job_id OR v_version.version_kind<>'ORIGINAL' OR v_version.media_type NOT LIKE 'video/%' THEN
        RAISE EXCEPTION 'Segment source is cross-scope, non-video, or not the exact immutable ORIGINAL' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_observation FROM medialab_core.media_technical_observations WHERE id=p_technical_observation_id;
    IF NOT FOUND OR v_observation.organization_id<>v_workspace.organization_id OR
       v_observation.job_id<>v_workspace.job_id OR v_observation.media_asset_version_id<>v_version.id THEN
        RAISE EXCEPTION 'Technical observation is missing, stale-source, or cross-scope' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('organization_id',v_workspace.organization_id,'job_id',v_workspace.job_id,
        'service_workstream_id',v_workspace.service_workstream_id,'workspace_id',v_workspace.id,
        'asset_id',v_asset.id,'version_id',v_version.id,'duration_ticks',v_observation.duration_ticks,
        'ticks_per_second',v_observation.ticks_per_second,'frame_duration_ticks',v_observation.frame_duration_ticks);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_editorial_segment(
    p_session_token text, p_idempotency_key text, p_cull_candidate_id uuid, p_technical_observation_id uuid,
    p_range jsonb, p_deterministic_name text, p_primary_story_section_code text, p_role_code text,
    p_order_key numeric, p_notes text, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_scope jsonb; v_segment_id uuid; v_version_id uuid; v_hash text; v_replay jsonb;
        v_in bigint; v_out bigint; v_tps bigint; v_frame bigint; v_leading bigint; v_trailing bigint;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.validate_editorial_safe_json(p_range);
    PERFORM medialab_core.validate_editorial_safe_json(p_evidence);
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_range) k WHERE k NOT IN (
        'source_in_ticks','source_out_ticks','ticks_per_second','frame_duration_ticks','leading_handle_ticks','trailing_handle_ticks'
    )) OR NOT (p_range ?& ARRAY['source_in_ticks','source_out_ticks','ticks_per_second','frame_duration_ticks']) THEN
        RAISE EXCEPTION 'Editorial range keys are unsupported or incomplete' USING ERRCODE='22023';
    END IF;
    v_scope := medialab_core.validate_editorial_segment_scope(v_actor,p_cull_candidate_id,p_technical_observation_id);
    v_in := (p_range->>'source_in_ticks')::bigint; v_out := (p_range->>'source_out_ticks')::bigint;
    v_tps := (p_range->>'ticks_per_second')::bigint; v_frame := (p_range->>'frame_duration_ticks')::bigint;
    v_leading := coalesce((p_range->>'leading_handle_ticks')::bigint,0);
    v_trailing := coalesce((p_range->>'trailing_handle_ticks')::bigint,0);
    IF v_tps<>(v_scope->>'ticks_per_second')::bigint OR v_frame<>(v_scope->>'frame_duration_ticks')::bigint OR
       v_in<0 OR v_out<=v_in OR v_out>(v_scope->>'duration_ticks')::bigint OR
       v_in%v_frame<>0 OR v_out%v_frame<>0 OR v_leading<0 OR v_trailing<0 OR
       v_leading%v_frame<>0 OR v_trailing%v_frame<>0 OR v_leading>v_in OR
       v_out+v_trailing>(v_scope->>'duration_ticks')::bigint THEN
        RAISE EXCEPTION 'Editorial range, handles, or timebase is outside the exact frame-aligned source bounds'
            USING ERRCODE='22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_cull_candidate_id,p_technical_observation_id,p_range,
        p_deterministic_name,p_primary_story_section_code,p_role_code,p_order_key,p_notes,p_evidence)::text,'UTF8')),'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor,'CREATE_EDITORIAL_SEGMENT',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'segment_id')::uuid; END IF;
    v_segment_id:=gen_random_uuid(); v_version_id:=gen_random_uuid();
    INSERT INTO medialab_core.editorial_segments
        (id,organization_id,job_id,service_workstream_id,cull_workspace_id,cull_candidate_id,
         media_asset_id,media_asset_version_id,created_by_identity_id)
    VALUES (v_segment_id,(v_scope->>'organization_id')::uuid,(v_scope->>'job_id')::uuid,
        (v_scope->>'service_workstream_id')::uuid,(v_scope->>'workspace_id')::uuid,p_cull_candidate_id,
        (v_scope->>'asset_id')::uuid,(v_scope->>'version_id')::uuid,v_actor);
    INSERT INTO medialab_core.editorial_segment_versions
        (id,segment_id,organization_id,job_id,media_asset_version_id,technical_observation_id,version_number,
         source_in_ticks,source_out_ticks,ticks_per_second,frame_duration_ticks,leading_handle_ticks,
         trailing_handle_ticks,deterministic_name,primary_story_section_code,role_code,order_key,notes,evidence,
         recorded_by_identity_id)
    VALUES (v_version_id,v_segment_id,(v_scope->>'organization_id')::uuid,(v_scope->>'job_id')::uuid,
        (v_scope->>'version_id')::uuid,p_technical_observation_id,1,v_in,v_out,v_tps,v_frame,v_leading,v_trailing,
        p_deterministic_name,p_primary_story_section_code,p_role_code,p_order_key,p_notes,p_evidence,v_actor);
    INSERT INTO medialab_core.editorial_segment_current(segment_id,current_version_id) VALUES(v_segment_id,v_version_id);
    PERFORM medialab_core.record_media_idempotency(v_actor,'CREATE_EDITORIAL_SEGMENT',p_idempotency_key,v_hash,
        jsonb_build_object('segment_id',v_segment_id,'version_id',v_version_id));
    RETURN v_segment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revise_editorial_segment(
    p_session_token text, p_idempotency_key text, p_segment_id uuid, p_technical_observation_id uuid,
    p_range jsonb, p_deterministic_name text, p_primary_story_section_code text, p_role_code text,
    p_order_key numeric, p_notes text, p_expected_version_generation bigint, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_segment medialab_core.editorial_segments%ROWTYPE; v_current medialab_core.editorial_segment_current%ROWTYPE;
        v_scope jsonb; v_id uuid; v_hash text; v_replay jsonb; v_in bigint; v_out bigint; v_tps bigint; v_frame bigint;
        v_leading bigint; v_trailing bigint;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_segment FROM medialab_core.editorial_segments WHERE id=p_segment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Editorial segment is missing or unavailable' USING ERRCODE='42501'; END IF;
    v_scope:=medialab_core.validate_editorial_segment_scope(v_actor,v_segment.cull_candidate_id,p_technical_observation_id);
    IF (v_scope->>'version_id')::uuid<>v_segment.media_asset_version_id THEN
        RAISE EXCEPTION 'Editorial revision cannot change immutable source identity' USING ERRCODE='22023';
    END IF;
    PERFORM medialab_core.validate_editorial_safe_json(p_range); PERFORM medialab_core.validate_editorial_safe_json(p_evidence);
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_range) k WHERE k NOT IN (
        'source_in_ticks','source_out_ticks','ticks_per_second','frame_duration_ticks','leading_handle_ticks','trailing_handle_ticks'
    )) OR NOT (p_range ?& ARRAY['source_in_ticks','source_out_ticks','ticks_per_second','frame_duration_ticks']) THEN
        RAISE EXCEPTION 'Editorial range keys are unsupported or incomplete' USING ERRCODE='22023';
    END IF;
    v_in:=(p_range->>'source_in_ticks')::bigint; v_out:=(p_range->>'source_out_ticks')::bigint;
    v_tps:=(p_range->>'ticks_per_second')::bigint; v_frame:=(p_range->>'frame_duration_ticks')::bigint;
    v_leading:=coalesce((p_range->>'leading_handle_ticks')::bigint,0);
    v_trailing:=coalesce((p_range->>'trailing_handle_ticks')::bigint,0);
    IF v_tps<>(v_scope->>'ticks_per_second')::bigint OR v_frame<>(v_scope->>'frame_duration_ticks')::bigint OR
       v_in<0 OR v_out<=v_in OR v_out>(v_scope->>'duration_ticks')::bigint OR v_in%v_frame<>0 OR v_out%v_frame<>0 OR
       v_leading<0 OR v_trailing<0 OR v_leading%v_frame<>0 OR v_trailing%v_frame<>0 OR v_leading>v_in OR
       v_out+v_trailing>(v_scope->>'duration_ticks')::bigint THEN
        RAISE EXCEPTION 'Editorial range, handles, or timebase is outside the exact frame-aligned source bounds'
            USING ERRCODE='22023';
    END IF;
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_segment_id,p_technical_observation_id,p_range,
        p_deterministic_name,p_primary_story_section_code,p_role_code,p_order_key,p_notes,
        p_expected_version_generation,p_evidence)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'REVISE_EDITORIAL_SEGMENT',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'version_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.editorial_segment_current WHERE segment_id=p_segment_id FOR UPDATE;
    IF v_current.version_generation<>p_expected_version_generation THEN
        RAISE EXCEPTION 'Stale editorial segment version generation' USING ERRCODE='40001';
    END IF;
    v_id:=gen_random_uuid();
    INSERT INTO medialab_core.editorial_segment_versions
        (id,segment_id,organization_id,job_id,media_asset_version_id,technical_observation_id,version_number,
         predecessor_version_id,source_in_ticks,source_out_ticks,ticks_per_second,frame_duration_ticks,
         leading_handle_ticks,trailing_handle_ticks,deterministic_name,primary_story_section_code,role_code,
         order_key,notes,evidence,recorded_by_identity_id)
    VALUES (v_id,v_segment.id,v_segment.organization_id,v_segment.job_id,v_segment.media_asset_version_id,
        p_technical_observation_id,v_current.version_generation+1,v_current.current_version_id,v_in,v_out,v_tps,v_frame,
        v_leading,v_trailing,p_deterministic_name,p_primary_story_section_code,p_role_code,p_order_key,p_notes,p_evidence,v_actor);
    UPDATE medialab_core.editorial_segment_current SET current_version_id=v_id,
        version_generation=version_generation+1,updated_at=clock_timestamp() WHERE segment_id=p_segment_id;
    PERFORM medialab_core.record_media_idempotency(v_actor,'REVISE_EDITORIAL_SEGMENT',p_idempotency_key,v_hash,
        jsonb_build_object('version_id',v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.decide_editorial_segment(
    p_session_token text, p_idempotency_key text, p_segment_id uuid, p_decision_state text,
    p_reason text, p_expected_decision_generation bigint, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_segment medialab_core.editorial_segments%ROWTYPE; v_current medialab_core.editorial_segment_current%ROWTYPE;
        v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_segment FROM medialab_core.editorial_segments WHERE id=p_segment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Editorial segment is missing or unavailable' USING ERRCODE='42501'; END IF;
    PERFORM medialab_core.require_editorial_permission(v_actor,v_segment.organization_id,'editorial_segment.manage');
    IF p_decision_state NOT IN ('SELECTED','REJECTED','UNSELECTED','APPROVED_UNUSED','RESERVED') THEN
        RAISE EXCEPTION 'Unsupported editorial segment decision state' USING ERRCODE='22023';
    END IF;
    PERFORM medialab_core.validate_editorial_reason(p_reason); PERFORM medialab_core.validate_editorial_safe_json(p_evidence);
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_segment_id,p_decision_state,p_reason,
        p_expected_decision_generation,p_evidence)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'DECIDE_EDITORIAL_SEGMENT',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'decision_event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.editorial_segment_current WHERE segment_id=p_segment_id FOR UPDATE;
    IF v_current.decision_generation<>p_expected_decision_generation THEN
        RAISE EXCEPTION 'Stale editorial segment decision generation' USING ERRCODE='40001';
    END IF;
    v_id:=gen_random_uuid();
    INSERT INTO medialab_core.editorial_segment_decision_events
        (id,segment_id,organization_id,job_id,action,decision_state,supersedes_decision_event_id,
         reason,evidence,recorded_by_identity_id)
    VALUES(v_id,v_segment.id,v_segment.organization_id,v_segment.job_id,'SET',p_decision_state,
        v_current.current_decision_event_id,p_reason,p_evidence,v_actor);
    UPDATE medialab_core.editorial_segment_current SET current_decision_event_id=v_id,
        current_decision_state=p_decision_state,decision_generation=decision_generation+1,
        updated_at=clock_timestamp() WHERE segment_id=p_segment_id;
    PERFORM medialab_core.record_media_idempotency(v_actor,'DECIDE_EDITORIAL_SEGMENT',p_idempotency_key,v_hash,
        jsonb_build_object('decision_event_id',v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.clear_editorial_segment_decision(
    p_session_token text, p_idempotency_key text, p_segment_id uuid, p_reason text,
    p_expected_decision_generation bigint, p_evidence jsonb
)
RETURNS uuid AS $$
DECLARE v_actor uuid; v_segment medialab_core.editorial_segments%ROWTYPE; v_current medialab_core.editorial_segment_current%ROWTYPE;
        v_id uuid; v_hash text; v_replay jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_segment FROM medialab_core.editorial_segments WHERE id=p_segment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Editorial segment is missing or unavailable' USING ERRCODE='42501'; END IF;
    PERFORM medialab_core.require_editorial_permission(v_actor,v_segment.organization_id,'editorial_segment.manage');
    PERFORM medialab_core.validate_editorial_reason(p_reason); PERFORM medialab_core.validate_editorial_safe_json(p_evidence);
    v_hash:=encode(sha256(convert_to(jsonb_build_array(p_segment_id,p_reason,p_expected_decision_generation,p_evidence)::text,'UTF8')),'hex');
    v_replay:=medialab_core.check_media_idempotency(v_actor,'CLEAR_EDITORIAL_SEGMENT_DECISION',p_idempotency_key,v_hash);
    IF v_replay IS NOT NULL THEN RETURN (v_replay->>'decision_event_id')::uuid; END IF;
    SELECT * INTO v_current FROM medialab_core.editorial_segment_current WHERE segment_id=p_segment_id FOR UPDATE;
    IF v_current.decision_generation<>p_expected_decision_generation THEN
        RAISE EXCEPTION 'Stale editorial segment decision generation' USING ERRCODE='40001';
    END IF;
    IF v_current.current_decision_event_id IS NULL THEN
        RAISE EXCEPTION 'Only a decided editorial segment can be cleared' USING ERRCODE='22023';
    END IF;
    v_id:=gen_random_uuid();
    INSERT INTO medialab_core.editorial_segment_decision_events
        (id,segment_id,organization_id,job_id,action,decision_state,supersedes_decision_event_id,
         reason,evidence,recorded_by_identity_id)
    VALUES(v_id,v_segment.id,v_segment.organization_id,v_segment.job_id,'CLEAR',NULL,
        v_current.current_decision_event_id,p_reason,p_evidence,v_actor);
    UPDATE medialab_core.editorial_segment_current SET current_decision_event_id=NULL,current_decision_state=NULL,
        decision_generation=decision_generation+1,updated_at=clock_timestamp() WHERE segment_id=p_segment_id;
    PERFORM medialab_core.record_media_idempotency(v_actor,'CLEAR_EDITORIAL_SEGMENT_DECISION',p_idempotency_key,v_hash,
        jsonb_build_object('decision_event_id',v_id));
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_editorial_segment(p_session_token text,p_segment_id uuid)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_segment medialab_core.editorial_segments%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_segment FROM medialab_core.editorial_segments WHERE id=p_segment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Editorial segment is missing or unavailable' USING ERRCODE='42501'; END IF;
    PERFORM medialab_core.require_editorial_permission(v_actor,v_segment.organization_id,'editorial_segment.read');
    RETURN jsonb_build_object('segment',to_jsonb(v_segment),
        'current',(SELECT to_jsonb(c) FROM medialab_core.editorial_segment_current c WHERE c.segment_id=v_segment.id),
        'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.version_number,v.id),'[]'::jsonb)
            FROM medialab_core.editorial_segment_versions v WHERE v.segment_id=v_segment.id),
        'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.recorded_at,d.id),'[]'::jsonb)
            FROM medialab_core.editorial_segment_decision_events d WHERE d.segment_id=v_segment.id));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_editorial_segments(
    p_session_token text,p_job_id uuid,p_service_workstream_id uuid,p_decision_state text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_job medialab_core.jobs%ROWTYPE;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_job FROM medialab_core.jobs WHERE id=p_job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE='42501'; END IF;
    PERFORM medialab_core.require_editorial_permission(v_actor,v_job.organization_id,'editorial_segment.read');
    IF p_service_workstream_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM medialab_core.service_workstreams
        WHERE id=p_service_workstream_id AND job_id=v_job.id AND organization_id=v_job.organization_id) THEN
        RAISE EXCEPTION 'Service Workstream is cross-tenant, cross-Job, or missing' USING ERRCODE='42501';
    END IF;
    IF p_decision_state IS NOT NULL AND p_decision_state NOT IN
        ('SELECTED','REJECTED','UNSELECTED','APPROVED_UNUSED','RESERVED') THEN
        RAISE EXCEPTION 'Unsupported editorial segment decision filter' USING ERRCODE='22023';
    END IF;
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('segment',to_jsonb(s),'current',to_jsonb(c),
        'version',to_jsonb(v)) ORDER BY v.order_key NULLS LAST,v.deterministic_name,s.id)
        FROM medialab_core.editorial_segments s JOIN medialab_core.editorial_segment_current c ON c.segment_id=s.id
        JOIN medialab_core.editorial_segment_versions v ON v.id=c.current_version_id
        WHERE s.organization_id=v_job.organization_id AND s.job_id=v_job.id
          AND (p_service_workstream_id IS NULL OR s.service_workstream_id=p_service_workstream_id)
          AND (p_decision_state IS NULL OR c.current_decision_state=p_decision_state)),'[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER media_technical_observations_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.media_technical_observations
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_segments_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.editorial_segments
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_segment_versions_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.editorial_segment_versions
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editorial_evidence_mutation();
CREATE TRIGGER editorial_segment_decision_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.editorial_segment_decision_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_editorial_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.media_technical_observations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.media_technical_observation_current FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.editorial_segments FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.editorial_segment_versions FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.editorial_segment_decision_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.editorial_segment_current FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_editorial_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_editorial_permission(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_editorial_safe_json(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_editorial_reason(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_media_technical_observation(text,text,uuid,text,jsonb,text,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_editorial_segment_scope(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_editorial_segment(text,text,uuid,uuid,jsonb,text,text,text,numeric,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.revise_editorial_segment(text,text,uuid,uuid,jsonb,text,text,text,numeric,text,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.decide_editorial_segment(text,text,uuid,text,text,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.clear_editorial_segment_decision(text,text,uuid,text,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_editorial_segment(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_editorial_segments(text,uuid,uuid,text) FROM PUBLIC;
