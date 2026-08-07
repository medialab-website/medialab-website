-- P02-M14-A: provider-neutral publication and delivery-entitlement foundation.
-- Database evidence only: no provider I/O, payment processing, URLs, downloads, or media movement.

CREATE TABLE medialab_core.media_publications (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    property_hub_id uuid NOT NULL,
    order_id uuid NOT NULL,
    job_id uuid NOT NULL,
    service_workstream_id uuid NULL,
    publication_number integer NOT NULL,
    supersedes_publication_id uuid NULL REFERENCES medialab_core.media_publications(id) ON DELETE RESTRICT,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (property_hub_id, organization_id) REFERENCES medialab_core.property_hubs(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id, organization_id) REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_id, organization_id, order_id) REFERENCES medialab_core.jobs(id, organization_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_workstream_id, job_id, organization_id) REFERENCES medialab_core.service_workstreams(id, job_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT media_publications_scope_key UNIQUE (id, organization_id, property_hub_id, order_id, job_id),
    CONSTRAINT media_publications_job_number_key UNIQUE (job_id, publication_number),
    CONSTRAINT media_publications_number_check CHECK (publication_number > 0),
    CONSTRAINT media_publications_not_self_check CHECK (supersedes_publication_id IS NULL OR supersedes_publication_id <> id),
    CONSTRAINT media_publications_context_check CHECK (jsonb_typeof(context) = 'object')
);

CREATE TABLE medialab_core.media_publication_items (
    id uuid PRIMARY KEY,
    publication_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    order_id uuid NOT NULL,
    job_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    media_asset_version_id uuid NOT NULL,
    final_source_designation_id uuid NOT NULL REFERENCES medialab_core.media_approved_source_designations(id) ON DELETE RESTRICT,
    category_code text NOT NULL,
    placement_code text NOT NULL,
    placement_ordinal integer NOT NULL,
    reason text NOT NULL,
    admitted_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (publication_id, organization_id, property_hub_id, order_id, job_id)
      REFERENCES medialab_core.media_publications(id, organization_id, property_hub_id, order_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_id, organization_id, job_id) REFERENCES medialab_core.media_assets(id, organization_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (media_asset_version_id, organization_id, job_id) REFERENCES medialab_core.media_asset_versions(id, organization_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_publication_items_publication_id_key UNIQUE (publication_id, id),
    CONSTRAINT media_publication_items_exact_version_key UNIQUE (publication_id, media_asset_version_id),
    CONSTRAINT media_publication_items_placement_key UNIQUE (publication_id, category_code, placement_code, placement_ordinal),
    CONSTRAINT media_publication_items_category_check CHECK (category_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_publication_items_placement_check CHECK (placement_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT media_publication_items_ordinal_check CHECK (placement_ordinal > 0),
    CONSTRAINT media_publication_items_reason_check CHECK (reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000)
);

CREATE TABLE medialab_core.media_publication_events (
    id uuid PRIMARY KEY,
    publication_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    order_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (publication_id, organization_id, property_hub_id, order_id, job_id)
      REFERENCES medialab_core.media_publications(id, organization_id, property_hub_id, order_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT media_publication_events_type_check CHECK (event_type IN ('DRAFT_CREATED','SEALED','ACTIVATED','REVOKED','SUPERSEDED')),
    CONSTRAINT media_publication_events_reason_check CHECK (reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000),
    CONSTRAINT media_publication_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE medialab_core.media_publication_current (
    publication_id uuid PRIMARY KEY REFERENCES medialab_core.media_publications(id) ON DELETE RESTRICT,
    current_state text NOT NULL DEFAULT 'DRAFT',
    item_count integer NOT NULL DEFAULT 0,
    lifecycle_generation bigint NOT NULL DEFAULT 0,
    sealed_event_id uuid NULL REFERENCES medialab_core.media_publication_events(id) ON DELETE RESTRICT,
    activated_event_id uuid NULL REFERENCES medialab_core.media_publication_events(id) ON DELETE RESTRICT,
    terminal_event_id uuid NULL REFERENCES medialab_core.media_publication_events(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT media_publication_current_state_check CHECK (current_state IN ('DRAFT','SEALED','ACTIVE','REVOKED','SUPERSEDED')),
    CONSTRAINT media_publication_current_count_check CHECK (item_count >= 0),
    CONSTRAINT media_publication_current_event_check CHECK (
      (current_state = 'DRAFT' AND sealed_event_id IS NULL AND activated_event_id IS NULL AND terminal_event_id IS NULL) OR
      (current_state = 'SEALED' AND sealed_event_id IS NOT NULL AND activated_event_id IS NULL AND terminal_event_id IS NULL) OR
      (current_state = 'ACTIVE' AND sealed_event_id IS NOT NULL AND activated_event_id IS NOT NULL AND terminal_event_id IS NULL) OR
      (current_state IN ('REVOKED','SUPERSEDED') AND sealed_event_id IS NOT NULL AND activated_event_id IS NOT NULL AND terminal_event_id IS NOT NULL)
    )
);

CREATE TABLE medialab_core.delivery_financial_eligibility_evidence (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL,
    eligibility text NOT NULL,
    evidence_kind text NOT NULL,
    evidence_reference text NOT NULL,
    supersedes_evidence_id uuid NULL REFERENCES medialab_core.delivery_financial_eligibility_evidence(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (order_id, organization_id) REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT delivery_financial_evidence_scope_key UNIQUE (id, organization_id, order_id),
    CONSTRAINT delivery_financial_evidence_value_check CHECK (eligibility IN ('ELIGIBLE','INELIGIBLE')),
    CONSTRAINT delivery_financial_evidence_kind_check CHECK (evidence_kind IN ('BOUNDED_SETTLEMENT_AUTHORITY','NONPRODUCTION_FIXTURE')),
    CONSTRAINT delivery_financial_evidence_reference_check CHECK (evidence_reference ~ '^[A-Z0-9][A-Z0-9_.:-]{2,199}$'),
    CONSTRAINT delivery_financial_evidence_reason_check CHECK (reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000)
);

CREATE TABLE medialab_core.delivery_entitlement_evaluations (
    id uuid PRIMARY KEY,
    publication_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    order_id uuid NOT NULL,
    job_id uuid NOT NULL,
    subject_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    grant_id uuid NULL,
    requested_capability text NOT NULL,
    subject_authority text NOT NULL,
    publication_state text NOT NULL,
    settlement_mode text NOT NULL,
    financial_gate text NOT NULL,
    financial_evidence_id uuid NULL,
    decision text NOT NULL,
    reason_code text NOT NULL,
    request_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key text NOT NULL,
    evaluated_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (publication_id, organization_id, property_hub_id, order_id, job_id)
      REFERENCES medialab_core.media_publications(id, organization_id, property_hub_id, order_id, job_id) ON DELETE RESTRICT,
    FOREIGN KEY (financial_evidence_id, organization_id, order_id)
      REFERENCES medialab_core.delivery_financial_eligibility_evidence(id, organization_id, order_id) ON DELETE RESTRICT,
    CONSTRAINT delivery_evaluations_capability_check CHECK (requested_capability IN ('PREVIEW','DOWNLOAD')),
    CONSTRAINT delivery_evaluations_authority_check CHECK (subject_authority IN ('COMMERCIAL_OWNER','CURRENT_HUB_MANAGER','CURRENT_HUB_ADMIN','NONE')),
    CONSTRAINT delivery_evaluations_publication_state_check CHECK (publication_state IN ('DRAFT','SEALED','ACTIVE','REVOKED','SUPERSEDED')),
    CONSTRAINT delivery_evaluations_settlement_check CHECK (settlement_mode IN ('PAY_NOW','APPROVED_TERMS')),
    CONSTRAINT delivery_evaluations_financial_gate_check CHECK (financial_gate IN ('NOT_REQUIRED','APPROVED_TERMS','ELIGIBLE_EVIDENCE','LOCKED')),
    CONSTRAINT delivery_evaluations_decision_check CHECK (decision IN ('ALLOW','DENY')),
    CONSTRAINT delivery_evaluations_reason_code_check CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT delivery_evaluations_request_check CHECK (jsonb_typeof(request_evidence) = 'object'),
    CONSTRAINT delivery_evaluations_key_check CHECK (idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200)
);

CREATE TABLE medialab_core.delivery_grants (
    id uuid PRIMARY KEY,
    evaluation_id uuid NOT NULL UNIQUE REFERENCES medialab_core.delivery_entitlement_evaluations(id) ON DELETE RESTRICT,
    publication_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    order_id uuid NOT NULL,
    job_id uuid NOT NULL,
    subject_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    capability text NOT NULL,
    granted_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (publication_id, organization_id, property_hub_id, order_id, job_id)
      REFERENCES medialab_core.media_publications(id, organization_id, property_hub_id, order_id, job_id) ON DELETE RESTRICT,
    CONSTRAINT delivery_grants_scope_key UNIQUE (id, publication_id, organization_id, order_id),
    CONSTRAINT delivery_grants_capability_check CHECK (capability IN ('PREVIEW','DOWNLOAD'))
);

ALTER TABLE medialab_core.delivery_entitlement_evaluations
  ADD CONSTRAINT delivery_evaluations_grant_fk FOREIGN KEY (grant_id) REFERENCES medialab_core.delivery_grants(id) ON DELETE RESTRICT;

CREATE TABLE medialab_core.delivery_grant_events (
    id uuid PRIMARY KEY,
    grant_id uuid NOT NULL,
    publication_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (grant_id, publication_id, organization_id, order_id)
      REFERENCES medialab_core.delivery_grants(id, publication_id, organization_id, order_id) ON DELETE RESTRICT,
    CONSTRAINT delivery_grant_events_type_check CHECK (event_type IN ('GRANTED','REVOKED','PUBLICATION_INVALIDATED','SUPERSEDED_INVALIDATED')),
    CONSTRAINT delivery_grant_events_reason_check CHECK (reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000)
);

CREATE TABLE medialab_core.delivery_grant_current (
    grant_id uuid PRIMARY KEY REFERENCES medialab_core.delivery_grants(id) ON DELETE RESTRICT,
    current_state text NOT NULL DEFAULT 'ACTIVE',
    terminal_event_id uuid NULL REFERENCES medialab_core.delivery_grant_events(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT delivery_grant_current_state_check CHECK (current_state IN ('ACTIVE','REVOKED','PUBLICATION_INVALIDATED','SUPERSEDED_INVALIDATED')),
    CONSTRAINT delivery_grant_current_event_check CHECK (
      (current_state = 'ACTIVE' AND terminal_event_id IS NULL) OR
      (current_state <> 'ACTIVE' AND terminal_event_id IS NOT NULL)
    )
);

CREATE INDEX media_publications_scope_idx ON medialab_core.media_publications(organization_id,property_hub_id,order_id,job_id,publication_number);
CREATE INDEX media_publication_items_order_idx ON medialab_core.media_publication_items(publication_id,category_code,placement_code,placement_ordinal,id);
CREATE INDEX media_publication_events_history_idx ON medialab_core.media_publication_events(publication_id,recorded_at,id);
CREATE INDEX delivery_evaluations_subject_idx ON medialab_core.delivery_entitlement_evaluations(subject_identity_id,publication_id,evaluated_at,id);
CREATE INDEX delivery_grants_subject_idx ON medialab_core.delivery_grants(subject_identity_id,publication_id,granted_at,id);

CREATE OR REPLACE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation()
RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION '% rows are immutable append-only publication/delivery evidence: UPDATE and DELETE are rejected',TG_TABLE_NAME USING ERRCODE='42501';
END; $$ LANGUAGE plpgsql SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_publication_delivery_permission(p_actor uuid,p_organization uuid,p_permission text)
RETURNS void AS $$ BEGIN
  IF NOT medialab_core.actor_has_permission(p_actor,p_organization,p_permission) THEN
    RAISE EXCEPTION 'Actor lacks active % authority for the target organization',p_permission USING ERRCODE='42501';
  END IF;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_publication_delivery_text(p_text text,p_required boolean,p_limit integer)
RETURNS void AS $$ BEGIN
  IF (p_required AND (p_text IS NULL OR p_text='')) OR
     (p_text IS NOT NULL AND (p_text<>btrim(p_text) OR p_text='' OR length(p_text)>p_limit OR
      p_text ~* '(password|credential|secret|token|oauth|access[_ -]?key|private[_ -]?key|signed[_ -]?(url|uri)|https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/]|base64)')) THEN
    RAISE EXCEPTION 'Bounded provider-neutral text without secrets, URLs, paths, or media data is required' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_publication_delivery_json(p_evidence jsonb)
RETURNS void AS $$ BEGIN
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR length(p_evidence::text)>20000 OR
     p_evidence::text ~* '"([a-z0-9_]*(credential|password|secret|token|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64|thumbnail|proxy)[a-z0-9_]*)"[[:space:]]*:' OR
     p_evidence::text ~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/])' THEN
    RAISE EXCEPTION 'Publication/delivery evidence contains prohibited secrets, provider payloads, URLs, paths, or media data' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.delivery_subject_authority(p_actor uuid,p_organization uuid,p_hub uuid,p_order uuid)
RETURNS text AS $$
DECLARE v_person uuid;v_membership uuid;v_admin boolean;
BEGIN
  SELECT i.person_id,m.id,m.is_organization_admin INTO v_person,v_membership,v_admin
    FROM medialab_core.identities i
    JOIN medialab_core.person_account_states s ON s.identity_id=i.id AND s.person_id=i.person_id AND s.current_state IN ('ACTIVE','RECOVERED')
    JOIN medialab_core.memberships m ON m.person_id=i.person_id AND m.organization_id=p_organization AND m.status='ACTIVE'
   WHERE i.id=p_actor AND i.status='ACTIVE' LIMIT 1;
  IF v_person IS NULL THEN RETURN 'NONE';END IF;
  IF EXISTS(SELECT 1 FROM medialab_core.order_parties op WHERE op.order_id=p_order AND op.party_role='COMMERCIAL_OWNER' AND op.party_kind='PERSON' AND op.person_id=v_person AND op.membership_id=v_membership) THEN RETURN 'COMMERCIAL_OWNER';END IF;
  IF v_admin AND EXISTS(SELECT 1 FROM medialab_core.property_hub_participants hp WHERE hp.property_hub_id=p_hub AND hp.membership_id=v_membership) THEN RETURN 'CURRENT_HUB_ADMIN';END IF;
  IF medialab_core.actor_has_permission(p_actor,p_organization,'delivery_entitlement.evaluate') AND
     EXISTS(SELECT 1 FROM medialab_core.property_hub_participants hp WHERE hp.property_hub_id=p_hub AND hp.membership_id=v_membership AND hp.participant_role='HUB_MANAGER') THEN RETURN 'CURRENT_HUB_MANAGER';END IF;
  RETURN 'NONE';
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.invalidate_publication_grants(p_publication uuid,p_event_type text,p_reason text,p_actor uuid)
RETURNS void AS $$
DECLARE g record;e uuid;
BEGIN
  FOR g IN SELECT x.id,x.organization_id,x.order_id FROM medialab_core.delivery_grants x JOIN medialab_core.delivery_grant_current c ON c.grant_id=x.id WHERE x.publication_id=p_publication AND c.current_state='ACTIVE' FOR UPDATE OF c LOOP
    e:=gen_random_uuid();
    INSERT INTO medialab_core.delivery_grant_events(id,grant_id,publication_id,organization_id,order_id,event_type,reason,recorded_by_identity_id)
      VALUES(e,g.id,p_publication,g.organization_id,g.order_id,p_event_type,p_reason,p_actor);
    UPDATE medialab_core.delivery_grant_current SET current_state=p_event_type,terminal_event_id=e,updated_at=clock_timestamp() WHERE grant_id=g.id;
  END LOOP;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_media_publication(p_session text,p_key text,p_job uuid,p_workstream uuid,p_supersedes uuid,p_reason text,p_context jsonb)
RETURNS uuid AS $$
DECLARE a uuid;j medialab_core.jobs%ROWTYPE;w medialab_core.service_workstreams%ROWTYPE;old medialab_core.media_publications%ROWTYPE;n integer;x uuid;q text;r jsonb;
BEGIN
 SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO j FROM medialab_core.jobs WHERE id=p_job;
 IF NOT FOUND OR j.property_hub_id IS NULL THEN RAISE EXCEPTION 'Publication Job is missing or lacks a Property Hub' USING ERRCODE='42501';END IF;
 PERFORM medialab_core.require_publication_delivery_permission(a,j.organization_id,'media_publication.manage');PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);PERFORM medialab_core.validate_publication_delivery_json(p_context);
 IF NOT EXISTS(SELECT 1 FROM medialab_core.property_hub_orders h WHERE h.property_hub_id=j.property_hub_id AND h.order_id=j.order_id AND h.organization_id=j.organization_id) THEN RAISE EXCEPTION 'Job Order is not associated with the Job Property Hub' USING ERRCODE='22023';END IF;
 IF p_workstream IS NOT NULL THEN SELECT * INTO w FROM medialab_core.service_workstreams WHERE id=p_workstream AND job_id=j.id AND organization_id=j.organization_id AND order_id=j.order_id;IF NOT FOUND THEN RAISE EXCEPTION 'Publication Workstream is cross-Job, cross-Order, or missing' USING ERRCODE='42501';END IF;END IF;
 IF p_supersedes IS NOT NULL THEN SELECT * INTO old FROM medialab_core.media_publications WHERE id=p_supersedes;IF NOT FOUND OR old.organization_id<>j.organization_id OR old.property_hub_id<>j.property_hub_id OR old.order_id<>j.order_id OR old.job_id<>j.id THEN RAISE EXCEPTION 'Superseded publication scope is invalid' USING ERRCODE='22023';END IF;END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_job,p_workstream,p_supersedes,p_reason,p_context)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'CREATE_MEDIA_PUBLICATION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'publication_id')::uuid;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.id::text,0));SELECT COALESCE(max(publication_number),0)+1 INTO n FROM medialab_core.media_publications WHERE job_id=j.id;x:=gen_random_uuid();
 INSERT INTO medialab_core.media_publications(id,organization_id,property_hub_id,order_id,job_id,service_workstream_id,publication_number,supersedes_publication_id,context,created_by_identity_id) VALUES(x,j.organization_id,j.property_hub_id,j.order_id,j.id,p_workstream,n,p_supersedes,p_context,a);
 INSERT INTO medialab_core.media_publication_events(id,publication_id,organization_id,property_hub_id,order_id,job_id,event_type,reason,evidence,recorded_by_identity_id) VALUES(gen_random_uuid(),x,j.organization_id,j.property_hub_id,j.order_id,j.id,'DRAFT_CREATED',p_reason,jsonb_build_object('publication_number',n),a);
 INSERT INTO medialab_core.media_publication_current(publication_id) VALUES(x);PERFORM medialab_core.record_media_idempotency(a,'CREATE_MEDIA_PUBLICATION',p_key,q,jsonb_build_object('publication_id',x));RETURN x;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.add_media_publication_item(p_session text,p_key text,p_publication uuid,p_version uuid,p_category text,p_placement text,p_ordinal integer,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;p medialab_core.media_publications%ROWTYPE;c medialab_core.media_publication_current%ROWTYPE;v medialab_core.media_asset_versions%ROWTYPE;d uuid;x uuid;q text;r jsonb;
BEGIN
 SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.media_publications WHERE id=p_publication;IF NOT FOUND THEN RAISE EXCEPTION 'Publication is missing or unavailable' USING ERRCODE='42501';END IF;
 PERFORM medialab_core.require_publication_delivery_permission(a,p.organization_id,'media_publication.manage');PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);
 IF p_category IS NULL OR p_category !~ '^[A-Z][A-Z0-9_]{1,79}$' OR p_placement IS NULL OR p_placement !~ '^[A-Z][A-Z0-9_]{1,79}$' OR p_ordinal IS NULL OR p_ordinal<=0 THEN RAISE EXCEPTION 'Deterministic category, placement, and positive ordinal are required' USING ERRCODE='22023';END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_publication,p_version,p_category,p_placement,p_ordinal,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ADD_MEDIA_PUBLICATION_ITEM',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'publication_item_id')::uuid;END IF;
 SELECT * INTO c FROM medialab_core.media_publication_current WHERE publication_id=p.id FOR UPDATE;IF c.current_state<>'DRAFT' THEN RAISE EXCEPTION 'Sealed or activated publication contents are immutable' USING ERRCODE='22023';END IF;
 SELECT * INTO v FROM medialab_core.media_asset_versions WHERE id=p_version AND organization_id=p.organization_id AND job_id=p.job_id;IF NOT FOUND THEN RAISE EXCEPTION 'Publication version is cross-tenant, cross-Job, or missing' USING ERRCODE='42501';END IF;
 IF p.service_workstream_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM medialab_core.media_assets ma WHERE ma.id=v.asset_id AND ma.service_workstream_id=p.service_workstream_id) THEN RAISE EXCEPTION 'Publication version is outside the scoped Workstream' USING ERRCODE='22023';END IF;
 SELECT s.id INTO d FROM medialab_core.media_approved_source_designations s
 JOIN medialab_core.returned_review_decisions rd ON rd.final_source_designation_id=s.id
 JOIN medialab_core.returned_review_item_current ric ON ric.current_decision_id=rd.id AND ric.current_final_source_designation_id=s.id
 JOIN medialab_core.returned_review_batch_current rbc ON rbc.review_batch_id=rd.review_batch_id AND rbc.current_state='COMPLETED'
 WHERE s.version_id=v.id AND s.organization_id=p.organization_id AND s.job_id=p.job_id
   AND s.purpose=medialab_core.returned_review_final_purpose(v.asset_id)
   AND NOT EXISTS(SELECT 1 FROM medialab_core.media_approved_source_designations newer WHERE newer.supersedes_designation_id=s.id)
 ORDER BY s.designated_at DESC,s.id DESC LIMIT 1;
 IF d IS NULL THEN RAISE EXCEPTION 'Exact immutable version is not the current accepted final source' USING ERRCODE='22023';END IF;x:=gen_random_uuid();
 INSERT INTO medialab_core.media_publication_items(id,publication_id,organization_id,property_hub_id,order_id,job_id,media_asset_id,media_asset_version_id,final_source_designation_id,category_code,placement_code,placement_ordinal,reason,admitted_by_identity_id) VALUES(x,p.id,p.organization_id,p.property_hub_id,p.order_id,p.job_id,v.asset_id,v.id,d,p_category,p_placement,p_ordinal,p_reason,a);
 UPDATE medialab_core.media_publication_current SET item_count=item_count+1,lifecycle_generation=lifecycle_generation+1,updated_at=clock_timestamp() WHERE publication_id=p.id;PERFORM medialab_core.record_media_idempotency(a,'ADD_MEDIA_PUBLICATION_ITEM',p_key,q,jsonb_build_object('publication_item_id',x));RETURN x;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.seal_media_publication(p_session text,p_key text,p_publication uuid,p_expected_generation bigint,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;p medialab_core.media_publications%ROWTYPE;c medialab_core.media_publication_current%ROWTYPE;e uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.media_publications WHERE id=p_publication;IF NOT FOUND THEN RAISE EXCEPTION 'Publication is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_publication_delivery_permission(a,p.organization_id,'media_publication.manage');PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);
 q:=encode(sha256(convert_to(jsonb_build_array(p_publication,p_expected_generation,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'SEAL_MEDIA_PUBLICATION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;SELECT * INTO c FROM medialab_core.media_publication_current WHERE publication_id=p.id FOR UPDATE;
 IF c.current_state<>'DRAFT' OR c.item_count=0 THEN RAISE EXCEPTION 'Only a nonempty draft publication may be sealed' USING ERRCODE='22023';END IF;IF c.lifecycle_generation<>p_expected_generation THEN RAISE EXCEPTION 'Stale publication generation' USING ERRCODE='40001';END IF;e:=gen_random_uuid();
 INSERT INTO medialab_core.media_publication_events(id,publication_id,organization_id,property_hub_id,order_id,job_id,event_type,reason,evidence,recorded_by_identity_id) VALUES(e,p.id,p.organization_id,p.property_hub_id,p.order_id,p.job_id,'SEALED',p_reason,jsonb_build_object('item_count',c.item_count),a);
 UPDATE medialab_core.media_publication_current SET current_state='SEALED',lifecycle_generation=lifecycle_generation+1,sealed_event_id=e,updated_at=clock_timestamp() WHERE publication_id=p.id;PERFORM medialab_core.record_media_idempotency(a,'SEAL_MEDIA_PUBLICATION',p_key,q,jsonb_build_object('event_id',e));RETURN e;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.activate_media_publication(p_session text,p_key text,p_publication uuid,p_expected_generation bigint,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;p medialab_core.media_publications%ROWTYPE;c medialab_core.media_publication_current%ROWTYPE;oc medialab_core.media_publication_current%ROWTYPE;e uuid;oe uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.media_publications WHERE id=p_publication;IF NOT FOUND THEN RAISE EXCEPTION 'Publication is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_publication_delivery_permission(a,p.organization_id,'media_publication.manage');PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);
 q:=encode(sha256(convert_to(jsonb_build_array(p_publication,p_expected_generation,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ACTIVATE_MEDIA_PUBLICATION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;SELECT * INTO c FROM medialab_core.media_publication_current WHERE publication_id=p.id FOR UPDATE;
 IF c.current_state<>'SEALED' OR c.lifecycle_generation<>p_expected_generation THEN RAISE EXCEPTION 'Activation requires the current sealed publication generation' USING ERRCODE='40001';END IF;
 IF p.supersedes_publication_id IS NOT NULL THEN SELECT * INTO oc FROM medialab_core.media_publication_current WHERE publication_id=p.supersedes_publication_id FOR UPDATE;IF oc.current_state<>'ACTIVE' THEN RAISE EXCEPTION 'Replacement activation requires an active predecessor' USING ERRCODE='22023';END IF;oe:=gen_random_uuid();INSERT INTO medialab_core.media_publication_events(id,publication_id,organization_id,property_hub_id,order_id,job_id,event_type,reason,evidence,recorded_by_identity_id) SELECT oe,o.id,o.organization_id,o.property_hub_id,o.order_id,o.job_id,'SUPERSEDED',p_reason,jsonb_build_object('successor_publication_id',p.id),a FROM medialab_core.media_publications o WHERE o.id=p.supersedes_publication_id;UPDATE medialab_core.media_publication_current SET current_state='SUPERSEDED',lifecycle_generation=lifecycle_generation+1,terminal_event_id=oe,updated_at=clock_timestamp() WHERE publication_id=p.supersedes_publication_id;PERFORM medialab_core.invalidate_publication_grants(p.supersedes_publication_id,'SUPERSEDED_INVALIDATED',p_reason,a);END IF;
 e:=gen_random_uuid();INSERT INTO medialab_core.media_publication_events(id,publication_id,organization_id,property_hub_id,order_id,job_id,event_type,reason,evidence,recorded_by_identity_id) VALUES(e,p.id,p.organization_id,p.property_hub_id,p.order_id,p.job_id,'ACTIVATED',p_reason,jsonb_build_object('item_count',c.item_count),a);UPDATE medialab_core.media_publication_current SET current_state='ACTIVE',lifecycle_generation=lifecycle_generation+1,activated_event_id=e,updated_at=clock_timestamp() WHERE publication_id=p.id;PERFORM medialab_core.record_media_idempotency(a,'ACTIVATE_MEDIA_PUBLICATION',p_key,q,jsonb_build_object('event_id',e));RETURN e;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revoke_media_publication(p_session text,p_key text,p_publication uuid,p_expected_generation bigint,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;p medialab_core.media_publications%ROWTYPE;c medialab_core.media_publication_current%ROWTYPE;e uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.media_publications WHERE id=p_publication;IF NOT FOUND THEN RAISE EXCEPTION 'Publication is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_publication_delivery_permission(a,p.organization_id,'media_publication.manage');PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);
 q:=encode(sha256(convert_to(jsonb_build_array(p_publication,p_expected_generation,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'REVOKE_MEDIA_PUBLICATION',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;SELECT * INTO c FROM medialab_core.media_publication_current WHERE publication_id=p.id FOR UPDATE;
 IF c.current_state<>'ACTIVE' OR c.lifecycle_generation<>p_expected_generation THEN RAISE EXCEPTION 'Revocation requires the current active publication generation' USING ERRCODE='40001';END IF;e:=gen_random_uuid();INSERT INTO medialab_core.media_publication_events(id,publication_id,organization_id,property_hub_id,order_id,job_id,event_type,reason,evidence,recorded_by_identity_id) VALUES(e,p.id,p.organization_id,p.property_hub_id,p.order_id,p.job_id,'REVOKED',p_reason,'{}',a);UPDATE medialab_core.media_publication_current SET current_state='REVOKED',lifecycle_generation=lifecycle_generation+1,terminal_event_id=e,updated_at=clock_timestamp() WHERE publication_id=p.id;PERFORM medialab_core.invalidate_publication_grants(p.id,'PUBLICATION_INVALIDATED',p_reason,a);PERFORM medialab_core.record_media_idempotency(a,'REVOKE_MEDIA_PUBLICATION',p_key,q,jsonb_build_object('event_id',e));RETURN e;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_delivery_financial_eligibility(p_session text,p_key text,p_order uuid,p_eligibility text,p_kind text,p_reference text,p_supersedes uuid,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;o medialab_core.orders%ROWTYPE;old medialab_core.delivery_financial_eligibility_evidence%ROWTYPE;x uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO o FROM medialab_core.orders WHERE id=p_order;IF NOT FOUND THEN RAISE EXCEPTION 'Order is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_publication_delivery_permission(a,o.organization_id,'delivery_financial_evidence.record');PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);
 IF p_eligibility NOT IN ('ELIGIBLE','INELIGIBLE') OR p_kind NOT IN ('BOUNDED_SETTLEMENT_AUTHORITY','NONPRODUCTION_FIXTURE') OR p_reference IS NULL OR p_reference !~ '^[A-Z0-9][A-Z0-9_.:-]{2,199}$' THEN RAISE EXCEPTION 'Bounded provider-neutral financial eligibility evidence is invalid' USING ERRCODE='22023';END IF;
 IF p_supersedes IS NOT NULL THEN SELECT * INTO old FROM medialab_core.delivery_financial_eligibility_evidence WHERE id=p_supersedes AND order_id=o.id AND organization_id=o.organization_id;IF NOT FOUND OR EXISTS(SELECT 1 FROM medialab_core.delivery_financial_eligibility_evidence n WHERE n.supersedes_evidence_id=old.id) THEN RAISE EXCEPTION 'Superseded financial evidence is missing, out of scope, or stale' USING ERRCODE='40001';END IF;END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_order,p_eligibility,p_kind,p_reference,p_supersedes,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'RECORD_DELIVERY_FINANCIAL_ELIGIBILITY',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'financial_evidence_id')::uuid;END IF;x:=gen_random_uuid();INSERT INTO medialab_core.delivery_financial_eligibility_evidence(id,organization_id,order_id,eligibility,evidence_kind,evidence_reference,supersedes_evidence_id,reason,recorded_by_identity_id) VALUES(x,o.organization_id,o.id,p_eligibility,p_kind,p_reference,p_supersedes,p_reason,a);PERFORM medialab_core.record_media_idempotency(a,'RECORD_DELIVERY_FINANCIAL_ELIGIBILITY',p_key,q,jsonb_build_object('financial_evidence_id',x));RETURN x;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.evaluate_delivery_entitlement(p_session text,p_key text,p_publication uuid,p_capability text,p_financial_evidence uuid,p_reason text,p_evidence jsonb)
RETURNS uuid AS $$
DECLARE a uuid;p medialab_core.media_publications%ROWTYPE;c medialab_core.media_publication_current%ROWTYPE;o medialab_core.orders%ROWTYPE;f medialab_core.delivery_financial_eligibility_evidence%ROWTYPE;auth text;gate text;dec text;code text;x uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.media_publications WHERE id=p_publication;IF NOT FOUND THEN RAISE EXCEPTION 'Publication is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);PERFORM medialab_core.validate_publication_delivery_json(p_evidence);IF p_capability NOT IN ('PREVIEW','DOWNLOAD') THEN RAISE EXCEPTION 'Capability must be PREVIEW or DOWNLOAD' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM medialab_core.memberships m JOIN medialab_core.identities i ON i.person_id=m.person_id WHERE i.id=a AND m.organization_id=p.organization_id AND m.status='ACTIVE') THEN RAISE EXCEPTION 'Subject lacks active organization authority' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM medialab_core.media_publication_current WHERE publication_id=p.id;SELECT * INTO o FROM medialab_core.orders WHERE id=p.order_id;auth:=medialab_core.delivery_subject_authority(a,p.organization_id,p.property_hub_id,p.order_id);
 IF p_financial_evidence IS NOT NULL THEN SELECT * INTO f FROM medialab_core.delivery_financial_eligibility_evidence WHERE id=p_financial_evidence AND organization_id=p.organization_id AND order_id=p.order_id AND NOT EXISTS(SELECT 1 FROM medialab_core.delivery_financial_eligibility_evidence n WHERE n.supersedes_evidence_id=p_financial_evidence);IF NOT FOUND THEN RAISE EXCEPTION 'Financial evidence is missing, out of scope, or stale' USING ERRCODE='22023';END IF;END IF;
 IF p_capability='PREVIEW' THEN gate:='NOT_REQUIRED';ELSIF o.settlement_mode='APPROVED_TERMS' THEN gate:='APPROVED_TERMS';ELSIF f.id IS NOT NULL AND f.eligibility='ELIGIBLE' THEN gate:='ELIGIBLE_EVIDENCE';ELSE gate:='LOCKED';END IF;
 IF c.current_state<>'ACTIVE' THEN dec:='DENY';code:='PUBLICATION_NOT_ACTIVE';ELSIF auth='NONE' THEN dec:='DENY';code:='SUBJECT_NOT_AUTHORIZED';ELSIF p_capability='DOWNLOAD' AND gate='LOCKED' THEN dec:='DENY';code:='FINANCIAL_GATE_LOCKED';ELSE dec:='ALLOW';code:=CASE p_capability WHEN 'PREVIEW' THEN 'PREVIEW_ALLOWED' ELSE 'DOWNLOAD_ALLOWED' END;END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_publication,p_capability,p_financial_evidence,p_reason,p_evidence)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'EVALUATE_DELIVERY_ENTITLEMENT',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'evaluation_id')::uuid;END IF;x:=gen_random_uuid();INSERT INTO medialab_core.delivery_entitlement_evaluations(id,publication_id,organization_id,property_hub_id,order_id,job_id,subject_identity_id,requested_capability,subject_authority,publication_state,settlement_mode,financial_gate,financial_evidence_id,decision,reason_code,request_evidence,idempotency_key,evaluated_by_identity_id) VALUES(x,p.id,p.organization_id,p.property_hub_id,p.order_id,p.job_id,a,p_capability,auth,c.current_state,o.settlement_mode,gate,f.id,dec,code,p_evidence,p_key,a);PERFORM medialab_core.record_media_idempotency(a,'EVALUATE_DELIVERY_ENTITLEMENT',p_key,q,jsonb_build_object('evaluation_id',x));RETURN x;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.issue_delivery_grant(p_session text,p_key text,p_evaluation uuid,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;v medialab_core.delivery_entitlement_evaluations%ROWTYPE;x uuid;e uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO v FROM medialab_core.delivery_entitlement_evaluations WHERE id=p_evaluation;IF NOT FOUND OR v.subject_identity_id<>a THEN RAISE EXCEPTION 'Evaluation is missing or unavailable to the authenticated subject' USING ERRCODE='42501';END IF;PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);IF v.decision<>'ALLOW' THEN RAISE EXCEPTION 'Only an allowed evaluation can produce a delivery grant' USING ERRCODE='22023';END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_evaluation,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ISSUE_DELIVERY_GRANT',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'grant_id')::uuid;END IF;IF EXISTS(SELECT 1 FROM medialab_core.delivery_grants WHERE evaluation_id=v.id) THEN RAISE EXCEPTION 'Evaluation already produced a delivery grant' USING ERRCODE='23505';END IF;x:=gen_random_uuid();e:=gen_random_uuid();INSERT INTO medialab_core.delivery_grants(id,evaluation_id,publication_id,organization_id,property_hub_id,order_id,job_id,subject_identity_id,capability,granted_by_identity_id) VALUES(x,v.id,v.publication_id,v.organization_id,v.property_hub_id,v.order_id,v.job_id,a,v.requested_capability,a);INSERT INTO medialab_core.delivery_grant_events(id,grant_id,publication_id,organization_id,order_id,event_type,reason,recorded_by_identity_id) VALUES(e,x,v.publication_id,v.organization_id,v.order_id,'GRANTED',p_reason,a);INSERT INTO medialab_core.delivery_grant_current(grant_id) VALUES(x);PERFORM medialab_core.record_media_idempotency(a,'ISSUE_DELIVERY_GRANT',p_key,q,jsonb_build_object('grant_id',x));RETURN x;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revoke_delivery_grant(p_session text,p_key text,p_grant uuid,p_reason text)
RETURNS uuid AS $$
DECLARE a uuid;g medialab_core.delivery_grants%ROWTYPE;c medialab_core.delivery_grant_current%ROWTYPE;e uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO g FROM medialab_core.delivery_grants WHERE id=p_grant;IF NOT FOUND THEN RAISE EXCEPTION 'Grant is missing or unavailable' USING ERRCODE='42501';END IF;IF g.subject_identity_id<>a AND NOT medialab_core.actor_has_permission(a,g.organization_id,'delivery_entitlement.manage') THEN RAISE EXCEPTION 'Actor cannot revoke this delivery grant' USING ERRCODE='42501';END IF;PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);
 q:=encode(sha256(convert_to(jsonb_build_array(p_grant,p_reason)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'REVOKE_DELIVERY_GRANT',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;SELECT * INTO c FROM medialab_core.delivery_grant_current WHERE grant_id=g.id FOR UPDATE;IF c.current_state<>'ACTIVE' THEN RAISE EXCEPTION 'Delivery grant is no longer active' USING ERRCODE='22023';END IF;e:=gen_random_uuid();INSERT INTO medialab_core.delivery_grant_events(id,grant_id,publication_id,organization_id,order_id,event_type,reason,recorded_by_identity_id) VALUES(e,g.id,g.publication_id,g.organization_id,g.order_id,'REVOKED',p_reason,a);UPDATE medialab_core.delivery_grant_current SET current_state='REVOKED',terminal_event_id=e,updated_at=clock_timestamp() WHERE grant_id=g.id;PERFORM medialab_core.record_media_idempotency(a,'REVOKE_DELIVERY_GRANT',p_key,q,jsonb_build_object('event_id',e));RETURN e;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.evaluate_delivery_grant_access(p_session text,p_key text,p_grant uuid,p_reason text,p_evidence jsonb)
RETURNS uuid AS $$
DECLARE a uuid;g medialab_core.delivery_grants%ROWTYPE;c medialab_core.delivery_grant_current%ROWTYPE;p medialab_core.media_publications%ROWTYPE;pc medialab_core.media_publication_current%ROWTYPE;o medialab_core.orders%ROWTYPE;v medialab_core.delivery_entitlement_evaluations%ROWTYPE;auth text;gate text;dec text;code text;x uuid;q text;r jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO g FROM medialab_core.delivery_grants WHERE id=p_grant;IF NOT FOUND OR g.subject_identity_id<>a THEN RAISE EXCEPTION 'Grant is missing or unavailable to the authenticated subject' USING ERRCODE='42501';END IF;PERFORM medialab_core.validate_publication_delivery_text(p_reason,true,1000);PERFORM medialab_core.validate_publication_delivery_json(p_evidence);SELECT * INTO c FROM medialab_core.delivery_grant_current WHERE grant_id=g.id;SELECT * INTO p FROM medialab_core.media_publications WHERE id=g.publication_id;SELECT * INTO pc FROM medialab_core.media_publication_current WHERE publication_id=p.id;SELECT * INTO o FROM medialab_core.orders WHERE id=p.order_id;SELECT * INTO v FROM medialab_core.delivery_entitlement_evaluations WHERE id=g.evaluation_id;auth:=medialab_core.delivery_subject_authority(a,p.organization_id,p.property_hub_id,p.order_id);gate:=v.financial_gate;
 IF c.current_state<>'ACTIVE' THEN dec:='DENY';code:='GRANT_NOT_ACTIVE';ELSIF pc.current_state<>'ACTIVE' THEN dec:='DENY';code:='PUBLICATION_NOT_ACTIVE';ELSIF auth='NONE' THEN dec:='DENY';code:='SUBJECT_NOT_AUTHORIZED';ELSIF g.capability='DOWNLOAD' AND NOT (o.settlement_mode='APPROVED_TERMS' OR (v.financial_evidence_id IS NOT NULL AND EXISTS(SELECT 1 FROM medialab_core.delivery_financial_eligibility_evidence f WHERE f.id=v.financial_evidence_id AND f.eligibility='ELIGIBLE' AND NOT EXISTS(SELECT 1 FROM medialab_core.delivery_financial_eligibility_evidence n WHERE n.supersedes_evidence_id=f.id)))) THEN dec:='DENY';code:='FINANCIAL_GATE_LOCKED';gate:='LOCKED';ELSE dec:='ALLOW';code:='GRANT_ACCESS_ALLOWED';END IF;
 q:=encode(sha256(convert_to(jsonb_build_array(p_grant,p_reason,p_evidence)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'EVALUATE_DELIVERY_GRANT_ACCESS',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'evaluation_id')::uuid;END IF;x:=gen_random_uuid();INSERT INTO medialab_core.delivery_entitlement_evaluations(id,publication_id,organization_id,property_hub_id,order_id,job_id,subject_identity_id,grant_id,requested_capability,subject_authority,publication_state,settlement_mode,financial_gate,financial_evidence_id,decision,reason_code,request_evidence,idempotency_key,evaluated_by_identity_id) VALUES(x,p.id,p.organization_id,p.property_hub_id,p.order_id,p.job_id,a,g.id,g.capability,auth,pc.current_state,o.settlement_mode,gate,v.financial_evidence_id,dec,code,p_evidence,p_key,a);PERFORM medialab_core.record_media_idempotency(a,'EVALUATE_DELIVERY_GRANT_ACCESS',p_key,q,jsonb_build_object('evaluation_id',x));RETURN x;END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_media_publication(p_session text,p_publication uuid)
RETURNS jsonb AS $$
DECLARE a uuid;p medialab_core.media_publications%ROWTYPE;z jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.media_publications WHERE id=p_publication;IF NOT FOUND THEN RAISE EXCEPTION 'Publication is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_publication_delivery_permission(a,p.organization_id,'media_publication.read');SELECT jsonb_build_object('publication',to_jsonb(p),'current',to_jsonb(c),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.category_code,i.placement_code,i.placement_ordinal,i.id) FROM medialab_core.media_publication_items i WHERE i.publication_id=p.id),'[]'::jsonb),'events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at,e.id) FROM medialab_core.media_publication_events e WHERE e.publication_id=p.id),'[]'::jsonb)) INTO z FROM medialab_core.media_publication_current c WHERE c.publication_id=p.id;RETURN z;END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_delivery_entitlement_history(p_session text,p_publication uuid)
RETURNS jsonb AS $$
DECLARE a uuid;p medialab_core.media_publications%ROWTYPE;z jsonb;
BEGIN SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO p FROM medialab_core.media_publications WHERE id=p_publication;IF NOT FOUND THEN RAISE EXCEPTION 'Publication is missing or unavailable' USING ERRCODE='42501';END IF;PERFORM medialab_core.require_publication_delivery_permission(a,p.organization_id,'delivery_entitlement.read');SELECT jsonb_build_object('evaluations',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.evaluated_at,e.id) FROM medialab_core.delivery_entitlement_evaluations e WHERE e.publication_id=p.id),'[]'::jsonb),'grants',COALESCE((SELECT jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'current',to_jsonb(c)) ORDER BY g.granted_at,g.id) FROM medialab_core.delivery_grants g JOIN medialab_core.delivery_grant_current c ON c.grant_id=g.id WHERE g.publication_id=p.id),'[]'::jsonb),'grant_events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at,e.id) FROM medialab_core.delivery_grant_events e WHERE e.publication_id=p.id),'[]'::jsonb)) INTO z;RETURN z;END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE TRIGGER media_publications_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_publications FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation();
CREATE TRIGGER media_publication_items_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_publication_items FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation();
CREATE TRIGGER media_publication_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.media_publication_events FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation();
CREATE TRIGGER delivery_financial_evidence_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.delivery_financial_eligibility_evidence FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation();
CREATE TRIGGER delivery_evaluations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.delivery_entitlement_evaluations FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation();
CREATE TRIGGER delivery_grants_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.delivery_grants FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation();
CREATE TRIGGER delivery_grant_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.delivery_grant_events FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_publication_delivery_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.media_publications,medialab_core.media_publication_items,medialab_core.media_publication_events,medialab_core.media_publication_current,medialab_core.delivery_financial_eligibility_evidence,medialab_core.delivery_entitlement_evaluations,medialab_core.delivery_grants,medialab_core.delivery_grant_events,medialab_core.delivery_grant_current FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_publication_delivery_evidence_mutation(),medialab_core.require_publication_delivery_permission(uuid,uuid,text),medialab_core.validate_publication_delivery_text(text,boolean,integer),medialab_core.validate_publication_delivery_json(jsonb),medialab_core.delivery_subject_authority(uuid,uuid,uuid,uuid),medialab_core.invalidate_publication_grants(uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_media_publication(text,text,uuid,uuid,uuid,text,jsonb),medialab_core.add_media_publication_item(text,text,uuid,uuid,text,text,integer,text),medialab_core.seal_media_publication(text,text,uuid,bigint,text),medialab_core.activate_media_publication(text,text,uuid,bigint,text),medialab_core.revoke_media_publication(text,text,uuid,bigint,text),medialab_core.record_delivery_financial_eligibility(text,text,uuid,text,text,text,uuid,text),medialab_core.evaluate_delivery_entitlement(text,text,uuid,text,uuid,text,jsonb),medialab_core.issue_delivery_grant(text,text,uuid,text),medialab_core.revoke_delivery_grant(text,text,uuid,text),medialab_core.evaluate_delivery_grant_access(text,text,uuid,text,jsonb),medialab_core.get_media_publication(text,uuid),medialab_core.get_delivery_entitlement_history(text,uuid) FROM PUBLIC;
