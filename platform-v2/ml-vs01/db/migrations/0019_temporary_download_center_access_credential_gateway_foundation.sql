-- P02-M15-B: Temporary Download Center access credential and anonymous gateway foundation.
-- Database authorization/evidence only: no public route, URL, provider access, file bytes, notification, payment, or download execution.

CREATE TABLE medialab_core.temporary_download_center_access_credentials (
    id uuid PRIMARY KEY,
    center_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    credential_generation integer NOT NULL,
    verifier_sha256 text NOT NULL,
    verifier_algorithm text NOT NULL,
    issued_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    predecessor_credential_id uuid NULL,
    reason text NOT NULL,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_centers(id, organization_id, property_hub_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_access_credentials_scope_key UNIQUE (id, center_id, organization_id, property_hub_id),
    CONSTRAINT temporary_download_center_access_credentials_center_id_key UNIQUE (center_id, id),
    CONSTRAINT temporary_download_center_access_credentials_generation_key UNIQUE (center_id, credential_generation),
    FOREIGN KEY (center_id, predecessor_credential_id)
      REFERENCES medialab_core.temporary_download_center_access_credentials(center_id, id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_access_credentials_generation_check CHECK (credential_generation > 0),
    CONSTRAINT temporary_download_center_access_credentials_predecessor_check CHECK (
      (credential_generation = 1 AND predecessor_credential_id IS NULL) OR
      (credential_generation > 1 AND predecessor_credential_id IS NOT NULL)
    ),
    CONSTRAINT temporary_download_center_access_credentials_verifier_check CHECK (verifier_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT temporary_download_center_access_credentials_algorithm_check CHECK (verifier_algorithm = 'SHA256-HEX-V1'),
    CONSTRAINT temporary_download_center_access_credentials_expiry_check CHECK (expires_at > issued_at),
    CONSTRAINT temporary_download_center_access_credentials_reason_check CHECK (
      reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000 AND
      reason !~* '(https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/]|[0-9a-f]{64})'
    ),
    CONSTRAINT temporary_download_center_access_credentials_context_check CHECK (
      jsonb_typeof(context) = 'object' AND length(context::text) <= 20000 AND
      context::text !~* '"[a-z0-9_]*(password|secret|token|verifier|credential|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' AND
      context::text !~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/]|[0-9a-f]{64})'
    )
);

CREATE TABLE medialab_core.temporary_download_center_access_credential_events (
    id uuid PRIMARY KEY,
    credential_id uuid NOT NULL,
    center_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    property_hub_id uuid NOT NULL,
    credential_generation integer NOT NULL,
    event_type text NOT NULL,
    previous_credential_id uuid NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (credential_id, center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_center_access_credentials(id, center_id, organization_id, property_hub_id) ON DELETE RESTRICT,
    FOREIGN KEY (center_id, previous_credential_id)
      REFERENCES medialab_core.temporary_download_center_access_credentials(center_id, id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_access_credential_events_scope_key UNIQUE (id, center_id),
    CONSTRAINT temporary_download_center_access_credential_events_credential_type_key UNIQUE (credential_id, event_type),
    CONSTRAINT temporary_download_center_access_credential_events_generation_check CHECK (credential_generation > 0),
    CONSTRAINT temporary_download_center_access_credential_events_type_check CHECK (event_type IN ('ISSUED','ROTATED','REVOKED')),
    CONSTRAINT temporary_download_center_access_credential_events_transition_check CHECK (
      (event_type = 'ISSUED' AND credential_generation = 1 AND previous_credential_id IS NULL) OR
      (event_type = 'ROTATED' AND credential_generation > 1 AND previous_credential_id IS NOT NULL) OR
      (event_type = 'REVOKED')
    ),
    CONSTRAINT temporary_download_center_access_credential_events_reason_check CHECK (
      reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000 AND
      reason !~* '(https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/]|[0-9a-f]{64})'
    ),
    CONSTRAINT temporary_download_center_access_credential_events_evidence_check CHECK (
      jsonb_typeof(evidence) = 'object' AND length(evidence::text) <= 20000 AND
      evidence::text !~* '"[a-z0-9_]*(password|secret|token|verifier|credential|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' AND
      evidence::text !~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/]|[0-9a-f]{64})'
    )
);

CREATE TABLE medialab_core.temporary_download_center_access_credential_current (
    center_id uuid PRIMARY KEY REFERENCES medialab_core.temporary_download_centers(id) ON DELETE RESTRICT,
    current_credential_id uuid NOT NULL,
    current_generation integer NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
    terminal_event_id uuid NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (center_id, current_credential_id)
      REFERENCES medialab_core.temporary_download_center_access_credentials(center_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (terminal_event_id, center_id)
      REFERENCES medialab_core.temporary_download_center_access_credential_events(id, center_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_access_credential_current_generation_check CHECK (current_generation > 0),
    CONSTRAINT temporary_download_center_access_credential_current_state_check CHECK (lifecycle_state IN ('ACTIVE','REVOKED')),
    CONSTRAINT temporary_download_center_access_credential_current_terminal_check CHECK (
      (lifecycle_state = 'ACTIVE' AND terminal_event_id IS NULL) OR
      (lifecycle_state = 'REVOKED' AND terminal_event_id IS NOT NULL)
    )
);

CREATE TABLE medialab_core.temporary_download_center_gateway_evaluations (
    id uuid PRIMARY KEY,
    access_event_reference text NOT NULL UNIQUE,
    request_sha256 text NOT NULL,
    credential_id uuid NULL REFERENCES medialab_core.temporary_download_center_access_credentials(id) ON DELETE RESTRICT,
    center_id uuid NULL,
    organization_id uuid NULL,
    property_hub_id uuid NULL,
    version_id uuid NULL,
    item_id uuid NULL,
    event_kind text NOT NULL,
    decision text NOT NULL,
    reason_code text NOT NULL,
    observation_id uuid NULL UNIQUE REFERENCES medialab_core.temporary_download_center_access_observations(id) ON DELETE RESTRICT,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (center_id, organization_id, property_hub_id)
      REFERENCES medialab_core.temporary_download_centers(id, organization_id, property_hub_id) ON DELETE RESTRICT,
    FOREIGN KEY (center_id, version_id)
      REFERENCES medialab_core.temporary_download_center_versions(center_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, center_id, version_id)
      REFERENCES medialab_core.temporary_download_center_items(id, center_id, version_id) ON DELETE RESTRICT,
    CONSTRAINT temporary_download_center_gateway_evaluations_request_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT temporary_download_center_gateway_evaluations_reference_check CHECK (access_event_reference ~ '^[A-Z0-9][A-Z0-9_.:-]{2,199}$'),
    CONSTRAINT temporary_download_center_gateway_evaluations_kind_check CHECK (event_kind IN ('OPEN','DOWNLOAD')),
    CONSTRAINT temporary_download_center_gateway_evaluations_decision_check CHECK (decision IN ('ALLOW','DENY')),
    CONSTRAINT temporary_download_center_gateway_evaluations_reason_check CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT temporary_download_center_gateway_evaluations_scope_check CHECK (
      (center_id IS NULL AND organization_id IS NULL AND property_hub_id IS NULL AND version_id IS NULL AND item_id IS NULL) OR
      (center_id IS NOT NULL AND organization_id IS NOT NULL AND property_hub_id IS NOT NULL AND version_id IS NOT NULL)
    ),
    CONSTRAINT temporary_download_center_gateway_evaluations_allow_check CHECK (
      decision = 'DENY' OR (credential_id IS NOT NULL AND center_id IS NOT NULL AND observation_id IS NOT NULL AND (event_kind = 'OPEN' OR item_id IS NOT NULL))
    ),
    CONSTRAINT temporary_download_center_gateway_evaluations_evidence_check CHECK (
      jsonb_typeof(evidence) = 'object' AND length(evidence::text) <= 20000 AND
      evidence::text !~* '"[a-z0-9_]*(password|secret|token|verifier|credential|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' AND
      evidence::text !~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/]|[0-9a-f]{64})'
    )
);

CREATE INDEX temporary_download_center_access_credentials_history_idx ON medialab_core.temporary_download_center_access_credentials(center_id,credential_generation,id);
CREATE INDEX temporary_download_center_access_credential_events_history_idx ON medialab_core.temporary_download_center_access_credential_events(center_id,recorded_at,id);
CREATE INDEX temporary_download_center_gateway_evaluations_history_idx ON medialab_core.temporary_download_center_gateway_evaluations(center_id,evaluated_at,id);

CREATE OR REPLACE FUNCTION medialab_core.reject_tdc_access_credential_evidence_mutation()
RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION '% rows are immutable append-only access credential/gateway evidence: UPDATE and DELETE are rejected',TG_TABLE_NAME USING ERRCODE='42501';
END; $$ LANGUAGE plpgsql SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_tdc_access_credential_current_mutation()
RETURNS trigger AS $$ BEGIN
  IF current_setting('medialab.tdc_gateway_current_mutation',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Temporary Download Center credential current projection may change only through controlled packet functions' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Temporary Download Center credential current projection deletion is prohibited' USING ERRCODE='42501';END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_temporary_download_center_gateway_text(p_text text,p_required boolean,p_limit integer)
RETURNS void AS $$ BEGIN
  IF (p_required AND (p_text IS NULL OR p_text='')) OR
     (p_text IS NOT NULL AND (p_text<>btrim(p_text) OR p_text='' OR length(p_text)>p_limit OR p_text ~ '@' OR
      p_text ~* '(https?://|file://|data:|/Users/|/home/|[A-Za-z]:[\\/]|base64|[0-9a-f]{64})')) THEN
    RAISE EXCEPTION 'Bounded provider-neutral text without secrets, URLs, paths, or media data is required' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_temporary_download_center_gateway_json(p_evidence jsonb)
RETURNS void AS $$ BEGIN
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR length(p_evidence::text)>20000 OR
     p_evidence::text ~* '"[a-z0-9_]*(password|secret|token|verifier|credential|oauth|access_key|private_key|signed_url|signed_uri|provider_payload|api_payload|binary|bytes|base64)[a-z0-9_]*"[[:space:]]*:' OR
     p_evidence::text ~* '(https?://|file://|data:[a-z0-9/+.-]+;base64,|/Users/|/home/|[A-Za-z]:[\\/]|[0-9a-f]{64})' THEN
    RAISE EXCEPTION 'Gateway evidence contains prohibited secrets, verifier material, provider payloads, URLs, paths, or media data' USING ERRCODE='22023';
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_tdc_access_credential_scope()
RETURNS trigger AS $$
DECLARE c medialab_core.temporary_download_centers%ROWTYPE;p medialab_core.temporary_download_center_access_credentials%ROWTYPE;
BEGIN
  SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=NEW.center_id;
  IF NOT FOUND OR c.organization_id<>NEW.organization_id OR c.property_hub_id<>NEW.property_hub_id OR NEW.expires_at>c.expires_at THEN
    RAISE EXCEPTION 'Credential scope or expiration exceeds its Temporary Download Center' USING ERRCODE='23514';
  END IF;
  IF NEW.credential_generation>1 THEN
    SELECT * INTO p FROM medialab_core.temporary_download_center_access_credentials WHERE id=NEW.predecessor_credential_id AND center_id=NEW.center_id;
    IF NOT FOUND OR p.credential_generation<>NEW.credential_generation-1 THEN
      RAISE EXCEPTION 'Credential generation must follow its exact predecessor' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.temporary_download_center_current_policy(p_center uuid)
RETURNS jsonb AS $$
DECLARE c medialab_core.temporary_download_centers%ROWTYPE;cur medialab_core.temporary_download_center_current%ROWTYPE;creator_auth text;effective text;decision text;reason text;publication_count integer;order_count integer;
BEGIN
  SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND THEN RETURN NULL;END IF;
  SELECT * INTO cur FROM medialab_core.temporary_download_center_current WHERE center_id=c.id;
  IF NOT FOUND THEN RETURN NULL;END IF;
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

CREATE OR REPLACE FUNCTION medialab_core.evaluate_temporary_download_center_policy(p_session text,p_center uuid)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;z jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND OR medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.read')='NONE' THEN RAISE EXCEPTION 'Temporary Download Center policy is unavailable to the scoped actor' USING ERRCODE='42501';END IF;
  z:=medialab_core.temporary_download_center_current_policy(c.id);IF z IS NULL THEN RAISE EXCEPTION 'Temporary Download Center policy is unavailable' USING ERRCODE='42501';END IF;RETURN z;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.issue_temporary_download_center_access_credential(p_session text,p_key text,p_center uuid,p_expected_center_generation bigint,p_reason text,p_context jsonb)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;cc medialab_core.temporary_download_center_current%ROWTYPE;x uuid;e uuid;s text;v text;q text;r jsonb;now_at timestamptz;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND OR a<>c.created_by_identity_id OR medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.manage')='NONE' THEN RAISE EXCEPTION 'Only the currently authorized center creator may issue access' USING ERRCODE='42501';END IF;
  PERFORM medialab_core.validate_temporary_download_center_gateway_text(p_reason,true,1000);PERFORM medialab_core.validate_temporary_download_center_gateway_json(p_context);
  q:=encode(sha256(convert_to(jsonb_build_array(p_center,p_expected_center_generation,p_reason,p_context)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ISSUE_TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL',p_key,q);
  IF r IS NOT NULL THEN RETURN r||jsonb_build_object('access_secret',NULL,'secret_returned',false,'replayed',true);END IF;
  SELECT * INTO cc FROM medialab_core.temporary_download_center_current WHERE center_id=c.id FOR UPDATE;
  IF cc.lifecycle_state<>'ACTIVE' OR cc.generation<>p_expected_center_generation OR clock_timestamp()>=c.expires_at THEN RAISE EXCEPTION 'Issuance requires the current active unexpired center generation' USING ERRCODE='40001';END IF;
  IF EXISTS(SELECT 1 FROM medialab_core.temporary_download_center_access_credential_current WHERE center_id=c.id) THEN RAISE EXCEPTION 'Current center access already exists; rotate rather than recover it' USING ERRCODE='23505';END IF;
  now_at:=clock_timestamp();x:=gen_random_uuid();e:=gen_random_uuid();s:=encode(sha256(uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid())),'hex');v:=encode(sha256(convert_to(s,'UTF8')),'hex');
  INSERT INTO medialab_core.temporary_download_center_access_credentials(id,center_id,organization_id,property_hub_id,credential_generation,verifier_sha256,verifier_algorithm,issued_by_identity_id,issued_at,expires_at,reason,context)
    VALUES(x,c.id,c.organization_id,c.property_hub_id,1,v,'SHA256-HEX-V1',a,now_at,c.expires_at,p_reason,p_context);
  INSERT INTO medialab_core.temporary_download_center_access_credential_events(id,credential_id,center_id,organization_id,property_hub_id,credential_generation,event_type,reason,evidence,recorded_by_identity_id,recorded_at)
    VALUES(e,x,c.id,c.organization_id,c.property_hub_id,1,'ISSUED',p_reason,p_context,a,now_at);
  INSERT INTO medialab_core.temporary_download_center_access_credential_current(center_id,current_credential_id,current_generation,lifecycle_state,updated_at) VALUES(c.id,x,1,'ACTIVE',now_at);
  r:=jsonb_build_object('credential_id',x,'generation',1,'expires_at',c.expires_at);
  PERFORM medialab_core.record_media_idempotency(a,'ISSUE_TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL',p_key,q,r);
  RETURN r||jsonb_build_object('access_secret',s,'secret_returned',true,'replayed',false);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.rotate_temporary_download_center_access_credential(p_session text,p_key text,p_center uuid,p_expected_credential_generation integer,p_reason text,p_context jsonb)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;center_current medialab_core.temporary_download_center_current%ROWTYPE;cur medialab_core.temporary_download_center_access_credential_current%ROWTYPE;oldc medialab_core.temporary_download_center_access_credentials%ROWTYPE;x uuid;e uuid;s text;v text;q text;r jsonb;now_at timestamptz;n integer;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND OR a<>c.created_by_identity_id OR medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.manage')='NONE' THEN RAISE EXCEPTION 'Only the currently authorized center creator may rotate access' USING ERRCODE='42501';END IF;
  PERFORM medialab_core.validate_temporary_download_center_gateway_text(p_reason,true,1000);PERFORM medialab_core.validate_temporary_download_center_gateway_json(p_context);
  q:=encode(sha256(convert_to(jsonb_build_array(p_center,p_expected_credential_generation,p_reason,p_context)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'ROTATE_TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL',p_key,q);
  IF r IS NOT NULL THEN RETURN r||jsonb_build_object('access_secret',NULL,'secret_returned',false,'replayed',true);END IF;
  SELECT * INTO center_current FROM medialab_core.temporary_download_center_current WHERE center_id=c.id;
  SELECT * INTO cur FROM medialab_core.temporary_download_center_access_credential_current WHERE center_id=c.id FOR UPDATE;
  IF NOT FOUND OR cur.lifecycle_state<>'ACTIVE' OR cur.current_generation<>p_expected_credential_generation OR center_current.lifecycle_state<>'ACTIVE' OR clock_timestamp()>=c.expires_at THEN RAISE EXCEPTION 'Rotation requires the current active unexpired credential generation' USING ERRCODE='40001';END IF;
  SELECT * INTO oldc FROM medialab_core.temporary_download_center_access_credentials WHERE id=cur.current_credential_id;n:=cur.current_generation+1;
  now_at:=clock_timestamp();x:=gen_random_uuid();e:=gen_random_uuid();s:=encode(sha256(uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid())),'hex');v:=encode(sha256(convert_to(s,'UTF8')),'hex');
  INSERT INTO medialab_core.temporary_download_center_access_credentials(id,center_id,organization_id,property_hub_id,credential_generation,verifier_sha256,verifier_algorithm,issued_by_identity_id,issued_at,expires_at,predecessor_credential_id,reason,context)
    VALUES(x,c.id,c.organization_id,c.property_hub_id,n,v,'SHA256-HEX-V1',a,now_at,c.expires_at,oldc.id,p_reason,p_context);
  INSERT INTO medialab_core.temporary_download_center_access_credential_events(id,credential_id,center_id,organization_id,property_hub_id,credential_generation,event_type,previous_credential_id,reason,evidence,recorded_by_identity_id,recorded_at)
    VALUES(e,x,c.id,c.organization_id,c.property_hub_id,n,'ROTATED',oldc.id,p_reason,p_context,a,now_at);
  PERFORM set_config('medialab.tdc_gateway_current_mutation','allowed',true);
  UPDATE medialab_core.temporary_download_center_access_credential_current SET current_credential_id=x,current_generation=n,lifecycle_state='ACTIVE',terminal_event_id=NULL,updated_at=now_at WHERE center_id=c.id;
  r:=jsonb_build_object('credential_id',x,'generation',n,'expires_at',c.expires_at);
  PERFORM medialab_core.record_media_idempotency(a,'ROTATE_TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL',p_key,q,r);
  RETURN r||jsonb_build_object('access_secret',s,'secret_returned',true,'replayed',false);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revoke_temporary_download_center_access_credential(p_session text,p_key text,p_center uuid,p_expected_credential_generation integer,p_reason text,p_context jsonb)
RETURNS uuid AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;cur medialab_core.temporary_download_center_access_credential_current%ROWTYPE;auth text;e uuid;q text;r jsonb;now_at timestamptz;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND THEN RAISE EXCEPTION 'Temporary Download Center access is missing or unavailable' USING ERRCODE='42501';END IF;
  auth:=medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.manage');
  IF auth='NONE' OR (a<>c.created_by_identity_id AND auth<>'ORGANIZATION_ADMIN') THEN RAISE EXCEPTION 'Only the authorized creator or current Organization Admin may revoke access' USING ERRCODE='42501';END IF;
  PERFORM medialab_core.validate_temporary_download_center_gateway_text(p_reason,true,1000);PERFORM medialab_core.validate_temporary_download_center_gateway_json(p_context);
  q:=encode(sha256(convert_to(jsonb_build_array(p_center,p_expected_credential_generation,p_reason,p_context)::text,'UTF8')),'hex');r:=medialab_core.check_media_idempotency(a,'REVOKE_TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL',p_key,q);IF r IS NOT NULL THEN RETURN (r->>'event_id')::uuid;END IF;
  SELECT * INTO cur FROM medialab_core.temporary_download_center_access_credential_current WHERE center_id=c.id FOR UPDATE;
  IF NOT FOUND OR cur.lifecycle_state<>'ACTIVE' OR cur.current_generation<>p_expected_credential_generation THEN RAISE EXCEPTION 'Revocation requires the current active credential generation' USING ERRCODE='40001';END IF;
  now_at:=clock_timestamp();e:=gen_random_uuid();
  INSERT INTO medialab_core.temporary_download_center_access_credential_events(id,credential_id,center_id,organization_id,property_hub_id,credential_generation,event_type,previous_credential_id,reason,evidence,recorded_by_identity_id,recorded_at)
    VALUES(e,cur.current_credential_id,c.id,c.organization_id,c.property_hub_id,cur.current_generation,'REVOKED',cur.current_credential_id,p_reason,p_context,a,now_at);
  PERFORM set_config('medialab.tdc_gateway_current_mutation','allowed',true);
  UPDATE medialab_core.temporary_download_center_access_credential_current SET lifecycle_state='REVOKED',terminal_event_id=e,updated_at=now_at WHERE center_id=c.id;
  PERFORM medialab_core.record_media_idempotency(a,'REVOKE_TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL',p_key,q,jsonb_build_object('event_id',e));RETURN e;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.evaluate_temporary_download_center_gateway_access(p_credential uuid,p_presented_secret text,p_event_kind text,p_access_event_reference text,p_item uuid,p_evidence jsonb)
RETURNS jsonb AS $$
DECLARE existing medialab_core.temporary_download_center_gateway_evaluations%ROWTYPE;cred medialab_core.temporary_download_center_access_credentials%ROWTYPE;c medialab_core.temporary_download_centers%ROWTYPE;cur medialab_core.temporary_download_center_access_credential_current%ROWTYPE;center_current medialab_core.temporary_download_center_current%ROWTYPE;item medialab_core.temporary_download_center_items%ROWTYPE;policy jsonb;request_secret_hash text;request_hash text;computed_verifier text;secret_valid boolean:=false;allow_access boolean:=false;internal_reason text:='CREDENTIAL_INVALID';eval_id uuid;obs_id uuid;obs_version uuid;obs_item uuid;now_at timestamptz;response_reason text;safe_center uuid;safe_version uuid;safe_item uuid;
BEGIN
  IF p_event_kind NOT IN ('OPEN','DOWNLOAD') THEN RAISE EXCEPTION 'Gateway event kind must be OPEN or DOWNLOAD' USING ERRCODE='22023';END IF;
  IF p_access_event_reference IS NULL OR p_access_event_reference !~ '^[A-Z0-9][A-Z0-9_.:-]{2,199}$' THEN RAISE EXCEPTION 'A bounded opaque access-event reference is required' USING ERRCODE='22023';END IF;
  PERFORM medialab_core.validate_temporary_download_center_gateway_json(p_evidence);
  request_secret_hash:=encode(sha256(convert_to(CASE WHEN p_presented_secret IS NULL THEN '<NULL>' WHEN length(p_presented_secret)<=256 THEN p_presented_secret ELSE left(p_presented_secret,256)||':'||length(p_presented_secret)::text END,'UTF8')),'hex');
  request_hash:=encode(sha256(convert_to(jsonb_build_array(p_credential,p_event_kind,p_item,p_evidence,request_secret_hash)::text,'UTF8')),'hex');
  SELECT * INTO existing FROM medialab_core.temporary_download_center_gateway_evaluations WHERE access_event_reference=p_access_event_reference;
  IF FOUND THEN
    IF existing.request_sha256<>request_hash THEN RAISE EXCEPTION 'Conflicting access-event replay rejected' USING ERRCODE='23505';END IF;
    RETURN jsonb_build_object('decision',existing.decision,'reason_code',CASE WHEN existing.decision='ALLOW' THEN 'GATEWAY_ALLOWED' ELSE 'ACCESS_DENIED' END,'center_id',CASE WHEN existing.decision='ALLOW' THEN existing.center_id ELSE NULL END,'current_version_id',CASE WHEN existing.decision='ALLOW' THEN existing.version_id ELSE NULL END,'item_id',CASE WHEN existing.decision='ALLOW' THEN existing.item_id ELSE NULL END,'access_event_reference',existing.access_event_reference,'replayed',true);
  END IF;
  SELECT * INTO cred FROM medialab_core.temporary_download_center_access_credentials WHERE id=p_credential;
  IF FOUND THEN
    SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=cred.center_id;
    SELECT * INTO cur FROM medialab_core.temporary_download_center_access_credential_current WHERE center_id=cred.center_id;
    SELECT * INTO center_current FROM medialab_core.temporary_download_center_current WHERE center_id=cred.center_id;
    IF p_presented_secret IS NOT NULL AND p_presented_secret ~ '^[0-9a-f]{64}$' THEN computed_verifier:=encode(sha256(convert_to(p_presented_secret,'UTF8')),'hex');secret_valid:=computed_verifier=cred.verifier_sha256;END IF;
    IF secret_valid AND cur.lifecycle_state='ACTIVE' AND cur.current_credential_id=cred.id AND cur.current_generation=cred.credential_generation AND clock_timestamp()<cred.expires_at THEN
      policy:=medialab_core.temporary_download_center_current_policy(cred.center_id);
      IF policy->>'policy_decision'='POLICY_ELIGIBLE' THEN
        IF p_event_kind='OPEN' THEN allow_access:=true;internal_reason:='GATEWAY_ALLOWED';
        ELSIF p_item IS NOT NULL AND EXISTS(SELECT 1 FROM medialab_core.temporary_download_center_items i WHERE i.id=p_item AND i.center_id=cred.center_id AND i.version_id=center_current.current_version_id) THEN allow_access:=true;internal_reason:='GATEWAY_ALLOWED';
        ELSE internal_reason:='ITEM_NOT_CURRENT';END IF;
      ELSE internal_reason:=COALESCE(policy->>'reason_code','CENTER_POLICY_LOCKED');END IF;
    END IF;
    IF p_event_kind='OPEN' THEN obs_version:=center_current.current_version_id;obs_item:=NULL;
    ELSIF p_item IS NOT NULL THEN SELECT * INTO item FROM medialab_core.temporary_download_center_items WHERE id=p_item AND center_id=cred.center_id;IF FOUND THEN obs_version:=item.version_id;obs_item:=item.id;END IF;END IF;
  END IF;
  now_at:=clock_timestamp();eval_id:=gen_random_uuid();
  IF cred.id IS NOT NULL AND obs_version IS NOT NULL THEN
    obs_id:=gen_random_uuid();
    INSERT INTO medialab_core.temporary_download_center_access_observations(id,center_id,version_id,item_id,event_kind,observed_outcome,reason_code,access_event_reference,evidence,observed_at,recorded_at)
      VALUES(obs_id,cred.center_id,obs_version,obs_item,p_event_kind,CASE WHEN allow_access THEN 'ALLOW' ELSE 'DENY' END,internal_reason,p_access_event_reference,jsonb_build_object('gateway_evaluation_id',eval_id,'generation',cred.credential_generation,'request_evidence',p_evidence),now_at,now_at);
  END IF;
  INSERT INTO medialab_core.temporary_download_center_gateway_evaluations(id,access_event_reference,request_sha256,credential_id,center_id,organization_id,property_hub_id,version_id,item_id,event_kind,decision,reason_code,observation_id,evidence,evaluated_at)
    VALUES(eval_id,p_access_event_reference,request_hash,cred.id,CASE WHEN cred.id IS NOT NULL THEN cred.center_id ELSE NULL END,CASE WHEN cred.id IS NOT NULL THEN cred.organization_id ELSE NULL END,CASE WHEN cred.id IS NOT NULL THEN cred.property_hub_id ELSE NULL END,CASE WHEN cred.id IS NOT NULL THEN COALESCE(obs_version,center_current.current_version_id) ELSE NULL END,CASE WHEN cred.id IS NOT NULL THEN obs_item ELSE NULL END,p_event_kind,CASE WHEN allow_access THEN 'ALLOW' ELSE 'DENY' END,internal_reason,obs_id,p_evidence,now_at);
  IF allow_access THEN response_reason:='GATEWAY_ALLOWED';safe_center:=cred.center_id;safe_version:=center_current.current_version_id;safe_item:=CASE WHEN p_event_kind='DOWNLOAD' THEN p_item ELSE NULL END;
  ELSE response_reason:='ACCESS_DENIED';safe_center:=NULL;safe_version:=NULL;safe_item:=NULL;END IF;
  RETURN jsonb_build_object('decision',CASE WHEN allow_access THEN 'ALLOW' ELSE 'DENY' END,'reason_code',response_reason,'center_id',safe_center,'current_version_id',safe_version,'item_id',safe_item,'access_event_reference',p_access_event_reference,'replayed',false);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_temporary_download_center_access_credential_history(p_session text,p_center uuid)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;auth text;z jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND THEN RAISE EXCEPTION 'Temporary Download Center access is missing or unavailable' USING ERRCODE='42501';END IF;
  auth:=medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.manage');
  IF auth='NONE' OR (a<>c.created_by_identity_id AND auth<>'ORGANIZATION_ADMIN') THEN RAISE EXCEPTION 'Only the authorized creator or current Organization Admin may read access history' USING ERRCODE='42501';END IF;
  SELECT jsonb_build_object('center_id',c.id,'current',CASE WHEN cur.center_id IS NULL THEN NULL ELSE jsonb_build_object('current_credential_id',cur.current_credential_id,'current_generation',cur.current_generation,'lifecycle_state',cur.lifecycle_state,'terminal_event_id',cur.terminal_event_id,'updated_at',cur.updated_at) END,'credentials',COALESCE((SELECT jsonb_agg(jsonb_build_object('credential_id',x.id,'generation',x.credential_generation,'verifier_algorithm',x.verifier_algorithm,'issued_by_identity_id',x.issued_by_identity_id,'issued_at',x.issued_at,'expires_at',x.expires_at,'predecessor_credential_id',x.predecessor_credential_id,'reason',x.reason,'context',x.context) ORDER BY x.credential_generation,x.id) FROM medialab_core.temporary_download_center_access_credentials x WHERE x.center_id=c.id),'[]'::jsonb),'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('event_id',e.id,'credential_id',e.credential_id,'generation',e.credential_generation,'event_type',e.event_type,'previous_credential_id',e.previous_credential_id,'reason',e.reason,'evidence',e.evidence,'recorded_by_identity_id',e.recorded_by_identity_id,'recorded_at',e.recorded_at) ORDER BY e.recorded_at,e.id) FROM medialab_core.temporary_download_center_access_credential_events e WHERE e.center_id=c.id),'[]'::jsonb)) INTO z FROM medialab_core.temporary_download_center_access_credential_current cur WHERE cur.center_id=c.id;
  IF z IS NULL THEN z:=jsonb_build_object('center_id',c.id,'current',NULL,'credentials','[]'::jsonb,'events','[]'::jsonb);END IF;RETURN z;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_temporary_download_center_gateway_history(p_session text,p_center uuid)
RETURNS jsonb AS $$
DECLARE a uuid;c medialab_core.temporary_download_centers%ROWTYPE;auth text;z jsonb;
BEGIN
  SELECT actor_identity_id INTO a FROM medialab_core.resolve_ordinary_session(p_session);SELECT * INTO c FROM medialab_core.temporary_download_centers WHERE id=p_center;
  IF NOT FOUND THEN RAISE EXCEPTION 'Temporary Download Center gateway history is missing or unavailable' USING ERRCODE='42501';END IF;
  auth:=medialab_core.temporary_download_center_hub_authority(a,c.organization_id,c.property_hub_id,'temporary_download_center.activity.read');
  IF auth='NONE' OR (a<>c.created_by_identity_id AND auth<>'ORGANIZATION_ADMIN') THEN RAISE EXCEPTION 'Only the authorized creator or current Organization Admin may read gateway history' USING ERRCODE='42501';END IF;
  SELECT jsonb_build_object('center_id',c.id,'evaluations',COALESCE(jsonb_agg(jsonb_build_object('evaluation_id',g.id,'access_event_reference',g.access_event_reference,'credential_id',g.credential_id,'version_id',g.version_id,'item_id',g.item_id,'event_kind',g.event_kind,'decision',g.decision,'reason_code',g.reason_code,'observation_id',g.observation_id,'evidence',g.evidence,'evaluated_at',g.evaluated_at) ORDER BY g.evaluated_at,g.id) FILTER(WHERE g.id IS NOT NULL),'[]'::jsonb)) INTO z FROM medialab_core.temporary_download_center_gateway_evaluations g WHERE g.center_id=c.id;RETURN z;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,medialab_core,pg_temp;

CREATE TRIGGER tdc_access_credentials_scope_guard BEFORE INSERT ON medialab_core.temporary_download_center_access_credentials FOR EACH ROW EXECUTE FUNCTION medialab_core.validate_tdc_access_credential_scope();
CREATE TRIGGER tdc_access_credentials_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_access_credentials FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_tdc_access_credential_evidence_mutation();
CREATE TRIGGER tdc_access_credential_events_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_access_credential_events FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_tdc_access_credential_evidence_mutation();
CREATE TRIGGER tdc_gateway_evaluations_immutability_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_gateway_evaluations FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_tdc_access_credential_evidence_mutation();
CREATE TRIGGER tdc_access_credential_current_control_guard BEFORE UPDATE OR DELETE ON medialab_core.temporary_download_center_access_credential_current FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_tdc_access_credential_current_mutation();

REVOKE ALL ON TABLE medialab_core.temporary_download_center_access_credentials,medialab_core.temporary_download_center_access_credential_events,medialab_core.temporary_download_center_access_credential_current,medialab_core.temporary_download_center_gateway_evaluations FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_tdc_access_credential_evidence_mutation(),medialab_core.guard_tdc_access_credential_current_mutation(),medialab_core.validate_temporary_download_center_gateway_text(text,boolean,integer),medialab_core.validate_temporary_download_center_gateway_json(jsonb),medialab_core.validate_tdc_access_credential_scope(),medialab_core.temporary_download_center_current_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.issue_temporary_download_center_access_credential(text,text,uuid,bigint,text,jsonb),medialab_core.rotate_temporary_download_center_access_credential(text,text,uuid,integer,text,jsonb),medialab_core.revoke_temporary_download_center_access_credential(text,text,uuid,integer,text,jsonb),medialab_core.evaluate_temporary_download_center_gateway_access(uuid,text,text,text,uuid,jsonb),medialab_core.get_temporary_download_center_access_credential_history(text,uuid),medialab_core.get_temporary_download_center_gateway_history(text,uuid) FROM PUBLIC;
