ALTER TABLE medialab_core.people
    ALTER COLUMN email DROP NOT NULL;

ALTER TABLE medialab_core.people
    DROP CONSTRAINT people_email_check;

ALTER TABLE medialab_core.people
    ADD CONSTRAINT people_email_check CHECK (
        email IS NULL OR (
            btrim(email) <> '' AND
            email = lower(email) AND
            email = btrim(email) AND
            length(email) - length(replace(email, '@', '')) = 1 AND
            position('@' in email) > 1 AND
            position('@' in email) < length(email)
        )
    );

CREATE OR REPLACE FUNCTION medialab_core.bootstrap_person_contact()
RETURNS trigger AS $$
DECLARE
    v_contact_id uuid;
BEGIN
    IF NEW.email IS NULL THEN
        RETURN NEW;
    END IF;

    v_contact_id := (
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 1, 8) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 9, 4) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 13, 4) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 17, 4) || '-' ||
        substr(md5('contact:' || NEW.id::text || ':' || NEW.email), 21, 12)
    )::uuid;

    INSERT INTO medialab_core.contact_methods (
        id, person_id, contact_type, submitted_value, normalized_value,
        lifecycle_state, created_by_identity_id, creation_authority, created_at
    ) VALUES (
        v_contact_id, NEW.id, 'EMAIL', NEW.email, NEW.email,
        'ACTIVE', NULL, 'SYSTEM_MIGRATION', NEW.created_at
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TABLE medialab_core.person_external_references (
    id uuid PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    source_system text NOT NULL,
    source_scope text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    provenance text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT person_external_references_source_system_check CHECK (
        source_system ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT person_external_references_source_scope_check CHECK (
        source_scope = btrim(source_scope) AND source_scope <> '' AND length(source_scope) <= 200
    ),
    CONSTRAINT person_external_references_record_type_check CHECK (
        external_record_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
    CONSTRAINT person_external_references_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND
        external_identifier <> '' AND length(external_identifier) <= 255
    ),
    CONSTRAINT person_external_references_provenance_check CHECK (
        provenance = btrim(provenance) AND provenance <> '' AND length(provenance) <= 500
    ),
    CONSTRAINT person_external_references_exact_source_key UNIQUE (
        source_system, source_scope, external_record_type, external_identifier
    )
);

CREATE INDEX person_external_references_person_idx
    ON medialab_core.person_external_references (person_id, recorded_at DESC, id DESC);

CREATE OR REPLACE FUNCTION medialab_core.reject_person_external_reference_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'person_external_references rows are append-only and immutable'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER person_external_references_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.person_external_references
    FOR EACH ROW
    EXECUTE FUNCTION medialab_core.reject_person_external_reference_mutation();

CREATE OR REPLACE FUNCTION medialab_core.reconcile_customer_person_intake(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_source_system text,
    p_source_scope text,
    p_external_record_type text,
    p_external_identifier text,
    p_source_evidence_fingerprint text,
    p_display_name text,
    p_email text
)
RETURNS jsonb AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_display_name text;
    v_email text;
    v_has_external_reference boolean;
    v_email_people uuid[];
    v_email_person_id uuid;
    v_external_person_id uuid;
    v_person_id uuid;
    v_membership_id uuid;
    v_membership_status text;
    v_person_outcome text;
    v_membership_outcome text;
    v_reference_outcome text := 'NOT_APPLICABLE';
    v_identity_basis text;
    v_lock_key text;
    v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    PERFORM medialab_core.require_order_permission(
        v_actor_identity_id, p_organization_id, 'order.create'
    );

    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'Customer intake idempotency key is invalid' USING ERRCODE = '22023';
    END IF;

    IF p_source_system IS NULL OR p_source_system !~ '^[A-Z][A-Z0-9_]{1,79}$' THEN
        RAISE EXCEPTION 'Customer intake source-system label is invalid' USING ERRCODE = '22023';
    END IF;

    IF p_source_evidence_fingerprint IS NULL OR
       p_source_evidence_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Customer intake requires an opaque SHA-256 evidence fingerprint'
            USING ERRCODE = '22023';
    END IF;

    v_display_name := regexp_replace(btrim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
    IF v_display_name = '' OR length(v_display_name) > 200 THEN
        RAISE EXCEPTION 'Customer display name is invalid' USING ERRCODE = '22023';
    END IF;

    v_email := NULLIF(btrim(coalesce(p_email, '')), '');
    IF v_email IS NOT NULL THEN
        v_email := medialab_core.normalize_contact_value('EMAIL', v_email);
        IF length(v_email) - length(replace(v_email, '@', '')) <> 1 OR
           position('@' in v_email) <= 1 OR position('@' in v_email) >= length(v_email) THEN
            RAISE EXCEPTION 'Customer email evidence is invalid' USING ERRCODE = '22023';
        END IF;
    END IF;

    v_has_external_reference :=
        p_source_scope IS NOT NULL OR p_external_record_type IS NOT NULL OR
        p_external_identifier IS NOT NULL;
    IF v_has_external_reference AND (
        p_source_scope IS NULL OR p_source_scope <> btrim(p_source_scope) OR
        p_source_scope = '' OR length(p_source_scope) > 200 OR
        p_external_record_type IS NULL OR
        p_external_record_type !~ '^[A-Z][A-Z0-9_]{1,79}$' OR
        p_external_identifier IS NULL OR
        p_external_identifier <> btrim(p_external_identifier) OR
        p_external_identifier = '' OR length(p_external_identifier) > 255
    ) THEN
        RAISE EXCEPTION 'Customer external-reference evidence is incomplete or invalid'
            USING ERRCODE = '22023';
    END IF;

    FOR v_lock_key IN
        SELECT key
          FROM unnest(ARRAY[
              CASE WHEN v_email IS NOT NULL
                   THEN 'EMAIL:' || v_email END,
              CASE WHEN v_has_external_reference
                   THEN 'EXTERNAL:' || p_source_system || ':' || p_source_scope || ':' ||
                        p_external_record_type || ':' || p_external_identifier END
          ]) AS keys(key)
         WHERE key IS NOT NULL
         ORDER BY key
    LOOP
        PERFORM pg_advisory_xact_lock(
            hashtextextended('CUSTOMER_PERSON_INTAKE:' || v_lock_key, 0)
        );
    END LOOP;

    IF v_email IS NOT NULL THEN
        SELECT array_agg(DISTINCT candidate.person_id ORDER BY candidate.person_id)
          INTO v_email_people
          FROM (
              SELECT p.id AS person_id
                FROM medialab_core.people p
               WHERE p.email = v_email
              UNION
              SELECT cm.person_id
                FROM medialab_core.contact_methods cm
               WHERE cm.contact_type = 'EMAIL'
                 AND cm.normalized_value = v_email
                 AND cm.lifecycle_state = 'ACTIVE'
          ) candidate;

        IF coalesce(array_length(v_email_people, 1), 0) > 1 THEN
            RAISE EXCEPTION 'Customer email evidence conflicts across canonical Persons'
                USING ERRCODE = '23505';
        END IF;
        v_email_person_id := v_email_people[1];
    END IF;

    IF v_has_external_reference THEN
        SELECT person_id
          INTO v_external_person_id
          FROM medialab_core.person_external_references
         WHERE source_system = p_source_system
           AND source_scope = p_source_scope
           AND external_record_type = p_external_record_type
           AND external_identifier = p_external_identifier
         FOR SHARE;
    END IF;

    IF v_email_person_id IS NOT NULL AND v_external_person_id IS NOT NULL AND
       v_email_person_id <> v_external_person_id THEN
        RAISE EXCEPTION 'Customer email and external-reference evidence resolve to different Persons'
            USING ERRCODE = '23505';
    END IF;

    IF v_email_person_id IS NOT NULL THEN
        v_person_id := v_email_person_id;
        v_person_outcome := 'REUSED';
        v_identity_basis := 'EMAIL';
    ELSIF v_external_person_id IS NOT NULL THEN
        v_person_id := v_external_person_id;
        v_person_outcome := 'REUSED';
        v_identity_basis := 'EXTERNAL_REFERENCE';
    ELSIF v_email IS NOT NULL THEN
        v_person_id := gen_random_uuid();
        INSERT INTO medialab_core.people (id, display_name, email, title, created_at, updated_at)
        VALUES (v_person_id, v_display_name, v_email, NULL, v_now, v_now);
        v_person_outcome := 'CREATED';
        v_identity_basis := 'EMAIL';
    ELSIF v_has_external_reference THEN
        v_person_id := gen_random_uuid();
        INSERT INTO medialab_core.people (id, display_name, email, title, created_at, updated_at)
        VALUES (v_person_id, v_display_name, NULL, NULL, v_now, v_now);
        v_person_outcome := 'CREATED';
        v_identity_basis := 'EXTERNAL_REFERENCE';
    ELSE
        RETURN jsonb_build_object(
            'outcome', 'AMBIGUOUS',
            'identity_basis', 'INSUFFICIENT_EVIDENCE',
            'person_id', NULL,
            'membership_id', NULL,
            'membership_status', NULL,
            'external_reference_outcome', 'NOT_APPLICABLE'
        );
    END IF;

    IF v_has_external_reference THEN
        IF v_external_person_id IS NULL THEN
            INSERT INTO medialab_core.person_external_references (
                id, person_id, source_system, source_scope, external_record_type,
                external_identifier, provenance, recorded_by_identity_id, recorded_at
            ) VALUES (
                gen_random_uuid(), v_person_id, p_source_system, p_source_scope,
                p_external_record_type, p_external_identifier,
                'LOCAL_READ_ONLY_SOURCE_EVIDENCE:' || p_source_evidence_fingerprint,
                v_actor_identity_id, v_now
            );
            v_reference_outcome := 'CREATED';
        ELSE
            v_reference_outcome := 'REUSED';
        END IF;
    END IF;

    SELECT id, status
      INTO v_membership_id, v_membership_status
      FROM medialab_core.memberships
     WHERE organization_id = p_organization_id
       AND person_id = v_person_id
     FOR UPDATE;

    IF v_membership_id IS NULL THEN
        v_membership_id := gen_random_uuid();
        INSERT INTO medialab_core.memberships (
            id, organization_id, person_id, status, is_organization_admin,
            activated_at, suspended_at, suspension_reason, removed_at,
            created_at, updated_at
        ) VALUES (
            v_membership_id, p_organization_id, v_person_id, 'ACTIVE', false,
            v_now, NULL, NULL, NULL, v_now, v_now
        );
        v_membership_status := 'ACTIVE';
        v_membership_outcome := 'CREATED';
    ELSIF v_membership_status = 'ACTIVE' THEN
        v_membership_outcome := 'REUSED';
    ELSE
        RAISE EXCEPTION 'Existing customer membership is not ACTIVE and cannot be reactivated by intake'
            USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'outcome', v_person_outcome,
        'identity_basis', v_identity_basis,
        'person_id', v_person_id,
        'membership_id', v_membership_id,
        'membership_status', v_membership_status,
        'membership_outcome', v_membership_outcome,
        'external_reference_outcome', v_reference_outcome,
        'source_evidence_fingerprint', p_source_evidence_fingerprint
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.reconcile_property_snapshot_intake(
    p_session_token text,
    p_idempotency_key text,
    p_organization_id uuid,
    p_source_system text,
    p_source_evidence_fingerprint text,
    p_address_line_1 text,
    p_address_line_2 text,
    p_locality text,
    p_administrative_area text,
    p_postal_code text,
    p_country_code text,
    p_reported_square_feet integer
)
RETURNS jsonb AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_address_line_1 text;
    v_address_line_2 text;
    v_locality text;
    v_administrative_area text;
    v_postal_code text;
    v_country_code text;
    v_property_ids uuid[];
    v_property_id uuid;
    v_snapshot_id uuid;
    v_property_outcome text;
    v_snapshot_outcome text;
    v_now timestamptz := clock_timestamp();
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    PERFORM medialab_core.require_order_permission(
        v_actor_identity_id, p_organization_id, 'order.create'
    );

    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'Property intake idempotency key is invalid' USING ERRCODE = '22023';
    END IF;
    IF p_source_system IS NULL OR p_source_system !~ '^[A-Z][A-Z0-9_]{1,79}$' THEN
        RAISE EXCEPTION 'Property intake source-system label is invalid' USING ERRCODE = '22023';
    END IF;
    IF p_source_evidence_fingerprint IS NULL OR
       p_source_evidence_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Property intake requires an opaque SHA-256 evidence fingerprint'
            USING ERRCODE = '22023';
    END IF;

    v_address_line_1 := regexp_replace(btrim(coalesce(p_address_line_1, '')), '\s+', ' ', 'g');
    v_address_line_2 := NULLIF(regexp_replace(btrim(coalesce(p_address_line_2, '')), '\s+', ' ', 'g'), '');
    v_locality := regexp_replace(btrim(coalesce(p_locality, '')), '\s+', ' ', 'g');
    v_administrative_area := upper(regexp_replace(btrim(coalesce(p_administrative_area, '')), '\s+', ' ', 'g'));
    v_postal_code := upper(regexp_replace(btrim(coalesce(p_postal_code, '')), '\s+', ' ', 'g'));
    v_country_code := upper(btrim(coalesce(p_country_code, '')));

    IF v_address_line_1 = '' OR v_locality = '' OR v_administrative_area = '' OR
       v_postal_code = '' OR v_country_code !~ '^[A-Z]{2}$' THEN
        RAISE EXCEPTION 'Property intake requires complete exact address components'
            USING ERRCODE = '22023';
    END IF;
    IF p_reported_square_feet IS NOT NULL AND p_reported_square_feet <= 0 THEN
        RAISE EXCEPTION 'Reported square feet must be positive when supplied'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'PROPERTY_SNAPSHOT_INTAKE:' || p_organization_id::text || ':' ||
        lower(v_address_line_1) || ':' || lower(coalesce(v_address_line_2, '')) || ':' ||
        lower(v_locality) || ':' || lower(v_administrative_area) || ':' ||
        lower(v_postal_code) || ':' || v_country_code,
        0
    ));

    SELECT array_agg(DISTINCT ps.property_id ORDER BY ps.property_id)
      INTO v_property_ids
      FROM medialab_core.property_snapshots ps
     WHERE ps.organization_id = p_organization_id
       AND lower(regexp_replace(btrim(ps.address_line_1), '\s+', ' ', 'g')) = lower(v_address_line_1)
       AND lower(coalesce(NULLIF(regexp_replace(btrim(coalesce(ps.address_line_2, '')), '\s+', ' ', 'g'), ''), '')) =
           lower(coalesce(v_address_line_2, ''))
       AND lower(regexp_replace(btrim(ps.locality), '\s+', ' ', 'g')) = lower(v_locality)
       AND lower(regexp_replace(btrim(ps.administrative_area), '\s+', ' ', 'g')) = lower(v_administrative_area)
       AND lower(regexp_replace(btrim(ps.postal_code), '\s+', ' ', 'g')) = lower(v_postal_code)
       AND upper(ps.country_code) = v_country_code;

    IF coalesce(array_length(v_property_ids, 1), 0) > 1 THEN
        RAISE EXCEPTION 'Exact address evidence resolves to multiple canonical Properties'
            USING ERRCODE = '21000';
    END IF;

    v_property_id := v_property_ids[1];
    IF v_property_id IS NULL THEN
        v_property_id := gen_random_uuid();
        INSERT INTO medialab_core.properties (id, organization_id, created_at, archived_at)
        VALUES (v_property_id, p_organization_id, v_now, NULL);
        v_property_outcome := 'PROPERTY_CREATED';
    ELSE
        v_property_outcome := 'PROPERTY_REUSED';
    END IF;

    SELECT ps.id
      INTO v_snapshot_id
      FROM medialab_core.property_snapshots ps
     WHERE ps.property_id = v_property_id
       AND ps.organization_id = p_organization_id
       AND lower(regexp_replace(btrim(ps.address_line_1), '\s+', ' ', 'g')) = lower(v_address_line_1)
       AND lower(coalesce(NULLIF(regexp_replace(btrim(coalesce(ps.address_line_2, '')), '\s+', ' ', 'g'), ''), '')) =
           lower(coalesce(v_address_line_2, ''))
       AND lower(regexp_replace(btrim(ps.locality), '\s+', ' ', 'g')) = lower(v_locality)
       AND lower(regexp_replace(btrim(ps.administrative_area), '\s+', ' ', 'g')) = lower(v_administrative_area)
       AND lower(regexp_replace(btrim(ps.postal_code), '\s+', ' ', 'g')) = lower(v_postal_code)
       AND upper(ps.country_code) = v_country_code
       AND ps.reported_square_feet IS NOT DISTINCT FROM p_reported_square_feet
     ORDER BY ps.created_at, ps.id
     LIMIT 1
     FOR SHARE;

    IF v_snapshot_id IS NULL THEN
        v_snapshot_id := gen_random_uuid();
        INSERT INTO medialab_core.property_snapshots (
            id, property_id, organization_id, captured_at, address_line_1,
            address_line_2, locality, administrative_area, postal_code,
            country_code, reported_square_feet, created_at
        ) VALUES (
            v_snapshot_id, v_property_id, p_organization_id, v_now,
            v_address_line_1, v_address_line_2, v_locality,
            v_administrative_area, v_postal_code, v_country_code,
            p_reported_square_feet, v_now
        );
        v_snapshot_outcome := 'SNAPSHOT_CREATED';
    ELSE
        v_snapshot_outcome := 'SNAPSHOT_REUSED';
    END IF;

    RETURN jsonb_build_object(
        'property_id', v_property_id,
        'property_snapshot_id', v_snapshot_id,
        'property_outcome', v_property_outcome,
        'snapshot_outcome', v_snapshot_outcome,
        'source_evidence_fingerprint', p_source_evidence_fingerprint
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON TABLE medialab_core.person_external_references FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.bootstrap_person_contact() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_person_external_reference_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reconcile_customer_person_intake(
    text, text, uuid, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reconcile_property_snapshot_intake(
    text, text, uuid, text, text, text, text, text, text, text, text, integer
) FROM PUBLIC;

COMMENT ON TABLE medialab_core.person_external_references IS
    'Append-only provider-neutral provenance linking an exact external customer reference to one canonical Person.';
COMMENT ON FUNCTION medialab_core.reconcile_customer_person_intake(
    text, text, uuid, text, text, text, text, text, text, text
) IS 'Ordinary-runtime customer Person and minimum Order membership reconciliation without authentication creation.';
COMMENT ON FUNCTION medialab_core.reconcile_property_snapshot_intake(
    text, text, uuid, text, text, text, text, text, text, text, text, integer
) IS 'Ordinary-runtime exact Property identity and immutable Snapshot reconciliation.';
