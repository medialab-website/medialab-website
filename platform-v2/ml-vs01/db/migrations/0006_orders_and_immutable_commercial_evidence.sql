CREATE TABLE medialab_core.orders (
    id uuid PRIMARY KEY,
    lane text NOT NULL,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    property_id uuid NULL,
    property_snapshot_id uuid NULL REFERENCES medialab_core.property_snapshots(id) ON DELETE RESTRICT,
    settlement_mode text NOT NULL,
    currency text NOT NULL,
    item_subtotal_cents bigint NOT NULL,
    travel_amount_cents bigint NOT NULL DEFAULT 0,
    travel_basis text NULL,
    total_amount_cents bigint NOT NULL,
    current_state text NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    accepted_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    accepted_at timestamptz NOT NULL,
    FOREIGN KEY (property_id, organization_id)
        REFERENCES medialab_core.properties(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT orders_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT orders_lane_check CHECK (lane ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT orders_property_pair_check CHECK (
        (property_id IS NULL AND property_snapshot_id IS NULL) OR
        (property_id IS NOT NULL AND property_snapshot_id IS NOT NULL)
    ),
    CONSTRAINT orders_real_estate_property_check CHECK (
        lane <> 'REAL_ESTATE' OR (property_id IS NOT NULL AND property_snapshot_id IS NOT NULL)
    ),
    CONSTRAINT orders_settlement_mode_check CHECK (settlement_mode IN ('PAY_NOW', 'APPROVED_TERMS')),
    CONSTRAINT orders_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT orders_item_subtotal_check CHECK (item_subtotal_cents >= 0),
    CONSTRAINT orders_travel_check CHECK (
        travel_amount_cents >= 0 AND
        ((travel_amount_cents = 0 AND travel_basis IS NULL) OR
         (travel_amount_cents > 0 AND travel_basis IS NOT NULL AND
          travel_basis = btrim(travel_basis) AND travel_basis <> '' AND length(travel_basis) <= 500))
    ),
    CONSTRAINT orders_total_check CHECK (total_amount_cents = item_subtotal_cents + travel_amount_cents),
    CONSTRAINT orders_state_check CHECK (current_state = 'ACCEPTED'),
    CONSTRAINT orders_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT orders_acceptance_time_check CHECK (accepted_at >= created_at)
);

CREATE TABLE medialab_core.order_parties (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    party_role text NOT NULL,
    party_kind text NOT NULL,
    person_id uuid NULL REFERENCES medialab_core.people(id) ON DELETE RESTRICT,
    organization_id uuid NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    membership_id uuid NULL REFERENCES medialab_core.memberships(id) ON DELETE RESTRICT,
    frozen_display_name text NOT NULL,
    authority_context text NOT NULL,
    source_system text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT order_parties_role_check CHECK (
        party_role IN ('ORDERING_PERSON', 'CUSTOMER', 'BILLING_PARTY', 'COMMERCIAL_OWNER', 'ORGANIZATION', 'AUTHORIZED_ACTOR')
    ),
    CONSTRAINT order_parties_kind_check CHECK (party_kind IN ('PERSON', 'ORGANIZATION')),
    CONSTRAINT order_parties_subject_check CHECK (
        (party_kind = 'PERSON' AND person_id IS NOT NULL AND organization_id IS NULL AND membership_id IS NOT NULL) OR
        (party_kind = 'ORGANIZATION' AND person_id IS NULL AND organization_id IS NOT NULL AND membership_id IS NULL)
    ),
    CONSTRAINT order_parties_name_check CHECK (
        frozen_display_name = btrim(frozen_display_name) AND frozen_display_name <> '' AND length(frozen_display_name) <= 200
    ),
    CONSTRAINT order_parties_authority_check CHECK (
        authority_context = btrim(authority_context) AND authority_context <> '' AND length(authority_context) <= 200
    ),
    CONSTRAINT order_parties_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT order_parties_order_role_key UNIQUE (order_id, party_role)
);

CREATE TABLE medialab_core.order_items (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    position integer NOT NULL,
    item_kind text NOT NULL,
    commercial_snapshot_id uuid NULL REFERENCES medialab_core.commercial_snapshots(id) ON DELETE RESTRICT,
    custom_commercial_snapshot_id uuid NULL REFERENCES medialab_core.custom_commercial_snapshots(id) ON DELETE RESTRICT,
    catalog_product_id uuid NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    frozen_description text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    commercial_unit text NOT NULL,
    unit_amount_cents bigint NOT NULL,
    line_total_cents bigint NOT NULL,
    currency text NOT NULL,
    source_item_identifier text NULL,
    custom_reason text NULL,
    custom_actor_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT order_items_position_check CHECK (position > 0),
    CONSTRAINT order_items_kind_check CHECK (item_kind IN ('CATALOG', 'CUSTOM')),
    CONSTRAINT order_items_evidence_check CHECK (
        (item_kind = 'CATALOG' AND commercial_snapshot_id IS NOT NULL AND custom_commercial_snapshot_id IS NULL AND
         catalog_product_id IS NOT NULL AND custom_reason IS NULL AND custom_actor_identity_id IS NULL) OR
        (item_kind = 'CUSTOM' AND commercial_snapshot_id IS NULL AND custom_commercial_snapshot_id IS NOT NULL AND
         catalog_product_id IS NULL AND custom_reason IS NOT NULL AND custom_actor_identity_id IS NOT NULL)
    ),
    CONSTRAINT order_items_description_check CHECK (
        frozen_description = btrim(frozen_description) AND frozen_description <> '' AND length(frozen_description) <= 500
    ),
    CONSTRAINT order_items_quantity_check CHECK (quantity > 0),
    CONSTRAINT order_items_unit_check CHECK (
        commercial_unit = btrim(commercial_unit) AND commercial_unit <> '' AND length(commercial_unit) <= 80
    ),
    CONSTRAINT order_items_amount_check CHECK (unit_amount_cents >= 0 AND line_total_cents >= 0),
    CONSTRAINT order_items_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT order_items_source_identifier_check CHECK (
        source_item_identifier IS NULL OR
        (source_item_identifier = btrim(source_item_identifier) AND source_item_identifier <> '' AND length(source_item_identifier) <= 200)
    ),
    CONSTRAINT order_items_custom_reason_check CHECK (
        custom_reason IS NULL OR
        (custom_reason = btrim(custom_reason) AND custom_reason <> '' AND length(custom_reason) <= 500)
    ),
    CONSTRAINT order_items_order_position_key UNIQUE (order_id, position)
);

CREATE TABLE medialab_core.order_external_references (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    provenance text NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT order_external_references_provider_check CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT order_external_references_type_check CHECK (external_record_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
    CONSTRAINT order_external_references_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND external_identifier <> '' AND length(external_identifier) <= 200
    ),
    CONSTRAINT order_external_references_provenance_check CHECK (
        provenance = btrim(provenance) AND provenance <> '' AND length(provenance) <= 500
    ),
    CONSTRAINT order_external_references_source_key UNIQUE (provider, external_record_type, external_identifier)
);

CREATE TABLE medialab_core.order_idempotency_records (
    id uuid PRIMARY KEY,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL,
    result_order_id uuid NOT NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    completion_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz NOT NULL,
    CONSTRAINT order_idempotency_records_command_check CHECK (command_type = 'CREATE_ORDER'),
    CONSTRAINT order_idempotency_records_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    ),
    CONSTRAINT order_idempotency_records_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT order_idempotency_records_state_check CHECK (completion_state = 'COMPLETED'),
    CONSTRAINT order_idempotency_records_time_check CHECK (completed_at >= created_at),
    CONSTRAINT order_idempotency_records_actor_command_key UNIQUE (actor_identity_id, command_type, idempotency_key)
);

CREATE TABLE medialab_core.order_events (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    authority_context text NOT NULL,
    source_system text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT order_events_type_check CHECK (event_type IN ('ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_RELATIONSHIP_RECORDED')),
    CONSTRAINT order_events_authority_check CHECK (
        authority_context = btrim(authority_context) AND authority_context <> '' AND length(authority_context) <= 200
    ),
    CONSTRAINT order_events_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT order_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 500
    ),
    CONSTRAINT order_events_idempotency_key_check CHECK (
        idempotency_key = btrim(idempotency_key) AND idempotency_key <> '' AND length(idempotency_key) <= 200
    )
);

CREATE TABLE medialab_core.order_relationships (
    id uuid PRIMARY KEY,
    original_order_id uuid NOT NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    related_order_id uuid NOT NULL REFERENCES medialab_core.orders(id) ON DELETE RESTRICT,
    relationship_type text NOT NULL,
    reason text NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT order_relationships_type_check CHECK (
        relationship_type IN ('CORRECTION', 'SUPPLEMENTAL', 'REPLACEMENT', 'CUSTOMER_ADDED_SCOPE', 'MEDIALAB_RESPONSIBLE_RETURN')
    ),
    CONSTRAINT order_relationships_not_self_check CHECK (original_order_id <> related_order_id),
    CONSTRAINT order_relationships_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 500
    ),
    CONSTRAINT order_relationships_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT order_relationships_pair_type_key UNIQUE (original_order_id, related_order_id, relationship_type)
);

CREATE INDEX orders_organization_created_idx
    ON medialab_core.orders (organization_id, created_at DESC, id DESC);
CREATE INDEX orders_property_idx
    ON medialab_core.orders (property_id, accepted_at DESC, id DESC);
CREATE INDEX order_parties_order_idx
    ON medialab_core.order_parties (order_id, party_role);
CREATE INDEX order_parties_person_idx
    ON medialab_core.order_parties (person_id, recorded_at DESC, id DESC);
CREATE INDEX order_items_order_idx
    ON medialab_core.order_items (order_id, position);
CREATE INDEX order_external_references_order_idx
    ON medialab_core.order_external_references (order_id, recorded_at, id);
CREATE INDEX order_events_order_idx
    ON medialab_core.order_events (order_id, occurred_at, id);
CREATE INDEX order_relationships_related_idx
    ON medialab_core.order_relationships (related_order_id, created_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_order_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable: UPDATE and DELETE are rejected', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.guard_order_relationship_insert()
RETURNS trigger AS $$
BEGIN
    LOCK TABLE medialab_core.order_relationships IN SHARE ROW EXCLUSIVE MODE;

    IF NEW.original_order_id = NEW.related_order_id THEN
        RAISE EXCEPTION 'An Order cannot be related to itself'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        WITH RECURSIVE descendants(order_id) AS (
            SELECT NEW.related_order_id
            UNION
            SELECT r.related_order_id
              FROM medialab_core.order_relationships r
              JOIN descendants d ON r.original_order_id = d.order_id
        )
        SELECT 1 FROM descendants WHERE order_id = NEW.original_order_id
    ) THEN
        RAISE EXCEPTION 'Order relationship would create a cycle'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.require_order_permission(
    p_actor_identity_id uuid,
    p_organization_id uuid,
    p_permission_code text
)
RETURNS void AS $$
DECLARE
    v_actor_person_id uuid;
BEGIN
    SELECT i.person_id
      INTO v_actor_person_id
      FROM medialab_core.identities i
      JOIN medialab_core.person_account_states s
        ON s.identity_id = i.id
       AND s.person_id = i.person_id
     WHERE i.id = p_actor_identity_id
       AND i.status = 'ACTIVE'
       AND s.current_state IN ('ACTIVE', 'RECOVERED');

    IF v_actor_person_id IS NULL THEN
        RAISE EXCEPTION 'Order actor identity is missing, inactive, suspended, or otherwise unusable'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM medialab_core.memberships m
          JOIN medialab_core.membership_permission_sets mps
            ON mps.membership_id = m.id
           AND mps.organization_id = m.organization_id
          JOIN medialab_core.permission_sets ps
            ON ps.id = mps.permission_set_id
           AND ps.organization_id = m.organization_id
          JOIN medialab_core.permission_set_permissions psp
            ON psp.permission_set_id = ps.id
          JOIN medialab_core.permissions p
            ON p.id = psp.permission_id
         WHERE m.person_id = v_actor_person_id
           AND m.organization_id = p_organization_id
           AND m.status = 'ACTIVE'
           AND ps.retired_at IS NULL
           AND p.is_active = true
           AND p.code = p_permission_code
    ) THEN
        RAISE EXCEPTION 'Order actor lacks required permission % for the target organization', p_permission_code
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_order(
    p_session_token text,
    p_idempotency_key text,
    p_lane text,
    p_organization_id uuid,
    p_property_id uuid,
    p_property_snapshot_id uuid,
    p_settlement_mode text,
    p_currency text,
    p_source_system text,
    p_source_record_type text,
    p_source_record_identifier text,
    p_parties jsonb,
    p_items jsonb,
    p_travel_amount_cents bigint,
    p_travel_basis text,
    p_related_order_id uuid,
    p_relationship_type text,
    p_relationship_reason text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_request_sha256 text;
    v_existing medialab_core.order_idempotency_records%ROWTYPE;
    v_order_id uuid := gen_random_uuid();
    v_now timestamptz := clock_timestamp();
    v_party jsonb;
    v_item jsonb;
    v_party_role text;
    v_party_person_id uuid;
    v_party_organization_id uuid;
    v_membership_id uuid;
    v_frozen_name text;
    v_position integer;
    v_commercial_snapshot_id uuid;
    v_custom_snapshot_id uuid;
    v_unit_amount_cents bigint;
    v_quantity numeric(12,3);
    v_line_total_numeric numeric;
    v_line_total_cents bigint;
    v_item_subtotal_cents bigint := 0;
    v_description text;
    v_unit text;
    v_item_currency text;
    v_catalog_product_id uuid;
    v_source_item_identifier text;
    v_custom_reason text;
    v_custom_actor_identity_id uuid;
    v_original_organization_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    PERFORM medialab_core.require_order_permission(v_actor_identity_id, p_organization_id, 'order.create');

    IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR
       p_idempotency_key = '' OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'Order idempotency key is invalid' USING ERRCODE = '22023';
    END IF;

    IF p_parties IS NULL OR jsonb_typeof(p_parties) <> 'array' OR jsonb_array_length(p_parties) <> 6 THEN
        RAISE EXCEPTION 'Order creation requires exactly six explicit party roles' USING ERRCODE = '22023';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order creation requires at least one immutable commercial item' USING ERRCODE = '22023';
    END IF;

    v_request_sha256 := encode(sha256(convert_to(jsonb_build_object(
        'lane', p_lane,
        'organization_id', p_organization_id,
        'property_id', p_property_id,
        'property_snapshot_id', p_property_snapshot_id,
        'settlement_mode', p_settlement_mode,
        'currency', p_currency,
        'source_system', p_source_system,
        'source_record_type', p_source_record_type,
        'source_record_identifier', p_source_record_identifier,
        'parties', p_parties,
        'items', p_items,
        'travel_amount_cents', p_travel_amount_cents,
        'travel_basis', p_travel_basis,
        'related_order_id', p_related_order_id,
        'relationship_type', p_relationship_type,
        'relationship_reason', p_relationship_reason
    )::text, 'UTF8')), 'hex');

    PERFORM pg_advisory_xact_lock(hashtextextended(
        v_actor_identity_id::text || ':CREATE_ORDER:' || p_idempotency_key, 0
    ));

    SELECT *
      INTO v_existing
      FROM medialab_core.order_idempotency_records
     WHERE actor_identity_id = v_actor_identity_id
       AND command_type = 'CREATE_ORDER'
       AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing.request_sha256 <> v_request_sha256 THEN
            RAISE EXCEPTION 'Idempotency key was already used with a conflicting request fingerprint'
                USING ERRCODE = '23505';
        END IF;
        RETURN v_existing.result_order_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM medialab_core.organizations WHERE id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Target organization does not exist' USING ERRCODE = '23503';
    END IF;

    IF (p_property_id IS NULL) <> (p_property_snapshot_id IS NULL) THEN
        RAISE EXCEPTION 'Property and property snapshot must be supplied together' USING ERRCODE = '23514';
    END IF;

    IF p_lane = 'REAL_ESTATE' AND p_property_id IS NULL THEN
        RAISE EXCEPTION 'REAL_ESTATE orders require immutable property evidence' USING ERRCODE = '23514';
    END IF;

    IF p_property_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM medialab_core.property_snapshots ps
         WHERE ps.id = p_property_snapshot_id
           AND ps.property_id = p_property_id
           AND ps.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Property snapshot does not belong to the target Property and organization'
            USING ERRCODE = '42501';
    END IF;

    IF (p_related_order_id IS NULL) <> (p_relationship_type IS NULL) OR
       (p_related_order_id IS NULL) <> (p_relationship_reason IS NULL) THEN
        RAISE EXCEPTION 'Related Order identity, relationship type, and reason must be supplied together'
            USING ERRCODE = '22023';
    END IF;

    IF p_related_order_id IS NOT NULL THEN
        SELECT organization_id
          INTO v_original_organization_id
          FROM medialab_core.orders
         WHERE id = p_related_order_id
         FOR SHARE;
        IF v_original_organization_id IS NULL OR v_original_organization_id <> p_organization_id THEN
            RAISE EXCEPTION 'Related Order is missing or belongs to another organization'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_parties) party
         WHERE party->>'role' NOT IN (
             'ORDERING_PERSON', 'CUSTOMER', 'BILLING_PARTY',
             'COMMERCIAL_OWNER', 'ORGANIZATION', 'AUTHORIZED_ACTOR'
         )
    ) OR (
        SELECT count(DISTINCT party->>'role')
          FROM jsonb_array_elements(p_parties) party
    ) <> 6 THEN
        RAISE EXCEPTION 'Order party roles are incomplete or duplicated' USING ERRCODE = '22023';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_position := (v_item->>'position')::integer;
        IF v_position IS NULL OR v_position <= 0 THEN
            RAISE EXCEPTION 'Order item position must be a positive integer' USING ERRCODE = '22023';
        END IF;
        v_commercial_snapshot_id := NULLIF(v_item->>'commercial_snapshot_id', '')::uuid;
        v_custom_snapshot_id := NULLIF(v_item->>'custom_commercial_snapshot_id', '')::uuid;

        IF (v_commercial_snapshot_id IS NULL) = (v_custom_snapshot_id IS NULL) THEN
            RAISE EXCEPTION 'Each Order item requires exactly one catalog or custom commercial snapshot'
                USING ERRCODE = '22023';
        END IF;

        IF v_commercial_snapshot_id IS NOT NULL THEN
            SELECT cs.display_name, cs.quantity, cs.commercial_unit,
                   cs.unit_price_cents + cs.adjustment_amount_cents,
                   cs.currency
              INTO v_description, v_quantity, v_unit, v_unit_amount_cents,
                   v_item_currency
              FROM medialab_core.commercial_snapshots cs
             WHERE cs.id = v_commercial_snapshot_id;
            IF v_description IS NULL THEN
                RAISE EXCEPTION 'Catalog commercial snapshot does not exist' USING ERRCODE = '23503';
            END IF;
        ELSE
            SELECT cs.description, cs.quantity, 'CUSTOM',
                   cs.approved_price_cents + cs.adjustment_amount_cents,
                   cs.currency, cs.created_by_identity_id
              INTO v_description, v_quantity, v_unit, v_unit_amount_cents,
                   v_item_currency, v_custom_actor_identity_id
              FROM medialab_core.custom_commercial_snapshots cs
             WHERE cs.id = v_custom_snapshot_id;
            IF v_description IS NULL THEN
                RAISE EXCEPTION 'Custom commercial snapshot does not exist' USING ERRCODE = '23503';
            END IF;
            IF v_custom_actor_identity_id <> v_actor_identity_id THEN
                RAISE EXCEPTION 'Custom commercial evidence was not authorized by the authenticated actor'
                    USING ERRCODE = '42501';
            END IF;
        END IF;

        IF v_item_currency <> p_currency THEN
            RAISE EXCEPTION 'Order item currency does not match Order currency' USING ERRCODE = '23514';
        END IF;

        v_line_total_numeric := v_unit_amount_cents * v_quantity;
        IF v_line_total_numeric <> trunc(v_line_total_numeric) THEN
            RAISE EXCEPTION 'Order item amount and quantity produce fractional minor currency units'
                USING ERRCODE = '23514';
        END IF;
        v_item_subtotal_cents := v_item_subtotal_cents + v_line_total_numeric::bigint;
    END LOOP;

    IF (SELECT count(DISTINCT (item->>'position')::integer) FROM jsonb_array_elements(p_items) item) <>
       jsonb_array_length(p_items) THEN
        RAISE EXCEPTION 'Order item positions must be unique' USING ERRCODE = '23505';
    END IF;

    INSERT INTO medialab_core.orders (
        id, lane, organization_id, property_id, property_snapshot_id,
        settlement_mode, currency, item_subtotal_cents, travel_amount_cents,
        travel_basis, total_amount_cents, current_state, source_system,
        created_by_identity_id, accepted_by_identity_id, created_at, accepted_at
    ) VALUES (
        v_order_id, p_lane, p_organization_id, p_property_id, p_property_snapshot_id,
        p_settlement_mode, p_currency, v_item_subtotal_cents, p_travel_amount_cents,
        p_travel_basis, v_item_subtotal_cents + p_travel_amount_cents, 'ACCEPTED', p_source_system,
        v_actor_identity_id, v_actor_identity_id, v_now, v_now
    );

    FOR v_party IN SELECT value FROM jsonb_array_elements(p_parties)
    LOOP
        v_party_role := v_party->>'role';
        IF v_party_role = 'ORGANIZATION' THEN
            v_party_organization_id := NULLIF(v_party->>'organization_id', '')::uuid;
            IF v_party_organization_id IS DISTINCT FROM p_organization_id THEN
                RAISE EXCEPTION 'Order organization party must match the target organization'
                    USING ERRCODE = '42501';
            END IF;
            SELECT name INTO v_frozen_name
              FROM medialab_core.organizations WHERE id = v_party_organization_id;
            INSERT INTO medialab_core.order_parties (
                id, order_id, party_role, party_kind, organization_id,
                frozen_display_name, authority_context, source_system,
                recorded_by_identity_id, recorded_at
            ) VALUES (
                gen_random_uuid(), v_order_id, v_party_role, 'ORGANIZATION', v_party_organization_id,
                v_frozen_name, 'ACTIVE_ORGANIZATION_CONTEXT', p_source_system,
                v_actor_identity_id, v_now
            );
        ELSE
            v_party_person_id := NULLIF(v_party->>'person_id', '')::uuid;
            SELECT m.id, p.display_name
              INTO v_membership_id, v_frozen_name
              FROM medialab_core.memberships m
              JOIN medialab_core.people p ON p.id = m.person_id
             WHERE m.organization_id = p_organization_id
               AND m.person_id = v_party_person_id
               AND m.status = 'ACTIVE';
            IF v_membership_id IS NULL THEN
                RAISE EXCEPTION 'Order party % is not an active member of the target organization', v_party_role
                    USING ERRCODE = '42501';
            END IF;
            IF v_party_role = 'AUTHORIZED_ACTOR' AND v_party_person_id <> v_actor_person_id THEN
                RAISE EXCEPTION 'Authorized actor party must be derived from the authenticated session'
                    USING ERRCODE = '42501';
            END IF;
            INSERT INTO medialab_core.order_parties (
                id, order_id, party_role, party_kind, person_id, membership_id,
                frozen_display_name, authority_context, source_system,
                recorded_by_identity_id, recorded_at
            ) VALUES (
                gen_random_uuid(), v_order_id, v_party_role, 'PERSON', v_party_person_id, v_membership_id,
                v_frozen_name, 'ACTIVE_MEMBERSHIP_AT_ACCEPTANCE', p_source_system,
                v_actor_identity_id, v_now
            );
        END IF;
    END LOOP;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_position := (v_item->>'position')::integer;
        v_commercial_snapshot_id := NULLIF(v_item->>'commercial_snapshot_id', '')::uuid;
        v_custom_snapshot_id := NULLIF(v_item->>'custom_commercial_snapshot_id', '')::uuid;

        IF (v_commercial_snapshot_id IS NULL) = (v_custom_snapshot_id IS NULL) THEN
            RAISE EXCEPTION 'Each Order item requires exactly one catalog or custom commercial snapshot'
                USING ERRCODE = '22023';
        END IF;

        IF v_commercial_snapshot_id IS NOT NULL THEN
            SELECT cs.display_name, cs.quantity, cs.commercial_unit,
                   cs.unit_price_cents + cs.adjustment_amount_cents,
                   cs.currency, cs.catalog_product_id, cs.source_record_identifier
              INTO v_description, v_quantity, v_unit, v_unit_amount_cents,
                   v_item_currency, v_catalog_product_id, v_source_item_identifier
              FROM medialab_core.commercial_snapshots cs
             WHERE cs.id = v_commercial_snapshot_id;
            IF v_description IS NULL THEN
                RAISE EXCEPTION 'Catalog commercial snapshot does not exist' USING ERRCODE = '23503';
            END IF;
            v_custom_reason := NULL;
            v_custom_actor_identity_id := NULL;
        ELSE
            SELECT cs.description, cs.quantity, 'CUSTOM',
                   cs.approved_price_cents + cs.adjustment_amount_cents,
                   cs.currency, cs.reason, cs.created_by_identity_id
              INTO v_description, v_quantity, v_unit, v_unit_amount_cents,
                   v_item_currency, v_custom_reason, v_custom_actor_identity_id
              FROM medialab_core.custom_commercial_snapshots cs
             WHERE cs.id = v_custom_snapshot_id;
            IF v_description IS NULL THEN
                RAISE EXCEPTION 'Custom commercial snapshot does not exist' USING ERRCODE = '23503';
            END IF;
            IF v_custom_actor_identity_id <> v_actor_identity_id THEN
                RAISE EXCEPTION 'Custom commercial evidence was not authorized by the authenticated actor'
                    USING ERRCODE = '42501';
            END IF;
            v_catalog_product_id := NULL;
            v_source_item_identifier := NULL;
        END IF;

        IF v_item_currency <> p_currency THEN
            RAISE EXCEPTION 'Order item currency does not match Order currency' USING ERRCODE = '23514';
        END IF;

        v_line_total_numeric := v_unit_amount_cents * v_quantity;
        IF v_line_total_numeric <> trunc(v_line_total_numeric) THEN
            RAISE EXCEPTION 'Order item amount and quantity produce fractional minor currency units'
                USING ERRCODE = '23514';
        END IF;
        v_line_total_cents := v_line_total_numeric::bigint;
        v_item_subtotal_cents := v_item_subtotal_cents + v_line_total_cents;

        INSERT INTO medialab_core.order_items (
            id, order_id, position, item_kind, commercial_snapshot_id,
            custom_commercial_snapshot_id, catalog_product_id, frozen_description,
            quantity, commercial_unit, unit_amount_cents, line_total_cents,
            currency, source_item_identifier, custom_reason,
            custom_actor_identity_id, created_at
        ) VALUES (
            gen_random_uuid(), v_order_id, v_position,
            CASE WHEN v_commercial_snapshot_id IS NOT NULL THEN 'CATALOG' ELSE 'CUSTOM' END,
            v_commercial_snapshot_id, v_custom_snapshot_id, v_catalog_product_id, v_description,
            v_quantity, v_unit, v_unit_amount_cents, v_line_total_cents,
            v_item_currency, v_source_item_identifier, v_custom_reason,
            v_custom_actor_identity_id, v_now
        );
    END LOOP;

    INSERT INTO medialab_core.order_external_references (
        id, order_id, provider, external_record_type, external_identifier,
        provenance, recorded_by_identity_id, recorded_at
    ) VALUES (
        gen_random_uuid(), v_order_id, p_source_system, p_source_record_type,
        p_source_record_identifier, 'CANONICAL_ORDER_CREATION', v_actor_identity_id, v_now
    );

    INSERT INTO medialab_core.order_idempotency_records (
        id, actor_identity_id, command_type, idempotency_key, request_sha256,
        result_order_id, completion_state, created_at, completed_at
    ) VALUES (
        gen_random_uuid(), v_actor_identity_id, 'CREATE_ORDER', p_idempotency_key,
        v_request_sha256, v_order_id, 'COMPLETED', v_now, clock_timestamp()
    );

    INSERT INTO medialab_core.order_events (
        id, order_id, event_type, actor_identity_id, authority_context,
        source_system, reason, idempotency_key, occurred_at
    ) VALUES
        (gen_random_uuid(), v_order_id, 'ORDER_CREATED', v_actor_identity_id,
         'ORDER_CREATE_PERMISSION', p_source_system, 'Canonical Order created', p_idempotency_key, v_now),
        (gen_random_uuid(), v_order_id, 'ORDER_ACCEPTED', v_actor_identity_id,
         'ORDER_CREATE_PERMISSION', p_source_system, 'Commercial evidence accepted', p_idempotency_key, v_now);

    IF p_related_order_id IS NOT NULL THEN
        INSERT INTO medialab_core.order_relationships (
            id, original_order_id, related_order_id, relationship_type, reason,
            source_system, created_by_identity_id, created_at
        ) VALUES (
            gen_random_uuid(), p_related_order_id, v_order_id, p_relationship_type,
            p_relationship_reason, p_source_system, v_actor_identity_id, v_now
        );
        INSERT INTO medialab_core.order_events (
            id, order_id, event_type, actor_identity_id, authority_context,
            source_system, reason, idempotency_key, occurred_at
        ) VALUES (
            gen_random_uuid(), v_order_id, 'ORDER_RELATIONSHIP_RECORDED', v_actor_identity_id,
            'ORDER_CREATE_PERMISSION', p_source_system, p_relationship_reason, p_idempotency_key, v_now
        );
    END IF;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_order_record(
    p_session_token text,
    p_order_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_organization_id uuid;
    v_result jsonb;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);

    SELECT organization_id
      INTO v_organization_id
      FROM medialab_core.orders
     WHERE id = p_order_id;

    IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Order is missing or unavailable' USING ERRCODE = '42501';
    END IF;

    PERFORM medialab_core.require_order_permission(v_actor_identity_id, v_organization_id, 'order.read');

    SELECT jsonb_build_object(
        'order', to_jsonb(o),
        'parties', COALESCE((
            SELECT jsonb_agg(to_jsonb(p) ORDER BY p.party_role)
              FROM medialab_core.order_parties p WHERE p.order_id = o.id
        ), '[]'::jsonb),
        'items', COALESCE((
            SELECT jsonb_agg(to_jsonb(i) ORDER BY i.position)
              FROM medialab_core.order_items i WHERE i.order_id = o.id
        ), '[]'::jsonb),
        'external_references', COALESCE((
            SELECT jsonb_agg(to_jsonb(r) ORDER BY r.recorded_at, r.id)
              FROM medialab_core.order_external_references r WHERE r.order_id = o.id
        ), '[]'::jsonb),
        'events', COALESCE((
            SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at, e.id)
              FROM medialab_core.order_events e WHERE e.order_id = o.id
        ), '[]'::jsonb),
        'relationships', COALESCE((
            SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id)
              FROM medialab_core.order_relationships r
             WHERE r.original_order_id = o.id OR r.related_order_id = o.id
        ), '[]'::jsonb)
    )
      INTO v_result
      FROM medialab_core.orders o
     WHERE o.id = p_order_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STRICT STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER orders_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.orders
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_order_evidence_mutation();
CREATE TRIGGER order_parties_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.order_parties
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_order_evidence_mutation();
CREATE TRIGGER order_items_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.order_items
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_order_evidence_mutation();
CREATE TRIGGER order_external_references_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.order_external_references
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_order_evidence_mutation();
CREATE TRIGGER order_idempotency_records_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.order_idempotency_records
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_order_evidence_mutation();
CREATE TRIGGER order_events_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.order_events
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_order_evidence_mutation();
CREATE TRIGGER order_relationships_insert_guard
    BEFORE INSERT ON medialab_core.order_relationships
    FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_order_relationship_insert();
CREATE TRIGGER order_relationships_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.order_relationships
    FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_order_evidence_mutation();

REVOKE ALL ON TABLE medialab_core.orders FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.order_parties FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.order_items FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.order_external_references FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.order_idempotency_records FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.order_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.order_relationships FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_order_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_order_relationship_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_order_permission(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_order(text, text, text, uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb, bigint, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_order_record(text, uuid) FROM PUBLIC;
