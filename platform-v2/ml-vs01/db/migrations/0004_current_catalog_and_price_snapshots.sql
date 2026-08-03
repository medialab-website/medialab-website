CREATE TABLE medialab_core.catalog_products (
    id uuid PRIMARY KEY,
    product_code text NOT NULL UNIQUE,
    display_name text NOT NULL,
    product_kind text NOT NULL,
    classification text NOT NULL,
    commercial_unit text NOT NULL,
    catalog_origin text NOT NULL,
    lifecycle_state text NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_products_code_check CHECK (
        product_code = btrim(product_code) AND product_code ~ '^[A-Z0-9_]{2,80}$'
    ),
    CONSTRAINT catalog_products_display_name_check CHECK (
        display_name = btrim(display_name) AND display_name <> '' AND length(display_name) <= 160
    ),
    CONSTRAINT catalog_products_kind_check CHECK (product_kind IN ('PACKAGE', 'ADD_ON', 'SERVICE')),
    CONSTRAINT catalog_products_classification_check CHECK (classification IN ('PRODUCT', 'SERVICE')),
    CONSTRAINT catalog_products_unit_check CHECK (
        commercial_unit = btrim(commercial_unit) AND commercial_unit <> '' AND length(commercial_unit) <= 80
    ),
    CONSTRAINT catalog_products_origin_check CHECK (catalog_origin IN ('CURRENT', 'LEGACY')),
    CONSTRAINT catalog_products_lifecycle_check CHECK (lifecycle_state IN ('ACTIVE', 'RETIRED', 'NONSELECTABLE')),
    CONSTRAINT catalog_products_legacy_nonselectable_check CHECK (
        catalog_origin <> 'LEGACY' OR lifecycle_state = 'NONSELECTABLE'
    ),
    CONSTRAINT catalog_products_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT catalog_products_timestamp_check CHECK (updated_at >= created_at)
);

CREATE TABLE medialab_core.catalog_product_change_events (
    id uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    previous_display_name text NULL,
    new_display_name text NOT NULL,
    previous_lifecycle_state text NULL,
    new_lifecycle_state text NOT NULL,
    reason text NOT NULL,
    source_system text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_product_change_events_previous_state_check CHECK (
        previous_lifecycle_state IS NULL OR previous_lifecycle_state IN ('ACTIVE', 'RETIRED', 'NONSELECTABLE')
    ),
    CONSTRAINT catalog_product_change_events_new_state_check CHECK (
        new_lifecycle_state IN ('ACTIVE', 'RETIRED', 'NONSELECTABLE')
    ),
    CONSTRAINT catalog_product_change_events_change_check CHECK (
        previous_lifecycle_state IS NULL OR
        previous_lifecycle_state <> new_lifecycle_state OR
        previous_display_name IS DISTINCT FROM new_display_name
    ),
    CONSTRAINT catalog_product_change_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 500
    ),
    CONSTRAINT catalog_product_change_events_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE TABLE medialab_core.catalog_prices (
    id uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    effective_at timestamptz NOT NULL,
    supersedes_price_id uuid NULL REFERENCES medialab_core.catalog_prices(id) ON DELETE RESTRICT,
    source_system text NOT NULL,
    source_record_identifier text NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_prices_amount_check CHECK (amount_cents >= 0),
    CONSTRAINT catalog_prices_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT catalog_prices_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT catalog_prices_source_record_check CHECK (
        source_record_identifier IS NULL OR
        (source_record_identifier = btrim(source_record_identifier) AND source_record_identifier <> '' AND length(source_record_identifier) <= 200)
    ),
    CONSTRAINT catalog_prices_not_self_superseding_check CHECK (supersedes_price_id IS DISTINCT FROM id),
    CONSTRAINT catalog_prices_product_effective_key UNIQUE (product_id, effective_at)
);

CREATE TABLE medialab_core.catalog_package_versions (
    id uuid PRIMARY KEY,
    package_product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    version_number integer NOT NULL,
    effective_at timestamptz NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_package_versions_number_check CHECK (version_number > 0),
    CONSTRAINT catalog_package_versions_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT catalog_package_versions_number_key UNIQUE (package_product_id, version_number),
    CONSTRAINT catalog_package_versions_effective_key UNIQUE (package_product_id, effective_at)
);

CREATE TABLE medialab_core.catalog_package_version_items (
    id uuid PRIMARY KEY,
    package_version_id uuid NOT NULL REFERENCES medialab_core.catalog_package_versions(id) ON DELETE RESTRICT,
    included_product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    included_product_code text NOT NULL,
    included_display_name text NOT NULL,
    included_classification text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    commercial_unit text NOT NULL,
    position integer NOT NULL,
    CONSTRAINT catalog_package_version_items_code_check CHECK (
        included_product_code = btrim(included_product_code) AND included_product_code ~ '^[A-Z0-9_]{2,80}$'
    ),
    CONSTRAINT catalog_package_version_items_name_check CHECK (
        included_display_name = btrim(included_display_name) AND included_display_name <> '' AND length(included_display_name) <= 160
    ),
    CONSTRAINT catalog_package_version_items_classification_check CHECK (
        included_classification IN ('PRODUCT', 'SERVICE')
    ),
    CONSTRAINT catalog_package_version_items_quantity_check CHECK (quantity > 0),
    CONSTRAINT catalog_package_version_items_unit_check CHECK (
        commercial_unit = btrim(commercial_unit) AND commercial_unit <> '' AND length(commercial_unit) <= 80
    ),
    CONSTRAINT catalog_package_version_items_position_check CHECK (position > 0),
    CONSTRAINT catalog_package_version_items_product_key UNIQUE (package_version_id, included_product_id),
    CONSTRAINT catalog_package_version_items_position_key UNIQUE (package_version_id, position)
);

CREATE TABLE medialab_core.catalog_bracket_sets (
    id uuid PRIMARY KEY,
    package_product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    version_number integer NOT NULL,
    bracket_basis text NOT NULL,
    effective_at timestamptz NOT NULL,
    source_system text NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_bracket_sets_number_check CHECK (version_number > 0),
    CONSTRAINT catalog_bracket_sets_basis_check CHECK (bracket_basis IN ('SQUARE_FEET', 'SCOPE_UNITS')),
    CONSTRAINT catalog_bracket_sets_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT catalog_bracket_sets_number_key UNIQUE (package_product_id, version_number),
    CONSTRAINT catalog_bracket_sets_effective_key UNIQUE (package_product_id, effective_at)
);

CREATE TABLE medialab_core.catalog_price_brackets (
    id uuid PRIMARY KEY,
    bracket_set_id uuid NOT NULL REFERENCES medialab_core.catalog_bracket_sets(id) ON DELETE RESTRICT,
    bracket_code text NOT NULL,
    lower_bound bigint NOT NULL,
    upper_bound bigint NULL,
    lower_inclusive boolean NOT NULL,
    upper_inclusive boolean NOT NULL,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    position integer NOT NULL,
    CONSTRAINT catalog_price_brackets_code_check CHECK (
        bracket_code = btrim(bracket_code) AND bracket_code ~ '^[A-Z0-9_]{2,80}$'
    ),
    CONSTRAINT catalog_price_brackets_lower_check CHECK (lower_bound >= 0),
    CONSTRAINT catalog_price_brackets_upper_check CHECK (upper_bound IS NULL OR upper_bound > lower_bound),
    CONSTRAINT catalog_price_brackets_unbounded_check CHECK (upper_bound IS NOT NULL OR upper_inclusive = false),
    CONSTRAINT catalog_price_brackets_amount_check CHECK (amount_cents >= 0),
    CONSTRAINT catalog_price_brackets_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT catalog_price_brackets_position_check CHECK (position > 0),
    CONSTRAINT catalog_price_brackets_code_key UNIQUE (bracket_set_id, bracket_code),
    CONSTRAINT catalog_price_brackets_position_key UNIQUE (bracket_set_id, position)
);

CREATE TABLE medialab_core.catalog_external_mappings (
    id uuid PRIMARY KEY,
    provider text NOT NULL,
    external_record_type text NOT NULL,
    external_identifier text NOT NULL,
    target_product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    supersedes_mapping_id uuid NULL REFERENCES medialab_core.catalog_external_mappings(id) ON DELETE RESTRICT,
    source_system text NOT NULL,
    observed_at timestamptz NOT NULL,
    recorded_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_external_mappings_provider_check CHECK (provider ~ '^[A-Z0-9_]{2,80}$'),
    CONSTRAINT catalog_external_mappings_type_check CHECK (external_record_type ~ '^[A-Z0-9_]{2,80}$'),
    CONSTRAINT catalog_external_mappings_identifier_check CHECK (
        external_identifier = btrim(external_identifier) AND external_identifier <> '' AND length(external_identifier) <= 200
    ),
    CONSTRAINT catalog_external_mappings_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT catalog_external_mappings_not_self_superseding_check CHECK (supersedes_mapping_id IS DISTINCT FROM id),
    CONSTRAINT catalog_external_mappings_observation_key UNIQUE (
        provider, external_record_type, external_identifier, observed_at
    )
);

CREATE TABLE medialab_core.commercial_snapshots (
    id uuid PRIMARY KEY,
    commercial_origin text NOT NULL,
    catalog_product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    catalog_price_id uuid NULL REFERENCES medialab_core.catalog_prices(id) ON DELETE RESTRICT,
    product_code text NOT NULL,
    display_name text NOT NULL,
    product_kind text NOT NULL,
    classification text NOT NULL,
    unit_price_cents bigint NOT NULL,
    currency text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    commercial_unit text NOT NULL,
    package_product_id uuid NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    package_product_code text NULL,
    package_display_name text NULL,
    package_version_id uuid NULL REFERENCES medialab_core.catalog_package_versions(id) ON DELETE RESTRICT,
    bracket_id uuid NULL REFERENCES medialab_core.catalog_price_brackets(id) ON DELETE RESTRICT,
    bracket_code text NULL,
    bracket_basis text NULL,
    bracket_lower_bound bigint NULL,
    bracket_upper_bound bigint NULL,
    bracket_lower_inclusive boolean NULL,
    bracket_upper_inclusive boolean NULL,
    adjustment_amount_cents bigint NOT NULL DEFAULT 0,
    adjustment_reason text NULL,
    adjustment_actor_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    adjustment_at timestamptz NULL,
    travel_estimate_amount_cents bigint NOT NULL DEFAULT 0,
    travel_estimate_basis text NULL,
    source_system text NOT NULL,
    source_record_type text NULL,
    source_record_identifier text NULL,
    effective_at timestamptz NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    material_increase_amount_cents bigint NOT NULL DEFAULT 0,
    renewed_acceptance_required boolean NOT NULL DEFAULT false,
    renewed_accepted_by_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    renewed_accepted_at timestamptz NULL,
    CONSTRAINT commercial_snapshots_origin_check CHECK (commercial_origin IN ('CURRENT', 'RETIRED', 'LEGACY')),
    CONSTRAINT commercial_snapshots_product_code_check CHECK (product_code ~ '^[A-Z0-9_]{2,80}$'),
    CONSTRAINT commercial_snapshots_display_name_check CHECK (
        display_name = btrim(display_name) AND display_name <> '' AND length(display_name) <= 160
    ),
    CONSTRAINT commercial_snapshots_kind_check CHECK (product_kind IN ('PACKAGE', 'ADD_ON', 'SERVICE')),
    CONSTRAINT commercial_snapshots_classification_check CHECK (classification IN ('PRODUCT', 'SERVICE')),
    CONSTRAINT commercial_snapshots_price_check CHECK (unit_price_cents >= 0),
    CONSTRAINT commercial_snapshots_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT commercial_snapshots_quantity_check CHECK (quantity > 0),
    CONSTRAINT commercial_snapshots_unit_check CHECK (
        commercial_unit = btrim(commercial_unit) AND commercial_unit <> '' AND length(commercial_unit) <= 80
    ),
    CONSTRAINT commercial_snapshots_package_fields_check CHECK (
        (package_product_id IS NULL AND package_product_code IS NULL AND package_display_name IS NULL AND package_version_id IS NULL) OR
        (package_product_id IS NOT NULL AND package_product_code IS NOT NULL AND package_display_name IS NOT NULL AND package_version_id IS NOT NULL)
    ),
    CONSTRAINT commercial_snapshots_bracket_fields_check CHECK (
        (bracket_id IS NULL AND bracket_code IS NULL AND bracket_basis IS NULL AND bracket_lower_bound IS NULL AND bracket_upper_bound IS NULL AND bracket_lower_inclusive IS NULL AND bracket_upper_inclusive IS NULL) OR
        (bracket_id IS NOT NULL AND bracket_code IS NOT NULL AND bracket_basis IS NOT NULL AND bracket_lower_bound IS NOT NULL AND bracket_lower_inclusive IS NOT NULL AND bracket_upper_inclusive IS NOT NULL)
    ),
    CONSTRAINT commercial_snapshots_adjustment_check CHECK (
        (adjustment_amount_cents = 0 AND adjustment_reason IS NULL AND adjustment_actor_identity_id IS NULL AND adjustment_at IS NULL) OR
        (adjustment_amount_cents <> 0 AND adjustment_reason IS NOT NULL AND adjustment_actor_identity_id IS NOT NULL AND adjustment_at IS NOT NULL)
    ),
    CONSTRAINT commercial_snapshots_travel_check CHECK (
        travel_estimate_amount_cents >= 0 AND
        ((travel_estimate_amount_cents = 0 AND travel_estimate_basis IS NULL) OR
         (travel_estimate_amount_cents > 0 AND travel_estimate_basis IS NOT NULL))
    ),
    CONSTRAINT commercial_snapshots_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT commercial_snapshots_source_mapping_check CHECK (
        (source_record_type IS NULL AND source_record_identifier IS NULL) OR
        (source_record_type IS NOT NULL AND source_record_identifier IS NOT NULL)
    ),
    CONSTRAINT commercial_snapshots_material_increase_check CHECK (
        material_increase_amount_cents >= 0 AND
        renewed_acceptance_required = (material_increase_amount_cents > 0) AND
        ((renewed_accepted_by_identity_id IS NULL AND renewed_accepted_at IS NULL) OR
         (renewed_accepted_by_identity_id IS NOT NULL AND renewed_accepted_at IS NOT NULL))
    )
);

CREATE TABLE medialab_core.commercial_snapshot_package_items (
    id uuid PRIMARY KEY,
    snapshot_id uuid NOT NULL REFERENCES medialab_core.commercial_snapshots(id) ON DELETE RESTRICT,
    source_package_item_id uuid NULL REFERENCES medialab_core.catalog_package_version_items(id) ON DELETE RESTRICT,
    included_product_id uuid NOT NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    included_product_code text NOT NULL,
    included_display_name text NOT NULL,
    included_classification text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    commercial_unit text NOT NULL,
    position integer NOT NULL,
    CONSTRAINT commercial_snapshot_package_items_code_check CHECK (included_product_code ~ '^[A-Z0-9_]{2,80}$'),
    CONSTRAINT commercial_snapshot_package_items_name_check CHECK (
        included_display_name = btrim(included_display_name) AND included_display_name <> '' AND length(included_display_name) <= 160
    ),
    CONSTRAINT commercial_snapshot_package_items_classification_check CHECK (
        included_classification IN ('PRODUCT', 'SERVICE')
    ),
    CONSTRAINT commercial_snapshot_package_items_quantity_check CHECK (quantity > 0),
    CONSTRAINT commercial_snapshot_package_items_position_check CHECK (position > 0),
    CONSTRAINT commercial_snapshot_package_items_position_key UNIQUE (snapshot_id, position)
);

CREATE TABLE medialab_core.custom_commercial_snapshots (
    id uuid PRIMARY KEY,
    description text NOT NULL,
    approved_price_cents bigint NOT NULL,
    currency text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    reason text NOT NULL,
    adjustment_amount_cents bigint NOT NULL DEFAULT 0,
    adjustment_reason text NULL,
    adjustment_actor_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    adjustment_at timestamptz NULL,
    travel_estimate_amount_cents bigint NOT NULL DEFAULT 0,
    travel_estimate_basis text NULL,
    source_system text NOT NULL,
    effective_at timestamptz NOT NULL,
    created_by_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    material_increase_amount_cents bigint NOT NULL DEFAULT 0,
    renewed_acceptance_required boolean NOT NULL DEFAULT false,
    renewed_accepted_by_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    renewed_accepted_at timestamptz NULL,
    CONSTRAINT custom_commercial_snapshots_description_check CHECK (
        description = btrim(description) AND description <> '' AND length(description) <= 500
    ),
    CONSTRAINT custom_commercial_snapshots_price_check CHECK (approved_price_cents >= 0),
    CONSTRAINT custom_commercial_snapshots_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT custom_commercial_snapshots_quantity_check CHECK (quantity > 0),
    CONSTRAINT custom_commercial_snapshots_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 500
    ),
    CONSTRAINT custom_commercial_snapshots_adjustment_check CHECK (
        (adjustment_amount_cents = 0 AND adjustment_reason IS NULL AND adjustment_actor_identity_id IS NULL AND adjustment_at IS NULL) OR
        (adjustment_amount_cents <> 0 AND adjustment_reason IS NOT NULL AND adjustment_actor_identity_id IS NOT NULL AND adjustment_at IS NOT NULL)
    ),
    CONSTRAINT custom_commercial_snapshots_travel_check CHECK (
        travel_estimate_amount_cents >= 0 AND
        ((travel_estimate_amount_cents = 0 AND travel_estimate_basis IS NULL) OR
         (travel_estimate_amount_cents > 0 AND travel_estimate_basis IS NOT NULL))
    ),
    CONSTRAINT custom_commercial_snapshots_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    ),
    CONSTRAINT custom_commercial_snapshots_material_increase_check CHECK (
        material_increase_amount_cents >= 0 AND
        renewed_acceptance_required = (material_increase_amount_cents > 0) AND
        ((renewed_accepted_by_identity_id IS NULL AND renewed_accepted_at IS NULL) OR
         (renewed_accepted_by_identity_id IS NOT NULL AND renewed_accepted_at IS NOT NULL))
    )
);

CREATE INDEX catalog_products_selectable_idx
    ON medialab_core.catalog_products (catalog_origin, lifecycle_state, product_kind, product_code);
CREATE INDEX catalog_product_change_events_product_idx
    ON medialab_core.catalog_product_change_events (product_id, occurred_at, id);
CREATE INDEX catalog_prices_product_effective_idx
    ON medialab_core.catalog_prices (product_id, effective_at DESC, recorded_at DESC, id DESC);
CREATE INDEX catalog_package_versions_effective_idx
    ON medialab_core.catalog_package_versions (package_product_id, effective_at DESC, version_number DESC);
CREATE INDEX catalog_package_version_items_version_idx
    ON medialab_core.catalog_package_version_items (package_version_id, position);
CREATE INDEX catalog_bracket_sets_effective_idx
    ON medialab_core.catalog_bracket_sets (package_product_id, effective_at DESC, version_number DESC);
CREATE INDEX catalog_price_brackets_set_idx
    ON medialab_core.catalog_price_brackets (bracket_set_id, position);
CREATE INDEX catalog_external_mappings_lookup_idx
    ON medialab_core.catalog_external_mappings (
        provider, external_record_type, external_identifier, observed_at DESC, recorded_at DESC, id DESC
    );
CREATE INDEX commercial_snapshots_product_idx
    ON medialab_core.commercial_snapshots (catalog_product_id, created_at, id);
CREATE INDEX commercial_snapshot_package_items_snapshot_idx
    ON medialab_core.commercial_snapshot_package_items (snapshot_id, position);
CREATE INDEX custom_commercial_snapshots_created_idx
    ON medialab_core.custom_commercial_snapshots (created_at, id);

CREATE OR REPLACE FUNCTION medialab_core.reject_catalog_evidence_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is immutable; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.reject_catalog_product_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Catalog products cannot be deleted; use an attributable lifecycle transition'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER catalog_products_delete_guard
BEFORE DELETE ON medialab_core.catalog_products
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_product_delete();

CREATE TRIGGER catalog_product_change_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_product_change_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER catalog_prices_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_prices
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER catalog_package_versions_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_package_versions
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER catalog_package_version_items_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_package_version_items
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER catalog_bracket_sets_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_bracket_sets
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER catalog_price_brackets_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_price_brackets
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER catalog_external_mappings_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_external_mappings
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER commercial_snapshots_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.commercial_snapshots
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER commercial_snapshot_package_items_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.commercial_snapshot_package_items
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE TRIGGER custom_commercial_snapshots_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.custom_commercial_snapshots
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE OR REPLACE FUNCTION medialab_core.require_catalog_permission(
    p_actor_identity_id uuid,
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
        RAISE EXCEPTION 'Catalog actor identity is missing, inactive, suspended, or otherwise unusable'
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
           AND m.status = 'ACTIVE'
           AND ps.retired_at IS NULL
           AND p.is_active = true
           AND p.code = p_permission_code
    ) THEN
        RAISE EXCEPTION 'Catalog actor lacks required permission %', p_permission_code
            USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_current_selectable_catalog(
    p_effective_at timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
    product_id uuid,
    product_code text,
    display_name text,
    product_kind text,
    classification text,
    commercial_unit text,
    price_evidence_id uuid,
    amount_cents bigint,
    currency text,
    bracket_set_id uuid,
    bracket_id uuid,
    bracket_code text,
    bracket_basis text,
    lower_bound bigint,
    upper_bound bigint,
    lower_inclusive boolean,
    upper_inclusive boolean,
    effective_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.product_code, p.display_name, p.product_kind, p.classification, p.commercial_unit,
           pr.id, pr.amount_cents, pr.currency,
           NULL::uuid, NULL::uuid, NULL::text, NULL::text,
           NULL::bigint, NULL::bigint, NULL::boolean, NULL::boolean,
           pr.effective_at
      FROM medialab_core.catalog_products p
      JOIN LATERAL (
          SELECT cp.id, cp.amount_cents, cp.currency, cp.effective_at
            FROM medialab_core.catalog_prices cp
           WHERE cp.product_id = p.id
             AND cp.effective_at <= p_effective_at
           ORDER BY cp.effective_at DESC, cp.recorded_at DESC, cp.id DESC
           LIMIT 1
      ) pr ON true
     WHERE p.catalog_origin = 'CURRENT'
       AND p.lifecycle_state = 'ACTIVE'
       AND p.product_kind <> 'PACKAGE'
    UNION ALL
    SELECT p.id, p.product_code, p.display_name, p.product_kind, p.classification, p.commercial_unit,
           b.id, b.amount_cents, b.currency,
           bs.id, b.id, b.bracket_code, bs.bracket_basis,
           b.lower_bound, b.upper_bound, b.lower_inclusive, b.upper_inclusive,
           bs.effective_at
      FROM medialab_core.catalog_products p
      JOIN LATERAL (
          SELECT s.id, s.bracket_basis, s.effective_at
            FROM medialab_core.catalog_bracket_sets s
           WHERE s.package_product_id = p.id
             AND s.effective_at <= p_effective_at
           ORDER BY s.effective_at DESC, s.version_number DESC, s.id DESC
           LIMIT 1
      ) bs ON true
      JOIN medialab_core.catalog_price_brackets b ON b.bracket_set_id = bs.id
     WHERE p.catalog_origin = 'CURRENT'
       AND p.lifecycle_state = 'ACTIVE'
       AND p.product_kind = 'PACKAGE'
     ORDER BY 2, 14 NULLS FIRST, 12 NULLS FIRST;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_current_catalog_package_inclusions(
    p_effective_at timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
    package_product_id uuid,
    package_product_code text,
    package_display_name text,
    package_version_id uuid,
    package_version_number integer,
    included_product_id uuid,
    included_product_code text,
    included_display_name text,
    included_classification text,
    quantity numeric,
    commercial_unit text,
    item_position integer
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.product_code, p.display_name, v.id, v.version_number,
           i.included_product_id, i.included_product_code, i.included_display_name,
           i.included_classification, i.quantity, i.commercial_unit, i.position
      FROM medialab_core.catalog_products p
      JOIN LATERAL (
          SELECT pv.id, pv.version_number
            FROM medialab_core.catalog_package_versions pv
           WHERE pv.package_product_id = p.id
             AND pv.effective_at <= p_effective_at
           ORDER BY pv.effective_at DESC, pv.version_number DESC, pv.id DESC
           LIMIT 1
      ) v ON true
      JOIN medialab_core.catalog_package_version_items i ON i.package_version_id = v.id
     WHERE p.catalog_origin = 'CURRENT'
       AND p.lifecycle_state = 'ACTIVE'
       AND p.product_kind = 'PACKAGE'
     ORDER BY p.product_code, i.position;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_catalog_product(
    p_session_token text,
    p_product_id uuid,
    p_product_code text,
    p_display_name text,
    p_product_kind text,
    p_classification text,
    p_commercial_unit text,
    p_source_system text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    IF EXISTS (
        SELECT 1 FROM medialab_core.custom_commercial_snapshots WHERE id = p_product_id
    ) THEN
        RAISE EXCEPTION 'Custom commercial evidence cannot be promoted through ordinary catalog creation'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO medialab_core.catalog_products (
        id, product_code, display_name, product_kind, classification, commercial_unit,
        catalog_origin, lifecycle_state, source_system,
        created_by_identity_id, updated_by_identity_id
    ) VALUES (
        p_product_id, p_product_code, p_display_name, p_product_kind, p_classification, p_commercial_unit,
        'CURRENT', 'ACTIVE', p_source_system,
        v_actor_identity_id, v_actor_identity_id
    );

    INSERT INTO medialab_core.catalog_product_change_events (
        id, product_id, previous_display_name, new_display_name,
        previous_lifecycle_state, new_lifecycle_state,
        reason, source_system, actor_identity_id
    ) VALUES (
        p_product_id, p_product_id, NULL, p_display_name,
        NULL, 'ACTIVE', 'Catalog product created', p_source_system, v_actor_identity_id
    );

    RETURN p_product_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revise_catalog_product(
    p_session_token text,
    p_product_id uuid,
    p_display_name text,
    p_lifecycle_state text,
    p_reason text,
    p_source_system text
)
RETURNS void AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product medialab_core.catalog_products%ROWTYPE;
    v_event_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    SELECT * INTO v_product
      FROM medialab_core.catalog_products
     WHERE id = p_product_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Catalog product does not exist' USING ERRCODE = '23503';
    END IF;
    IF v_product.catalog_origin = 'LEGACY' AND p_lifecycle_state <> 'NONSELECTABLE' THEN
        RAISE EXCEPTION 'Legacy catalog evidence cannot become selectable' USING ERRCODE = '23514';
    END IF;
    IF v_product.display_name = p_display_name AND v_product.lifecycle_state = p_lifecycle_state THEN
        RAISE EXCEPTION 'Catalog revision must change display name or lifecycle state' USING ERRCODE = '23514';
    END IF;

    UPDATE medialab_core.catalog_products
       SET display_name = p_display_name,
           lifecycle_state = p_lifecycle_state,
           source_system = p_source_system,
           updated_by_identity_id = v_actor_identity_id,
           updated_at = clock_timestamp()
     WHERE id = p_product_id;

    v_event_id := md5(p_product_id::text || clock_timestamp()::text || p_reason)::uuid;
    INSERT INTO medialab_core.catalog_product_change_events (
        id, product_id, previous_display_name, new_display_name,
        previous_lifecycle_state, new_lifecycle_state,
        reason, source_system, actor_identity_id
    ) VALUES (
        v_event_id, p_product_id, v_product.display_name, p_display_name,
        v_product.lifecycle_state, p_lifecycle_state,
        p_reason, p_source_system, v_actor_identity_id
    );
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_catalog_price(
    p_session_token text,
    p_price_id uuid,
    p_product_id uuid,
    p_amount_cents bigint,
    p_currency text,
    p_effective_at timestamptz,
    p_source_system text,
    p_source_record_identifier text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product_kind text;
    v_supersedes_price_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    SELECT product_kind INTO v_product_kind
      FROM medialab_core.catalog_products
     WHERE id = p_product_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Catalog product does not exist' USING ERRCODE = '23503';
    END IF;
    IF v_product_kind = 'PACKAGE' THEN
        RAISE EXCEPTION 'Package prices must be recorded through a validated bracket set' USING ERRCODE = '23514';
    END IF;

    SELECT id INTO v_supersedes_price_id
      FROM medialab_core.catalog_prices
     WHERE product_id = p_product_id
     ORDER BY effective_at DESC, recorded_at DESC, id DESC
     LIMIT 1;

    INSERT INTO medialab_core.catalog_prices (
        id, product_id, amount_cents, currency, effective_at, supersedes_price_id,
        source_system, source_record_identifier, recorded_by_identity_id
    ) VALUES (
        p_price_id, p_product_id, p_amount_cents, p_currency, p_effective_at, v_supersedes_price_id,
        p_source_system, p_source_record_identifier, v_actor_identity_id
    );

    RETURN p_price_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.replace_catalog_package_composition(
    p_session_token text,
    p_package_version_id uuid,
    p_package_product_id uuid,
    p_effective_at timestamptz,
    p_source_system text,
    p_items jsonb
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product_kind text;
    v_catalog_origin text;
    v_version_number integer;
    v_item jsonb;
    v_position integer := 0;
    v_included_product medialab_core.catalog_products%ROWTYPE;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    SELECT product_kind, catalog_origin
      INTO v_product_kind, v_catalog_origin
      FROM medialab_core.catalog_products
     WHERE id = p_package_product_id
     FOR UPDATE;
    IF NOT FOUND OR v_product_kind <> 'PACKAGE' OR v_catalog_origin <> 'CURRENT' THEN
        RAISE EXCEPTION 'Package composition requires a current canonical package product' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Package composition requires a nonempty JSON array' USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(max(version_number), 0) + 1
      INTO v_version_number
      FROM medialab_core.catalog_package_versions
     WHERE package_product_id = p_package_product_id;

    INSERT INTO medialab_core.catalog_package_versions (
        id, package_product_id, version_number, effective_at, source_system, created_by_identity_id
    ) VALUES (
        p_package_version_id, p_package_product_id, v_version_number,
        p_effective_at, p_source_system, v_actor_identity_id
    );

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_position := v_position + 1;
        SELECT * INTO v_included_product
          FROM medialab_core.catalog_products
         WHERE id = (v_item ->> 'product_id')::uuid;
        IF NOT FOUND OR
           v_included_product.id = p_package_product_id OR
           v_included_product.catalog_origin <> 'CURRENT' OR
           v_included_product.lifecycle_state = 'RETIRED' THEN
            RAISE EXCEPTION 'Package inclusion must reference another current, nonretired canonical product' USING ERRCODE = '23514';
        END IF;

        INSERT INTO medialab_core.catalog_package_version_items (
            id, package_version_id, included_product_id,
            included_product_code, included_display_name, included_classification,
            quantity, commercial_unit, position
        ) VALUES (
            (v_item ->> 'id')::uuid, p_package_version_id, v_included_product.id,
            v_included_product.product_code, v_included_product.display_name, v_included_product.classification,
            (v_item ->> 'quantity')::numeric, v_included_product.commercial_unit, v_position
        );
    END LOOP;

    RETURN p_package_version_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.replace_catalog_bracket_set(
    p_session_token text,
    p_bracket_set_id uuid,
    p_package_product_id uuid,
    p_bracket_basis text,
    p_effective_at timestamptz,
    p_source_system text,
    p_brackets jsonb
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product_kind text;
    v_catalog_origin text;
    v_version_number integer;
    v_bracket jsonb;
    v_position integer := 0;
    v_lower bigint;
    v_upper bigint;
    v_lower_inclusive boolean;
    v_upper_inclusive boolean;
    v_effective_lower bigint;
    v_effective_upper bigint;
    v_previous_effective_upper bigint;
    v_previous_was_unbounded boolean := false;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    SELECT product_kind, catalog_origin
      INTO v_product_kind, v_catalog_origin
      FROM medialab_core.catalog_products
     WHERE id = p_package_product_id
     FOR UPDATE;
    IF NOT FOUND OR v_product_kind <> 'PACKAGE' OR v_catalog_origin <> 'CURRENT' THEN
        RAISE EXCEPTION 'Bracket sets require a current canonical package product' USING ERRCODE = '23514';
    END IF;
    IF p_bracket_basis NOT IN ('SQUARE_FEET', 'SCOPE_UNITS') THEN
        RAISE EXCEPTION 'Unsupported bracket basis' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(p_brackets) <> 'array' OR jsonb_array_length(p_brackets) = 0 THEN
        RAISE EXCEPTION 'Bracket set requires a nonempty JSON array' USING ERRCODE = '23514';
    END IF;

    FOR v_bracket IN SELECT value FROM jsonb_array_elements(p_brackets)
    LOOP
        v_position := v_position + 1;
        v_lower := (v_bracket ->> 'lower_bound')::bigint;
        v_upper := CASE WHEN v_bracket ->> 'upper_bound' IS NULL THEN NULL ELSE (v_bracket ->> 'upper_bound')::bigint END;
        v_lower_inclusive := (v_bracket ->> 'lower_inclusive')::boolean;
        v_upper_inclusive := (v_bracket ->> 'upper_inclusive')::boolean;

        IF v_lower IS NULL OR v_lower < 0 OR v_lower_inclusive IS NULL OR v_upper_inclusive IS NULL THEN
            RAISE EXCEPTION 'Bracket bounds and inclusivity must be explicit' USING ERRCODE = '23514';
        END IF;
        IF v_upper IS NOT NULL AND v_upper <= v_lower THEN
            RAISE EXCEPTION 'Bracket upper bound must exceed lower bound' USING ERRCODE = '23514';
        END IF;
        IF v_upper IS NULL AND v_upper_inclusive THEN
            RAISE EXCEPTION 'An unbounded bracket cannot have an inclusive upper bound' USING ERRCODE = '23514';
        END IF;

        v_effective_lower := v_lower + CASE WHEN v_lower_inclusive THEN 0 ELSE 1 END;
        v_effective_upper := CASE
            WHEN v_upper IS NULL THEN NULL
            ELSE v_upper - CASE WHEN v_upper_inclusive THEN 0 ELSE 1 END
        END;
        IF v_effective_upper IS NOT NULL AND v_effective_upper < v_effective_lower THEN
            RAISE EXCEPTION 'Bracket contains no selectable integer value' USING ERRCODE = '23514';
        END IF;
        IF v_position = 1 AND v_effective_lower <> 0 THEN
            RAISE EXCEPTION 'Bracket set must begin at the normalized value zero' USING ERRCODE = '23514';
        END IF;
        IF v_position > 1 THEN
            IF v_previous_was_unbounded THEN
                RAISE EXCEPTION 'No bracket may follow an unbounded bracket' USING ERRCODE = '23514';
            END IF;
            IF v_effective_lower <> v_previous_effective_upper + 1 THEN
                RAISE EXCEPTION 'Bracket set contains a gap or overlap at position %', v_position USING ERRCODE = '23514';
            END IF;
        END IF;
        v_previous_effective_upper := v_effective_upper;
        v_previous_was_unbounded := v_effective_upper IS NULL;
    END LOOP;
    IF NOT v_previous_was_unbounded THEN
        RAISE EXCEPTION 'Bracket set must end with one unbounded bracket' USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(max(version_number), 0) + 1
      INTO v_version_number
      FROM medialab_core.catalog_bracket_sets
     WHERE package_product_id = p_package_product_id;

    INSERT INTO medialab_core.catalog_bracket_sets (
        id, package_product_id, version_number, bracket_basis,
        effective_at, source_system, created_by_identity_id
    ) VALUES (
        p_bracket_set_id, p_package_product_id, v_version_number, p_bracket_basis,
        p_effective_at, p_source_system, v_actor_identity_id
    );

    v_position := 0;
    FOR v_bracket IN SELECT value FROM jsonb_array_elements(p_brackets)
    LOOP
        v_position := v_position + 1;
        INSERT INTO medialab_core.catalog_price_brackets (
            id, bracket_set_id, bracket_code,
            lower_bound, upper_bound, lower_inclusive, upper_inclusive,
            amount_cents, currency, position
        ) VALUES (
            (v_bracket ->> 'id')::uuid, p_bracket_set_id, v_bracket ->> 'code',
            (v_bracket ->> 'lower_bound')::bigint,
            CASE WHEN v_bracket ->> 'upper_bound' IS NULL THEN NULL ELSE (v_bracket ->> 'upper_bound')::bigint END,
            (v_bracket ->> 'lower_inclusive')::boolean,
            (v_bracket ->> 'upper_inclusive')::boolean,
            (v_bracket ->> 'amount_cents')::bigint,
            v_bracket ->> 'currency',
            v_position
        );
    END LOOP;

    RETURN p_bracket_set_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.record_catalog_external_mapping(
    p_session_token text,
    p_mapping_id uuid,
    p_provider text,
    p_external_record_type text,
    p_external_identifier text,
    p_target_product_id uuid,
    p_source_system text,
    p_observed_at timestamptz
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_supersedes_mapping_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    PERFORM 1 FROM medialab_core.catalog_products WHERE id = p_target_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'External mapping target product does not exist' USING ERRCODE = '23503';
    END IF;

    SELECT id INTO v_supersedes_mapping_id
      FROM medialab_core.catalog_external_mappings
     WHERE provider = p_provider
       AND external_record_type = p_external_record_type
       AND external_identifier = p_external_identifier
     ORDER BY observed_at DESC, recorded_at DESC, id DESC
     LIMIT 1;

    INSERT INTO medialab_core.catalog_external_mappings (
        id, provider, external_record_type, external_identifier,
        target_product_id, supersedes_mapping_id,
        source_system, observed_at, recorded_by_identity_id
    ) VALUES (
        p_mapping_id, p_provider, p_external_record_type, p_external_identifier,
        p_target_product_id, v_supersedes_mapping_id,
        p_source_system, p_observed_at, v_actor_identity_id
    );

    RETURN p_mapping_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_catalog_commercial_snapshot(
    p_session_token text,
    p_snapshot_id uuid,
    p_product_id uuid,
    p_quantity numeric,
    p_basis_value bigint,
    p_adjustment_amount_cents bigint,
    p_adjustment_reason text,
    p_travel_estimate_amount_cents bigint,
    p_travel_estimate_basis text,
    p_effective_at timestamptz,
    p_source_system text,
    p_source_record_type text,
    p_source_record_identifier text,
    p_material_increase_amount_cents bigint,
    p_renewed_accepted_at timestamptz
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product medialab_core.catalog_products%ROWTYPE;
    v_price medialab_core.catalog_prices%ROWTYPE;
    v_bracket_set medialab_core.catalog_bracket_sets%ROWTYPE;
    v_bracket medialab_core.catalog_price_brackets%ROWTYPE;
    v_package_version medialab_core.catalog_package_versions%ROWTYPE;
    v_origin text;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.snapshot_create');

    SELECT * INTO v_product
      FROM medialab_core.catalog_products
     WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Snapshot product does not exist' USING ERRCODE = '23503';
    END IF;

    v_origin := CASE
        WHEN v_product.catalog_origin = 'LEGACY' THEN 'LEGACY'
        WHEN v_product.lifecycle_state = 'RETIRED' THEN 'RETIRED'
        ELSE 'CURRENT'
    END;

    IF v_product.product_kind = 'PACKAGE' THEN
        IF p_basis_value IS NULL OR p_basis_value < 0 THEN
            RAISE EXCEPTION 'Package snapshot requires a nonnegative verified bracket basis value' USING ERRCODE = '23514';
        END IF;

        SELECT * INTO v_bracket_set
          FROM medialab_core.catalog_bracket_sets
         WHERE package_product_id = p_product_id
           AND effective_at <= p_effective_at
         ORDER BY effective_at DESC, version_number DESC, id DESC
         LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No effective package bracket set exists' USING ERRCODE = '23514';
        END IF;

        SELECT * INTO v_bracket
          FROM medialab_core.catalog_price_brackets
         WHERE bracket_set_id = v_bracket_set.id
           AND (p_basis_value > lower_bound OR (p_basis_value = lower_bound AND lower_inclusive))
           AND (upper_bound IS NULL OR p_basis_value < upper_bound OR (p_basis_value = upper_bound AND upper_inclusive))
         ORDER BY position
         LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No deterministic bracket matches the verified basis value' USING ERRCODE = '23514';
        END IF;

        SELECT * INTO v_package_version
          FROM medialab_core.catalog_package_versions
         WHERE package_product_id = p_product_id
           AND effective_at <= p_effective_at
         ORDER BY effective_at DESC, version_number DESC, id DESC
         LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No effective package composition exists' USING ERRCODE = '23514';
        END IF;

        INSERT INTO medialab_core.commercial_snapshots (
            id, commercial_origin, catalog_product_id, catalog_price_id,
            product_code, display_name, product_kind, classification,
            unit_price_cents, currency, quantity, commercial_unit,
            package_product_id, package_product_code, package_display_name, package_version_id,
            bracket_id, bracket_code, bracket_basis, bracket_lower_bound, bracket_upper_bound,
            bracket_lower_inclusive, bracket_upper_inclusive,
            adjustment_amount_cents, adjustment_reason, adjustment_actor_identity_id, adjustment_at,
            travel_estimate_amount_cents, travel_estimate_basis,
            source_system, source_record_type, source_record_identifier, effective_at,
            created_by_identity_id, material_increase_amount_cents, renewed_acceptance_required,
            renewed_accepted_by_identity_id, renewed_accepted_at
        ) VALUES (
            p_snapshot_id, v_origin, v_product.id, NULL,
            v_product.product_code, v_product.display_name, v_product.product_kind, v_product.classification,
            v_bracket.amount_cents, v_bracket.currency, p_quantity, v_product.commercial_unit,
            v_product.id, v_product.product_code, v_product.display_name, v_package_version.id,
            v_bracket.id, v_bracket.bracket_code, v_bracket_set.bracket_basis,
            v_bracket.lower_bound, v_bracket.upper_bound, v_bracket.lower_inclusive, v_bracket.upper_inclusive,
            p_adjustment_amount_cents, CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE p_adjustment_reason END,
            CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE v_actor_identity_id END,
            CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE clock_timestamp() END,
            p_travel_estimate_amount_cents, CASE WHEN p_travel_estimate_amount_cents = 0 THEN NULL ELSE p_travel_estimate_basis END,
            p_source_system, p_source_record_type, p_source_record_identifier, p_effective_at,
            v_actor_identity_id, p_material_increase_amount_cents, p_material_increase_amount_cents > 0,
            CASE WHEN p_renewed_accepted_at IS NULL THEN NULL ELSE v_actor_identity_id END, p_renewed_accepted_at
        );

        INSERT INTO medialab_core.commercial_snapshot_package_items (
            id, snapshot_id, source_package_item_id, included_product_id,
            included_product_code, included_display_name, included_classification,
            quantity, commercial_unit, position
        )
        SELECT md5(p_snapshot_id::text || i.id::text)::uuid,
               p_snapshot_id, i.id, i.included_product_id,
               i.included_product_code, i.included_display_name, i.included_classification,
               i.quantity, i.commercial_unit, i.position
          FROM medialab_core.catalog_package_version_items i
         WHERE i.package_version_id = v_package_version.id
         ORDER BY i.position;
    ELSE
        IF p_basis_value IS NOT NULL THEN
            RAISE EXCEPTION 'Nonpackage snapshot cannot carry a bracket basis value' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_price
          FROM medialab_core.catalog_prices
         WHERE product_id = p_product_id
           AND effective_at <= p_effective_at
         ORDER BY effective_at DESC, recorded_at DESC, id DESC
         LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No effective catalog price exists' USING ERRCODE = '23514';
        END IF;

        INSERT INTO medialab_core.commercial_snapshots (
            id, commercial_origin, catalog_product_id, catalog_price_id,
            product_code, display_name, product_kind, classification,
            unit_price_cents, currency, quantity, commercial_unit,
            adjustment_amount_cents, adjustment_reason, adjustment_actor_identity_id, adjustment_at,
            travel_estimate_amount_cents, travel_estimate_basis,
            source_system, source_record_type, source_record_identifier, effective_at,
            created_by_identity_id, material_increase_amount_cents, renewed_acceptance_required,
            renewed_accepted_by_identity_id, renewed_accepted_at
        ) VALUES (
            p_snapshot_id, v_origin, v_product.id, v_price.id,
            v_product.product_code, v_product.display_name, v_product.product_kind, v_product.classification,
            v_price.amount_cents, v_price.currency, p_quantity, v_product.commercial_unit,
            p_adjustment_amount_cents, CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE p_adjustment_reason END,
            CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE v_actor_identity_id END,
            CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE clock_timestamp() END,
            p_travel_estimate_amount_cents, CASE WHEN p_travel_estimate_amount_cents = 0 THEN NULL ELSE p_travel_estimate_basis END,
            p_source_system, p_source_record_type, p_source_record_identifier, p_effective_at,
            v_actor_identity_id, p_material_increase_amount_cents, p_material_increase_amount_cents > 0,
            CASE WHEN p_renewed_accepted_at IS NULL THEN NULL ELSE v_actor_identity_id END, p_renewed_accepted_at
        );
    END IF;

    RETURN p_snapshot_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_custom_commercial_snapshot(
    p_session_token text,
    p_snapshot_id uuid,
    p_description text,
    p_approved_price_cents bigint,
    p_currency text,
    p_quantity numeric,
    p_reason text,
    p_adjustment_amount_cents bigint,
    p_adjustment_reason text,
    p_travel_estimate_amount_cents bigint,
    p_travel_estimate_basis text,
    p_source_system text,
    p_effective_at timestamptz,
    p_material_increase_amount_cents bigint,
    p_renewed_accepted_at timestamptz
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.snapshot_create');

    INSERT INTO medialab_core.custom_commercial_snapshots (
        id, description, approved_price_cents, currency, quantity, reason,
        adjustment_amount_cents, adjustment_reason, adjustment_actor_identity_id, adjustment_at,
        travel_estimate_amount_cents, travel_estimate_basis,
        source_system, effective_at, created_by_identity_id,
        material_increase_amount_cents, renewed_acceptance_required,
        renewed_accepted_by_identity_id, renewed_accepted_at
    ) VALUES (
        p_snapshot_id, p_description, p_approved_price_cents, p_currency, p_quantity, p_reason,
        p_adjustment_amount_cents, CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE p_adjustment_reason END,
        CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE v_actor_identity_id END,
        CASE WHEN p_adjustment_amount_cents = 0 THEN NULL ELSE clock_timestamp() END,
        p_travel_estimate_amount_cents, CASE WHEN p_travel_estimate_amount_cents = 0 THEN NULL ELSE p_travel_estimate_basis END,
        p_source_system, p_effective_at, v_actor_identity_id,
        p_material_increase_amount_cents, p_material_increase_amount_cents > 0,
        CASE WHEN p_renewed_accepted_at IS NULL THEN NULL ELSE v_actor_identity_id END, p_renewed_accepted_at
    );

    RETURN p_snapshot_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON TABLE medialab_core.catalog_products FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.catalog_product_change_events FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.catalog_prices FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.catalog_package_versions FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.catalog_package_version_items FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.catalog_bracket_sets FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.catalog_price_brackets FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.catalog_external_mappings FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.commercial_snapshots FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.commercial_snapshot_package_items FROM PUBLIC;
REVOKE ALL ON TABLE medialab_core.custom_commercial_snapshots FROM PUBLIC;

REVOKE ALL ON FUNCTION medialab_core.reject_catalog_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.reject_catalog_product_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.require_catalog_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_current_selectable_catalog(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_current_catalog_package_inclusions(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_catalog_product(text, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.revise_catalog_product(text, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_catalog_price(text, uuid, uuid, bigint, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.replace_catalog_package_composition(text, uuid, uuid, timestamptz, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.replace_catalog_bracket_set(text, uuid, uuid, text, timestamptz, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.record_catalog_external_mapping(text, uuid, text, text, text, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_catalog_commercial_snapshot(text, uuid, uuid, numeric, bigint, bigint, text, bigint, text, timestamptz, text, text, text, bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_custom_commercial_snapshot(text, uuid, text, bigint, text, numeric, text, bigint, text, bigint, text, text, timestamptz, bigint, timestamptz) FROM PUBLIC;
