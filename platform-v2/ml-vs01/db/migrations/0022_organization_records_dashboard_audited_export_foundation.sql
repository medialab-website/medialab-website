-- P02-M15-E: Organization records, personal-summary privacy, and audited export foundation.
-- Nonproduction only. This migration creates no trusted-billing activation, payment ledger,
-- customer-facing dashboard authority, media authority, Property Hub authority, or file delivery.

CREATE TABLE medialab_core.organization_record_personal_summary_shares (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL,
    commercial_owner_person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    shared_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    shared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (order_id, organization_id)
      REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT organization_record_shares_scope_key UNIQUE (id, organization_id, order_id),
    CONSTRAINT organization_record_shares_order_key UNIQUE (order_id),
    CONSTRAINT organization_record_shares_actor_key UNIQUE (shared_by_identity_id, idempotency_key),
    CONSTRAINT organization_record_shares_reason_check CHECK (
      reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT organization_record_shares_key_check CHECK (
      idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT organization_record_shares_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.organization_record_personal_summary_revocations (
    id uuid PRIMARY KEY,
    share_id uuid NOT NULL UNIQUE,
    organization_id uuid NOT NULL,
    order_id uuid NOT NULL,
    revoked_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (share_id, organization_id, order_id)
      REFERENCES medialab_core.organization_record_personal_summary_shares(id, organization_id, order_id) ON DELETE RESTRICT,
    CONSTRAINT organization_record_revocations_scope_key UNIQUE (id, organization_id, order_id),
    CONSTRAINT organization_record_revocations_actor_key UNIQUE (revoked_by_identity_id, idempotency_key),
    CONSTRAINT organization_record_revocations_reason_check CHECK (
      reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT organization_record_revocations_key_check CHECK (
      idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT organization_record_revocations_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.organization_record_export_snapshots (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    requested_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    requested_format text NOT NULL,
    as_of timestamptz NOT NULL,
    row_count integer NOT NULL,
    canonical_payload text NOT NULL,
    canonical_payload_sha256 text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organization_record_exports_scope_key UNIQUE (id, organization_id),
    CONSTRAINT organization_record_exports_actor_key UNIQUE (requested_by_identity_id, idempotency_key),
    CONSTRAINT organization_record_exports_format_check CHECK (requested_format IN ('CSV', 'JSON')),
    CONSTRAINT organization_record_exports_count_check CHECK (row_count >= 0),
    CONSTRAINT organization_record_exports_payload_check CHECK (
      canonical_payload <> '' AND jsonb_typeof(canonical_payload::jsonb) = 'object'
    ),
    CONSTRAINT organization_record_exports_payload_sha_check CHECK (canonical_payload_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT organization_record_exports_reason_check CHECK (
      reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT organization_record_exports_key_check CHECK (
      idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT organization_record_exports_request_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.organization_record_export_items (
    id uuid PRIMARY KEY,
    export_snapshot_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    position integer NOT NULL,
    order_id uuid NOT NULL,
    visibility_basis text NOT NULL,
    personal_summary_share_id uuid NULL,
    row_payload text NOT NULL,
    row_payload_sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (export_snapshot_id, organization_id)
      REFERENCES medialab_core.organization_record_export_snapshots(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id, organization_id)
      REFERENCES medialab_core.orders(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (personal_summary_share_id, organization_id, order_id)
      REFERENCES medialab_core.organization_record_personal_summary_shares(id, organization_id, order_id) ON DELETE RESTRICT,
    CONSTRAINT organization_record_export_items_position_key UNIQUE (export_snapshot_id, position),
    CONSTRAINT organization_record_export_items_order_key UNIQUE (export_snapshot_id, order_id),
    CONSTRAINT organization_record_export_items_position_check CHECK (position > 0),
    CONSTRAINT organization_record_export_items_basis_check CHECK (
      (visibility_basis = 'ORGANIZATION_FUNDED' AND personal_summary_share_id IS NULL) OR
      (visibility_basis = 'PERSONAL_SUMMARY_SHARED' AND personal_summary_share_id IS NOT NULL)
    ),
    CONSTRAINT organization_record_export_items_payload_check CHECK (
      row_payload <> '' AND jsonb_typeof(row_payload::jsonb) = 'object'
    ),
    CONSTRAINT organization_record_export_items_sha_check CHECK (row_payload_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE medialab_core.organization_record_access_events (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    order_id uuid NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    decision text NOT NULL,
    reason_code text NOT NULL,
    reason text NOT NULL,
    personal_summary_share_id uuid NULL REFERENCES medialab_core.organization_record_personal_summary_shares(id) ON DELETE RESTRICT,
    personal_summary_revocation_id uuid NULL REFERENCES medialab_core.organization_record_personal_summary_revocations(id) ON DELETE RESTRICT,
    export_snapshot_id uuid NULL REFERENCES medialab_core.organization_record_export_snapshots(id) ON DELETE RESTRICT,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organization_record_access_events_type_check CHECK (
      event_type IN ('PERSONAL_SUMMARY_SHARED','PERSONAL_SUMMARY_REVOKED','INTERNAL_PROJECTION_EVALUATED','EXPORT_SNAPSHOT_CREATED')
    ),
    CONSTRAINT organization_record_access_events_decision_check CHECK (decision IN ('ALLOW','RECORDED')),
    CONSTRAINT organization_record_access_events_reason_code_check CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT organization_record_access_events_reason_check CHECK (
      reason = btrim(reason) AND reason <> '' AND length(reason) <= 1000
    ),
    CONSTRAINT organization_record_access_events_evidence_check CHECK (jsonb_typeof(evidence) = 'object'),
    CONSTRAINT organization_record_access_events_reference_check CHECK (
      (event_type = 'PERSONAL_SUMMARY_SHARED' AND personal_summary_share_id IS NOT NULL AND personal_summary_revocation_id IS NULL AND export_snapshot_id IS NULL AND order_id IS NOT NULL) OR
      (event_type = 'PERSONAL_SUMMARY_REVOKED' AND personal_summary_share_id IS NOT NULL AND personal_summary_revocation_id IS NOT NULL AND export_snapshot_id IS NULL AND order_id IS NOT NULL) OR
      (event_type = 'INTERNAL_PROJECTION_EVALUATED' AND personal_summary_share_id IS NULL AND personal_summary_revocation_id IS NULL AND export_snapshot_id IS NULL AND order_id IS NULL) OR
      (event_type = 'EXPORT_SNAPSHOT_CREATED' AND personal_summary_share_id IS NULL AND personal_summary_revocation_id IS NULL AND export_snapshot_id IS NOT NULL AND order_id IS NULL)
    )
);

CREATE INDEX organization_record_shares_org_time_idx
  ON medialab_core.organization_record_personal_summary_shares (organization_id, shared_at, order_id);
CREATE INDEX organization_record_revocations_org_time_idx
  ON medialab_core.organization_record_personal_summary_revocations (organization_id, revoked_at, order_id);
CREATE INDEX organization_record_exports_org_time_idx
  ON medialab_core.organization_record_export_snapshots (organization_id, as_of, created_at, id);
CREATE INDEX organization_record_export_items_order_idx
  ON medialab_core.organization_record_export_items (organization_id, order_id, export_snapshot_id);
CREATE INDEX organization_record_access_events_org_time_idx
  ON medialab_core.organization_record_access_events (organization_id, recorded_at, id);
CREATE INDEX organization_record_access_events_actor_time_idx
  ON medialab_core.organization_record_access_events (actor_identity_id, recorded_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_organization_record_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only and immutable', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.validate_organization_record_text(p_value text, p_label text)
RETURNS void AS $$
BEGIN
  IF p_value IS NULL OR p_value <> btrim(p_value) OR p_value = '' OR length(p_value) > 1000 THEN
    RAISE EXCEPTION '% must be trimmed nonempty text of at most 1000 characters', p_label USING ERRCODE = '22023';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.classify_organization_record_order(p_order uuid, p_organization uuid)
RETURNS TABLE(classification text, commercial_owner_person_id uuid) AS $$
  SELECT CASE
    WHEN o.organization_id <> p_organization THEN 'INELIGIBLE'
    WHEN bp.party_kind = 'ORGANIZATION' AND bp.organization_id = p_organization
     AND co.party_kind = 'ORGANIZATION' AND co.organization_id = p_organization
      THEN 'ORGANIZATION_FUNDED'
    WHEN bp.party_kind = 'PERSON' AND co.party_kind = 'PERSON'
     AND bp.person_id IS NOT NULL AND bp.person_id = co.person_id
      THEN 'PERSONAL_FUNDED'
    ELSE 'INELIGIBLE'
  END,
  CASE WHEN bp.party_kind = 'PERSON' AND co.party_kind = 'PERSON' AND bp.person_id = co.person_id
       THEN co.person_id ELSE NULL END
  FROM medialab_core.orders o
  LEFT JOIN medialab_core.order_parties bp ON bp.order_id = o.id AND bp.party_role = 'BILLING_PARTY'
  LEFT JOIN medialab_core.order_parties co ON co.order_id = o.id AND co.party_role = 'COMMERCIAL_OWNER'
  WHERE o.id = p_order;
$$ LANGUAGE sql STABLE STRICT
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.organization_record_projection_rows(p_organization uuid, p_as_of timestamptz)
RETURNS TABLE(order_id uuid, accepted_at timestamptz, visibility_basis text, personal_summary_share_id uuid, row_payload jsonb) AS $$
  SELECT o.id, o.accepted_at, 'ORGANIZATION_FUNDED'::text, NULL::uuid,
    jsonb_build_object(
      'record_type','ORGANIZATION_FUNDED',
      'order_id',o.id,
      'accepted_at',o.accepted_at,
      'service_items',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'position',i.position,'description',i.frozen_description,'quantity',i.quantity,
          'commercial_unit',i.commercial_unit,'unit_amount_cents',i.unit_amount_cents,
          'line_total_cents',i.line_total_cents,'currency',i.currency
        ) ORDER BY i.position,i.id) FROM medialab_core.order_items i WHERE i.order_id=o.id
      ),'[]'::jsonb),
      'appointments',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'starts_at',a.starts_at,'ends_at',a.ends_at,'iana_timezone',a.iana_timezone,
          'local_starts_at',a.local_starts_at,'local_ends_at',a.local_ends_at
        ) ORDER BY a.starts_at,a.id) FROM medialab_core.appointments a WHERE a.order_id=o.id AND a.confirmed_at <= p_as_of
      ),'[]'::jsonb),
      'settlement_mode',o.settlement_mode,
      'currency',o.currency,
      'item_subtotal_cents',o.item_subtotal_cents,
      'travel_amount_cents',o.travel_amount_cents,
      'total_amount_cents',o.total_amount_cents,
      'financial_eligibility_evidence',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'eligibility',f.eligibility,'evidence_kind',f.evidence_kind,'recorded_at',f.recorded_at
        ) ORDER BY f.recorded_at,f.id)
        FROM medialab_core.delivery_financial_eligibility_evidence f
        WHERE f.order_id=o.id AND f.organization_id=o.organization_id AND f.recorded_at <= p_as_of
      ),'[]'::jsonb)
    )
  FROM medialab_core.orders o
  CROSS JOIN LATERAL medialab_core.classify_organization_record_order(o.id,p_organization) c
  WHERE o.organization_id=p_organization AND o.accepted_at <= p_as_of AND c.classification='ORGANIZATION_FUNDED'
  UNION ALL
  SELECT o.id, o.accepted_at, 'PERSONAL_SUMMARY_SHARED'::text, s.id,
    jsonb_build_object(
      'record_type','PERSONAL_SUMMARY_SHARED',
      'order_id',o.id,
      'accepted_at',o.accepted_at,
      'service_items',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'position',i.position,'description',i.frozen_description,'quantity',i.quantity,
          'commercial_unit',i.commercial_unit
        ) ORDER BY i.position,i.id) FROM medialab_core.order_items i WHERE i.order_id=o.id
      ),'[]'::jsonb),
      'appointments',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'starts_at',a.starts_at,'ends_at',a.ends_at,'iana_timezone',a.iana_timezone,
          'local_starts_at',a.local_starts_at,'local_ends_at',a.local_ends_at
        ) ORDER BY a.starts_at,a.id) FROM medialab_core.appointments a WHERE a.order_id=o.id AND a.confirmed_at <= p_as_of
      ),'[]'::jsonb),
      'personal_summary_share_id',s.id
    )
  FROM medialab_core.orders o
  JOIN medialab_core.organization_record_personal_summary_shares s
    ON s.order_id=o.id AND s.organization_id=o.organization_id AND s.shared_at <= p_as_of
  CROSS JOIN LATERAL medialab_core.classify_organization_record_order(o.id,p_organization) c
  WHERE o.organization_id=p_organization AND o.accepted_at <= p_as_of AND c.classification='PERSONAL_FUNDED'
    AND NOT EXISTS (
      SELECT 1 FROM medialab_core.organization_record_personal_summary_revocations r
      WHERE r.share_id=s.id AND r.revoked_at <= p_as_of
    );
$$ LANGUAGE sql STABLE STRICT
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.share_personal_order_summary(
  p_session text, p_key text, p_order uuid, p_reason text
) RETURNS uuid AS $$
DECLARE
  a uuid; person uuid; o medialab_core.orders%ROWTYPE; c record; fingerprint text;
  existing medialab_core.organization_record_personal_summary_shares%ROWTYPE; result_id uuid;
BEGIN
  SELECT actor_identity_id,actor_person_id INTO a,person FROM medialab_core.resolve_ordinary_session(p_session);
  PERFORM medialab_core.validate_organization_record_text(p_key,'Idempotency key');
  IF length(p_key)>200 THEN RAISE EXCEPTION 'Idempotency key is too long' USING ERRCODE='22023'; END IF;
  PERFORM medialab_core.validate_organization_record_text(p_reason,'Reason');
  SELECT * INTO o FROM medialab_core.orders WHERE id=p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order is missing or unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM medialab_core.classify_organization_record_order(o.id,o.organization_id);
  IF c.classification <> 'PERSONAL_FUNDED' OR c.commercial_owner_person_id <> person THEN
    RAISE EXCEPTION 'Only the exact personal commercial owner may share this summary' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medialab_core.memberships m WHERE m.organization_id=o.organization_id AND m.person_id=person AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'An active membership in the exact Order organization is required' USING ERRCODE='42501';
  END IF;
  fingerprint:=encode(sha256(convert_to(concat_ws(chr(31),'SHARE_PERSONAL_ORDER_SUMMARY',a::text,o.id::text,p_reason),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtext(a::text||':SHARE_PERSONAL_ORDER_SUMMARY:'||p_key));
  SELECT * INTO existing FROM medialab_core.organization_record_personal_summary_shares
    WHERE shared_by_identity_id=a AND idempotency_key=p_key;
  IF FOUND THEN
    IF existing.request_sha256<>fingerprint THEN RAISE EXCEPTION 'Idempotency key was reused with a different request' USING ERRCODE='22023'; END IF;
    RETURN existing.id;
  END IF;
  IF EXISTS (SELECT 1 FROM medialab_core.organization_record_personal_summary_shares WHERE order_id=o.id) THEN
    RAISE EXCEPTION 'This personal Order already has preserved share evidence' USING ERRCODE='23505';
  END IF;
  result_id:=gen_random_uuid();
  INSERT INTO medialab_core.organization_record_personal_summary_shares
    (id,organization_id,order_id,commercial_owner_person_id,shared_by_identity_id,reason,idempotency_key,request_sha256)
  VALUES(result_id,o.organization_id,o.id,person,a,p_reason,p_key,fingerprint);
  INSERT INTO medialab_core.organization_record_access_events
    (id,organization_id,order_id,actor_identity_id,event_type,decision,reason_code,reason,personal_summary_share_id,evidence)
  VALUES(gen_random_uuid(),o.organization_id,o.id,a,'PERSONAL_SUMMARY_SHARED','RECORDED','EXACT_PERSONAL_OWNER',p_reason,result_id,'{}');
  RETURN result_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revoke_personal_order_summary(
  p_session text, p_key text, p_share uuid, p_reason text
) RETURNS uuid AS $$
DECLARE
  a uuid; person uuid; s medialab_core.organization_record_personal_summary_shares%ROWTYPE;
  c record; fingerprint text; existing medialab_core.organization_record_personal_summary_revocations%ROWTYPE; result_id uuid;
BEGIN
  SELECT actor_identity_id,actor_person_id INTO a,person FROM medialab_core.resolve_ordinary_session(p_session);
  PERFORM medialab_core.validate_organization_record_text(p_key,'Idempotency key');
  IF length(p_key)>200 THEN RAISE EXCEPTION 'Idempotency key is too long' USING ERRCODE='22023'; END IF;
  PERFORM medialab_core.validate_organization_record_text(p_reason,'Reason');
  SELECT * INTO s FROM medialab_core.organization_record_personal_summary_shares WHERE id=p_share;
  IF NOT FOUND THEN RAISE EXCEPTION 'Share evidence is missing or unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM medialab_core.classify_organization_record_order(s.order_id,s.organization_id);
  IF c.classification <> 'PERSONAL_FUNDED' OR c.commercial_owner_person_id <> person OR s.commercial_owner_person_id<>person THEN
    RAISE EXCEPTION 'Only the exact personal commercial owner may revoke this summary' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medialab_core.memberships m WHERE m.organization_id=s.organization_id AND m.person_id=person AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'An active membership in the exact Order organization is required' USING ERRCODE='42501';
  END IF;
  fingerprint:=encode(sha256(convert_to(concat_ws(chr(31),'REVOKE_PERSONAL_ORDER_SUMMARY',a::text,s.id::text,p_reason),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtext(a::text||':REVOKE_PERSONAL_ORDER_SUMMARY:'||p_key));
  SELECT * INTO existing FROM medialab_core.organization_record_personal_summary_revocations
    WHERE revoked_by_identity_id=a AND idempotency_key=p_key;
  IF FOUND THEN
    IF existing.request_sha256<>fingerprint THEN RAISE EXCEPTION 'Idempotency key was reused with a different request' USING ERRCODE='22023'; END IF;
    RETURN existing.id;
  END IF;
  IF EXISTS (SELECT 1 FROM medialab_core.organization_record_personal_summary_revocations WHERE share_id=s.id) THEN
    RAISE EXCEPTION 'This personal summary share is already revoked' USING ERRCODE='23505';
  END IF;
  result_id:=gen_random_uuid();
  INSERT INTO medialab_core.organization_record_personal_summary_revocations
    (id,share_id,organization_id,order_id,revoked_by_identity_id,reason,idempotency_key,request_sha256)
  VALUES(result_id,s.id,s.organization_id,s.order_id,a,p_reason,p_key,fingerprint);
  INSERT INTO medialab_core.organization_record_access_events
    (id,organization_id,order_id,actor_identity_id,event_type,decision,reason_code,reason,personal_summary_share_id,personal_summary_revocation_id,evidence)
  VALUES(gen_random_uuid(),s.organization_id,s.order_id,a,'PERSONAL_SUMMARY_REVOKED','RECORDED','EXACT_PERSONAL_OWNER',p_reason,s.id,result_id,'{}');
  RETURN result_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_internal_organization_records_projection(
  p_organization uuid, p_requesting_actor uuid, p_as_of timestamptz, p_reason text
) RETURNS jsonb AS $$
DECLARE rows_payload jsonb; result_payload jsonb;
BEGIN
  PERFORM 1 FROM medialab_core.organizations WHERE id=p_organization;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization is missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM medialab_core.identities WHERE id=p_requesting_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requesting actor is missing' USING ERRCODE='22023'; END IF;
  PERFORM medialab_core.validate_organization_record_text(p_reason,'Reason');
  SELECT COALESCE(jsonb_agg(r.row_payload ORDER BY r.accepted_at,r.order_id),'[]'::jsonb)
    INTO rows_payload FROM medialab_core.organization_record_projection_rows(p_organization,p_as_of) r;
  result_payload:=jsonb_build_object('organization_id',p_organization,'as_of',p_as_of,'rows',rows_payload);
  INSERT INTO medialab_core.organization_record_access_events
    (id,organization_id,actor_identity_id,event_type,decision,reason_code,reason,evidence)
  VALUES(gen_random_uuid(),p_organization,p_requesting_actor,'INTERNAL_PROJECTION_EVALUATED','ALLOW','OWNER_ONLY_INTERNAL_PROJECTION',p_reason,jsonb_build_object('row_count',jsonb_array_length(rows_payload)));
  RETURN result_payload;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_organization_record_export_snapshot(
  p_organization uuid, p_requesting_actor uuid, p_format text, p_as_of timestamptz, p_key text, p_reason text
) RETURNS uuid AS $$
DECLARE
  fingerprint text; existing medialab_core.organization_record_export_snapshots%ROWTYPE;
  rows_payload jsonb; payload jsonb; payload_text text; payload_sha text; result_id uuid; item record;
BEGIN
  PERFORM 1 FROM medialab_core.organizations WHERE id=p_organization;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization is missing' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM medialab_core.identities WHERE id=p_requesting_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requesting actor is missing' USING ERRCODE='22023'; END IF;
  IF p_format NOT IN ('CSV','JSON') THEN RAISE EXCEPTION 'Export format must be CSV or JSON' USING ERRCODE='22023'; END IF;
  PERFORM medialab_core.validate_organization_record_text(p_key,'Idempotency key');
  IF length(p_key)>200 THEN RAISE EXCEPTION 'Idempotency key is too long' USING ERRCODE='22023'; END IF;
  PERFORM medialab_core.validate_organization_record_text(p_reason,'Reason');
  fingerprint:=encode(sha256(convert_to(concat_ws(chr(31),'CREATE_ORGANIZATION_RECORD_EXPORT',p_organization::text,p_requesting_actor::text,p_format,p_as_of::text,p_reason),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtext(p_requesting_actor::text||':CREATE_ORGANIZATION_RECORD_EXPORT:'||p_key));
  SELECT * INTO existing FROM medialab_core.organization_record_export_snapshots
    WHERE requested_by_identity_id=p_requesting_actor AND idempotency_key=p_key;
  IF FOUND THEN
    IF existing.request_sha256<>fingerprint THEN RAISE EXCEPTION 'Idempotency key was reused with a different request' USING ERRCODE='22023'; END IF;
    RETURN existing.id;
  END IF;
  SELECT COALESCE(jsonb_agg(r.row_payload ORDER BY r.accepted_at,r.order_id),'[]'::jsonb)
    INTO rows_payload FROM medialab_core.organization_record_projection_rows(p_organization,p_as_of) r;
  payload:=jsonb_build_object('organization_id',p_organization,'requested_format',p_format,'as_of',p_as_of,'rows',rows_payload);
  payload_text:=payload::text;
  payload_sha:=encode(sha256(convert_to(payload_text,'UTF8')),'hex');
  result_id:=gen_random_uuid();
  INSERT INTO medialab_core.organization_record_export_snapshots
    (id,organization_id,requested_by_identity_id,requested_format,as_of,row_count,canonical_payload,canonical_payload_sha256,reason,idempotency_key,request_sha256)
  VALUES(result_id,p_organization,p_requesting_actor,p_format,p_as_of,jsonb_array_length(rows_payload),payload_text,payload_sha,p_reason,p_key,fingerprint);
  FOR item IN
    SELECT row_number() OVER (ORDER BY r.accepted_at,r.order_id)::integer AS position,r.*
    FROM medialab_core.organization_record_projection_rows(p_organization,p_as_of) r
    ORDER BY r.accepted_at,r.order_id
  LOOP
    INSERT INTO medialab_core.organization_record_export_items
      (id,export_snapshot_id,organization_id,position,order_id,visibility_basis,personal_summary_share_id,row_payload,row_payload_sha256)
    VALUES(gen_random_uuid(),result_id,p_organization,item.position,item.order_id,item.visibility_basis,item.personal_summary_share_id,
      item.row_payload::text,encode(sha256(convert_to(item.row_payload::text,'UTF8')),'hex'));
  END LOOP;
  INSERT INTO medialab_core.organization_record_access_events
    (id,organization_id,actor_identity_id,event_type,decision,reason_code,reason,export_snapshot_id,evidence)
  VALUES(gen_random_uuid(),p_organization,p_requesting_actor,'EXPORT_SNAPSHOT_CREATED','RECORDED','OWNER_ONLY_IMMUTABLE_EXPORT',p_reason,result_id,
    jsonb_build_object('row_count',jsonb_array_length(rows_payload),'payload_sha256',payload_sha,'requested_format',p_format));
  RETURN result_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_organization_record_export_snapshot(p_export uuid)
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'snapshot',jsonb_build_object(
      'id',e.id,'organization_id',e.organization_id,'requested_by_identity_id',e.requested_by_identity_id,
      'requested_format',e.requested_format,'as_of',e.as_of,'row_count',e.row_count,
      'canonical_payload',e.canonical_payload::jsonb,'canonical_payload_sha256',e.canonical_payload_sha256,
      'created_at',e.created_at,'reason',e.reason
    ),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'position',i.position,'order_id',i.order_id,'visibility_basis',i.visibility_basis,
      'personal_summary_share_id',i.personal_summary_share_id,'row_payload',i.row_payload::jsonb,
      'row_payload_sha256',i.row_payload_sha256
    ) ORDER BY i.position) FROM medialab_core.organization_record_export_items i WHERE i.export_snapshot_id=e.id),'[]'::jsonb)
  ) FROM medialab_core.organization_record_export_snapshots e WHERE e.id=p_export;
$$ LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER organization_record_shares_immutability_guard
  BEFORE UPDATE OR DELETE ON medialab_core.organization_record_personal_summary_shares
  FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_organization_record_evidence_mutation();
CREATE TRIGGER organization_record_revocations_immutability_guard
  BEFORE UPDATE OR DELETE ON medialab_core.organization_record_personal_summary_revocations
  FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_organization_record_evidence_mutation();
CREATE TRIGGER organization_record_exports_immutability_guard
  BEFORE UPDATE OR DELETE ON medialab_core.organization_record_export_snapshots
  FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_organization_record_evidence_mutation();
CREATE TRIGGER organization_record_export_items_immutability_guard
  BEFORE UPDATE OR DELETE ON medialab_core.organization_record_export_items
  FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_organization_record_evidence_mutation();
CREATE TRIGGER organization_record_access_events_immutability_guard
  BEFORE UPDATE OR DELETE ON medialab_core.organization_record_access_events
  FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_organization_record_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.organization_record_personal_summary_shares FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.organization_record_personal_summary_revocations FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.organization_record_export_snapshots FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.organization_record_export_items FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.organization_record_access_events FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_organization_record_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.validate_organization_record_text(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.classify_organization_record_order(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.organization_record_projection_rows(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.share_personal_order_summary(text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.revoke_personal_order_summary(text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_internal_organization_records_projection(uuid,uuid,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_organization_record_export_snapshot(uuid,uuid,text,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_organization_record_export_snapshot(uuid) FROM PUBLIC;
