-- P02-M13-A: returned-editor review and final-source decision foundation.
-- Database decision/lineage evidence only: no provider, media-byte, Desktop, publication, or delivery action.

CREATE TABLE medialab_core.returned_review_batches (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    lane text NOT NULL,
    editor_handoff_batch_id uuid NOT NULL,
    review_cycle_number integer NOT NULL,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (job_id, organization_id) REFERENCES medialab_core.jobs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
      REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (editor_handoff_batch_id, organization_id, job_id)
      REFERENCES medialab_core.editor_handoff_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_review_batches_scope_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT returned_review_batches_handoff_cycle_key UNIQUE (editor_handoff_batch_id, review_cycle_number),
    CONSTRAINT returned_review_batches_lane_check CHECK (lane IN ('PHOTO','VIDEO')),
    CONSTRAINT returned_review_batches_cycle_check CHECK (review_cycle_number > 0),
    CONSTRAINT returned_review_batches_context_check CHECK (jsonb_typeof(context)='object')
);

CREATE TABLE medialab_core.returned_review_batch_events (
    id uuid PRIMARY KEY,
    review_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (review_batch_id, organization_id, job_id)
      REFERENCES medialab_core.returned_review_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_review_batch_events_type_check CHECK (event_type IN ('CREATED','INVENTORY_SEALED','COMPLETED')),
    CONSTRAINT returned_review_batch_events_reason_check CHECK (reason=btrim(reason) AND reason<>'' AND length(reason)<=1000),
    CONSTRAINT returned_review_batch_events_evidence_check CHECK (jsonb_typeof(evidence)='object')
);

CREATE TABLE medialab_core.returned_review_batch_current (
    review_batch_id uuid PRIMARY KEY REFERENCES medialab_core.returned_review_batches(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    current_state text NOT NULL DEFAULT 'DRAFT',
    item_count integer NOT NULL DEFAULT 0,
    resolved_count integer NOT NULL DEFAULT 0,
    final_source_count integer NOT NULL DEFAULT 0,
    revision_routed_count integer NOT NULL DEFAULT 0,
    quick_edit_routed_count integer NOT NULL DEFAULT 0,
    unresolved_count integer NOT NULL DEFAULT 0,
    lifecycle_generation bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (review_batch_id, organization_id, job_id)
      REFERENCES medialab_core.returned_review_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_review_batch_current_state_check CHECK (current_state IN ('DRAFT','SEALED','COMPLETED')),
    CONSTRAINT returned_review_batch_current_counts_check CHECK (
      item_count>=0 AND resolved_count>=0 AND final_source_count>=0 AND revision_routed_count>=0 AND
      quick_edit_routed_count>=0 AND unresolved_count>=0 AND resolved_count+unresolved_count=item_count
    )
);

CREATE TABLE medialab_core.returned_review_items (
    id uuid PRIMARY KEY,
    review_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    lane text NOT NULL,
    ordinal integer NOT NULL,
    media_asset_id uuid NOT NULL,
    review_media_asset_version_id uuid NOT NULL,
    returned_media_item_id uuid NULL REFERENCES medialab_core.returned_media_items(id) ON DELETE RESTRICT,
    source_kind text NOT NULL,
    admitted_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (review_batch_id, organization_id, job_id)
      REFERENCES medialab_core.returned_review_batches(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_id, organization_id, job_id)
      REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (review_media_asset_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id)
      REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT returned_review_items_batch_ordinal_key UNIQUE (review_batch_id, ordinal),
    CONSTRAINT returned_review_items_batch_version_key UNIQUE (review_batch_id, review_media_asset_version_id),
    CONSTRAINT returned_review_items_batch_id_key UNIQUE (review_batch_id, id),
    CONSTRAINT returned_review_items_id_scope_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT returned_review_items_scope_key UNIQUE (id, review_batch_id, organization_id, job_id),
    CONSTRAINT returned_review_items_lane_check CHECK (lane IN ('PHOTO','VIDEO')),
    CONSTRAINT returned_review_items_ordinal_check CHECK (ordinal>0),
    CONSTRAINT returned_review_items_source_kind_check CHECK (source_kind IN ('EDITOR_RETURN','REVISION_RETURN','QUICK_EDIT_CORRECTION'))
);

CREATE TABLE medialab_core.returned_review_decisions (
    id uuid PRIMARY KEY,
    review_item_id uuid NOT NULL,
    review_batch_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    reviewed_media_asset_version_id uuid NOT NULL,
    disposition text NOT NULL,
    reason text NOT NULL,
    instructions text NULL,
    supersedes_decision_id uuid NULL REFERENCES medialab_core.returned_review_decisions(id) ON DELETE RESTRICT,
    final_source_designation_id uuid NULL REFERENCES medialab_core.media_approved_source_designations(id) ON DELETE RESTRICT,
    decided_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (review_item_id, review_batch_id, organization_id, job_id)
      REFERENCES medialab_core.returned_review_items(id, review_batch_id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_media_asset_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_review_decisions_scope_key UNIQUE (id, review_item_id, organization_id, job_id),
    CONSTRAINT returned_review_decisions_disposition_check CHECK (disposition IN ('ACCEPT','REJECT_REVISION','USE_ORIGINAL','QUICK_EDIT','SKIP_QUICK_EDIT')),
    CONSTRAINT returned_review_decisions_reason_check CHECK (reason=btrim(reason) AND reason<>'' AND length(reason)<=1000),
    CONSTRAINT returned_review_decisions_instructions_check CHECK (instructions IS NULL OR (instructions=btrim(instructions) AND instructions<>'' AND length(instructions)<=2000)),
    CONSTRAINT returned_review_decisions_designation_check CHECK (
      (disposition IN ('ACCEPT','USE_ORIGINAL') AND final_source_designation_id IS NOT NULL) OR
      (disposition NOT IN ('ACCEPT','USE_ORIGINAL') AND final_source_designation_id IS NULL)
    )
);

CREATE TABLE medialab_core.returned_review_item_current (
    review_item_id uuid PRIMARY KEY REFERENCES medialab_core.returned_review_items(id) ON DELETE RESTRICT,
    review_batch_id uuid NOT NULL,
    current_decision_id uuid NULL REFERENCES medialab_core.returned_review_decisions(id) ON DELETE RESTRICT,
    current_disposition text NULL,
    current_route_state text NOT NULL DEFAULT 'UNDECIDED',
    current_final_source_designation_id uuid NULL REFERENCES medialab_core.media_approved_source_designations(id) ON DELETE RESTRICT,
    decision_generation bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (review_batch_id, review_item_id)
      REFERENCES medialab_core.returned_review_items(review_batch_id, id) ON DELETE RESTRICT,
    CONSTRAINT returned_review_item_current_disposition_check CHECK (current_disposition IS NULL OR current_disposition IN ('ACCEPT','REJECT_REVISION','USE_ORIGINAL','QUICK_EDIT','SKIP_QUICK_EDIT')),
    CONSTRAINT returned_review_item_current_route_check CHECK (current_route_state IN ('UNDECIDED','FINAL_SOURCE_SELECTED','REVISION_ROUTED','QUICK_EDIT_ROUTED','SKIP_QUICK_EDIT_UNRESOLVED')),
    CONSTRAINT returned_review_item_current_decision_check CHECK (
      (current_decision_id IS NULL AND current_disposition IS NULL AND decision_generation=0) OR
      (current_decision_id IS NOT NULL AND current_disposition IS NOT NULL AND decision_generation>0)
    )
);

CREATE TABLE medialab_core.returned_revision_requests (
    id uuid PRIMARY KEY,
    review_decision_id uuid NOT NULL UNIQUE REFERENCES medialab_core.returned_review_decisions(id) ON DELETE RESTRICT,
    review_item_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    rejected_media_asset_version_id uuid NOT NULL,
    instructions text NULL,
    reason text NOT NULL,
    requested_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (review_item_id, organization_id, job_id)
      REFERENCES medialab_core.returned_review_items(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (rejected_media_asset_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_revision_requests_scope_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT returned_revision_requests_reason_check CHECK (reason=btrim(reason) AND reason<>'' AND length(reason)<=1000)
);

CREATE TABLE medialab_core.returned_quick_edit_requests (
    id uuid PRIMARY KEY,
    review_decision_id uuid NOT NULL UNIQUE REFERENCES medialab_core.returned_review_decisions(id) ON DELETE RESTRICT,
    review_item_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    source_media_asset_version_id uuid NOT NULL,
    instructions text NULL,
    reason text NOT NULL,
    requested_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (review_item_id, organization_id, job_id)
      REFERENCES medialab_core.returned_review_items(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_media_asset_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_quick_edit_requests_scope_key UNIQUE (id, organization_id, job_id),
    CONSTRAINT returned_quick_edit_requests_reason_check CHECK (reason=btrim(reason) AND reason<>'' AND length(reason)<=1000)
);

CREATE TABLE medialab_core.returned_revision_version_links (
    id uuid PRIMARY KEY,
    revision_request_id uuid NOT NULL REFERENCES medialab_core.returned_revision_requests(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    rejected_media_asset_version_id uuid NOT NULL,
    returned_successor_version_id uuid NOT NULL,
    reason text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (revision_request_id, organization_id, job_id)
      REFERENCES medialab_core.returned_revision_requests(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (rejected_media_asset_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (returned_successor_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_revision_version_links_request_version_key UNIQUE (revision_request_id, returned_successor_version_id),
    CONSTRAINT returned_revision_version_links_reason_check CHECK (reason=btrim(reason) AND reason<>'' AND length(reason)<=1000)
);

CREATE TABLE medialab_core.returned_quick_edit_version_links (
    id uuid PRIMARY KEY,
    quick_edit_request_id uuid NOT NULL REFERENCES medialab_core.returned_quick_edit_requests(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    source_media_asset_version_id uuid NOT NULL,
    corrected_media_asset_version_id uuid NOT NULL,
    lineage_id uuid NOT NULL REFERENCES medialab_core.media_asset_lineage(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (quick_edit_request_id, organization_id, job_id)
      REFERENCES medialab_core.returned_quick_edit_requests(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_media_asset_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (corrected_media_asset_version_id, organization_id, job_id)
      REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT returned_quick_edit_version_links_request_version_key UNIQUE (quick_edit_request_id, corrected_media_asset_version_id),
    CONSTRAINT returned_quick_edit_version_links_reason_check CHECK (reason=btrim(reason) AND reason<>'' AND length(reason)<=1000)
);

CREATE TABLE medialab_core.returned_review_successor_links (
    id uuid PRIMARY KEY,
    predecessor_review_batch_id uuid NOT NULL REFERENCES medialab_core.returned_review_batches(id) ON DELETE RESTRICT,
    successor_review_batch_id uuid NOT NULL UNIQUE REFERENCES medialab_core.returned_review_batches(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    job_id uuid NOT NULL,
    reason text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT returned_review_successor_links_pair_key UNIQUE (predecessor_review_batch_id, successor_review_batch_id),
    CONSTRAINT returned_review_successor_links_not_self CHECK (predecessor_review_batch_id<>successor_review_batch_id),
    CONSTRAINT returned_review_successor_links_reason_check CHECK (reason=btrim(reason) AND reason<>'' AND length(reason)<=1000)
);

CREATE INDEX returned_review_batches_scope_idx ON medialab_core.returned_review_batches(organization_id,job_id,lane,created_at,id);
CREATE INDEX returned_review_items_batch_idx ON medialab_core.returned_review_items(review_batch_id,ordinal,id);
CREATE INDEX returned_review_decisions_item_idx ON medialab_core.returned_review_decisions(review_item_id,decided_at,id);
CREATE INDEX returned_revision_requests_item_idx ON medialab_core.returned_revision_requests(review_item_id,requested_at,id);
CREATE INDEX returned_quick_edit_requests_item_idx ON medialab_core.returned_quick_edit_requests(review_item_id,requested_at,id);

CREATE OR REPLACE FUNCTION medialab_core.reject_returned_review_evidence_mutation()
RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION '% rows are immutable append-only returned-review evidence: UPDATE and DELETE are rejected',TG_TABLE_NAME USING ERRCODE='42501';
END; $$ LANGUAGE plpgsql SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_returned_review_permission(p_actor uuid,p_organization uuid,p_permission text)
RETURNS void AS $$ BEGIN
  IF NOT medialab_core.actor_has_permission(p_actor,p_organization,p_permission) THEN
    RAISE EXCEPTION 'Actor lacks active % authority for the target organization',p_permission USING ERRCODE='42501';
  END IF;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_returned_review_text(p_text text,p_required boolean,p_limit integer)
RETURNS void AS $$ BEGIN
  IF (p_required AND (p_text IS NULL OR p_text='')) OR
     (p_text IS NOT NULL AND (p_text<>btrim(p_text) OR p_text='' OR length(p_text)>p_limit OR
      p_text ~* '(password|credential|secret|token|oauth|access[_ -]?key|private[_ -]?key|signed[_ -]?(url|uri)|https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/]|base64)')) THEN
    RAISE EXCEPTION 'Bounded provider-neutral review text without secrets, URLs, paths, or media data is required' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_returned_review_safe_json(p_evidence jsonb)
RETURNS void AS $$ BEGIN
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR length(p_evidence::text)>20000 OR
     p_evidence::text ~* '"([a-z0-9_]*(credential|password|secret|token|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64|thumbnail|proxy)[a-z0-9_]*)"[[:space:]]*:' OR
     p_evidence::text ~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])' THEN
    RAISE EXCEPTION 'Returned-review evidence contains prohibited secrets, provider payloads, URLs, paths, or media data' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.returned_review_final_purpose(p_asset_id uuid)
RETURNS text AS $$ BEGIN RETURN 'FINAL_SOURCE_'||upper(replace(p_asset_id::text,'-','')); END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.current_returned_review_final_designation(p_asset_id uuid,p_organization uuid,p_job uuid)
RETURNS uuid AS $$
  SELECT d.id FROM medialab_core.media_approved_source_designations d
  JOIN medialab_core.media_asset_versions v ON v.id=d.version_id
  WHERE v.asset_id=p_asset_id AND d.organization_id=p_organization AND d.job_id=p_job
    AND d.purpose=medialab_core.returned_review_final_purpose(p_asset_id)
    AND NOT EXISTS (SELECT 1 FROM medialab_core.media_approved_source_designations n WHERE n.supersedes_designation_id=d.id)
  ORDER BY d.designated_at DESC,d.id DESC LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.recompute_returned_review_current(p_batch uuid)
RETURNS void AS $$
DECLARE v_total integer;v_resolved integer;v_final integer;v_revision integer;v_quick integer;
BEGIN
  SELECT count(*)::integer INTO v_total FROM medialab_core.returned_review_items WHERE review_batch_id=p_batch;
  SELECT count(*) FILTER (WHERE c.current_disposition IN ('ACCEPT','USE_ORIGINAL','REJECT_REVISION','QUICK_EDIT') OR
      (c.current_disposition='SKIP_QUICK_EDIT' AND c.current_final_source_designation_id IS NOT NULL))::integer,
    count(*) FILTER (WHERE c.current_final_source_designation_id IS NOT NULL)::integer,
    count(*) FILTER (WHERE c.current_disposition='REJECT_REVISION')::integer,
    count(*) FILTER (WHERE c.current_disposition='QUICK_EDIT')::integer
    INTO v_resolved,v_final,v_revision,v_quick
    FROM medialab_core.returned_review_item_current c WHERE c.review_batch_id=p_batch;
  UPDATE medialab_core.returned_review_batch_current SET item_count=v_total,resolved_count=COALESCE(v_resolved,0),
    final_source_count=COALESCE(v_final,0),revision_routed_count=COALESCE(v_revision,0),quick_edit_routed_count=COALESCE(v_quick,0),
    unresolved_count=v_total-COALESCE(v_resolved,0),updated_at=clock_timestamp() WHERE review_batch_id=p_batch;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_returned_review_batch(
  p_session text,p_key text,p_handoff uuid,p_cycle integer,p_reason text,p_context jsonb)
RETURNS uuid AS $$
DECLARE a uuid;h medialab_core.editor_handoff_batches%ROWTYPE;b uuid;q text;r jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);
  SELECT * INTO h FROM medialab_core.editor_handoff_batches WHERE id=p_handoff;
  IF NOT FOUND THEN RAISE EXCEPTION 'Editor handoff is missing or unavailable' USING ERRCODE='42501';END IF;
  PERFORM medialab_core.require_returned_review_permission(a,h.organization_id,'media_return_review.manage');
  PERFORM medialab_core.validate_returned_review_text(p_reason,true,1000);PERFORM medialab_core.validate_returned_review_safe_json(p_context);
  IF p_cycle IS NULL OR p_cycle<=0 THEN RAISE EXCEPTION 'Review cycle number must be positive' USING ERRCODE='22023';END IF;
  q:=encode(sha256(convert_to(jsonb_build_array(p_handoff,p_cycle,p_reason,p_context)::text,'UTF8')),'hex');
  r:=medialab_core.check_media_idempotency(a,'CREATE_RETURNED_REVIEW_BATCH',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'review_batch_id')::uuid;END IF;
  IF EXISTS(SELECT 1 FROM medialab_core.returned_review_batches WHERE editor_handoff_batch_id=p_handoff AND review_cycle_number=p_cycle) THEN RAISE EXCEPTION 'Review cycle already exists for handoff' USING ERRCODE='23505';END IF;
  b:=gen_random_uuid();
  INSERT INTO medialab_core.returned_review_batches(id,organization_id,job_id,service_workstream_id,lane,editor_handoff_batch_id,review_cycle_number,context,created_by_identity_id)
   VALUES(b,h.organization_id,h.job_id,h.service_workstream_id,h.lane,h.id,p_cycle,p_context,a);
  INSERT INTO medialab_core.returned_review_batch_events(id,review_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id)
   VALUES(gen_random_uuid(),b,h.organization_id,h.job_id,'CREATED',p_reason,jsonb_build_object('review_cycle_number',p_cycle),a);
  INSERT INTO medialab_core.returned_review_batch_current(review_batch_id,organization_id,job_id) VALUES(b,h.organization_id,h.job_id);
  PERFORM medialab_core.record_media_idempotency(a,'CREATE_RETURNED_REVIEW_BATCH',p_key,q,jsonb_build_object('review_batch_id',b));RETURN b;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.admit_returned_review_item(
  p_session text,p_key text,p_batch uuid,p_version uuid,p_expected_generation bigint,p_context jsonb)
RETURNS uuid AS $$
DECLARE a uuid;b medialab_core.returned_review_batches%ROWTYPE;c medialab_core.returned_review_batch_current%ROWTYPE;
 v medialab_core.media_asset_versions%ROWTYPE;i uuid;o integer;ri uuid;sk text;q text;r jsonb;
BEGIN
 SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);
 SELECT * INTO b FROM medialab_core.returned_review_batches WHERE id=p_batch;IF NOT FOUND THEN RAISE EXCEPTION 'Review batch is missing or unavailable' USING ERRCODE='42501';END IF;
 PERFORM medialab_core.require_returned_review_permission(a,b.organization_id,'media_return_review.manage');PERFORM medialab_core.validate_returned_review_safe_json(p_context);
 SELECT * INTO v FROM medialab_core.media_asset_versions WHERE id=p_version AND organization_id=b.organization_id AND job_id=b.job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Review version is cross-tenant, cross-Job, or missing' USING ERRCODE='42501';END IF;
 IF (b.lane='PHOTO' AND v.media_type LIKE 'video/%') OR (b.lane='VIDEO' AND v.media_type NOT LIKE 'video/%') THEN RAISE EXCEPTION 'Review inventory cannot mix PHOTO and VIDEO lanes' USING ERRCODE='22023';END IF;
 SELECT x.returned_item_id INTO ri FROM medialab_core.returned_media_item_current x JOIN medialab_core.returned_media_items z ON z.id=x.returned_item_id
  WHERE x.returned_media_asset_version_id=v.id AND x.current_outcome IN ('EXACT_MATCH','CONFIDENT_MATCH','REPEATED_RETURN') AND z.handoff_batch_id=b.editor_handoff_batch_id LIMIT 1;
 IF ri IS NOT NULL THEN sk:=CASE v.version_kind WHEN 'REVISION_RETURN' THEN 'REVISION_RETURN' ELSE 'EDITOR_RETURN' END;
 ELSIF EXISTS(SELECT 1 FROM medialab_core.returned_quick_edit_version_links l WHERE l.corrected_media_asset_version_id=v.id) THEN sk:='QUICK_EDIT_CORRECTION';
 ELSIF EXISTS(SELECT 1 FROM medialab_core.returned_revision_version_links l WHERE l.returned_successor_version_id=v.id) THEN sk:='REVISION_RETURN';
 ELSE RAISE EXCEPTION 'Review version lacks accepted returned-media or corrected-version lineage evidence' USING ERRCODE='22023';END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_batch,p_version,p_expected_generation,p_context)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ADMIT_RETURNED_REVIEW_ITEM',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'review_item_id')::uuid;END IF;
 SELECT * INTO c FROM medialab_core.returned_review_batch_current WHERE review_batch_id=b.id FOR UPDATE;
 IF c.current_state<>'DRAFT' THEN RAISE EXCEPTION 'Sealed or completed review inventory is immutable' USING ERRCODE='22023';END IF;
 IF c.lifecycle_generation<>p_expected_generation THEN RAISE EXCEPTION 'Stale review batch generation' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM medialab_core.returned_review_items WHERE review_batch_id=b.id AND review_media_asset_version_id=v.id) THEN RAISE EXCEPTION 'Exact immutable version is already in review inventory' USING ERRCODE='23505';END IF;
 SELECT COALESCE(max(ordinal),0)+1 INTO o FROM medialab_core.returned_review_items WHERE review_batch_id=b.id;i:=gen_random_uuid();
 INSERT INTO medialab_core.returned_review_items(id,review_batch_id,organization_id,job_id,service_workstream_id,lane,ordinal,media_asset_id,review_media_asset_version_id,returned_media_item_id,source_kind,admitted_by_identity_id)
  VALUES(i,b.id,b.organization_id,b.job_id,b.service_workstream_id,b.lane,o,v.asset_id,v.id,ri,sk,a);
 INSERT INTO medialab_core.returned_review_item_current(review_item_id,review_batch_id) VALUES(i,b.id);
 UPDATE medialab_core.returned_review_batch_current SET lifecycle_generation=lifecycle_generation+1 WHERE review_batch_id=b.id;PERFORM medialab_core.recompute_returned_review_current(b.id);
 PERFORM medialab_core.record_media_idempotency(a,'ADMIT_RETURNED_REVIEW_ITEM',p_key,q,jsonb_build_object('review_item_id',i));RETURN i;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.seal_returned_review_inventory(p_session text,p_key text,p_batch uuid,p_expected_generation bigint,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;b medialab_core.returned_review_batches%ROWTYPE;c medialab_core.returned_review_batch_current%ROWTYPE;e uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO b FROM medialab_core.returned_review_batches WHERE id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'Review batch is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,b.organization_id,'media_return_review.manage');PERFORM medialab_core.validate_returned_review_text(p_reason,true,1000);
 q:=encode(sha256(convert_to(jsonb_build_array(p_batch,p_expected_generation,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'SEAL_RETURNED_REVIEW_INVENTORY',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;
 SELECT * INTO c FROM medialab_core.returned_review_batch_current WHERE review_batch_id=b.id FOR UPDATE;IF c.lifecycle_generation<>p_expected_generation THEN RAISE EXCEPTION 'Stale review batch generation' USING ERRCODE='40001';END IF;
 IF c.current_state<>'DRAFT' OR c.item_count=0 THEN RAISE EXCEPTION 'Only a nonempty draft review inventory may be sealed' USING ERRCODE='22023';END IF;e:=gen_random_uuid();
 INSERT INTO medialab_core.returned_review_batch_events(id,review_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id) VALUES(e,b.id,b.organization_id,b.job_id,'INVENTORY_SEALED',p_reason,jsonb_build_object('item_count',c.item_count),a);
 UPDATE medialab_core.returned_review_batch_current SET current_state='SEALED',lifecycle_generation=lifecycle_generation+1,updated_at=clock_timestamp() WHERE review_batch_id=b.id;
 PERFORM medialab_core.record_media_idempotency(a,'SEAL_RETURNED_REVIEW_INVENTORY',p_key,q,jsonb_build_object('event_id',e));RETURN e;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.apply_returned_review_decision(p_actor uuid,p_item uuid,p_disposition text,p_reason text,p_instructions text,p_supersedes uuid)
RETURNS uuid AS $$
DECLARE i medialab_core.returned_review_items%ROWTYPE;c medialab_core.returned_review_item_current%ROWTYPE;v_target uuid;v_current_designation uuid;v_designation uuid;d uuid;v_state text;v_old medialab_core.returned_review_decisions%ROWTYPE;
BEGIN SELECT * INTO i FROM medialab_core.returned_review_items WHERE id=p_item;SELECT * INTO c FROM medialab_core.returned_review_item_current WHERE review_item_id=i.id FOR UPDATE;
 IF p_disposition NOT IN ('ACCEPT','REJECT_REVISION','USE_ORIGINAL','QUICK_EDIT','SKIP_QUICK_EDIT') THEN RAISE EXCEPTION 'Unsupported returned-review disposition' USING ERRCODE='22023';END IF;
 PERFORM medialab_core.validate_returned_review_text(p_reason,true,1000);PERFORM medialab_core.validate_returned_review_text(p_instructions,false,2000);
 IF p_disposition IN ('REJECT_REVISION','QUICK_EDIT') AND p_instructions IS NULL THEN RAISE EXCEPTION 'Revision and Quick Edit routing require bounded instructions' USING ERRCODE='22023';END IF;
 IF p_supersedes IS NULL AND c.current_decision_id IS NOT NULL THEN RAISE EXCEPTION 'Current decision requires explicit append-only supersession' USING ERRCODE='22023';END IF;
 IF p_supersedes IS NOT NULL THEN SELECT * INTO v_old FROM medialab_core.returned_review_decisions WHERE id=p_supersedes AND review_item_id=i.id;IF NOT FOUND OR c.current_decision_id<>p_supersedes THEN RAISE EXCEPTION 'Superseded decision is not the current decision for this item' USING ERRCODE='40001';END IF;
   IF v_old.disposition IN ('ACCEPT','USE_ORIGINAL') AND p_disposition NOT IN ('ACCEPT','USE_ORIGINAL') THEN RAISE EXCEPTION 'An established final source may only be replaced by a new valid final-source decision' USING ERRCODE='22023';END IF;
 END IF;
 IF p_disposition IN ('ACCEPT','USE_ORIGINAL') THEN
   PERFORM medialab_core.require_media_permission(p_actor,i.organization_id,'media_asset.manage');
   IF p_disposition='ACCEPT' THEN v_target:=i.review_media_asset_version_id;ELSE SELECT id INTO v_target FROM medialab_core.media_asset_versions WHERE asset_id=i.media_asset_id AND organization_id=i.organization_id AND job_id=i.job_id AND version_kind='ORIGINAL' ORDER BY version_number,id LIMIT 1;IF v_target IS NULL THEN RAISE EXCEPTION 'Accepted immutable ORIGINAL version is unavailable' USING ERRCODE='22023';END IF;END IF;
   v_current_designation:=medialab_core.current_returned_review_final_designation(i.media_asset_id,i.organization_id,i.job_id);v_designation:=gen_random_uuid();
   INSERT INTO medialab_core.media_approved_source_designations(id,version_id,organization_id,job_id,purpose,designation,supersedes_designation_id,reason,designated_by_identity_id)
    VALUES(v_designation,v_target,i.organization_id,i.job_id,medialab_core.returned_review_final_purpose(i.media_asset_id),CASE WHEN p_disposition='USE_ORIGINAL' THEN 'USE_ORIGINAL' ELSE 'FINAL_SOURCE' END,v_current_designation,p_reason,p_actor);
   v_state:='FINAL_SOURCE_SELECTED';
 ELSIF p_disposition='REJECT_REVISION' THEN v_state:='REVISION_ROUTED';
 ELSIF p_disposition='QUICK_EDIT' THEN v_state:='QUICK_EDIT_ROUTED';
 ELSE v_designation:=medialab_core.current_returned_review_final_designation(i.media_asset_id,i.organization_id,i.job_id);v_state:=CASE WHEN v_designation IS NULL THEN 'SKIP_QUICK_EDIT_UNRESOLVED' ELSE 'FINAL_SOURCE_SELECTED' END;END IF;
 d:=gen_random_uuid();INSERT INTO medialab_core.returned_review_decisions(id,review_item_id,review_batch_id,organization_id,job_id,reviewed_media_asset_version_id,disposition,reason,instructions,supersedes_decision_id,final_source_designation_id,decided_by_identity_id)
  VALUES(d,i.id,i.review_batch_id,i.organization_id,i.job_id,i.review_media_asset_version_id,p_disposition,p_reason,p_instructions,p_supersedes,v_designation,p_actor);
 IF p_disposition='REJECT_REVISION' THEN INSERT INTO medialab_core.returned_revision_requests(id,review_decision_id,review_item_id,organization_id,job_id,rejected_media_asset_version_id,instructions,reason,requested_by_identity_id) VALUES(gen_random_uuid(),d,i.id,i.organization_id,i.job_id,i.review_media_asset_version_id,p_instructions,p_reason,p_actor);
 ELSIF p_disposition='QUICK_EDIT' THEN INSERT INTO medialab_core.returned_quick_edit_requests(id,review_decision_id,review_item_id,organization_id,job_id,source_media_asset_version_id,instructions,reason,requested_by_identity_id) VALUES(gen_random_uuid(),d,i.id,i.organization_id,i.job_id,i.review_media_asset_version_id,p_instructions,p_reason,p_actor);END IF;
 UPDATE medialab_core.returned_review_item_current SET current_decision_id=d,current_disposition=p_disposition,current_route_state=v_state,current_final_source_designation_id=v_designation,decision_generation=decision_generation+1,updated_at=clock_timestamp() WHERE review_item_id=i.id;
 PERFORM medialab_core.recompute_returned_review_current(i.review_batch_id);RETURN d;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_returned_review_decision(p_session text,p_key text,p_item uuid,p_disposition text,p_reason text,p_instructions text,p_expected_generation bigint)
RETURNS uuid AS $$
DECLARE a uuid;i medialab_core.returned_review_items%ROWTYPE;b medialab_core.returned_review_batch_current%ROWTYPE;c medialab_core.returned_review_item_current%ROWTYPE;d uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO i FROM medialab_core.returned_review_items WHERE id=p_item;IF NOT FOUND THEN RAISE EXCEPTION 'Review item is missing or unavailable' USING ERRCODE='42501';END IF;
 PERFORM medialab_core.require_returned_review_permission(a,i.organization_id,'media_return_review.manage');q:=encode(sha256(convert_to(jsonb_build_array(p_item,p_disposition,p_reason,p_instructions,p_expected_generation)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'RECORD_RETURNED_REVIEW_DECISION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'decision_id')::uuid;END IF;
 SELECT * INTO b FROM medialab_core.returned_review_batch_current WHERE review_batch_id=i.review_batch_id FOR UPDATE;IF b.current_state<>'SEALED' THEN RAISE EXCEPTION 'Decisions require a sealed, incomplete review batch' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM medialab_core.returned_review_item_current WHERE review_item_id=i.id FOR UPDATE;IF c.decision_generation<>p_expected_generation THEN RAISE EXCEPTION 'Stale review-item decision generation' USING ERRCODE='40001';END IF;IF c.current_decision_id IS NOT NULL THEN RAISE EXCEPTION 'Existing decision requires explicit supersession' USING ERRCODE='22023';END IF;
 d:=medialab_core.apply_returned_review_decision(a,i.id,p_disposition,p_reason,p_instructions,NULL);PERFORM medialab_core.record_media_idempotency(a,'RECORD_RETURNED_REVIEW_DECISION',p_key,q,jsonb_build_object('decision_id',d));RETURN d;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.supersede_returned_review_decision(p_session text,p_key text,p_item uuid,p_current_decision uuid,p_disposition text,p_reason text,p_instructions text,p_expected_generation bigint)
RETURNS uuid AS $$
DECLARE a uuid;i medialab_core.returned_review_items%ROWTYPE;b medialab_core.returned_review_batch_current%ROWTYPE;c medialab_core.returned_review_item_current%ROWTYPE;d uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO i FROM medialab_core.returned_review_items WHERE id=p_item;IF NOT FOUND THEN RAISE EXCEPTION 'Review item is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,i.organization_id,'media_return_review.manage');
 q:=encode(sha256(convert_to(jsonb_build_array(p_item,p_current_decision,p_disposition,p_reason,p_instructions,p_expected_generation)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'SUPERSEDE_RETURNED_REVIEW_DECISION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'decision_id')::uuid;END IF;
 SELECT * INTO b FROM medialab_core.returned_review_batch_current WHERE review_batch_id=i.review_batch_id FOR UPDATE;IF b.current_state<>'SEALED' THEN RAISE EXCEPTION 'Decision correction requires a sealed, incomplete review batch' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM medialab_core.returned_review_item_current WHERE review_item_id=i.id FOR UPDATE;IF c.decision_generation<>p_expected_generation OR c.current_decision_id<>p_current_decision THEN RAISE EXCEPTION 'Stale review-item decision generation or decision identity' USING ERRCODE='40001';END IF;
 d:=medialab_core.apply_returned_review_decision(a,i.id,p_disposition,p_reason,p_instructions,p_current_decision);PERFORM medialab_core.record_media_idempotency(a,'SUPERSEDE_RETURNED_REVIEW_DECISION',p_key,q,jsonb_build_object('decision_id',d));RETURN d;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.complete_returned_review_batch(p_session text,p_key text,p_batch uuid,p_expected_generation bigint,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;b medialab_core.returned_review_batches%ROWTYPE;c medialab_core.returned_review_batch_current%ROWTYPE;e uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO b FROM medialab_core.returned_review_batches WHERE id=p_batch;IF NOT FOUND THEN RAISE EXCEPTION 'Review batch is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,b.organization_id,'media_return_review.manage');PERFORM medialab_core.validate_returned_review_text(p_reason,true,1000);
 q:=encode(sha256(convert_to(jsonb_build_array(p_batch,p_expected_generation,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'COMPLETE_RETURNED_REVIEW_BATCH',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;
 SELECT * INTO c FROM medialab_core.returned_review_batch_current WHERE review_batch_id=b.id FOR UPDATE;IF c.lifecycle_generation<>p_expected_generation THEN RAISE EXCEPTION 'Stale review batch generation' USING ERRCODE='40001';END IF;IF c.current_state<>'SEALED' OR c.item_count=0 OR c.unresolved_count<>0 THEN RAISE EXCEPTION 'Every sealed review item requires an explicit resolving disposition' USING ERRCODE='22023';END IF;e:=gen_random_uuid();
 INSERT INTO medialab_core.returned_review_batch_events(id,review_batch_id,organization_id,job_id,event_type,reason,evidence,recorded_by_identity_id) VALUES(e,b.id,b.organization_id,b.job_id,'COMPLETED',p_reason,jsonb_build_object('item_count',c.item_count,'final_source_count',c.final_source_count,'revision_routed_count',c.revision_routed_count,'quick_edit_routed_count',c.quick_edit_routed_count),a);
 UPDATE medialab_core.returned_review_batch_current SET current_state='COMPLETED',lifecycle_generation=lifecycle_generation+1,updated_at=clock_timestamp() WHERE review_batch_id=b.id;PERFORM medialab_core.record_media_idempotency(a,'COMPLETE_RETURNED_REVIEW_BATCH',p_key,q,jsonb_build_object('event_id',e));RETURN e;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.link_returned_review_successor(p_session text,p_key text,p_predecessor uuid,p_successor uuid,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;p medialab_core.returned_review_batches%ROWTYPE;s medialab_core.returned_review_batches%ROWTYPE;l uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.returned_review_batches WHERE id=p_predecessor;SELECT * INTO s FROM medialab_core.returned_review_batches WHERE id=p_successor;
 IF p.id IS NULL OR s.id IS NULL THEN RAISE EXCEPTION 'Review cycle is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,p.organization_id,'media_return_review.manage');PERFORM medialab_core.validate_returned_review_text(p_reason,true,1000);
 IF p.organization_id<>s.organization_id OR p.job_id<>s.job_id OR p.lane<>s.lane OR p.editor_handoff_batch_id<>s.editor_handoff_batch_id OR s.review_cycle_number<=p.review_cycle_number THEN RAISE EXCEPTION 'Successor review cycle scope or ordering is invalid' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM medialab_core.returned_review_batch_current WHERE review_batch_id=p.id AND current_state='COMPLETED') THEN RAISE EXCEPTION 'Predecessor review cycle must be completed' USING ERRCODE='22023';END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_predecessor,p_successor,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'LINK_RETURNED_REVIEW_SUCCESSOR',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'successor_link_id')::uuid;END IF;l:=gen_random_uuid();
 INSERT INTO medialab_core.returned_review_successor_links(id,predecessor_review_batch_id,successor_review_batch_id,organization_id,job_id,reason,recorded_by_identity_id) VALUES(l,p.id,s.id,p.organization_id,p.job_id,p_reason,a);
 PERFORM medialab_core.record_media_idempotency(a,'LINK_RETURNED_REVIEW_SUCCESSOR',p_key,q,jsonb_build_object('successor_link_id',l));RETURN l;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.associate_returned_revision(p_session text,p_key text,p_request uuid,p_version uuid,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;x medialab_core.returned_revision_requests%ROWTYPE;s medialab_core.media_asset_versions%ROWTYPE;t medialab_core.media_asset_versions%ROWTYPE;l uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO x FROM medialab_core.returned_revision_requests WHERE id=p_request;IF NOT FOUND THEN RAISE EXCEPTION 'Revision request is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,x.organization_id,'media_return_review.manage');PERFORM medialab_core.validate_returned_review_text(p_reason,true,1000);
 SELECT * INTO s FROM medialab_core.media_asset_versions WHERE id=x.rejected_media_asset_version_id;SELECT * INTO t FROM medialab_core.media_asset_versions WHERE id=p_version;
 IF t.id IS NULL OR t.organization_id<>x.organization_id OR t.job_id<>x.job_id OR t.asset_id<>s.asset_id OR t.version_kind<>'REVISION_RETURN' OR t.version_number<=s.version_number OR NOT EXISTS(SELECT 1 FROM medialab_core.returned_media_item_current c WHERE c.returned_media_asset_version_id=t.id AND c.current_outcome IN ('EXACT_MATCH','CONFIDENT_MATCH','REPEATED_RETURN')) THEN RAISE EXCEPTION 'Returned revision lacks valid accepted M12-A scope and intake evidence' USING ERRCODE='22023';END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_request,p_version,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ASSOCIATE_RETURNED_REVISION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'revision_link_id')::uuid;END IF;l:=gen_random_uuid();
 INSERT INTO medialab_core.returned_revision_version_links(id,revision_request_id,organization_id,job_id,rejected_media_asset_version_id,returned_successor_version_id,reason,recorded_by_identity_id) VALUES(l,x.id,x.organization_id,x.job_id,s.id,t.id,p_reason,a);
 PERFORM medialab_core.record_media_idempotency(a,'ASSOCIATE_RETURNED_REVISION',p_key,q,jsonb_build_object('revision_link_id',l));RETURN l;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.associate_quick_edit_corrected_version(p_session text,p_key text,p_request uuid,p_version uuid,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;x medialab_core.returned_quick_edit_requests%ROWTYPE;s medialab_core.media_asset_versions%ROWTYPE;t medialab_core.media_asset_versions%ROWTYPE;ln uuid;l uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO x FROM medialab_core.returned_quick_edit_requests WHERE id=p_request;IF NOT FOUND THEN RAISE EXCEPTION 'Quick Edit request is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,x.organization_id,'media_return_review.manage');PERFORM medialab_core.require_media_permission(a,x.organization_id,'media_asset.manage');PERFORM medialab_core.validate_returned_review_text(p_reason,true,1000);
 SELECT * INTO s FROM medialab_core.media_asset_versions WHERE id=x.source_media_asset_version_id;SELECT * INTO t FROM medialab_core.media_asset_versions WHERE id=p_version;
 SELECT id INTO ln FROM medialab_core.media_asset_lineage WHERE source_version_id=s.id AND target_version_id=t.id AND relationship_type IN ('EDITOR_RETURN_TO_CORRECTED_VERSION','PARENT_TO_CHILD') ORDER BY recorded_at,id LIMIT 1;
 IF t.id IS NULL OR t.organization_id<>x.organization_id OR t.job_id<>x.job_id OR t.asset_id<>s.asset_id OR t.version_kind<>'QUICK_EDIT_CORRECTION' OR t.version_number<=s.version_number OR ln IS NULL THEN RAISE EXCEPTION 'Quick Edit corrected version lacks immutable same-asset source lineage' USING ERRCODE='22023';END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_request,p_version,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ASSOCIATE_QUICK_EDIT_CORRECTION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'quick_edit_link_id')::uuid;END IF;l:=gen_random_uuid();
 INSERT INTO medialab_core.returned_quick_edit_version_links(id,quick_edit_request_id,organization_id,job_id,source_media_asset_version_id,corrected_media_asset_version_id,lineage_id,reason,recorded_by_identity_id) VALUES(l,x.id,x.organization_id,x.job_id,s.id,t.id,ln,p_reason,a);
 PERFORM medialab_core.record_media_idempotency(a,'ASSOCIATE_QUICK_EDIT_CORRECTION',p_key,q,jsonb_build_object('quick_edit_link_id',l));RETURN l;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_returned_review_batch(p_session text,p_batch uuid)
RETURNS jsonb AS $$ DECLARE a uuid;b medialab_core.returned_review_batches%ROWTYPE;z jsonb;BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO b FROM medialab_core.returned_review_batches WHERE id=p_batch;IF NOT FOUND THEN RAISE EXCEPTION 'Review batch is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,b.organization_id,'media_return_review.read');
 SELECT jsonb_build_object('batch',to_jsonb(b),'current',to_jsonb(c),'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('item',to_jsonb(i),'current',to_jsonb(ic)) ORDER BY i.ordinal) FROM medialab_core.returned_review_items i JOIN medialab_core.returned_review_item_current ic ON ic.review_item_id=i.id WHERE i.review_batch_id=b.id),'[]'::jsonb)) INTO z FROM medialab_core.returned_review_batch_current c WHERE c.review_batch_id=b.id;RETURN z;END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_returned_review_history(p_session text,p_batch uuid)
RETURNS jsonb AS $$ DECLARE a uuid;b medialab_core.returned_review_batches%ROWTYPE;z jsonb;BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO b FROM medialab_core.returned_review_batches WHERE id=p_batch;IF NOT FOUND THEN RAISE EXCEPTION 'Review batch is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,b.organization_id,'media_return_review.read');
 SELECT jsonb_build_object('events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at,e.id) FROM medialab_core.returned_review_batch_events e WHERE e.review_batch_id=b.id),'[]'::jsonb),'decisions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.decided_at,d.id) FROM medialab_core.returned_review_decisions d WHERE d.review_batch_id=b.id),'[]'::jsonb),'revision_requests',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.requested_at,x.id) FROM medialab_core.returned_revision_requests x JOIN medialab_core.returned_review_items i ON i.id=x.review_item_id WHERE i.review_batch_id=b.id),'[]'::jsonb),'quick_edit_requests',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.requested_at,x.id) FROM medialab_core.returned_quick_edit_requests x JOIN medialab_core.returned_review_items i ON i.id=x.review_item_id WHERE i.review_batch_id=b.id),'[]'::jsonb)) INTO z;RETURN z;END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_returned_review_batches(p_session text,p_job uuid,p_lane text)
RETURNS SETOF jsonb AS $$ DECLARE a uuid;j medialab_core.jobs%ROWTYPE;BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO j FROM medialab_core.jobs WHERE id=p_job;IF NOT FOUND THEN RAISE EXCEPTION 'Job is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,j.organization_id,'media_return_review.read');IF p_lane IS NOT NULL AND p_lane NOT IN ('PHOTO','VIDEO') THEN RAISE EXCEPTION 'Lane must be PHOTO or VIDEO' USING ERRCODE='22023';END IF;RETURN QUERY SELECT jsonb_build_object('batch',to_jsonb(b),'current',to_jsonb(c)) FROM medialab_core.returned_review_batches b JOIN medialab_core.returned_review_batch_current c ON c.review_batch_id=b.id WHERE b.job_id=j.id AND (p_lane IS NULL OR b.lane=p_lane) ORDER BY b.created_at,b.id;END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_returned_review_lineage(p_session text,p_asset uuid)
RETURNS jsonb AS $$ DECLARE a uuid;m medialab_core.media_assets%ROWTYPE;z jsonb;BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO m FROM medialab_core.media_assets WHERE id=p_asset;IF NOT FOUND THEN RAISE EXCEPTION 'Media asset is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_returned_review_permission(a,m.organization_id,'media_return_review.read');
 SELECT jsonb_build_object('review_items',COALESCE((SELECT jsonb_agg(jsonb_build_object('item',to_jsonb(i),'current',to_jsonb(c)) ORDER BY i.admitted_at,i.id) FROM medialab_core.returned_review_items i JOIN medialab_core.returned_review_item_current c ON c.review_item_id=i.id WHERE i.media_asset_id=m.id),'[]'::jsonb),'decisions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.decided_at,d.id) FROM medialab_core.returned_review_decisions d JOIN medialab_core.returned_review_items i ON i.id=d.review_item_id WHERE i.media_asset_id=m.id),'[]'::jsonb),'final_designations',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.designated_at,d.id) FROM medialab_core.media_approved_source_designations d JOIN medialab_core.media_asset_versions v ON v.id=d.version_id WHERE v.asset_id=m.id AND d.purpose=medialab_core.returned_review_final_purpose(m.id)),'[]'::jsonb),'revision_links',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.recorded_at,l.id) FROM medialab_core.returned_revision_version_links l JOIN medialab_core.media_asset_versions v ON v.id=l.rejected_media_asset_version_id WHERE v.asset_id=m.id),'[]'::jsonb),'quick_edit_links',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.recorded_at,l.id) FROM medialab_core.returned_quick_edit_version_links l JOIN medialab_core.media_asset_versions v ON v.id=l.source_media_asset_version_id WHERE v.asset_id=m.id),'[]'::jsonb)) INTO z;RETURN z;END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE TRIGGER returned_review_batches_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_review_batches FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_review_batch_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_review_batch_events FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_review_items_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_review_items FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_review_decisions_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_review_decisions FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_revision_requests_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_revision_requests FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_quick_edit_requests_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_quick_edit_requests FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_revision_version_links_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_revision_version_links FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_quick_edit_version_links_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_quick_edit_version_links FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();
CREATE TRIGGER returned_review_successor_links_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.returned_review_successor_links FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_returned_review_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.returned_review_batches,medialab_core.returned_review_batch_events,medialab_core.returned_review_batch_current,medialab_core.returned_review_items,medialab_core.returned_review_decisions,medialab_core.returned_review_item_current,medialab_core.returned_revision_requests,medialab_core.returned_quick_edit_requests,medialab_core.returned_revision_version_links,medialab_core.returned_quick_edit_version_links,medialab_core.returned_review_successor_links FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_returned_review_evidence_mutation(),medialab_core.require_returned_review_permission(uuid,uuid,text),medialab_core.validate_returned_review_text(text,boolean,integer),medialab_core.validate_returned_review_safe_json(jsonb),medialab_core.returned_review_final_purpose(uuid),medialab_core.current_returned_review_final_designation(uuid,uuid,uuid),medialab_core.recompute_returned_review_current(uuid),medialab_core.apply_returned_review_decision(uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_returned_review_batch(text,text,uuid,integer,text,jsonb),medialab_core.admit_returned_review_item(text,text,uuid,uuid,bigint,jsonb),medialab_core.seal_returned_review_inventory(text,text,uuid,bigint,text),medialab_core.record_returned_review_decision(text,text,uuid,text,text,text,bigint),medialab_core.supersede_returned_review_decision(text,text,uuid,uuid,text,text,text,bigint),medialab_core.complete_returned_review_batch(text,text,uuid,bigint,text),medialab_core.link_returned_review_successor(text,text,uuid,uuid,text),medialab_core.associate_returned_revision(text,text,uuid,uuid,text),medialab_core.associate_quick_edit_corrected_version(text,text,uuid,uuid,text),medialab_core.get_returned_review_batch(text,uuid),medialab_core.get_returned_review_history(text,uuid),medialab_core.list_returned_review_batches(text,uuid,text),medialab_core.get_returned_review_lineage(text,uuid) FROM PUBLIC;
