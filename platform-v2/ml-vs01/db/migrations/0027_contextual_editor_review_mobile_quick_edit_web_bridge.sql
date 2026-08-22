-- Operator-authored review notes are optional. The accepted 0016 audit model required
-- these three note columns, so this bridge relaxes only the operator-note evidence and
-- leaves system audit/event reasons required.
ALTER TABLE medialab_core.returned_review_decisions
    ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE medialab_core.returned_revision_requests
    ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE medialab_core.returned_quick_edit_requests
    ALTER COLUMN reason DROP NOT NULL;

CREATE OR REPLACE FUNCTION medialab_core.apply_returned_review_decision(
    p_actor uuid, p_item uuid, p_disposition text, p_reason text,
    p_instructions text, p_supersedes uuid
)
RETURNS uuid AS $$
DECLARE
    i medialab_core.returned_review_items%ROWTYPE;
    c medialab_core.returned_review_item_current%ROWTYPE;
    v_target uuid;
    v_current_designation uuid;
    v_designation uuid;
    d uuid;
    v_state text;
    v_old medialab_core.returned_review_decisions%ROWTYPE;
    v_designation_reason text;
BEGIN
    SELECT * INTO i FROM medialab_core.returned_review_items WHERE id = p_item;
    SELECT * INTO c FROM medialab_core.returned_review_item_current
     WHERE review_item_id = i.id FOR UPDATE;
    IF p_disposition NOT IN ('ACCEPT','REJECT_REVISION','USE_ORIGINAL','QUICK_EDIT','SKIP_QUICK_EDIT') THEN
      RAISE EXCEPTION 'Unsupported returned-review disposition' USING ERRCODE = '22023';
    END IF;
    PERFORM medialab_core.validate_returned_review_text(p_reason, false, 1000);
    PERFORM medialab_core.validate_returned_review_text(p_instructions, false, 2000);
    IF p_supersedes IS NULL AND c.current_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'Current decision requires explicit append-only supersession' USING ERRCODE = '22023';
    END IF;
    IF p_supersedes IS NOT NULL THEN
      SELECT * INTO v_old FROM medialab_core.returned_review_decisions
       WHERE id = p_supersedes AND review_item_id = i.id;
      IF NOT FOUND OR c.current_decision_id <> p_supersedes THEN
        RAISE EXCEPTION 'Superseded decision is not the current decision for this item' USING ERRCODE = '40001';
      END IF;
      IF v_old.disposition IN ('ACCEPT','USE_ORIGINAL') AND p_disposition NOT IN ('ACCEPT','USE_ORIGINAL') THEN
        RAISE EXCEPTION 'An established final source may only be replaced by a new valid final-source decision'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF p_disposition IN ('ACCEPT','USE_ORIGINAL') THEN
      PERFORM medialab_core.require_media_permission(p_actor, i.organization_id, 'media_asset.manage');
      IF p_disposition = 'ACCEPT' THEN
        v_target := i.review_media_asset_version_id;
        v_designation_reason := coalesce(
          p_reason,
          'System evidence: returned review selected the reviewed version as final source.'
        );
      ELSE
        SELECT id INTO v_target FROM medialab_core.media_asset_versions
         WHERE asset_id = i.media_asset_id AND organization_id = i.organization_id
           AND job_id = i.job_id AND version_kind = 'ORIGINAL'
         ORDER BY version_number, id LIMIT 1;
        IF v_target IS NULL THEN
          RAISE EXCEPTION 'Accepted immutable ORIGINAL version is unavailable' USING ERRCODE = '22023';
        END IF;
        v_designation_reason := coalesce(
          p_reason,
          'System evidence: returned review selected the immutable original as final source.'
        );
      END IF;
      v_current_designation := medialab_core.current_returned_review_final_designation(
        i.media_asset_id, i.organization_id, i.job_id
      );
      v_designation := gen_random_uuid();
      INSERT INTO medialab_core.media_approved_source_designations(
        id, version_id, organization_id, job_id, purpose, designation,
        supersedes_designation_id, reason, designated_by_identity_id
      ) VALUES (
        v_designation, v_target, i.organization_id, i.job_id,
        medialab_core.returned_review_final_purpose(i.media_asset_id),
        CASE WHEN p_disposition = 'USE_ORIGINAL' THEN 'USE_ORIGINAL' ELSE 'FINAL_SOURCE' END,
        v_current_designation, v_designation_reason, p_actor
      );
      v_state := 'FINAL_SOURCE_SELECTED';
    ELSIF p_disposition = 'REJECT_REVISION' THEN
      v_state := 'REVISION_ROUTED';
    ELSIF p_disposition = 'QUICK_EDIT' THEN
      v_state := 'QUICK_EDIT_ROUTED';
    ELSE
      v_designation := medialab_core.current_returned_review_final_designation(
        i.media_asset_id, i.organization_id, i.job_id
      );
      v_state := CASE WHEN v_designation IS NULL
                      THEN 'SKIP_QUICK_EDIT_UNRESOLVED'
                      ELSE 'FINAL_SOURCE_SELECTED' END;
    END IF;
    d := gen_random_uuid();
    INSERT INTO medialab_core.returned_review_decisions(
      id, review_item_id, review_batch_id, organization_id, job_id,
      reviewed_media_asset_version_id, disposition, reason, instructions,
      supersedes_decision_id, final_source_designation_id, decided_by_identity_id
    ) VALUES (
      d, i.id, i.review_batch_id, i.organization_id, i.job_id,
      i.review_media_asset_version_id, p_disposition, p_reason, p_instructions,
      p_supersedes, v_designation, p_actor
    );
    IF p_disposition = 'REJECT_REVISION' THEN
      INSERT INTO medialab_core.returned_revision_requests(
        id, review_decision_id, review_item_id, organization_id, job_id,
        rejected_media_asset_version_id, instructions, reason, requested_by_identity_id
      ) VALUES (
        gen_random_uuid(), d, i.id, i.organization_id, i.job_id,
        i.review_media_asset_version_id, p_instructions, p_reason, p_actor
      );
    ELSIF p_disposition = 'QUICK_EDIT' THEN
      INSERT INTO medialab_core.returned_quick_edit_requests(
        id, review_decision_id, review_item_id, organization_id, job_id,
        source_media_asset_version_id, instructions, reason, requested_by_identity_id
      ) VALUES (
        gen_random_uuid(), d, i.id, i.organization_id, i.job_id,
        i.review_media_asset_version_id, p_instructions, p_reason, p_actor
      );
    END IF;
    UPDATE medialab_core.returned_review_item_current
       SET current_decision_id = d,
           current_disposition = p_disposition,
           current_route_state = v_state,
           current_final_source_designation_id = v_designation,
           decision_generation = decision_generation + 1,
           updated_at = clock_timestamp()
     WHERE review_item_id = i.id;
    PERFORM medialab_core.recompute_returned_review_current(i.review_batch_id);
    RETURN d;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.complete_returned_review_batch(
    p_session text, p_key text, p_batch uuid, p_expected_generation bigint, p_reason text
)
RETURNS uuid AS $$
DECLARE
    a uuid;
    b medialab_core.returned_review_batches%ROWTYPE;
    c medialab_core.returned_review_batch_current%ROWTYPE;
    e uuid;
    q text;
    r jsonb;
    v_event_reason text;
BEGIN
    SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);
    SELECT * INTO b FROM medialab_core.returned_review_batches WHERE id = p_batch;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Review batch is missing or unavailable' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(
      a, b.organization_id, 'media_return_review.manage'
    );
    PERFORM medialab_core.validate_returned_review_text(p_reason, false, 1000);
    q := encode(sha256(convert_to(
      jsonb_build_array(p_batch, p_expected_generation, p_reason)::text, 'UTF8'
    )), 'hex');
    r := medialab_core.check_media_idempotency(
      a, 'COMPLETE_RETURNED_REVIEW_BATCH', p_key, q
    );
    IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid; END IF;
    SELECT * INTO c FROM medialab_core.returned_review_batch_current
     WHERE review_batch_id = b.id FOR UPDATE;
    IF c.lifecycle_generation <> p_expected_generation THEN
      RAISE EXCEPTION 'Stale review batch generation' USING ERRCODE = '40001';
    END IF;
    IF c.current_state <> 'SEALED' OR c.item_count = 0 OR c.unresolved_count <> 0 THEN
      RAISE EXCEPTION 'Every sealed review item requires an explicit resolving disposition'
        USING ERRCODE = '22023';
    END IF;
    e := gen_random_uuid();
    v_event_reason := coalesce(
      p_reason,
      'System evidence: returned review completed with every item resolved.'
    );
    INSERT INTO medialab_core.returned_review_batch_events(
      id, review_batch_id, organization_id, job_id, event_type, reason,
      evidence, recorded_by_identity_id
    ) VALUES (
      e, b.id, b.organization_id, b.job_id, 'COMPLETED', v_event_reason,
      jsonb_build_object(
        'item_count', c.item_count,
        'final_source_count', c.final_source_count,
        'revision_routed_count', c.revision_routed_count,
        'quick_edit_routed_count', c.quick_edit_routed_count
      ),
      a
    );
    UPDATE medialab_core.returned_review_batch_current
       SET current_state = 'COMPLETED',
           lifecycle_generation = lifecycle_generation + 1,
           updated_at = clock_timestamp()
     WHERE review_batch_id = b.id;
    PERFORM medialab_core.record_media_idempotency(
      a, 'COMPLETE_RETURNED_REVIEW_BATCH', p_key, q, jsonb_build_object('event_id', e)
    );
    RETURN e;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TABLE medialab_core.operations_quick_edit_upload_intents (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    order_id uuid NOT NULL,
    review_batch_id uuid NOT NULL,
    review_item_id uuid NOT NULL,
    quick_edit_request_id uuid NOT NULL UNIQUE,
    source_media_asset_version_id uuid NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (order_id, organization_id)
        REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_id, organization_id, order_id)
        REFERENCES medialab_core.jobs(id, organization_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (review_batch_id, organization_id, job_id)
        REFERENCES medialab_core.returned_review_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (review_item_id, review_batch_id, organization_id, job_id)
        REFERENCES medialab_core.returned_review_items(id, review_batch_id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (quick_edit_request_id, organization_id, job_id)
        REFERENCES medialab_core.returned_quick_edit_requests(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_media_asset_version_id, organization_id, job_id)
        REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT operations_quick_edit_upload_intents_scope_key
        UNIQUE (id, organization_id, job_id, order_id),
    CONSTRAINT operations_quick_edit_upload_intents_item_key
        UNIQUE (id, review_batch_id, review_item_id, quick_edit_request_id)
);

CREATE TABLE medialab_core.operations_quick_edit_upload_events (
    id uuid PRIMARY KEY,
    upload_intent_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    lifecycle_generation bigint NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (upload_intent_id, organization_id, job_id, order_id)
        REFERENCES medialab_core.operations_quick_edit_upload_intents(id, organization_id, job_id, order_id)
        ON DELETE RESTRICT,
    CONSTRAINT operations_quick_edit_upload_events_generation_key
        UNIQUE (upload_intent_id, lifecycle_generation),
    CONSTRAINT operations_quick_edit_upload_events_type_check
        CHECK (event_type IN ('INTENT_CREATED', 'FINALIZED')),
    CONSTRAINT operations_quick_edit_upload_events_generation_check
        CHECK (lifecycle_generation >= 0),
    CONSTRAINT operations_quick_edit_upload_events_reason_check
        CHECK (reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000),
    CONSTRAINT operations_quick_edit_upload_events_evidence_check
        CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.operations_quick_edit_upload_current (
    upload_intent_id uuid PRIMARY KEY
        REFERENCES medialab_core.operations_quick_edit_upload_intents(id) ON DELETE RESTRICT,
    current_state text NOT NULL DEFAULT 'AWAITING_UPLOAD',
    lifecycle_generation bigint NOT NULL DEFAULT 0,
    corrected_media_asset_version_id uuid NULL REFERENCES medialab_core.media_asset_versions(id) ON DELETE RESTRICT,
    storage_object_id uuid NULL REFERENCES medialab_core.media_storage_objects(id) ON DELETE RESTRICT,
    verification_event_id uuid NULL REFERENCES medialab_core.media_verification_events(id) ON DELETE RESTRICT,
    lineage_id uuid NULL REFERENCES medialab_core.media_asset_lineage(id) ON DELETE RESTRICT,
    quick_edit_link_id uuid NULL REFERENCES medialab_core.returned_quick_edit_version_links(id) ON DELETE RESTRICT,
    successor_review_batch_id uuid NULL REFERENCES medialab_core.returned_review_batches(id) ON DELETE RESTRICT,
    successor_review_item_id uuid NULL REFERENCES medialab_core.returned_review_items(id) ON DELETE RESTRICT,
    successor_seal_event_id uuid NULL REFERENCES medialab_core.returned_review_batch_events(id) ON DELETE RESTRICT,
    successor_link_id uuid NULL REFERENCES medialab_core.returned_review_successor_links(id) ON DELETE RESTRICT,
    successor_decision_id uuid NULL REFERENCES medialab_core.returned_review_decisions(id) ON DELETE RESTRICT,
    successor_completion_event_id uuid NULL REFERENCES medialab_core.returned_review_batch_events(id) ON DELETE RESTRICT,
    registration_content_sha256 text NULL,
    registration_result jsonb NULL,
    registered_by_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    registered_at timestamptz NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT operations_quick_edit_upload_current_state_check
        CHECK (current_state IN ('AWAITING_UPLOAD', 'FINALIZED')),
    CONSTRAINT operations_quick_edit_upload_current_generation_check
        CHECK (lifecycle_generation >= 0),
    CONSTRAINT operations_quick_edit_upload_current_fingerprint_check
        CHECK (registration_content_sha256 IS NULL OR registration_content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT operations_quick_edit_upload_current_result_check
        CHECK (registration_result IS NULL OR jsonb_typeof(registration_result) = 'object'),
    CONSTRAINT operations_quick_edit_upload_current_completion_check CHECK (
      (current_state = 'AWAITING_UPLOAD' AND lifecycle_generation = 0 AND
       corrected_media_asset_version_id IS NULL AND storage_object_id IS NULL AND
       verification_event_id IS NULL AND lineage_id IS NULL AND quick_edit_link_id IS NULL AND
       successor_review_batch_id IS NULL AND successor_review_item_id IS NULL AND
       successor_seal_event_id IS NULL AND successor_link_id IS NULL AND
       successor_decision_id IS NULL AND successor_completion_event_id IS NULL AND
       registration_content_sha256 IS NULL AND registration_result IS NULL AND
       registered_by_identity_id IS NULL AND registered_at IS NULL) OR
      (current_state = 'FINALIZED' AND lifecycle_generation = 1 AND
       corrected_media_asset_version_id IS NOT NULL AND storage_object_id IS NOT NULL AND
       verification_event_id IS NOT NULL AND lineage_id IS NOT NULL AND quick_edit_link_id IS NOT NULL AND
       successor_review_batch_id IS NOT NULL AND successor_review_item_id IS NOT NULL AND
       successor_seal_event_id IS NOT NULL AND successor_link_id IS NOT NULL AND
       successor_decision_id IS NOT NULL AND successor_completion_event_id IS NOT NULL AND
       registration_content_sha256 IS NOT NULL AND registration_result IS NOT NULL AND
       registered_by_identity_id IS NOT NULL AND registered_at IS NOT NULL)
    )
);

CREATE INDEX operations_quick_edit_upload_intents_job_idx
    ON medialab_core.operations_quick_edit_upload_intents(job_id, created_at, id);
CREATE INDEX operations_quick_edit_upload_events_intent_idx
    ON medialab_core.operations_quick_edit_upload_events(upload_intent_id, recorded_at, id);

CREATE OR REPLACE FUNCTION medialab_core.operations_review_version_summary(p_version_id uuid)
RETURNS jsonb AS $$
    SELECT jsonb_build_object(
      'mediaAssetId', v.asset_id,
      'versionId', v.id,
      'versionKind', v.version_kind,
      'observedFilename', v.observed_filename,
      'byteSize', v.byte_size,
      'mediaType', v.media_type,
      'checksumSha256', v.checksum_sha256
    )
      FROM medialab_core.media_asset_versions v
     WHERE v.id = p_version_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.operations_review_actions(p_job_id uuid)
RETURNS jsonb AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'code', q.code,
      'label', q.label,
      'lane', q.lane,
      'reviewBatchId', q.review_batch_id,
      'reviewItemId', q.review_item_id,
      'quickEditRequestId', q.quick_edit_request_id
    ) ORDER BY q.lane, q.priority, q.review_batch_id NULLS FIRST, q.review_item_id NULLS FIRST), '[]'::jsonb)
    FROM (
      SELECT 'EDITOR_REVIEW_READY'::text AS code, 'Review edits'::text AS label, h.lane,
             10 AS priority, NULL::uuid AS review_batch_id, NULL::uuid AS review_item_id,
             NULL::uuid AS quick_edit_request_id
        FROM medialab_core.editor_handoff_batches h
        JOIN medialab_core.editor_handoff_current hc ON hc.handoff_batch_id = h.id
       WHERE h.job_id = p_job_id AND hc.current_state = 'RETURNS_COMPLETE'
         AND NOT EXISTS (
           SELECT 1 FROM medialab_core.returned_review_batches rb
            WHERE rb.editor_handoff_batch_id = h.id
         )
      UNION ALL
      SELECT 'EDITOR_REVIEW_IN_PROGRESS', 'Review edits', b.lane, 20, b.id, NULL::uuid, NULL::uuid
        FROM medialab_core.returned_review_batches b
        JOIN medialab_core.returned_review_batch_current bc ON bc.review_batch_id = b.id
       WHERE b.job_id = p_job_id AND bc.current_state IN ('DRAFT', 'SEALED')
      UNION ALL
      SELECT 'EDITOR_REVISION_REQUIRED', 'Revision requested', b.lane, 30, b.id, i.id, NULL::uuid
        FROM medialab_core.returned_review_batches b
        JOIN medialab_core.returned_review_batch_current bc ON bc.review_batch_id = b.id
        JOIN medialab_core.returned_review_items i ON i.review_batch_id = b.id
        JOIN medialab_core.returned_review_item_current ic ON ic.review_item_id = i.id
        JOIN medialab_core.returned_revision_requests rr ON rr.review_decision_id = ic.current_decision_id
       WHERE b.job_id = p_job_id AND bc.current_state = 'COMPLETED'
         AND ic.current_disposition = 'REJECT_REVISION'
         AND NOT EXISTS (
           SELECT 1
             FROM medialab_core.returned_revision_version_links rl
             JOIN medialab_core.returned_review_items si
               ON si.review_media_asset_version_id = rl.returned_successor_version_id
             JOIN medialab_core.returned_review_item_current sic ON sic.review_item_id = si.id
             JOIN medialab_core.returned_review_batch_current sbc ON sbc.review_batch_id = si.review_batch_id
            WHERE rl.revision_request_id = rr.id
              AND sbc.current_state = 'COMPLETED'
              AND sic.current_route_state = 'FINAL_SOURCE_SELECTED'
         )
      UNION ALL
      SELECT 'QUICK_EDIT_REQUIRED', 'Quick Edit', b.lane, 40, b.id, i.id, qr.id
        FROM medialab_core.returned_review_batches b
        JOIN medialab_core.returned_review_batch_current bc ON bc.review_batch_id = b.id
        JOIN medialab_core.returned_review_items i ON i.review_batch_id = b.id
        JOIN medialab_core.returned_review_item_current ic ON ic.review_item_id = i.id
        JOIN medialab_core.returned_quick_edit_requests qr ON qr.review_decision_id = ic.current_decision_id
       WHERE b.job_id = p_job_id AND bc.current_state = 'COMPLETED'
         AND ic.current_disposition = 'QUICK_EDIT'
         AND NOT EXISTS (
           SELECT 1 FROM medialab_core.returned_quick_edit_version_links ql
            WHERE ql.quick_edit_request_id = qr.id
         )
    ) q;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.operations_review_batch_workspace(p_review_batch_id uuid)
RETURNS jsonb AS $$
    SELECT jsonb_build_object(
      'reviewBatchId', b.id,
      'lane', b.lane,
      'reviewCycleNumber', b.review_cycle_number,
      'currentState', c.current_state,
      'lifecycleGeneration', c.lifecycle_generation,
      'itemCount', c.item_count,
      'resolvedCount', c.resolved_count,
      'unresolvedCount', c.unresolved_count,
      'finalSourceCount', c.final_source_count,
      'revisionRoutedCount', c.revision_routed_count,
      'quickEditRoutedCount', c.quick_edit_routed_count,
      'items', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'reviewItemId', i.id,
          'ordinal', i.ordinal,
          'sourceKind', i.source_kind,
          'decisionGeneration', ic.decision_generation,
          'currentDecisionId', ic.current_decision_id,
          'currentDisposition', ic.current_disposition,
          'currentRouteState', ic.current_route_state,
          'instructions', d.instructions,
          'version', medialab_core.operations_review_version_summary(i.review_media_asset_version_id),
          'previewAvailable', (
            SELECT count(*) = 1 FROM medialab_core.media_storage_objects s
             JOIN medialab_core.media_asset_versions v ON v.id = s.version_id
            WHERE s.version_id = i.review_media_asset_version_id
              AND s.provider = 'LOCAL_FIXTURE'
              AND s.checksum_sha256 = v.checksum_sha256
              AND s.byte_size = v.byte_size
              AND s.media_type = v.media_type
              AND s.media_type IN ('image/jpeg', 'image/png')
          ) AND EXISTS (
            SELECT 1 FROM medialab_core.media_verification_events verification
             JOIN medialab_core.media_asset_versions v ON v.id = verification.version_id
            WHERE verification.version_id = i.review_media_asset_version_id
              AND verification.verification_state = 'VERIFIED'
              AND verification.observed_checksum_sha256 = v.checksum_sha256
          )
        ) ORDER BY i.ordinal, i.id)
          FROM medialab_core.returned_review_items i
          JOIN medialab_core.returned_review_item_current ic ON ic.review_item_id = i.id
          LEFT JOIN medialab_core.returned_review_decisions d ON d.id = ic.current_decision_id
         WHERE i.review_batch_id = b.id
      ), '[]'::jsonb)
    )
      FROM medialab_core.returned_review_batches b
      JOIN medialab_core.returned_review_batch_current c ON c.review_batch_id = b.id
     WHERE b.id = p_review_batch_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.start_operations_editor_review(
    p_session_token text, p_idempotency_key text, p_order_id uuid, p_lane text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_order medialab_core.orders%ROWTYPE; v_job medialab_core.jobs%ROWTYPE;
        v_handoff medialab_core.editor_handoff_batches%ROWTYPE;
        v_handoff_current medialab_core.editor_handoff_current%ROWTYPE;
        v_review medialab_core.returned_review_batches%ROWTYPE;
        v_review_current medialab_core.returned_review_batch_current%ROWTYPE;
        v_item record; v_hash text; v_replay jsonb; v_result jsonb;
        v_item_count integer; v_invalid_count integer; v_distinct_version_count integer;
        v_active_count integer; v_cycle integer; v_expected_generation bigint := 0;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_order FROM medialab_core.orders WHERE id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operations review Order is missing or unavailable' USING ERRCODE = '42501'; END IF;
    IF p_lane NOT IN ('PHOTO', 'VIDEO') THEN
      RAISE EXCEPTION 'Operations editor review lane must be PHOTO or VIDEO' USING ERRCODE = '22023';
    END IF;
    IF NOT medialab_core.actor_has_permission(v_actor, v_order.organization_id, 'order.read') THEN
      RAISE EXCEPTION 'Actor lacks active order.read authority for the target organization' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.read');
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.manage');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.read');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.manage');
    PERFORM medialab_core.require_editor_handoff_permission(v_actor, v_order.organization_id, 'media_editor_handoff.read');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_order_id, p_lane)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(
      v_actor, 'START_OPERATIONS_EDITOR_REVIEW', p_idempotency_key, v_hash
    );
    IF v_replay IS NOT NULL THEN RETURN jsonb_set(v_replay, '{replayed}', 'true'::jsonb, true); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('M22A:START_EDITOR_REVIEW:' || p_order_id::text || ':' || p_lane, 0)
    );

    SELECT h.* INTO v_handoff
      FROM medialab_core.editor_handoff_batches h
      JOIN medialab_core.jobs j ON j.id = h.job_id AND j.organization_id = h.organization_id
      JOIN medialab_core.editor_handoff_current hc ON hc.handoff_batch_id = h.id
     WHERE j.order_id = v_order.id AND j.organization_id = v_order.organization_id
       AND h.lane = p_lane AND hc.current_state = 'RETURNS_COMPLETE'
       AND NOT EXISTS (
         SELECT 1
           FROM medialab_core.returned_review_batches rb
           JOIN medialab_core.returned_review_batch_current rbc ON rbc.review_batch_id = rb.id
          WHERE rb.editor_handoff_batch_id = h.id AND rbc.current_state = 'COMPLETED'
       )
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT 1
     FOR UPDATE OF hc;
    IF v_handoff.id IS NULL THEN
      SELECT h.* INTO v_handoff
        FROM medialab_core.editor_handoff_batches h
        JOIN medialab_core.jobs j ON j.id = h.job_id AND j.organization_id = h.organization_id
        JOIN medialab_core.editor_handoff_current hc ON hc.handoff_batch_id = h.id
       WHERE j.order_id = v_order.id AND j.organization_id = v_order.organization_id
         AND h.lane = p_lane AND hc.current_state <> 'CANCELLED'
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT 1
       FOR UPDATE OF hc;
      IF v_handoff.id IS NULL THEN
        RAISE EXCEPTION 'No returned-media handoff exists for the exact Order and lane' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_handoff_current FROM medialab_core.editor_handoff_current
       WHERE handoff_batch_id = v_handoff.id;
      IF v_handoff_current.unresolved_return_count > 0 OR EXISTS (
        SELECT 1 FROM medialab_core.returned_media_item_current ric
         WHERE ric.handoff_batch_id = v_handoff.id
           AND ric.current_outcome IN ('AMBIGUOUS', 'UNMATCHED', 'CONFLICTING')
      ) THEN
        RAISE EXCEPTION 'Returned-media evidence remains unresolved or ambiguous for the exact Order and lane'
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'Returned-media evidence is not complete for the exact Order and lane' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_job FROM medialab_core.jobs
     WHERE id = v_handoff.job_id AND organization_id = v_order.organization_id AND order_id = v_order.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Editor review handoff is cross-tenant or cross-Job' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_handoff_current FROM medialab_core.editor_handoff_current
     WHERE handoff_batch_id = v_handoff.id FOR UPDATE;
    IF v_handoff_current.current_state <> 'RETURNS_COMPLETE' OR
       v_handoff_current.outstanding_source_count <> 0 OR v_handoff_current.unresolved_return_count <> 0 THEN
      RAISE EXCEPTION 'Returned-media evidence changed before editor review could start' USING ERRCODE = '40001';
    END IF;

    SELECT count(*)::integer,
           count(*) FILTER (WHERE
             hic.return_count <= 0 OR hic.latest_returned_version_id IS NULL OR
             match_event.id IS NULL OR match_event.handoff_item_id IS DISTINCT FROM hi.id OR
             match_event.returned_media_asset_version_id IS DISTINCT FROM hic.latest_returned_version_id OR
             match_event.outcome NOT IN ('EXACT_MATCH', 'CONFIDENT_MATCH', 'REPEATED_RETURN') OR
             returned_current.current_match_event_id IS DISTINCT FROM match_event.id OR
             returned_current.current_outcome NOT IN ('EXACT_MATCH', 'CONFIDENT_MATCH', 'REPEATED_RETURN') OR
             returned_current.handoff_item_id IS DISTINCT FROM hi.id OR
             returned_current.returned_media_asset_version_id IS DISTINCT FROM hic.latest_returned_version_id
           )::integer,
           count(DISTINCT hic.latest_returned_version_id)::integer
      INTO v_item_count, v_invalid_count, v_distinct_version_count
      FROM medialab_core.editor_handoff_items hi
      JOIN medialab_core.editor_handoff_item_current hic ON hic.handoff_item_id = hi.id
      LEFT JOIN medialab_core.returned_media_match_events match_event ON match_event.id = hic.latest_match_event_id
      LEFT JOIN medialab_core.returned_media_item_current returned_current
        ON returned_current.returned_item_id = match_event.returned_item_id
       AND returned_current.current_match_event_id = match_event.id
     WHERE hi.handoff_batch_id = v_handoff.id;
    IF v_item_count = 0 OR v_item_count <> v_handoff_current.item_count OR v_invalid_count <> 0 OR
       v_distinct_version_count <> v_item_count OR EXISTS (
         SELECT 1 FROM medialab_core.returned_media_item_current ric
          WHERE ric.handoff_batch_id = v_handoff.id
            AND ric.current_outcome IN ('AMBIGUOUS', 'UNMATCHED', 'CONFLICTING')
       ) THEN
      RAISE EXCEPTION 'Returned-media evidence is unresolved, ambiguous, duplicated, or missing an exact latest version'
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer INTO v_active_count
      FROM medialab_core.returned_review_batches rb
      JOIN medialab_core.returned_review_batch_current rbc ON rbc.review_batch_id = rb.id
     WHERE rb.job_id = v_job.id AND rb.lane = p_lane AND rbc.current_state IN ('DRAFT', 'SEALED');
    IF v_active_count > 1 THEN
      RAISE EXCEPTION 'Multiple active editor reviews make the exact Job and lane ambiguous' USING ERRCODE = '22023';
    ELSIF v_active_count = 1 THEN
      SELECT rb.* INTO v_review
        FROM medialab_core.returned_review_batches rb
        JOIN medialab_core.returned_review_batch_current rbc ON rbc.review_batch_id = rb.id
       WHERE rb.job_id = v_job.id AND rb.lane = p_lane AND rbc.current_state IN ('DRAFT', 'SEALED')
       ORDER BY rb.created_at, rb.id LIMIT 1;
      SELECT * INTO v_review_current FROM medialab_core.returned_review_batch_current
       WHERE review_batch_id = v_review.id FOR UPDATE;
      IF v_review.editor_handoff_batch_id <> v_handoff.id OR v_review_current.current_state <> 'SEALED' OR
         v_review_current.item_count <> v_item_count OR EXISTS (
           SELECT 1 FROM medialab_core.returned_review_items ri
            WHERE ri.review_batch_id = v_review.id AND NOT EXISTS (
              SELECT 1 FROM medialab_core.editor_handoff_item_current hic
               WHERE hic.handoff_batch_id = v_handoff.id
                 AND hic.latest_returned_version_id = ri.review_media_asset_version_id
            )
         ) OR EXISTS (
           SELECT 1 FROM medialab_core.editor_handoff_item_current hic
            WHERE hic.handoff_batch_id = v_handoff.id AND NOT EXISTS (
              SELECT 1 FROM medialab_core.returned_review_items ri
               WHERE ri.review_batch_id = v_review.id
                 AND ri.review_media_asset_version_id = hic.latest_returned_version_id
            )
         ) THEN
        RAISE EXCEPTION 'An active editor review conflicts with the exact latest returned-media inventory'
          USING ERRCODE = '22023';
      END IF;
      v_result := jsonb_build_object(
        'reviewBatchId', v_review.id,
        'lane', v_review.lane,
        'itemCount', v_review_current.item_count,
        'lifecycleGeneration', v_review_current.lifecycle_generation,
        'replayed', true
      );
      PERFORM medialab_core.record_media_idempotency(
        v_actor, 'START_OPERATIONS_EDITOR_REVIEW', p_idempotency_key, v_hash, v_result
      );
      RETURN v_result;
    END IF;

    SELECT coalesce(max(rb.review_cycle_number), 0) + 1 INTO v_cycle
      FROM medialab_core.returned_review_batches rb
     WHERE rb.editor_handoff_batch_id = v_handoff.id;
    v_review.id := medialab_core.create_returned_review_batch(
      p_session_token, 'm22a-start-review-batch-' || v_handoff.id::text, v_handoff.id, v_cycle,
      'Operations Editor Review started from completed returned-media evidence',
      jsonb_build_object('source', 'OPERATIONS_EDITOR_REVIEW_WEB', 'orderId', v_order.id, 'lane', p_lane)
    );
    FOR v_item IN
      SELECT hi.ordinal, hic.latest_returned_version_id AS version_id
        FROM medialab_core.editor_handoff_items hi
        JOIN medialab_core.editor_handoff_item_current hic ON hic.handoff_item_id = hi.id
       WHERE hi.handoff_batch_id = v_handoff.id
       ORDER BY hi.ordinal, hi.id
    LOOP
      PERFORM medialab_core.admit_returned_review_item(
        p_session_token,
        'm22a-start-review-item-' || v_handoff.id::text || '-' || v_item.ordinal::text,
        v_review.id,
        v_item.version_id,
        v_expected_generation,
        jsonb_build_object('source', 'OPERATIONS_EDITOR_REVIEW_WEB', 'handoffOrdinal', v_item.ordinal)
      );
      v_expected_generation := v_expected_generation + 1;
    END LOOP;
    PERFORM medialab_core.seal_returned_review_inventory(
      p_session_token, 'm22a-start-review-seal-' || v_handoff.id::text, v_review.id,
      v_expected_generation, 'Operations Editor Review inventory sealed from exact returned-media evidence'
    );
    v_result := jsonb_build_object(
      'reviewBatchId', v_review.id,
      'lane', p_lane,
      'itemCount', v_item_count,
      'lifecycleGeneration', v_expected_generation + 1,
      'replayed', false
    );
    PERFORM medialab_core.record_media_idempotency(
      v_actor, 'START_OPERATIONS_EDITOR_REVIEW', p_idempotency_key, v_hash, v_result
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_operations_review_attention(p_session_token text)
RETURNS SETOF jsonb AS $$
DECLARE v_actor uuid; v_actor_person uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id INTO v_actor, v_actor_person
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    RETURN QUERY
    SELECT jsonb_build_object(
      'orderId', j.order_id,
      'jobId', j.id,
      'actions', medialab_core.operations_review_actions(j.id)
    )
      FROM medialab_core.jobs j
     WHERE EXISTS (
       SELECT 1 FROM medialab_core.memberships m
        WHERE m.organization_id = j.organization_id AND m.person_id = v_actor_person AND m.status = 'ACTIVE'
     )
       AND medialab_core.actor_has_permission(v_actor, j.organization_id, 'order.read')
       AND medialab_core.actor_has_permission(v_actor, j.organization_id, 'media_editor_handoff.read')
       AND medialab_core.actor_has_permission(v_actor, j.organization_id, 'media_return_review.read')
       AND medialab_core.actor_has_permission(v_actor, j.organization_id, 'media_asset.read')
       AND jsonb_array_length(medialab_core.operations_review_actions(j.id)) > 0
     ORDER BY j.created_at, j.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_operations_review_workspace(
    p_session_token text, p_order_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_order medialab_core.orders%ROWTYPE; v_job medialab_core.jobs%ROWTYPE;
        v_context jsonb; v_active_batch uuid; v_actions jsonb; v_quick_edits jsonb; v_history jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_order FROM medialab_core.orders WHERE id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operations review Order is missing or unavailable' USING ERRCODE = '42501'; END IF;
    IF NOT medialab_core.actor_has_permission(v_actor, v_order.organization_id, 'order.read') THEN
      RAISE EXCEPTION 'Actor lacks active order.read authority for the target organization' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.read');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.read');
    PERFORM medialab_core.require_editor_handoff_permission(v_actor, v_order.organization_id, 'media_editor_handoff.read');
    SELECT * INTO v_job FROM medialab_core.jobs
     WHERE order_id = v_order.id AND organization_id = v_order.organization_id
     ORDER BY (current_state NOT IN ('COMPLETED', 'CANCELLED')) DESC, created_at DESC, id DESC LIMIT 1;
    v_context := medialab_core.get_operations_order_context(p_session_token, p_order_id);
    IF v_job.id IS NULL THEN
      RETURN jsonb_build_object('context', v_context, 'actions', '[]'::jsonb, 'activeReview', NULL,
        'quickEdits', '[]'::jsonb, 'completedHistory', '[]'::jsonb);
    END IF;
    v_actions := medialab_core.operations_review_actions(v_job.id);
    SELECT b.id INTO v_active_batch
      FROM medialab_core.returned_review_batches b
      JOIN medialab_core.returned_review_batch_current c ON c.review_batch_id = b.id
     WHERE b.job_id = v_job.id AND c.current_state IN ('DRAFT', 'SEALED')
     ORDER BY b.created_at, b.id LIMIT 1;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'quickEditRequestId', qr.id,
      'reviewBatchId', b.id,
      'reviewItemId', i.id,
      'lane', b.lane,
      'instructions', qr.instructions,
      'expectedReviewLifecycleGeneration', bc.lifecycle_generation,
      'expectedDecisionGeneration', ic.decision_generation,
      'sourceVersion', medialab_core.operations_review_version_summary(qr.source_media_asset_version_id),
      'uploadState', coalesce(uc.current_state, 'AWAITING_UPLOAD'),
      'uploadMessage', CASE WHEN ui.id IS NULL THEN 'Choose Upload revision to continue this Quick Edit.'
                            ELSE 'The interrupted revision upload is ready to resume.' END,
      'downloadAvailable', (
        SELECT count(*) = 1 FROM medialab_core.media_storage_objects s
         JOIN medialab_core.media_asset_versions v ON v.id = s.version_id
        WHERE s.version_id = qr.source_media_asset_version_id AND s.provider = 'LOCAL_FIXTURE'
          AND s.checksum_sha256 = v.checksum_sha256 AND s.byte_size = v.byte_size
          AND s.media_type = v.media_type AND s.media_type IN ('image/jpeg', 'image/png')
      ) AND EXISTS (
        SELECT 1 FROM medialab_core.media_verification_events verification
         JOIN medialab_core.media_asset_versions v ON v.id = verification.version_id
        WHERE verification.version_id = qr.source_media_asset_version_id
          AND verification.verification_state = 'VERIFIED'
          AND verification.observed_checksum_sha256 = v.checksum_sha256
      ),
      'correctedVersionId', uc.corrected_media_asset_version_id,
      'successorReviewBatchId', uc.successor_review_batch_id
    ) ORDER BY qr.requested_at, qr.id), '[]'::jsonb) INTO v_quick_edits
      FROM medialab_core.returned_quick_edit_requests qr
      JOIN medialab_core.returned_review_items i ON i.id = qr.review_item_id
      JOIN medialab_core.returned_review_item_current ic ON ic.review_item_id = i.id
      JOIN medialab_core.returned_review_batches b ON b.id = i.review_batch_id
      JOIN medialab_core.returned_review_batch_current bc ON bc.review_batch_id = b.id
      LEFT JOIN medialab_core.operations_quick_edit_upload_intents ui ON ui.quick_edit_request_id = qr.id
      LEFT JOIN medialab_core.operations_quick_edit_upload_current uc ON uc.upload_intent_id = ui.id
     WHERE b.job_id = v_job.id AND bc.current_state = 'COMPLETED'
       AND ic.current_decision_id = qr.review_decision_id AND ic.current_disposition = 'QUICK_EDIT'
       AND NOT EXISTS (
         SELECT 1 FROM medialab_core.returned_quick_edit_version_links ql
          WHERE ql.quick_edit_request_id = qr.id
       );
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'reviewBatchId', b.id,
      'lane', b.lane,
      'reviewCycleNumber', b.review_cycle_number,
      'completedAt', e.recorded_at,
      'itemCount', c.item_count,
      'finalSourceCount', c.final_source_count,
      'revisionRoutedCount', c.revision_routed_count,
      'quickEditRoutedCount', c.quick_edit_routed_count,
      'decisions', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'reviewItemId', d.review_item_id,
          'disposition', d.disposition,
          'reason', d.reason,
          'instructions', d.instructions,
          'decidedAt', d.decided_at
        ) ORDER BY d.decided_at, d.id)
          FROM medialab_core.returned_review_decisions d WHERE d.review_batch_id = b.id
      ), '[]'::jsonb)
    ) ORDER BY e.recorded_at DESC, b.id DESC), '[]'::jsonb) INTO v_history
      FROM medialab_core.returned_review_batches b
      JOIN medialab_core.returned_review_batch_current c ON c.review_batch_id = b.id
      JOIN LATERAL (
        SELECT x.recorded_at FROM medialab_core.returned_review_batch_events x
         WHERE x.review_batch_id = b.id AND x.event_type = 'COMPLETED'
         ORDER BY x.recorded_at DESC, x.id DESC LIMIT 1
      ) e ON true
     WHERE b.job_id = v_job.id AND c.current_state = 'COMPLETED';
    RETURN jsonb_build_object(
      'context', v_context,
      'actions', v_actions,
      'activeReview', CASE WHEN v_active_batch IS NULL THEN NULL
                           ELSE medialab_core.operations_review_batch_workspace(v_active_batch) END,
      'quickEdits', v_quick_edits,
      'completedHistory', v_history
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.submit_operations_editor_review(
    p_session_token text, p_idempotency_key text, p_order_id uuid,
    p_review_batch_id uuid, p_expected_lifecycle_generation bigint, p_decisions jsonb
)
RETURNS jsonb AS $$
DECLARE
    v_actor uuid;
    v_order medialab_core.orders%ROWTYPE;
    v_batch medialab_core.returned_review_batches%ROWTYPE;
    v_batch_current medialab_core.returned_review_batch_current%ROWTYPE;
    v_decision jsonb;
    v_item_id uuid;
    v_disposition text;
    v_instructions text;
    v_expected_generation bigint;
    v_expected_current_decision_id uuid;
    v_actual_generation bigint;
    v_actual_current_decision_id uuid;
    v_decision_id uuid;
    v_completion_event_id uuid;
    v_decision_count integer;
    v_unique_item_count integer;
    v_batch_item_count integer;
    v_canonical_decisions jsonb;
    v_request_hash text;
    v_replay jsonb;
    v_decision_results jsonb := '[]'::jsonb;
    v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_order FROM medialab_core.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Operations review Order is missing or unavailable' USING ERRCODE = '42501';
    END IF;
    IF NOT medialab_core.actor_has_permission(v_actor, v_order.organization_id, 'order.read') THEN
      RAISE EXCEPTION 'Actor lacks active order.read authority for the target organization'
        USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(
      v_actor, v_order.organization_id, 'media_return_review.manage'
    );
    SELECT b.* INTO v_batch
      FROM medialab_core.returned_review_batches b
      JOIN medialab_core.jobs j
        ON j.id = b.job_id AND j.organization_id = b.organization_id
     WHERE b.id = p_review_batch_id
       AND b.organization_id = v_order.organization_id
       AND j.order_id = v_order.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Editor review batch is cross-tenant, cross-Job, or unavailable'
        USING ERRCODE = '42501';
    END IF;
    IF p_decisions IS NULL OR jsonb_typeof(p_decisions) <> 'array' OR
       jsonb_array_length(p_decisions) = 0 OR jsonb_array_length(p_decisions) > 500 THEN
      RAISE EXCEPTION 'Whole-review submission requires a bounded nonempty decision array'
        USING ERRCODE = '22023';
    END IF;
    FOR v_decision IN SELECT value FROM jsonb_array_elements(p_decisions)
    LOOP
      IF jsonb_typeof(v_decision) <> 'object' OR
         NOT (v_decision ?& ARRAY[
           'reviewItemId','disposition','expectedGeneration','currentDecisionId'
         ]) OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(v_decision) AS keys(field_name)
            WHERE field_name NOT IN (
              'reviewItemId','disposition','instructions','expectedGeneration','currentDecisionId'
            )
         ) THEN
        RAISE EXCEPTION 'Each whole-review decision must contain only the exact bounded decision fields'
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_decision->'reviewItemId') <> 'string' OR
         jsonb_typeof(v_decision->'disposition') <> 'string' OR
         jsonb_typeof(v_decision->'expectedGeneration') <> 'number' OR
         (v_decision->>'expectedGeneration') !~ '^[0-9]+$' OR
         jsonb_typeof(v_decision->'currentDecisionId') NOT IN ('string','null') OR
         ((v_decision ? 'instructions') AND
          jsonb_typeof(v_decision->'instructions') NOT IN ('string','null')) THEN
        RAISE EXCEPTION 'Whole-review decision field types are invalid' USING ERRCODE = '22023';
      END IF;
      v_item_id := (v_decision->>'reviewItemId')::uuid;
      v_disposition := v_decision->>'disposition';
      v_expected_generation := (v_decision->>'expectedGeneration')::bigint;
      v_expected_current_decision_id := CASE
        WHEN jsonb_typeof(v_decision->'currentDecisionId') = 'null' THEN NULL
        ELSE (v_decision->>'currentDecisionId')::uuid
      END;
      v_instructions := CASE
        WHEN NOT (v_decision ? 'instructions') OR jsonb_typeof(v_decision->'instructions') = 'null' THEN NULL
        ELSE v_decision->>'instructions'
      END;
      IF v_disposition NOT IN ('ACCEPT','REJECT_REVISION','QUICK_EDIT') THEN
        RAISE EXCEPTION 'Whole-review submission supports only Accept, Send back, or Quick Edit'
          USING ERRCODE = '22023';
      END IF;
      IF v_disposition = 'ACCEPT' AND v_instructions IS NOT NULL THEN
        RAISE EXCEPTION 'Only Send back and Quick Edit may carry an optional review note'
          USING ERRCODE = '22023';
      END IF;
      PERFORM medialab_core.validate_returned_review_text(v_instructions, false, 2000);
    END LOOP;

    SELECT jsonb_agg(jsonb_build_object(
      'reviewItemId', (value->>'reviewItemId')::uuid,
      'disposition', value->>'disposition',
      'instructions', CASE
        WHEN NOT (value ? 'instructions') OR jsonb_typeof(value->'instructions') = 'null' THEN NULL
        ELSE value->>'instructions'
      END,
      'expectedGeneration', (value->>'expectedGeneration')::bigint,
      'currentDecisionId', CASE
        WHEN jsonb_typeof(value->'currentDecisionId') = 'null' THEN NULL
        ELSE (value->>'currentDecisionId')::uuid
      END
    ) ORDER BY (value->>'reviewItemId')::uuid) INTO v_canonical_decisions
      FROM jsonb_array_elements(p_decisions);
    v_request_hash := encode(sha256(convert_to(jsonb_build_array(
      p_order_id, p_review_batch_id, p_expected_lifecycle_generation, v_canonical_decisions
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(
      v_actor, 'SUBMIT_OPERATIONS_EDITOR_REVIEW', p_idempotency_key, v_request_hash
    );
    IF v_replay IS NOT NULL THEN
      RETURN jsonb_set(v_replay, '{replayed}', 'true'::jsonb, true);
    END IF;

    SELECT * INTO v_batch_current
      FROM medialab_core.returned_review_batch_current
     WHERE review_batch_id = v_batch.id FOR UPDATE;
    IF p_expected_lifecycle_generation IS NULL OR
       v_batch_current.lifecycle_generation IS DISTINCT FROM p_expected_lifecycle_generation THEN
      RAISE EXCEPTION 'Stale review batch generation' USING ERRCODE = '40001';
    END IF;
    IF v_batch_current.current_state <> 'SEALED' THEN
      RAISE EXCEPTION 'Whole-review submission requires a sealed incomplete review batch'
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer,
           count(DISTINCT (value->>'reviewItemId')::uuid)::integer
      INTO v_decision_count, v_unique_item_count
      FROM jsonb_array_elements(v_canonical_decisions);
    SELECT count(*)::integer INTO v_batch_item_count
      FROM medialab_core.returned_review_items WHERE review_batch_id = v_batch.id;
    IF v_batch_item_count = 0 OR v_batch_item_count <> v_batch_current.item_count OR
       v_decision_count <> v_batch_item_count OR v_unique_item_count <> v_decision_count THEN
      RAISE EXCEPTION 'Whole-review submission must contain every exact review item once'
        USING ERRCODE = '22023';
    END IF;

    FOR v_decision IN
      SELECT value FROM jsonb_array_elements(v_canonical_decisions)
       ORDER BY (value->>'reviewItemId')::uuid
    LOOP
      v_item_id := (v_decision->>'reviewItemId')::uuid;
      v_expected_generation := (v_decision->>'expectedGeneration')::bigint;
      v_expected_current_decision_id := CASE
        WHEN jsonb_typeof(v_decision->'currentDecisionId') = 'null' THEN NULL
        ELSE (v_decision->>'currentDecisionId')::uuid
      END;
      SELECT ic.decision_generation, ic.current_decision_id
        INTO v_actual_generation, v_actual_current_decision_id
        FROM medialab_core.returned_review_items i
        JOIN medialab_core.returned_review_item_current ic ON ic.review_item_id = i.id
       WHERE i.review_batch_id = v_batch.id AND i.id = v_item_id
       FOR UPDATE OF ic;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Whole-review decision contains an extra or unavailable review item'
          USING ERRCODE = '42501';
      END IF;
      IF v_actual_generation <> v_expected_generation OR
         v_actual_current_decision_id IS DISTINCT FROM v_expected_current_decision_id THEN
        RAISE EXCEPTION 'Stale review-item decision generation or decision identity'
          USING ERRCODE = '40001';
      END IF;
    END LOOP;

    -- Serialize any final-designation head chosen by this command with another
    -- accepted review batch that could contain the same immutable asset.
    PERFORM 1
      FROM medialab_core.media_assets asset
     WHERE asset.id IN (
       SELECT item.media_asset_id
         FROM medialab_core.returned_review_items item
        WHERE item.review_batch_id = v_batch.id
     )
     ORDER BY asset.id
     FOR UPDATE;

    FOR v_decision IN
      SELECT value FROM jsonb_array_elements(v_canonical_decisions)
       ORDER BY (value->>'reviewItemId')::uuid
    LOOP
      v_item_id := (v_decision->>'reviewItemId')::uuid;
      v_disposition := v_decision->>'disposition';
      v_expected_generation := (v_decision->>'expectedGeneration')::bigint;
      v_expected_current_decision_id := CASE
        WHEN jsonb_typeof(v_decision->'currentDecisionId') = 'null' THEN NULL
        ELSE (v_decision->>'currentDecisionId')::uuid
      END;
      v_instructions := CASE
        WHEN NOT (v_decision ? 'instructions') OR jsonb_typeof(v_decision->'instructions') = 'null' THEN NULL
        ELSE v_decision->>'instructions'
      END;
      v_decision_id := medialab_core.apply_returned_review_decision(
        v_actor, v_item_id, v_disposition, NULL, v_instructions,
        v_expected_current_decision_id
      );
      v_decision_results := v_decision_results || jsonb_build_array(jsonb_build_object(
        'reviewItemId', v_item_id,
        'decisionId', v_decision_id
      ));
    END LOOP;

    SELECT * INTO v_batch_current
      FROM medialab_core.returned_review_batch_current
     WHERE review_batch_id = v_batch.id;
    IF v_batch_current.current_state <> 'SEALED' OR v_batch_current.item_count = 0 OR
       v_batch_current.unresolved_count <> 0 THEN
      RAISE EXCEPTION 'Every sealed review item requires an explicit resolving disposition'
        USING ERRCODE = '22023';
    END IF;
    v_completion_event_id := gen_random_uuid();
    INSERT INTO medialab_core.returned_review_batch_events(
      id, review_batch_id, organization_id, job_id, event_type, reason,
      evidence, recorded_by_identity_id
    ) VALUES (
      v_completion_event_id, v_batch.id, v_batch.organization_id, v_batch.job_id,
      'COMPLETED', 'System evidence: returned review completed with every item resolved.',
      jsonb_build_object(
        'item_count', v_batch_current.item_count,
        'final_source_count', v_batch_current.final_source_count,
        'revision_routed_count', v_batch_current.revision_routed_count,
        'quick_edit_routed_count', v_batch_current.quick_edit_routed_count
      ),
      v_actor
    );
    UPDATE medialab_core.returned_review_batch_current
       SET current_state = 'COMPLETED',
           lifecycle_generation = lifecycle_generation + 1,
           updated_at = clock_timestamp()
     WHERE review_batch_id = v_batch.id;
    v_result := jsonb_build_object(
      'orderId', v_order.id,
      'reviewBatchId', v_batch.id,
      'completedEventId', v_completion_event_id,
      'decisions', v_decision_results,
      'replayed', false
    );
    PERFORM medialab_core.record_media_idempotency(
      v_actor, 'SUBMIT_OPERATIONS_EDITOR_REVIEW', p_idempotency_key, v_request_hash, v_result
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.resolve_operations_review_media_source(
    p_session_token text, p_order_id uuid, p_review_batch_id uuid, p_review_item_id uuid, p_purpose text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_order medialab_core.orders%ROWTYPE; v_batch medialab_core.returned_review_batches%ROWTYPE;
        v_item medialab_core.returned_review_items%ROWTYPE; v_item_current medialab_core.returned_review_item_current%ROWTYPE;
        v_batch_current medialab_core.returned_review_batch_current%ROWTYPE; v_version medialab_core.media_asset_versions%ROWTYPE;
        v_storage medialab_core.media_storage_objects%ROWTYPE; v_storage_count integer;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_order FROM medialab_core.orders WHERE id = p_order_id;
    SELECT * INTO v_batch FROM medialab_core.returned_review_batches WHERE id = p_review_batch_id;
    SELECT * INTO v_item FROM medialab_core.returned_review_items WHERE id = p_review_item_id;
    IF v_order.id IS NULL OR v_batch.id IS NULL OR v_item.id IS NULL OR
       v_batch.organization_id <> v_order.organization_id OR v_batch.job_id IS DISTINCT FROM (
         SELECT j.id FROM medialab_core.jobs j WHERE j.id = v_batch.job_id AND j.order_id = v_order.id
       ) OR v_item.review_batch_id <> v_batch.id THEN
      RAISE EXCEPTION 'Review media source scope is cross-tenant, cross-Job, or unavailable' USING ERRCODE = '42501';
    END IF;
    IF NOT medialab_core.actor_has_permission(v_actor, v_order.organization_id, 'order.read') THEN
      RAISE EXCEPTION 'Actor lacks active order.read authority for the target organization' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.read');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.read');
    PERFORM medialab_core.require_editor_handoff_permission(v_actor, v_order.organization_id, 'media_editor_handoff.read');
    IF p_purpose NOT IN ('REVIEW_PREVIEW', 'QUICK_EDIT_DOWNLOAD') THEN
      RAISE EXCEPTION 'Unsupported operations review media purpose' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_item_current FROM medialab_core.returned_review_item_current WHERE review_item_id = v_item.id;
    SELECT * INTO v_batch_current FROM medialab_core.returned_review_batch_current WHERE review_batch_id = v_batch.id;
    IF p_purpose = 'REVIEW_PREVIEW' AND v_batch_current.current_state NOT IN ('DRAFT', 'SEALED') THEN
      RAISE EXCEPTION 'Review preview is available only for an active draft or sealed review'
        USING ERRCODE = '22023';
    END IF;
    IF p_purpose = 'QUICK_EDIT_DOWNLOAD' AND (
      v_batch_current.current_state <> 'COMPLETED' OR v_item_current.current_disposition <> 'QUICK_EDIT' OR
      NOT EXISTS (
        SELECT 1 FROM medialab_core.returned_quick_edit_requests qr
         WHERE qr.review_item_id = v_item.id AND qr.review_decision_id = v_item_current.current_decision_id
           AND NOT EXISTS (SELECT 1 FROM medialab_core.returned_quick_edit_version_links ql
                            WHERE ql.quick_edit_request_id = qr.id)
      )
    ) THEN RAISE EXCEPTION 'Quick Edit working source is not currently actionable' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_version FROM medialab_core.media_asset_versions WHERE id = v_item.review_media_asset_version_id;
    IF NOT EXISTS (
      SELECT 1 FROM medialab_core.media_verification_events verification
       WHERE verification.version_id = v_version.id
         AND verification.verification_state = 'VERIFIED'
         AND verification.observed_checksum_sha256 = v_version.checksum_sha256
    ) THEN
      RAISE EXCEPTION 'Verified review media checksum evidence is unavailable' USING ERRCODE = '42501';
    END IF;
    SELECT count(*)::integer INTO v_storage_count FROM medialab_core.media_storage_objects s
     WHERE s.version_id = v_version.id AND s.provider = 'LOCAL_FIXTURE'
       AND s.checksum_sha256 = v_version.checksum_sha256 AND s.byte_size = v_version.byte_size
       AND s.media_type = v_version.media_type AND s.media_type IN ('image/jpeg', 'image/png');
    IF v_storage_count = 0 THEN
      RAISE EXCEPTION 'Verified local review media is unavailable' USING ERRCODE = '42501';
    ELSIF v_storage_count <> 1 THEN
      RAISE EXCEPTION 'Verified local review media storage identity is ambiguous' USING ERRCODE = '22023';
    END IF;
    SELECT s.* INTO v_storage FROM medialab_core.media_storage_objects s
     WHERE s.version_id = v_version.id AND s.provider = 'LOCAL_FIXTURE'
       AND s.checksum_sha256 = v_version.checksum_sha256 AND s.byte_size = v_version.byte_size
       AND s.media_type = v_version.media_type AND s.media_type IN ('image/jpeg', 'image/png')
     ORDER BY s.recorded_at DESC, s.id DESC;
    RETURN jsonb_build_object(
      'object_identifier', v_storage.provider_object_identifier,
      'filename', v_version.observed_filename,
      'byte_size', v_version.byte_size,
      'checksum_sha256', v_version.checksum_sha256,
      'media_type', v_version.media_type
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_operations_quick_edit_upload_intent(
    p_session_token text, p_idempotency_key text, p_order_id uuid, p_review_batch_id uuid,
    p_review_item_id uuid, p_quick_edit_request_id uuid, p_expected_review_lifecycle_generation bigint,
    p_expected_decision_generation bigint
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_order medialab_core.orders%ROWTYPE; v_batch medialab_core.returned_review_batches%ROWTYPE;
        v_item medialab_core.returned_review_items%ROWTYPE; v_request medialab_core.returned_quick_edit_requests%ROWTYPE;
        v_batch_current medialab_core.returned_review_batch_current%ROWTYPE;
        v_item_current medialab_core.returned_review_item_current%ROWTYPE;
        v_intent medialab_core.operations_quick_edit_upload_intents%ROWTYPE;
        v_current medialab_core.operations_quick_edit_upload_current%ROWTYPE;
        v_hash text; v_replay jsonb; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_order FROM medialab_core.orders WHERE id = p_order_id;
    SELECT * INTO v_batch FROM medialab_core.returned_review_batches WHERE id = p_review_batch_id;
    SELECT * INTO v_item FROM medialab_core.returned_review_items WHERE id = p_review_item_id;
    SELECT * INTO v_request FROM medialab_core.returned_quick_edit_requests WHERE id = p_quick_edit_request_id;
    IF v_order.id IS NULL OR v_batch.id IS NULL OR v_item.id IS NULL OR v_request.id IS NULL OR
       v_batch.organization_id <> v_order.organization_id OR v_item.review_batch_id <> v_batch.id OR
       v_request.review_item_id <> v_item.id OR v_request.organization_id <> v_order.organization_id OR
       NOT EXISTS (SELECT 1 FROM medialab_core.jobs j WHERE j.id = v_batch.job_id
                    AND j.organization_id = v_order.organization_id AND j.order_id = v_order.id) THEN
      RAISE EXCEPTION 'Quick Edit upload intent scope is cross-tenant, cross-Job, or unavailable' USING ERRCODE = '42501';
    END IF;
    IF NOT medialab_core.actor_has_permission(v_actor, v_order.organization_id, 'order.read') THEN
      RAISE EXCEPTION 'Actor lacks active order.read authority for the target organization' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.read');
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.manage');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.read');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.manage');
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_order_id, p_review_batch_id, p_review_item_id,
      p_quick_edit_request_id, p_expected_review_lifecycle_generation, p_expected_decision_generation)::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'CREATE_OPERATIONS_QUICK_EDIT_UPLOAD_INTENT', p_idempotency_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN jsonb_set(v_replay, '{replayed}', 'true'::jsonb, true); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('M22A:QUICK_EDIT_REQUEST:' || v_request.id::text, 0));
    SELECT * INTO v_batch_current FROM medialab_core.returned_review_batch_current
     WHERE review_batch_id = v_batch.id FOR UPDATE;
    SELECT * INTO v_item_current FROM medialab_core.returned_review_item_current
     WHERE review_item_id = v_item.id FOR UPDATE;
    IF v_batch_current.current_state <> 'COMPLETED' OR
       v_batch_current.lifecycle_generation <> p_expected_review_lifecycle_generation THEN
      RAISE EXCEPTION 'Stale or incomplete Quick Edit parent review generation' USING ERRCODE = '40001';
    END IF;
    IF v_item_current.decision_generation <> p_expected_decision_generation OR
       v_item_current.current_decision_id <> v_request.review_decision_id OR
       v_item_current.current_disposition <> 'QUICK_EDIT' THEN
      RAISE EXCEPTION 'Stale or inactive Quick Edit decision generation' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO v_intent FROM medialab_core.operations_quick_edit_upload_intents
     WHERE quick_edit_request_id = v_request.id FOR UPDATE;
    IF v_intent.id IS NOT NULL THEN
      SELECT * INTO v_current FROM medialab_core.operations_quick_edit_upload_current
       WHERE upload_intent_id = v_intent.id FOR UPDATE;
      v_result := jsonb_build_object(
        'uploadIntentId', v_intent.id, 'requestId', v_request.id, 'state', v_current.current_state,
        'generation', v_current.lifecycle_generation, 'replayed', true
      );
      PERFORM medialab_core.record_media_idempotency(v_actor, 'CREATE_OPERATIONS_QUICK_EDIT_UPLOAD_INTENT',
        p_idempotency_key, v_hash, v_result);
      RETURN v_result;
    END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.returned_quick_edit_version_links ql
                WHERE ql.quick_edit_request_id = v_request.id) THEN
      RAISE EXCEPTION 'Quick Edit request already has a corrected version' USING ERRCODE = '22023';
    END IF;
    v_intent.id := gen_random_uuid();
    INSERT INTO medialab_core.operations_quick_edit_upload_intents(
      id, organization_id, job_id, order_id, review_batch_id, review_item_id, quick_edit_request_id,
      source_media_asset_version_id, created_by_identity_id
    ) VALUES (
      v_intent.id, v_order.organization_id, v_batch.job_id, v_order.id, v_batch.id, v_item.id, v_request.id,
      v_request.source_media_asset_version_id, v_actor
    );
    INSERT INTO medialab_core.operations_quick_edit_upload_events(
      id, upload_intent_id, organization_id, job_id, order_id, event_type, lifecycle_generation,
      reason, evidence, recorded_by_identity_id
    ) VALUES (
      gen_random_uuid(), v_intent.id, v_order.organization_id, v_batch.job_id, v_order.id, 'INTENT_CREATED', 0,
      'Explicit mobile Quick Edit upload intent', jsonb_build_object('quickEditRequestId', v_request.id), v_actor
    );
    INSERT INTO medialab_core.operations_quick_edit_upload_current(upload_intent_id) VALUES(v_intent.id);
    v_result := jsonb_build_object(
      'uploadIntentId', v_intent.id, 'requestId', v_request.id, 'state', 'AWAITING_UPLOAD',
      'generation', 0, 'replayed', false
    );
    PERFORM medialab_core.record_media_idempotency(v_actor, 'CREATE_OPERATIONS_QUICK_EDIT_UPLOAD_INTENT',
      p_idempotency_key, v_hash, v_result);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_operations_quick_edit_upload_intent(
    p_session_token text, p_order_id uuid, p_upload_intent_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_intent medialab_core.operations_quick_edit_upload_intents%ROWTYPE;
        v_current medialab_core.operations_quick_edit_upload_current%ROWTYPE;
        v_match_count integer; v_corrected_checksum text; v_registered_object_identifier text;
        v_review_generation bigint; v_decision_generation bigint;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT count(*)::integer INTO v_match_count
      FROM medialab_core.operations_quick_edit_upload_intents
     WHERE order_id = p_order_id
       AND (id = p_upload_intent_id OR quick_edit_request_id = p_upload_intent_id);
    IF v_match_count = 0 THEN
      RAISE EXCEPTION 'Quick Edit upload intent is missing or unavailable' USING ERRCODE = '42501';
    ELSIF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Quick Edit upload intent lookup is ambiguous' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_intent FROM medialab_core.operations_quick_edit_upload_intents
     WHERE order_id = p_order_id
       AND (id = p_upload_intent_id OR quick_edit_request_id = p_upload_intent_id);
    IF NOT medialab_core.actor_has_permission(v_actor, v_intent.organization_id, 'order.read') THEN
      RAISE EXCEPTION 'Actor lacks active order.read authority for the target organization' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_intent.organization_id, 'media_return_review.read');
    PERFORM medialab_core.require_media_permission(v_actor, v_intent.organization_id, 'media_asset.read');
    SELECT * INTO v_current FROM medialab_core.operations_quick_edit_upload_current
     WHERE upload_intent_id = v_intent.id;
    SELECT lifecycle_generation INTO v_review_generation
      FROM medialab_core.returned_review_batch_current WHERE review_batch_id = v_intent.review_batch_id;
    SELECT decision_generation INTO v_decision_generation
      FROM medialab_core.returned_review_item_current WHERE review_item_id = v_intent.review_item_id;
    IF v_current.corrected_media_asset_version_id IS NOT NULL THEN
      SELECT checksum_sha256 INTO v_corrected_checksum FROM medialab_core.media_asset_versions
       WHERE id = v_current.corrected_media_asset_version_id;
    END IF;
    IF v_current.storage_object_id IS NOT NULL THEN
      SELECT provider_object_identifier INTO v_registered_object_identifier
        FROM medialab_core.media_storage_objects WHERE id = v_current.storage_object_id;
    END IF;
    RETURN jsonb_build_object(
      'uploadIntentId', v_intent.id,
      'requestId', v_intent.quick_edit_request_id,
      'reviewBatchId', v_intent.review_batch_id,
      'reviewItemId', v_intent.review_item_id,
      'state', v_current.current_state,
      'generation', v_current.lifecycle_generation,
      'expectedReviewLifecycleGeneration', v_review_generation,
      'expectedDecisionGeneration', v_decision_generation,
      'correctedVersionId', v_current.corrected_media_asset_version_id,
      'correctedChecksumSha256', v_corrected_checksum,
      'registeredObjectIdentifier', v_registered_object_identifier,
      'successorReviewBatchId', v_current.successor_review_batch_id,
      'successorDecisionId', v_current.successor_decision_id,
      'successorCompletionEventId', v_current.successor_completion_event_id,
      'createdAt', v_intent.created_at,
      'updatedAt', v_current.updated_at
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.register_operations_quick_edit_revision(
    p_session_token text, p_idempotency_key text, p_order_id uuid, p_review_batch_id uuid,
    p_review_item_id uuid, p_quick_edit_request_id uuid, p_upload_intent_id uuid,
    p_expected_review_lifecycle_generation bigint, p_expected_decision_generation bigint,
    p_expected_upload_generation bigint, p_observed_filename text, p_byte_size bigint,
    p_media_type text, p_checksum_sha256 text, p_provider_object_identifier text, p_reason text
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_order medialab_core.orders%ROWTYPE; v_batch medialab_core.returned_review_batches%ROWTYPE;
        v_item medialab_core.returned_review_items%ROWTYPE; v_request medialab_core.returned_quick_edit_requests%ROWTYPE;
        v_batch_current medialab_core.returned_review_batch_current%ROWTYPE;
        v_item_current medialab_core.returned_review_item_current%ROWTYPE;
        v_intent medialab_core.operations_quick_edit_upload_intents%ROWTYPE;
        v_upload_current medialab_core.operations_quick_edit_upload_current%ROWTYPE;
        v_source medialab_core.media_asset_versions%ROWTYPE; v_request_hash text; v_content_hash text;
        v_replay jsonb; v_result jsonb; v_corrected uuid; v_storage uuid; v_verification uuid;
        v_lineage uuid; v_quick_link uuid; v_successor_batch uuid; v_successor_item uuid;
        v_successor_seal uuid; v_successor_link uuid; v_successor_decision uuid;
        v_successor_completion uuid; v_successor_cycle integer;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_order FROM medialab_core.orders WHERE id = p_order_id;
    SELECT * INTO v_batch FROM medialab_core.returned_review_batches WHERE id = p_review_batch_id;
    SELECT * INTO v_item FROM medialab_core.returned_review_items WHERE id = p_review_item_id;
    SELECT * INTO v_request FROM medialab_core.returned_quick_edit_requests WHERE id = p_quick_edit_request_id;
    SELECT * INTO v_intent FROM medialab_core.operations_quick_edit_upload_intents WHERE id = p_upload_intent_id;
    IF v_order.id IS NULL OR v_batch.id IS NULL OR v_item.id IS NULL OR v_request.id IS NULL OR v_intent.id IS NULL OR
       v_batch.organization_id <> v_order.organization_id OR v_item.review_batch_id <> v_batch.id OR
       v_request.review_item_id <> v_item.id OR v_intent.order_id <> v_order.id OR
       v_intent.review_batch_id <> v_batch.id OR v_intent.review_item_id <> v_item.id OR
       v_intent.quick_edit_request_id <> v_request.id OR
       NOT EXISTS (SELECT 1 FROM medialab_core.jobs j WHERE j.id = v_batch.job_id
                    AND j.organization_id = v_order.organization_id AND j.order_id = v_order.id) THEN
      RAISE EXCEPTION 'Quick Edit revision registration scope is cross-tenant, cross-Job, or unavailable' USING ERRCODE = '42501';
    END IF;
    IF NOT medialab_core.actor_has_permission(v_actor, v_order.organization_id, 'order.read') THEN
      RAISE EXCEPTION 'Actor lacks active order.read authority for the target organization' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.read');
    PERFORM medialab_core.require_returned_review_permission(v_actor, v_order.organization_id, 'media_return_review.manage');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.read');
    PERFORM medialab_core.require_media_permission(v_actor, v_order.organization_id, 'media_asset.manage');
    PERFORM medialab_core.validate_returned_review_text(p_reason, true, 1000);
    IF p_observed_filename IS NULL OR p_observed_filename <> btrim(p_observed_filename) OR
       p_observed_filename = '' OR length(p_observed_filename) > 500 OR
       p_observed_filename ~ '[/\\]' OR p_observed_filename ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Quick Edit revision filename is invalid' USING ERRCODE = '22023';
    END IF;
    IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 104857600 THEN
      RAISE EXCEPTION 'Quick Edit revision byte size is invalid' USING ERRCODE = '22023';
    END IF;
    IF p_media_type NOT IN ('image/jpeg', 'image/png') THEN
      RAISE EXCEPTION 'Quick Edit revision media type is unsupported' USING ERRCODE = '22023';
    END IF;
    IF p_checksum_sha256 IS NULL OR p_checksum_sha256 !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Quick Edit revision checksum is invalid' USING ERRCODE = '22023';
    END IF;
    IF p_provider_object_identifier IS NULL OR p_provider_object_identifier <> btrim(p_provider_object_identifier) OR
       p_provider_object_identifier = '' OR length(p_provider_object_identifier) > 1000 OR
       p_provider_object_identifier ~ '://' OR p_provider_object_identifier ~ '(^/|^[A-Za-z]:[\\/])' OR
       p_provider_object_identifier ~ '(^|/)\.\.?(/|$)' OR p_provider_object_identifier ~ '[[:cntrl:]]' OR
       p_provider_object_identifier !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' THEN
      RAISE EXCEPTION 'Quick Edit revision object identifier is invalid' USING ERRCODE = '22023';
    END IF;
    v_request_hash := encode(sha256(convert_to(jsonb_build_array(
      p_order_id, p_review_batch_id, p_review_item_id, p_quick_edit_request_id, p_upload_intent_id,
      p_expected_review_lifecycle_generation, p_expected_decision_generation, p_expected_upload_generation,
      p_observed_filename, p_byte_size, p_media_type, p_checksum_sha256, p_provider_object_identifier, p_reason
    )::text, 'UTF8')), 'hex');
    v_content_hash := encode(sha256(convert_to(jsonb_build_array(
      p_order_id, p_review_batch_id, p_review_item_id, p_quick_edit_request_id, p_upload_intent_id,
      p_byte_size, p_media_type, p_checksum_sha256
    )::text, 'UTF8')), 'hex');
    v_replay := medialab_core.check_media_idempotency(v_actor, 'REGISTER_OPERATIONS_QUICK_EDIT_REVISION',
      p_idempotency_key, v_request_hash);
    IF v_replay IS NOT NULL THEN RETURN jsonb_set(v_replay, '{replayed}', 'true'::jsonb, true); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('M22A:QUICK_EDIT_REQUEST:' || v_request.id::text, 0));
    SELECT * INTO v_batch_current FROM medialab_core.returned_review_batch_current
     WHERE review_batch_id = v_batch.id FOR UPDATE;
    SELECT * INTO v_item_current FROM medialab_core.returned_review_item_current
     WHERE review_item_id = v_item.id FOR UPDATE;
    SELECT * INTO v_upload_current FROM medialab_core.operations_quick_edit_upload_current
     WHERE upload_intent_id = v_intent.id FOR UPDATE;
    IF v_batch_current.current_state <> 'COMPLETED' OR
       v_batch_current.lifecycle_generation <> p_expected_review_lifecycle_generation THEN
      RAISE EXCEPTION 'Stale or incomplete Quick Edit parent review generation' USING ERRCODE = '40001';
    END IF;
    IF v_item_current.decision_generation <> p_expected_decision_generation OR
       v_item_current.current_decision_id <> v_request.review_decision_id OR
       v_item_current.current_disposition <> 'QUICK_EDIT' THEN
      RAISE EXCEPTION 'Stale or inactive Quick Edit decision generation' USING ERRCODE = '40001';
    END IF;
    IF v_upload_current.current_state = 'FINALIZED' THEN
      IF v_upload_current.registration_content_sha256 <> v_content_hash THEN
        RAISE EXCEPTION 'Quick Edit upload intent conflicts with an already registered correction' USING ERRCODE = '22023';
      END IF;
      v_result := jsonb_set(v_upload_current.registration_result, '{replayed}', 'true'::jsonb, true);
      PERFORM medialab_core.record_media_idempotency(v_actor, 'REGISTER_OPERATIONS_QUICK_EDIT_REVISION',
        p_idempotency_key, v_request_hash, v_result);
      RETURN v_result;
    END IF;
    IF v_upload_current.current_state <> 'AWAITING_UPLOAD' OR
       v_upload_current.lifecycle_generation <> p_expected_upload_generation THEN
      RAISE EXCEPTION 'Stale Quick Edit upload generation' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (SELECT 1 FROM medialab_core.returned_quick_edit_version_links ql
                WHERE ql.quick_edit_request_id = v_request.id) THEN
      RAISE EXCEPTION 'Quick Edit request already has a corrected version' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_source FROM medialab_core.media_asset_versions WHERE id = v_request.source_media_asset_version_id;
    PERFORM 1 FROM medialab_core.media_assets WHERE id = v_source.asset_id FOR UPDATE;
    v_corrected := medialab_core.add_media_asset_version(
      p_session_token, 'm22a-version-' || v_intent.id::text, v_source.asset_id, 'QUICK_EDIT_CORRECTION',
      p_observed_filename, p_byte_size, p_media_type, p_checksum_sha256, 'OPERATIONS_QUICK_EDIT_WEB_UPLOAD'
    );
    v_storage := medialab_core.record_media_storage_object(
      p_session_token, 'm22a-storage-' || v_intent.id::text, v_corrected, 'LOCAL_FIXTURE',
      'M22A_QUICK_EDIT_UPLOAD', p_provider_object_identifier, p_checksum_sha256, p_byte_size, p_media_type,
      'OPERATIONS_QUICK_EDIT_WEB_UPLOAD'
    );
    v_verification := medialab_core.record_media_verification_event(
      p_session_token, 'm22a-verify-' || v_intent.id::text, v_corrected, 'SERVER_STREAM_SHA256', 'VERIFIED',
      p_checksum_sha256, jsonb_build_object('uploadIntentId', v_intent.id, 'channel', 'OPERATIONS_QUICK_EDIT_WEB')
    );
    v_lineage := medialab_core.record_media_lineage(
      p_session_token, 'm22a-lineage-' || v_intent.id::text, v_source.id, v_corrected,
      'EDITOR_RETURN_TO_CORRECTED_VERSION', p_reason
    );
    v_quick_link := medialab_core.associate_quick_edit_corrected_version(
      p_session_token, 'm22a-quick-link-' || v_intent.id::text, v_request.id, v_corrected, p_reason
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('M22A:REVIEW_CYCLE:' || v_batch.editor_handoff_batch_id::text, 0)
    );
    SELECT coalesce(max(review_cycle_number), 0) + 1 INTO v_successor_cycle
      FROM medialab_core.returned_review_batches
     WHERE editor_handoff_batch_id = v_batch.editor_handoff_batch_id;
    v_successor_batch := medialab_core.create_returned_review_batch(
      p_session_token, 'm22a-successor-batch-' || v_intent.id::text, v_batch.editor_handoff_batch_id,
      v_successor_cycle, 'Quick Edit upload finalization evidence',
      jsonb_build_object('source', 'OPERATIONS_QUICK_EDIT_WEB', 'uploadIntentId', v_intent.id,
        'quickEditRequestId', v_request.id)
    );
    v_successor_item := medialab_core.admit_returned_review_item(
      p_session_token, 'm22a-successor-item-' || v_intent.id::text, v_successor_batch, v_corrected, 0,
      jsonb_build_object('source', 'OPERATIONS_QUICK_EDIT_WEB', 'uploadIntentId', v_intent.id)
    );
    v_successor_seal := medialab_core.seal_returned_review_inventory(
      p_session_token, 'm22a-successor-seal-' || v_intent.id::text, v_successor_batch, 1,
      'Exact Quick Edit correction inventory sealed for upload finalization'
    );
    v_successor_link := medialab_core.link_returned_review_successor(
      p_session_token, 'm22a-successor-link-' || v_intent.id::text, v_batch.id, v_successor_batch,
      'Finalized Quick Edit correction linked to its submitted predecessor review'
    );
    v_successor_decision := medialab_core.apply_returned_review_decision(
      v_actor, v_successor_item, 'ACCEPT', NULL, NULL, NULL
    );
    v_successor_completion := medialab_core.complete_returned_review_batch(
      p_session_token, 'm22a-successor-complete-' || v_intent.id::text, v_successor_batch, 2, NULL
    );
    v_result := jsonb_build_object(
      'uploadIntentId', v_intent.id,
      'requestId', v_request.id,
      'correctedVersionId', v_corrected,
      'providerObjectIdentifier', p_provider_object_identifier,
      'storageObjectId', v_storage,
      'verificationEventId', v_verification,
      'lineageId', v_lineage,
      'quickEditLinkId', v_quick_link,
      'successorReviewBatchId', v_successor_batch,
      'successorReviewItemId', v_successor_item,
      'successorSealEventId', v_successor_seal,
      'successorLinkId', v_successor_link,
      'successorDecisionId', v_successor_decision,
      'successorCompletionEventId', v_successor_completion,
      'finalSourceVersionId', v_corrected,
      'replayed', false
    );
    UPDATE medialab_core.operations_quick_edit_upload_current SET
      current_state = 'FINALIZED', lifecycle_generation = 1,
      corrected_media_asset_version_id = v_corrected, storage_object_id = v_storage,
      verification_event_id = v_verification, lineage_id = v_lineage, quick_edit_link_id = v_quick_link,
      successor_review_batch_id = v_successor_batch, successor_review_item_id = v_successor_item,
      successor_seal_event_id = v_successor_seal, successor_link_id = v_successor_link,
      successor_decision_id = v_successor_decision,
      successor_completion_event_id = v_successor_completion,
      registration_content_sha256 = v_content_hash, registration_result = v_result,
      registered_by_identity_id = v_actor, registered_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE upload_intent_id = v_intent.id;
    INSERT INTO medialab_core.operations_quick_edit_upload_events(
      id, upload_intent_id, organization_id, job_id, order_id, event_type, lifecycle_generation,
      reason, evidence, recorded_by_identity_id
    ) VALUES (
      gen_random_uuid(), v_intent.id, v_intent.organization_id, v_intent.job_id, v_intent.order_id,
      'FINALIZED', 1, p_reason,
      jsonb_build_object(
        'correctedVersionId', v_corrected,
        'successorReviewBatchId', v_successor_batch,
        'successorDecisionId', v_successor_decision,
        'successorCompletionEventId', v_successor_completion
      ), v_actor
    );
    PERFORM medialab_core.record_media_idempotency(v_actor, 'REGISTER_OPERATIONS_QUICK_EDIT_REVISION',
      p_idempotency_key, v_request_hash, v_result);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER operations_quick_edit_upload_intents_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.operations_quick_edit_upload_intents
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();
CREATE TRIGGER operations_quick_edit_upload_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.operations_quick_edit_upload_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_media_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.operations_quick_edit_upload_intents FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.operations_quick_edit_upload_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.operations_quick_edit_upload_current FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.operations_review_version_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.operations_review_actions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.operations_review_batch_workspace(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.start_operations_editor_review(text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_operations_review_attention(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_operations_review_workspace(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.submit_operations_editor_review(text,text,uuid,uuid,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.resolve_operations_review_media_source(text,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_operations_quick_edit_upload_intent(text,text,uuid,uuid,uuid,uuid,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_operations_quick_edit_upload_intent(text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.register_operations_quick_edit_revision(text,text,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,bigint,text,text,text,text) FROM PUBLIC;

-- Fresh application follows the centralized 0026 runtime policy. Discover only non-superuser
-- login roles already trusted to execute the exact Operations Console read boundary and grant
-- this packet's public functions. db/migrate.ts also carries the durable rerun allowlist.
DO $grant_runtime$
DECLARE v_role name;
BEGIN
  FOR v_role IN
    SELECT r.rolname
      FROM pg_catalog.pg_roles r
     WHERE r.rolcanlogin AND NOT r.rolsuper AND r.rolname <> current_user
       AND pg_catalog.has_function_privilege(
         r.oid,
         'medialab_core.get_operations_order_context(text,uuid)'::regprocedure,
         'EXECUTE'
       )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.start_operations_editor_review(text,text,uuid,text) TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.list_operations_review_attention(text) TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.get_operations_review_workspace(text,uuid) TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.submit_operations_editor_review(text,text,uuid,uuid,bigint,jsonb) TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.resolve_operations_review_media_source(text,uuid,uuid,uuid,text) TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.create_operations_quick_edit_upload_intent(text,text,uuid,uuid,uuid,uuid,bigint,bigint) TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.get_operations_quick_edit_upload_intent(text,uuid,uuid) TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION medialab_core.register_operations_quick_edit_revision(text,text,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,bigint,text,text,text,text) TO %I', v_role);
  END LOOP;
END;
$grant_runtime$;
