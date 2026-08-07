-- P02-M15-A: Temporary Download Center and external-sharing policy foundation.
-- Database evidence only: no public credential, URL, recipient access, provider I/O, payment processing, or download execution.

CREATE TABLE medialab_core.temporary_download_centers (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    property_hub_id uuid NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    expiration_days integer NOT NULL,
    stakeholder_label text NULL,
    replaces_center_id uuid NULL REFERENCES medialab_core.temporary_download_centers(id) ON DELETE RESTRICT,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (property_hub_id, organization_id)
      REFERENCES medialab_core.property_hubs(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_centers_scope_key UNIQUE (id, organization_id, property_hub_id),
    CONSTRAINT temporary_download_centers_expiration_days_check CHECK (expiration_days IN (3,7,14)),
    CONSTRAINT temporary_download_centers_expiry_check CHECK (expires_at = created_at + make_interval(days => expiration_days)),
    CONSTRAINT temporary_download_centers_label_check CHECK (
      stakeholder_label IS NULL OR
      (stakeholder_label = btrim(stakeholder_label) AND stakeholder_label <> '' AND length(stakeholder_label) <= 200 AND stakeholder_label !~ '@')
    ),
    CONSTRAINT temporary_download_centers_replacement_check CHECK (replaces_center_id IS NULL OR replaces_center_id <> id),
    CONSTRAINT temporary_download_centers_context_check CHECK (
      jsonb_typeof(context) = 'object' AND length(context::text) <= 20000 AND
      context::text !~* '"[a-z0-9_]*(credential|password|secret|token|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' AND
      context::text !~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])'
    )
);

CREATE TABLE medialab_core.temporary_download_center_versions (
    id uuid PRIMARY KEY,
    center_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    version_number integer NOT NULL,
    predecessor_version_id uuid NULL,
    selection_sha256 text NOT NULL,
    reason text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_centers(id, organization_id, property_hub_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_versions_scope_key UNIQUE (id, center_id, organization_id, property_hub_id),
    CONSTRAINT temporary_download_center_versions_center_number_key UNIQUE (center_id, version_number),
    CONSTRAINT temporary_download_center_versions_center_id_key UNIQUE (center_id, id),
    FOREIGN KEY (center_id, predecessor_version_id)
      REFERENCES medialab_core.temporary_download_center_versions(center_id, id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_versions_number_check CHECK (version_number > 0),
    CONSTRAINT temporary_download_center_versions_predecessor_check CHECK (
      (version_number = 1 AND predecessor_version_id IS NULL) OR
      (version_number > 1 AND predecessor_version_id IS NOT NULL)
    ),
    CONSTRAINT temporary_download_center_versions_hash_check CHECK (selection_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT temporary_download_center_versions_reason_check CHECK (reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000)
);

CREATE TABLE medialab_core.temporary_download_center_selections (
    id uuid PRIMARY KEY,
    center_id uuid NOT NULL,
    version_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    source_publication_id uuid NOT NULL,
    source_order_id uuid NOT NULL,
    source_job_id uuid NOT NULL,
    category_code text NOT NULL,
    selection_ordinal integer NOT NULL,
    selected_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (version_id, center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_center_versions(id, center_id, organization_id, property_hub_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_publication_id, organization_id, property_hub_id, source_order_id, source_job_id)
      REFERENCES medialab_core.media_publications(id, organization_id, property_hub_id, order_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_selections_scope_key UNIQUE (id, version_id, center_id, organization_id, property_hub_id),
    CONSTRAINT temporary_download_center_selections_pair_key UNIQUE (version_id, source_publication_id, category_code),
    CONSTRAINT temporary_download_center_selections_ordinal_key UNIQUE (version_id, selection_ordinal),
    CONSTRAINT temporary_download_center_selections_category_check CHECK (category_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT temporary_download_center_selections_ordinal_check CHECK (selection_ordinal > 0)
);

CREATE TABLE medialab_core.temporary_download_center_items (
    id uuid PRIMARY KEY,
    center_id uuid NOT NULL,
    version_id uuid NOT NULL,
    selection_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    source_publication_id uuid NOT NULL,
    source_publication_item_id uuid NOT NULL,
    source_order_id uuid NOT NULL,
    source_job_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    category_code text NOT NULL,
    placement_code text NOT NULL,
    placement_ordinal integer NOT NULL,
    materialized_ordinal integer NOT NULL,
    materialized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (selection_id, version_id, center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_center_selections(id, version_id, center_id, organization_id, property_hub_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_publication_id, source_publication_item_id)
      REFERENCES medialab_core.media_publication_items(publication_id, id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_items_scope_key UNIQUE (id, center_id, version_id),
    CONSTRAINT temporary_download_center_items_source_key UNIQUE (version_id, source_publication_item_id),
    CONSTRAINT temporary_download_center_items_materialized_key UNIQUE (version_id, materialized_ordinal),
    CONSTRAINT temporary_download_center_items_category_check CHECK (category_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT temporary_download_center_items_placement_check CHECK (placement_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT temporary_download_center_items_ordinal_check CHECK (placement_ordinal > 0 AND materialized_ordinal > 0)
);

CREATE TABLE medialab_core.temporary_download_center_events (
    id uuid PRIMARY KEY,
    center_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    version_id uuid NULL,
    event_type text NOT NULL,
    previous_state text NULL,
    resulting_state text NOT NULL,
    related_center_id uuid NULL REFERENCES medialab_core.temporary_download_centers(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_centers(id, organization_id, property_hub_id) ON DELETE RESTRICT,
    FOREIGN KEY (version_id, center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_center_versions(id, center_id, organization_id, property_hub_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_events_center_id_key UNIQUE (center_id, id),
    CONSTRAINT temporary_download_center_events_type_check CHECK (event_type IN ('CREATED','SELECTION_UPDATED','REPLACED','REVOKED')),
    CONSTRAINT temporary_download_center_events_previous_check CHECK (previous_state IS NULL OR previous_state IN ('ACTIVE','REVOKED','REPLACED')),
    CONSTRAINT temporary_download_center_events_resulting_check CHECK (resulting_state IN ('ACTIVE','REVOKED','REPLACED')),
    CONSTRAINT temporary_download_center_events_transition_check CHECK (
      (event_type = 'CREATED' AND previous_state IS NULL AND resulting_state = 'ACTIVE') OR
      (event_type = 'SELECTION_UPDATED' AND previous_state = 'ACTIVE' AND resulting_state = 'ACTIVE') OR
      (event_type = 'REPLACED' AND previous_state = 'ACTIVE' AND resulting_state = 'REPLACED' AND related_center_id IS NOT NULL) OR
      (event_type = 'REVOKED' AND previous_state = 'ACTIVE' AND resulting_state = 'REVOKED')
    ),
    CONSTRAINT temporary_download_center_events_reason_check CHECK (reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000),
    CONSTRAINT temporary_download_center_events_evidence_check CHECK (
      jsonb_typeof(evidence) = 'object' AND length(evidence::text) <= 20000 AND
      evidence::text !~* '"[a-z0-9_]*(credential|password|secret|token|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' AND
      evidence::text !~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])'
    )
);

CREATE TABLE medialab_core.temporary_download_center_current (
    center_id uuid PRIMARY KEY REFERENCES medialab_core.temporary_download_centers(id) ON DELETE RESTRICT,
    current_version_id uuid NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
    generation bigint NOT NULL DEFAULT 0,
    terminal_event_id uuid NULL,
    replacement_center_id uuid NULL REFERENCES medialab_core.temporary_download_centers(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (center_id, current_version_id)
      REFERENCES medialab_core.temporary_download_center_versions(center_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (center_id, terminal_event_id)
      REFERENCES medialab_core.temporary_download_center_events(center_id, id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_current_state_check CHECK (lifecycle_state IN ('ACTIVE','REVOKED','REPLACED')),
    CONSTRAINT temporary_download_center_current_generation_check CHECK (generation >= 0),
    CONSTRAINT temporary_download_center_current_terminal_check CHECK (
      (lifecycle_state = 'ACTIVE' AND terminal_event_id IS NULL AND replacement_center_id IS NULL) OR
      (lifecycle_state = 'REVOKED' AND terminal_event_id IS NOT NULL AND replacement_center_id IS NULL) OR
      (lifecycle_state = 'REPLACED' AND terminal_event_id IS NOT NULL AND replacement_center_id IS NOT NULL)
    )
);

CREATE TABLE medialab_core.temporary_download_center_access_observations (
    id uuid PRIMARY KEY,
    center_id uuid NOT NULL,
    version_id uuid NOT NULL,
    item_id uuid NULL,
    event_kind text NOT NULL,
    observed_outcome text NOT NULL,
    reason_code text NOT NULL,
    access_event_reference text NOT NULL UNIQUE,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (center_id, version_id)
      REFERENCES medialab_core.temporary_download_center_versions(center_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, center_id, version_id)
      REFERENCES medialab_core.temporary_download_center_items(id, center_id, version_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_observations_kind_check CHECK (event_kind IN ('OPEN','DOWNLOAD')),
    CONSTRAINT temporary_download_center_observations_outcome_check CHECK (observed_outcome IN ('ALLOW','DENY')),
    CONSTRAINT temporary_download_center_observations_reason_check CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT temporary_download_center_observations_reference_check CHECK (access_event_reference ~ '^[A-Z0-9][A-Z0-9_.:-]{2,199}$'),
    CONSTRAINT temporary_download_center_observations_item_check CHECK (event_kind = 'OPEN' OR item_id IS NOT NULL),
    CONSTRAINT temporary_download_center_observations_evidence_check CHECK (
      jsonb_typeof(evidence) = 'object' AND length(evidence::text) <= 20000 AND
      evidence::text !~* '"[a-z0-9_]*(credential|password|secret|token|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' AND
      evidence::text !~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])'
    )
);

CREATE INDEX temporary_download_centers_hub_idx ON medialab_core.temporary_download_centers(organization_id,property_hub_id,created_at,id);
CREATE INDEX temporary_download_center_versions_history_idx ON medialab_core.temporary_download_center_versions(center_id,version_number,id);
CREATE INDEX temporary_download_center_selections_history_idx ON medialab_core.temporary_download_center_selections(version_id,selection_ordinal,id);
CREATE INDEX temporary_download_center_items_snapshot_idx ON medialab_core.temporary_download_center_items(version_id,materialized_ordinal,id);
CREATE INDEX temporary_download_center_events_history_idx ON medialab_core.temporary_download_center_events(center_id,recorded_at,id);
CREATE INDEX temporary_download_center_observations_history_idx ON medialab_core.temporary_download_center_access_observations(center_id,observed_at,id);

CREATE OR REPLACE FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation()
RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION '% rows are immutable append-only Temporary Download Center evidence: UPDATE and DELETE are rejected',TG_TABLE_NAME USING ERRCODE='42501';
END; $$ LANGUAGE plpgsql SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_temporary_download_center_text(p_text text,p_required boolean,p_limit integer)
RETURNS void AS $$ BEGIN
  IF (p_required AND (p_text IS NULL OR p_text='')) OR
     (p_text IS NOT NULL AND (p_text<>btrim(p_text) OR p_text='' OR length(p_text)>p_limit OR p_text ~ '@' OR
      p_text ~* '(password|credential|secret|token|oauth|access[_ -]?key|private[_ -]?key|signed[_ -]?(url|uri)|https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/]|base64)')) THEN
    RAISE EXCEPTION 'Bounded provider-neutral text without accounts, secrets, URLs, paths, or media data is required' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_temporary_download_center_json(p_evidence jsonb)
RETURNS void AS $$ BEGIN
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR length(p_evidence::text)>20000 OR
     p_evidence::text ~* '"[a-z0-9_]*(credential|password|secret|token|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' OR
     p_evidence::text ~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])' THEN
    RAISE EXCEPTION 'Temporary Download Center evidence contains prohibited secrets, provider payloads, URLs, paths, or media data' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.normalize_temporary_download_center_selections(p_selections jsonb)
RETURNS jsonb AS $$
DECLARE v_entry jsonb;v_count integer;v_duplicate integer;v_result jsonb;
BEGIN
  IF p_selections IS NULL OR jsonb_typeof(p_selections)<>'array' THEN RAISE EXCEPTION 'Selections must be a bounded JSON array' USING ERRCODE='22023';END IF;
  v_count:=jsonb_array_length(p_selections);
  IF v_count<1 OR v_count>100 THEN RAISE EXCEPTION 'Selection count must be between 1 and 100' USING ERRCODE='22023';END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
    IF jsonb_typeof(v_entry)<>'object' OR NOT (v_entry?'publication_id') OR NOT (v_entry?'category_code') OR
       (SELECT count(*) FROM jsonb_object_keys(v_entry))<>2 OR
       COALESCE(v_entry->>'publication_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
       COALESCE(v_entry->>'category_code','') !~ '^[A-Z][A-Z0-9_]{1,79}$' THEN
      RAISE EXCEPTION 'Each selection must contain only a valid publication_id and category_code' USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_duplicate FROM (
    SELECT value->>'publication_id',value->>'category_code' FROM jsonb_array_elements(p_selections)
     GROUP BY value->>'publication_id',value->>'category_code' HAVING count(*)>1
  ) d;
  IF v_duplicate>0 THEN RAISE EXCEPTION 'Duplicate publication/category selections are rejected' USING ERRCODE='23505';END IF;
  SELECT jsonb_agg(jsonb_build_object('publication_id',value->>'publication_id','category_code',value->>'category_code') ORDER BY value->>'publication_id',value->>'category_code')
    INTO v_result FROM jsonb_array_elements(p_selections);
  RETURN v_result;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.temporary_download_center_hub_authority(p_actor uuid,p_organization uuid,p_hub uuid,p_permission text)
RETURNS text AS $$
DECLARE v_membership uuid;v_admin boolean;v_role text;
BEGIN
  IF NOT medialab_core.actor_has_permission(p_actor,p_organization,p_permission) THEN RETURN 'NONE';END IF;
  SELECT m.id,m.is_organization_admin,hp.participant_role INTO v_membership,v_admin,v_role
    FROM medialab_core.identities i
    JOIN medialab_core.person_account_states s ON s.identity_id=i.id AND s.person_id=i.person_id AND s.current_state IN ('ACTIVE','RECOVERED')
    JOIN medialab_core.memberships m ON m.person_id=i.person_id AND m.organization_id=p_organization AND m.status='ACTIVE'
    JOIN medialab_core.property_hub_participants hp ON hp.membership_id=m.id AND hp.organization_id=m.organization_id AND hp.property_hub_id=p_hub
   WHERE i.id=p_actor AND i.status='ACTIVE' ORDER BY hp.participant_role LIMIT 1;
  IF v_membership IS NULL THEN RETURN 'NONE';END IF;
  IF v_admin THEN RETURN 'ORGANIZATION_ADMIN';END IF;
  RETURN v_role;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.materialize_temporary_download_center_version(p_center uuid,p_version uuid,p_selections jsonb,p_actor uuid)
RETURNS jsonb AS $$
DECLARE c medialab_core.temporary_download_centers%ROWTYPE;v medialab_core.temporary_download_center_versions%ROWTYPE;entry jsonb;p medialab_core.media_publications%ROWTYPE;pc medialab_core.media_publication_current%ROWTYPE;i medialab_core.media_publication_items%ROWTYPE;s uuid;selection_ordinal integer:=0;item_ordinal integer:=0;
BEGIN
  SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  SELECT * INTO v FROM medialab_core.temporary_download_center_versions WHERE id=p_version AND center_id=p_center;
  IF c.id IS NULL OR v.id IS NULL THEN RAISE EXCEPTION 'Center/version materialization scope is invalid' USING ERRCODE='22023';END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_selections) ORDER BY value->>'publication_id',value->>'category_code' LOOP
    SELECT * INTO p FROM medialab_core.media_publications WHERE id=(entry->>'publication_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected publication is missing or unavailable' USING ERRCODE='42501';END IF;
    IF p.organization_id<>c.organization_id OR p.property_hub_id<>c.property_hub_id THEN RAISE EXCEPTION 'Selected publication crosses the center organization or Property Hub scope' USING ERRCODE='42501';END IF;
    SELECT * INTO pc FROM medialab_core.media_publication_current WHERE publication_id=p.id;
    IF pc.current_state<>'ACTIVE' THEN RAISE EXCEPTION 'Selected publication must be currently ACTIVE' USING ERRCODE='22023';END IF;
    IF NOT EXISTS(SELECT 1 FROM medialab_core.media_publication_items x WHERE x.publication_id=p.id AND x.category_code=entry->>'category_code') THEN RAISE EXCEPTION 'Selected publication category has no current publication items' USING ERRCODE='22023';END IF;
    selection_ordinal:=selection_ordinal+1;s:=gen_random_uuid();
    INSERT INTO medialab_core.temporary_download_center_selections(id,center_id,version_id,organization_id,property_hub_id,source_publication_id,source_order_id,source_job_id,category_code,selection_ordinal,selected_by_identity_id)
      VALUES(s,c.id,v.id,c.organization_id,c.property_hub_id,p.id,p.order_id,p.job_id,entry->>'category_code',selection_ordinal,p_actor);
    FOR i IN SELECT * FROM medialab_core.media_publication_items x WHERE x.publication_id=p.id AND x.category_code=entry->>'category_code' ORDER BY x.category_code,x.placement_code,x.placement_ordinal,x.id LOOP
      item_ordinal:=item_ordinal+1;
      INSERT INTO medialab_core.temporary_download_center_items(id,center_id,version_id,selection_id,organization_id,property_hub_id,source_publication_id,source_publication_item_id,source_order_id,source_job_id,media_asset_id,media_asset_version_id,category_code,placement_code,placement_ordinal,materialized_ordinal)
        VALUES(gen_random_uuid(),c.id,v.id,s,c.organization_id,c.property_hub_id,p.id,i.id,p.order_id,p.job_id,i.media_asset_id,i.media_asset_version_id,i.category_code,i.placement_code,i.placement_ordinal,item_ordinal);
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('selection_count',selection_ordinal,'item_count',item_ordinal);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_temporary_download_center(p_session text,p_key text,p_property_hub uuid,p_expiration_days integer,p_stakeholder_label text,p_selections jsonb,p_reason text,p_context jsonb)
RETURNS uuid AS $$
DECLARE a uuid;h medialab_core.property_hubs%ROWTYPE;normalized jsonb;now_at timestamptz;x uuid;v uuid;e uuid;q text;r jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO h FROM medialab_core.property_hubs WHERE id=p_property_hub;
  IF NOT FOUND OR medialab_core.temporary_download_center_hub_authority(a,h.organization_id,h.id,'temporary_download_center.create')='NONE' THEN RAISE EXCEPTION 'Actor lacks scoped Temporary Download Center creation authority' USING ERRCODE='42501';END IF;
  IF p_expiration_days NOT IN (3,7,14) THEN RAISE EXCEPTION 'Expiration must be exactly 3, 7, or 14 days' USING ERRCODE='22023';END IF;
  PERFORM medialab_core.validate_temporary_download_center_text(p_stakeholder_label,false,200);PERFORM medialab_core.validate_temporary_download_center_text(p_reason,true,1000);PERFORM medialab_core.validate_temporary_download_center_json(p_context);normalized:=medialab_core.normalize_temporary_download_center_selections(p_selections);
  q:=encode(sha256(convert_to(jsonb_build_array(p_property_hub,p_expiration_days,p_stakeholder_label,normalized,p_reason,p_context)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'CREATE_TEMPORARY_DOWNLOAD_CENTER',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'center_id')::uuid;END IF;
  now_at:=clock_timestamp();x:=gen_random_uuid();v:=gen_random_uuid();e:=gen_random_uuid();
  INSERT INTO medialab_core.temporary_download_centers(id,organization_id,property_hub_id,created_by_identity_id,expiration_days,stakeholder_label,context,created_at,expires_at)
    VALUES(x,h.organization_id,h.id,a,p_expiration_days,p_stakeholder_label,p_context,now_at,now_at+make_interval(days=>p_expiration_days));
  INSERT INTO medialab_core.temporary_download_center_versions(id,center_id,organization_id,property_hub_id,version_number,selection_sha256,reason,created_by_identity_id,created_at)
    VALUES(v,x,h.organization_id,h.id,1,encode(sha256(convert_to(normalized::text,'UTF8')),'hex'),p_reason,a,now_at);
  PERFORM medialab_core.materialize_temporary_download_center_version(x,v,normalized,a);
  INSERT INTO medialab_core.temporary_download_center_events(id,center_id,organization_id,property_hub_id,version_id,event_type,previous_state,resulting_state,reason,evidence,recorded_by_identity_id,recorded_at)
    VALUES(e,x,h.organization_id,h.id,v,'CREATED',NULL,'ACTIVE',p_reason,'{}',a,now_at);
  INSERT INTO medialab_core.temporary_download_center_current(center_id,current_version_id,lifecycle_state,generation,updated_at) VALUES(x,v,'ACTIVE',0,now_at);
  PERFORM medialab_core.record_media_idempotency(a,'CREATE_TEMPORARY_DOWNLOAD_CENTER',p_key,q,jsonb_build_object('center_id',x));RETURN x;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.update_temporary_download_center_selection(p_session text,p_key text,p_center uuid,p_expected_generation bigint,p_selections jsonb,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;cur medialab_core.temporary_download_center_current%ROWTYPE;oldv medialab_core.temporary_download_center_versions%ROWTYPE;normalized jsonb;v uuid;e uuid;n integer;q text;r jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND OR a<>c.created_by_identity_id OR medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.manage')='NONE' THEN RAISE EXCEPTION 'Only the currently authorized center creator may update selections' USING ERRCODE='42501';END IF;
  PERFORM medialab_core.validate_temporary_download_center_text(p_reason,true,1000);normalized:=medialab_core.normalize_temporary_download_center_selections(p_selections);
  q:=encode(sha256(convert_to(jsonb_build_array(p_center,p_expected_generation,normalized,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'UPDATE_TEMPORARY_DOWNLOAD_CENTER_SELECTION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'version_id')::uuid;END IF;
  SELECT * INTO cur FROM medialab_core.temporary_download_center_current WHERE center_id=c.id FOR UPDATE;
  IF cur.lifecycle_state<>'ACTIVE' OR cur.generation<>p_expected_generation OR clock_timestamp()>=c.expires_at THEN RAISE EXCEPTION 'Selection update requires the current active unexpired generation' USING ERRCODE='40001';END IF;
  SELECT * INTO oldv FROM medialab_core.temporary_download_center_versions WHERE id=cur.current_version_id;n:=oldv.version_number+1;v:=gen_random_uuid();e:=gen_random_uuid();
  INSERT INTO medialab_core.temporary_download_center_versions(id,center_id,organization_id,property_hub_id,version_number,predecessor_version_id,selection_sha256,reason,created_by_identity_id)
    VALUES(v,c.id,c.organization_id,c.property_hub_id,n,oldv.id,encode(sha256(convert_to(normalized::text,'UTF8')),'hex'),p_reason,a);
  PERFORM medialab_core.materialize_temporary_download_center_version(c.id,v,normalized,a);
  INSERT INTO medialab_core.temporary_download_center_events(id,center_id,organization_id,property_hub_id,version_id,event_type,previous_state,resulting_state,reason,evidence,recorded_by_identity_id)
    VALUES(e,c.id,c.organization_id,c.property_hub_id,v,'SELECTION_UPDATED','ACTIVE','ACTIVE',p_reason,jsonb_build_object('previous_version_id',oldv.id,'version_number',n),a);
  UPDATE medialab_core.temporary_download_center_current SET current_version_id=v,generation=generation+1,updated_at=clock_timestamp() WHERE center_id=c.id;
  PERFORM medialab_core.record_media_idempotency(a,'UPDATE_TEMPORARY_DOWNLOAD_CENTER_SELECTION',p_key,q,jsonb_build_object('version_id',v));RETURN v;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.replace_temporary_download_center(p_session text,p_key text,p_center uuid,p_expected_generation bigint,p_expiration_days integer,p_stakeholder_label text,p_selections jsonb,p_reason text,p_context jsonb)
RETURNS uuid AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;cur medialab_core.temporary_download_center_current%ROWTYPE;normalized jsonb;now_at timestamptz;x uuid;v uuid;created_event uuid;replaced_event uuid;q text;r jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND OR a<>c.created_by_identity_id OR medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.manage')='NONE' THEN RAISE EXCEPTION 'Only the currently authorized center creator may replace the center' USING ERRCODE='42501';END IF;
  IF p_expiration_days NOT IN (3,7,14) THEN RAISE EXCEPTION 'Expiration must be exactly 3, 7, or 14 days' USING ERRCODE='22023';END IF;
  PERFORM medialab_core.validate_temporary_download_center_text(p_stakeholder_label,false,200);PERFORM medialab_core.validate_temporary_download_center_text(p_reason,true,1000);PERFORM medialab_core.validate_temporary_download_center_json(p_context);normalized:=medialab_core.normalize_temporary_download_center_selections(p_selections);
  q:=encode(sha256(convert_to(jsonb_build_array(p_center,p_expected_generation,p_expiration_days,p_stakeholder_label,normalized,p_reason,p_context)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'REPLACE_TEMPORARY_DOWNLOAD_CENTER',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'center_id')::uuid;END IF;
  SELECT * INTO cur FROM medialab_core.temporary_download_center_current WHERE center_id=c.id FOR UPDATE;
  IF cur.lifecycle_state<>'ACTIVE' OR cur.generation<>p_expected_generation THEN RAISE EXCEPTION 'Replacement requires the current active center generation' USING ERRCODE='40001';END IF;
  now_at:=clock_timestamp();x:=gen_random_uuid();v:=gen_random_uuid();created_event:=gen_random_uuid();replaced_event:=gen_random_uuid();
  INSERT INTO medialab_core.temporary_download_centers(id,organization_id,property_hub_id,created_by_identity_id,expiration_days,stakeholder_label,replaces_center_id,context,created_at,expires_at)
    VALUES(x,c.organization_id,c.property_hub_id,a,p_expiration_days,p_stakeholder_label,c.id,p_context,now_at,now_at+make_interval(days=>p_expiration_days));
  INSERT INTO medialab_core.temporary_download_center_versions(id,center_id,organization_id,property_hub_id,version_number,selection_sha256,reason,created_by_identity_id,created_at)
    VALUES(v,x,c.organization_id,c.property_hub_id,1,encode(sha256(convert_to(normalized::text,'UTF8')),'hex'),p_reason,a,now_at);
  PERFORM medialab_core.materialize_temporary_download_center_version(x,v,normalized,a);
  INSERT INTO medialab_core.temporary_download_center_events(id,center_id,organization_id,property_hub_id,version_id,event_type,previous_state,resulting_state,related_center_id,reason,evidence,recorded_by_identity_id,recorded_at)
    VALUES(created_event,x,c.organization_id,c.property_hub_id,v,'CREATED',NULL,'ACTIVE',c.id,p_reason,jsonb_build_object('replacement',true),a,now_at);
  INSERT INTO medialab_core.temporary_download_center_current(center_id,current_version_id,lifecycle_state,generation,updated_at) VALUES(x,v,'ACTIVE',0,now_at);
  INSERT INTO medialab_core.temporary_download_center_events(id,center_id,organization_id,property_hub_id,version_id,event_type,previous_state,resulting_state,related_center_id,reason,evidence,recorded_by_identity_id,recorded_at)
    VALUES(replaced_event,c.id,c.organization_id,c.property_hub_id,cur.current_version_id,'REPLACED','ACTIVE','REPLACED',x,p_reason,jsonb_build_object('replacement_center_id',x),a,now_at);
  UPDATE medialab_core.temporary_download_center_current SET lifecycle_state='REPLACED',generation=generation+1,terminal_event_id=replaced_event,replacement_center_id=x,updated_at=now_at WHERE center_id=c.id;
  PERFORM medialab_core.record_media_idempotency(a,'REPLACE_TEMPORARY_DOWNLOAD_CENTER',p_key,q,jsonb_build_object('center_id',x));RETURN x;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revoke_temporary_download_center(p_session text,p_key text,p_center uuid,p_expected_generation bigint,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;cur medialab_core.temporary_download_center_current%ROWTYPE;auth text;e uuid;q text;r jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND THEN RAISE EXCEPTION 'Temporary Download Center is missing or unavailable' USING ERRCODE='42501';END IF;
  auth:=medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.manage');
  IF auth='NONE' OR (a<>c.created_by_identity_id AND auth<>'ORGANIZATION_ADMIN') THEN RAISE EXCEPTION 'Only the authorized creator or current Organization Admin may revoke the center' USING ERRCODE='42501';END IF;
  PERFORM medialab_core.validate_temporary_download_center_text(p_reason,true,1000);q:=encode(sha256(convert_to(jsonb_build_array(p_center,p_expected_generation,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'REVOKE_TEMPORARY_DOWNLOAD_CENTER',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;
  SELECT * INTO cur FROM medialab_core.temporary_download_center_current WHERE center_id=c.id FOR UPDATE;
  IF cur.lifecycle_state<>'ACTIVE' OR cur.generation<>p_expected_generation THEN RAISE EXCEPTION 'Revocation requires the current active center generation' USING ERRCODE='40001';END IF;
  e:=gen_random_uuid();INSERT INTO medialab_core.temporary_download_center_events(id,center_id,organization_id,property_hub_id,version_id,event_type,previous_state,resulting_state,reason,evidence,recorded_by_identity_id)
    VALUES(e,c.id,c.organization_id,c.property_hub_id,cur.current_version_id,'REVOKED','ACTIVE','REVOKED',p_reason,'{}',a);
  UPDATE medialab_core.temporary_download_center_current SET lifecycle_state='REVOKED',generation=generation+1,terminal_event_id=e,updated_at=clock_timestamp() WHERE center_id=c.id;
  PERFORM medialab_core.record_media_idempotency(a,'REVOKE_TEMPORARY_DOWNLOAD_CENTER',p_key,q,jsonb_build_object('event_id',e));RETURN e;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_temporary_download_center(p_session text,p_center uuid)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;z jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND OR medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.read')='NONE' THEN RAISE EXCEPTION 'Temporary Download Center is missing or unavailable to the scoped actor' USING ERRCODE='42501';END IF;
  SELECT jsonb_build_object('center',to_jsonb(c),'current',to_jsonb(cur),'versions',COALESCE((SELECT jsonb_agg(jsonb_build_object('version',to_jsonb(v),'selections',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.selection_ordinal,s.id) FROM medialab_core.temporary_download_center_selections s WHERE s.version_id=v.id),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.materialized_ordinal,i.id) FROM medialab_core.temporary_download_center_items i WHERE i.version_id=v.id),'[]'::jsonb)) ORDER BY v.version_number,v.id) FROM medialab_core.temporary_download_center_versions v WHERE v.center_id=c.id),'[]'::jsonb),'events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at,e.id) FROM medialab_core.temporary_download_center_events e WHERE e.center_id=c.id),'[]'::jsonb)) INTO z FROM medialab_core.temporary_download_center_current cur WHERE cur.center_id=c.id;RETURN z;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.evaluate_temporary_download_center_policy(p_session text,p_center uuid)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;cur medialab_core.temporary_download_center_current%ROWTYPE;creator_auth text;effective text;decision text;reason text;publication_count integer;order_count integer;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND OR medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.read')='NONE' THEN RAISE EXCEPTION 'Temporary Download Center policy is unavailable to the scoped actor' USING ERRCODE='42501';END IF;
  SELECT * INTO cur FROM medialab_core.temporary_download_center_current WHERE center_id=c.id;
  SELECT count(DISTINCT source_publication_id),count(DISTINCT source_order_id) INTO publication_count,order_count FROM medialab_core.temporary_download_center_selections WHERE version_id=cur.current_version_id;
  creator_auth:=medialab_core.temporary_download_center_hub_authority(c.created_by_identity_id,c.organization_id,c.property_hub_id,'temporary_download_center.manage');
  IF cur.lifecycle_state='REVOKED' THEN effective:='REVOKED';decision:='POLICY_LOCKED';reason:='CENTER_REVOKED';
  ELSIF cur.lifecycle_state='REPLACED' THEN effective:='REPLACED';decision:='POLICY_LOCKED';reason:='CENTER_REPLACED';
  ELSIF clock_timestamp()>=c.expires_at THEN effective:='EXPIRED';decision:='POLICY_LOCKED';reason:='CENTER_EXPIRED';
  ELSIF creator_auth='NONE' THEN effective:='POLICY_LOCKED';decision:='POLICY_LOCKED';reason:='CREATOR_AUTHORITY_LOCKED';
  ELSIF EXISTS(SELECT 1 FROM medialab_core.temporary_download_center_selections s JOIN medialab_core.media_publication_current pc ON pc.publication_id=s.source_publication_id WHERE s.version_id=cur.current_version_id AND pc.current_state<>'ACTIVE') THEN effective:='POLICY_LOCKED';decision:='POLICY_LOCKED';reason:='SOURCE_PUBLICATION_LOCKED';
  ELSIF EXISTS(SELECT 1 FROM (SELECT DISTINCT source_order_id FROM medialab_core.temporary_download_center_selections WHERE version_id=cur.current_version_id) selected JOIN medialab_core.orders o ON o.id=selected.source_order_id WHERE o.settlement_mode='PAY_NOW' AND NOT EXISTS(SELECT 1 FROM medialab_core.delivery_financial_eligibility_evidence f WHERE f.order_id=o.id AND f.organization_id=o.organization_id AND f.eligibility='ELIGIBLE' AND NOT EXISTS(SELECT 1 FROM medialab_core.delivery_financial_eligibility_evidence n WHERE n.supersedes_evidence_id=f.id))) THEN effective:='POLICY_LOCKED';decision:='POLICY_LOCKED';reason:='SOURCE_FINANCIAL_GATE_LOCKED';
  ELSE effective:='ACTIVE';decision:='POLICY_ELIGIBLE';reason:='CURRENT_POLICY_ELIGIBLE';END IF;
  RETURN jsonb_build_object('center_id',c.id,'current_version_id',cur.current_version_id,'generation',cur.generation,'effective_state',effective,'policy_decision',decision,'reason_code',reason,'source_publication_count',publication_count,'source_order_count',order_count,'evaluated_at',clock_timestamp());
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_temporary_download_center_activity(p_session text,p_center uuid)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;auth text;z jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND THEN RAISE EXCEPTION 'Temporary Download Center is missing or unavailable' USING ERRCODE='42501';END IF;
  auth:=medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.activity.read');
  IF auth='NONE' OR (a<>c.created_by_identity_id AND auth<>'ORGANIZATION_ADMIN') THEN RAISE EXCEPTION 'Only the authorized creator or current Organization Admin may read center activity evidence' USING ERRCODE='42501';END IF;
  SELECT jsonb_build_object('center_id',c.id,'observations',COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.observed_at,o.id) FILTER(WHERE o.id IS NOT NULL),'[]'::jsonb)) INTO z FROM medialab_core.temporary_download_center_access_observations o WHERE o.center_id=c.id;RETURN z;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE TRIGGER temporary_download_centers_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_centers FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation();
CREATE TRIGGER temporary_download_center_versions_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_versions FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation();
CREATE TRIGGER temporary_download_center_selections_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_selections FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation();
CREATE TRIGGER temporary_download_center_items_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_items FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation();
CREATE TRIGGER temporary_download_center_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_events FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation();
CREATE TRIGGER temporary_download_center_observations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_access_observations FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.temporary_download_centers,medialab_core.temporary_download_center_versions,medialab_core.temporary_download_center_selections,medialab_core.temporary_download_center_items,medialab_core.temporary_download_center_events,medialab_core.temporary_download_center_current,medialab_core.temporary_download_center_access_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_temporary_download_center_evidence_mutation(),medialab_core.validate_temporary_download_center_text(text,boolean,integer),medialab_core.validate_temporary_download_center_json(jsonb),medialab_core.normalize_temporary_download_center_selections(jsonb),medialab_core.temporary_download_center_hub_authority(uuid,uuid,uuid,text),medialab_core.materialize_temporary_download_center_version(uuid,uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_temporary_download_center(text,text,uuid,integer,text,jsonb,text,jsonb),medialab_core.update_temporary_download_center_selection(text,text,uuid,bigint,jsonb,text),medialab_core.replace_temporary_download_center(text,text,uuid,bigint,integer,text,jsonb,text,jsonb),medialab_core.revoke_temporary_download_center(text,text,uuid,bigint,text),medialab_core.get_temporary_download_center(text,uuid),medialab_core.evaluate_temporary_download_center_policy(text,uuid),medialab_core.get_temporary_download_center_activity(text,uuid) FROM PUBLIC;
