ALTER TABLE medialab_core.catalog_products
    ADD COLUMN authoring_state text NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN published_at timestamptz NULL,
    ADD COLUMN published_by_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    ADD COLUMN archived_at timestamptz NULL,
    ADD COLUMN archived_by_identity_id uuid NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    ADD COLUMN duplicated_from_product_id uuid NULL REFERENCES medialab_core.catalog_products(id) ON DELETE RESTRICT,
    ADD COLUMN source_type text NULL,
    ADD COLUMN source_url text NULL,
    ADD COLUMN source_display_label text NULL,
    ADD COLUMN seed_version text NULL,
    ADD COLUMN seed_effective_date date NULL;

UPDATE medialab_core.catalog_products
   SET published_at = created_at,
       published_by_identity_id = created_by_identity_id
 WHERE authoring_state = 'PUBLISHED'
   AND (published_at IS NULL OR published_by_identity_id IS NULL);

ALTER TABLE medialab_core.catalog_products
    ADD CONSTRAINT catalog_products_authoring_state_check
        CHECK (authoring_state IN ('DRAFT', 'PUBLISHED')),
    ADD CONSTRAINT catalog_products_draft_nonselectable_check
        CHECK (authoring_state <> 'DRAFT' OR lifecycle_state = 'NONSELECTABLE'),
    ADD CONSTRAINT catalog_products_publication_evidence_check
        CHECK (
            (authoring_state = 'DRAFT' AND published_at IS NULL AND published_by_identity_id IS NULL) OR
            (authoring_state = 'PUBLISHED' AND published_at IS NOT NULL AND published_by_identity_id IS NOT NULL)
        ),
    ADD CONSTRAINT catalog_products_archive_evidence_check
        CHECK (
            (archived_at IS NULL AND archived_by_identity_id IS NULL) OR
            (archived_at IS NOT NULL AND archived_by_identity_id IS NOT NULL)
        ),
    ADD CONSTRAINT catalog_products_duplicate_source_check
        CHECK (duplicated_from_product_id IS DISTINCT FROM id),
    ADD CONSTRAINT catalog_products_source_type_check
        CHECK (
            source_type IS NULL OR
            source_type IN ('PUBLIC_WEBSITE', 'ADMINISTRATIVE', 'SYNTHETIC_FIXTURE')
        ),
    ADD CONSTRAINT catalog_products_source_url_check
        CHECK (
            source_url IS NULL OR
            (source_url = btrim(source_url) AND source_url ~ '^https://[^[:space:]]+$' AND length(source_url) <= 500)
        ),
    ADD CONSTRAINT catalog_products_source_display_label_check
        CHECK (
            source_display_label IS NULL OR
            (source_display_label = btrim(source_display_label) AND source_display_label <> '' AND length(source_display_label) <= 240)
        ),
    ADD CONSTRAINT catalog_products_seed_version_check
        CHECK (
            seed_version IS NULL OR
            (seed_version = btrim(seed_version) AND seed_version <> '' AND length(seed_version) <= 100)
        ),
    ADD CONSTRAINT catalog_products_public_source_metadata_check
        CHECK (
            source_type <> 'PUBLIC_WEBSITE' OR
            (source_url IS NOT NULL AND source_display_label IS NOT NULL AND seed_version IS NOT NULL AND seed_effective_date IS NOT NULL)
        );

CREATE TABLE medialab_core.catalog_administration_events (
    id uuid PRIMARY KEY,
    product_id uuid NOT NULL,
    product_code text NOT NULL,
    display_name text NOT NULL,
    previous_definition jsonb NULL,
    new_definition jsonb NULL,
    event_type text NOT NULL,
    previous_authoring_state text NULL,
    new_authoring_state text NULL,
    previous_lifecycle_state text NULL,
    new_lifecycle_state text NULL,
    previous_archived boolean NULL,
    new_archived boolean NULL,
    duplicated_from_product_id uuid NULL,
    reason text NOT NULL,
    source_system text NOT NULL,
    actor_identity_id uuid NOT NULL REFERENCES medialab_core.identities(id) ON DELETE RESTRICT,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_administration_events_product_code_check CHECK (
        product_code = btrim(product_code) AND product_code ~ '^[A-Z0-9_]{2,80}$'
    ),
    CONSTRAINT catalog_administration_events_display_name_check CHECK (
        display_name = btrim(display_name) AND display_name <> '' AND length(display_name) <= 160
    ),
    CONSTRAINT catalog_administration_events_type_check CHECK (
        event_type IN (
            'CANONICAL_SEEDED',
            'DRAFT_CREATED',
            'DRAFT_DUPLICATED',
            'DRAFT_REVISED',
            'DRAFT_PUBLISHED',
            'PUBLISHED_REVISED',
            'ARCHIVED',
            'UNARCHIVED',
            'DRAFT_DELETED'
        )
    ),
    CONSTRAINT catalog_administration_events_previous_authoring_check CHECK (
        previous_authoring_state IS NULL OR previous_authoring_state IN ('DRAFT', 'PUBLISHED')
    ),
    CONSTRAINT catalog_administration_events_new_authoring_check CHECK (
        new_authoring_state IS NULL OR new_authoring_state IN ('DRAFT', 'PUBLISHED')
    ),
    CONSTRAINT catalog_administration_events_previous_lifecycle_check CHECK (
        previous_lifecycle_state IS NULL OR previous_lifecycle_state IN ('ACTIVE', 'RETIRED', 'NONSELECTABLE')
    ),
    CONSTRAINT catalog_administration_events_new_lifecycle_check CHECK (
        new_lifecycle_state IS NULL OR new_lifecycle_state IN ('ACTIVE', 'RETIRED', 'NONSELECTABLE')
    ),
    CONSTRAINT catalog_administration_events_previous_definition_check CHECK (
        previous_definition IS NULL OR jsonb_typeof(previous_definition) = 'object'
    ),
    CONSTRAINT catalog_administration_events_new_definition_check CHECK (
        new_definition IS NULL OR jsonb_typeof(new_definition) = 'object'
    ),
    CONSTRAINT catalog_administration_events_reason_check CHECK (
        reason = btrim(reason) AND reason <> '' AND length(reason) <= 500
    ),
    CONSTRAINT catalog_administration_events_source_check CHECK (
        source_system = btrim(source_system) AND source_system <> '' AND length(source_system) <= 100
    )
);

CREATE INDEX catalog_products_administration_idx
    ON medialab_core.catalog_products (archived_at, authoring_state, lifecycle_state, product_code);
CREATE INDEX catalog_products_duplicate_source_idx
    ON medialab_core.catalog_products (duplicated_from_product_id)
    WHERE duplicated_from_product_id IS NOT NULL;
CREATE INDEX catalog_administration_events_product_idx
    ON medialab_core.catalog_administration_events (product_id, occurred_at, id);
CREATE INDEX catalog_administration_events_actor_idx
    ON medialab_core.catalog_administration_events (actor_identity_id, occurred_at, id);

CREATE OR REPLACE FUNCTION medialab_core.apply_catalog_product_administration_defaults()
RETURNS trigger AS $$
BEGIN
    IF NEW.authoring_state = 'PUBLISHED' THEN
        NEW.published_at := COALESCE(NEW.published_at, NEW.created_at, clock_timestamp());
        NEW.published_by_identity_id := COALESCE(NEW.published_by_identity_id, NEW.created_by_identity_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE TRIGGER catalog_products_administration_defaults
BEFORE INSERT ON medialab_core.catalog_products
FOR EACH ROW EXECUTE FUNCTION medialab_core.apply_catalog_product_administration_defaults();

CREATE OR REPLACE FUNCTION medialab_core.guard_catalog_draft_product_delete()
RETURNS trigger AS $$
BEGIN
    IF OLD.authoring_state <> 'DRAFT' OR OLD.lifecycle_state <> 'NONSELECTABLE' THEN
        RAISE EXCEPTION 'Only a never-published, nonselectable draft catalog product may be deleted'
            USING ERRCODE = '55000';
    END IF;

    IF EXISTS (SELECT 1 FROM medialab_core.catalog_product_change_events WHERE product_id = OLD.id) OR
       EXISTS (SELECT 1 FROM medialab_core.catalog_prices WHERE product_id = OLD.id) OR
       EXISTS (SELECT 1 FROM medialab_core.catalog_package_versions WHERE package_product_id = OLD.id) OR
       EXISTS (SELECT 1 FROM medialab_core.catalog_package_version_items WHERE included_product_id = OLD.id) OR
       EXISTS (SELECT 1 FROM medialab_core.catalog_bracket_sets WHERE package_product_id = OLD.id) OR
       EXISTS (SELECT 1 FROM medialab_core.catalog_external_mappings WHERE target_product_id = OLD.id) OR
       EXISTS (
           SELECT 1 FROM medialab_core.commercial_snapshots
            WHERE catalog_product_id = OLD.id OR package_product_id = OLD.id
       ) OR
       EXISTS (
           SELECT 1 FROM medialab_core.commercial_snapshot_package_items
            WHERE included_product_id = OLD.id
       ) OR
       EXISTS (
           SELECT 1 FROM medialab_core.catalog_products
            WHERE duplicated_from_product_id = OLD.id
       ) THEN
        RAISE EXCEPTION 'Catalog draft has protected commercial, package, mapping, snapshot, lifecycle, or provenance references'
            USING ERRCODE = '55000';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

DROP TRIGGER catalog_products_delete_guard ON medialab_core.catalog_products;
CREATE TRIGGER catalog_products_delete_guard
BEFORE DELETE ON medialab_core.catalog_products
FOR EACH ROW EXECUTE FUNCTION medialab_core.guard_catalog_draft_product_delete();

CREATE TRIGGER catalog_administration_events_immutability_guard
BEFORE UPDATE OR DELETE ON medialab_core.catalog_administration_events
FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_catalog_evidence_mutation();

CREATE OR REPLACE FUNCTION medialab_core.get_catalog_administration_products(
    p_session_token text,
    p_include_archived boolean DEFAULT false
)
RETURNS TABLE(
    product_id uuid,
    product_code text,
    display_name text,
    product_kind text,
    classification text,
    commercial_unit text,
    authoring_state text,
    lifecycle_state text,
    is_archived boolean,
    duplicated_from_product_id uuid,
    source_type text,
    source_url text,
    source_display_label text,
    seed_version text,
    seed_effective_date date,
    created_at timestamptz,
    updated_at timestamptz
) AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    RETURN QUERY
    SELECT p.id, p.product_code, p.display_name, p.product_kind, p.classification,
           p.commercial_unit, p.authoring_state, p.lifecycle_state,
           p.archived_at IS NOT NULL, p.duplicated_from_product_id,
           p.source_type, p.source_url, p.source_display_label, p.seed_version,
           p.seed_effective_date, p.created_at, p.updated_at
      FROM medialab_core.catalog_products p
     WHERE p_include_archived OR p.archived_at IS NULL
     ORDER BY p.product_code;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.create_catalog_draft_product(
    p_session_token text,
    p_product_id uuid,
    p_product_code text,
    p_display_name text,
    p_product_kind text,
    p_classification text,
    p_commercial_unit text,
    p_source_system text,
    p_source_type text,
    p_source_url text,
    p_source_display_label text,
    p_seed_version text,
    p_seed_effective_date date,
    p_duplicated_from_product_id uuid
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_event_id uuid;
    v_event_type text;
BEGIN
    SELECT actor_identity_id, actor_person_id
      INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage');

    IF EXISTS (SELECT 1 FROM medialab_core.custom_commercial_snapshots WHERE id = p_product_id) THEN
        RAISE EXCEPTION 'Custom commercial evidence cannot be promoted through catalog draft creation'
            USING ERRCODE = '23514';
    END IF;

    IF p_duplicated_from_product_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM medialab_core.catalog_products WHERE id = p_duplicated_from_product_id
    ) THEN
        RAISE EXCEPTION 'Catalog duplication source does not exist' USING ERRCODE = '23503';
    END IF;

    INSERT INTO medialab_core.catalog_products (
        id, product_code, display_name, product_kind, classification, commercial_unit,
        catalog_origin, lifecycle_state, source_system,
        created_by_identity_id, updated_by_identity_id,
        authoring_state, published_at, published_by_identity_id,
        archived_at, archived_by_identity_id, duplicated_from_product_id,
        source_type, source_url, source_display_label, seed_version, seed_effective_date
    ) VALUES (
        p_product_id, p_product_code, p_display_name, p_product_kind, p_classification, p_commercial_unit,
        'CURRENT', 'NONSELECTABLE', p_source_system,
        v_actor_identity_id, v_actor_identity_id,
        'DRAFT', NULL, NULL,
        NULL, NULL, p_duplicated_from_product_id,
        p_source_type, p_source_url, p_source_display_label, p_seed_version, p_seed_effective_date
    );

    v_event_id := md5(p_product_id::text || clock_timestamp()::text || 'draft-created')::uuid;
    v_event_type := CASE WHEN p_duplicated_from_product_id IS NULL THEN 'DRAFT_CREATED' ELSE 'DRAFT_DUPLICATED' END;
    INSERT INTO medialab_core.catalog_administration_events (
        id, product_id, product_code, display_name, event_type,
        previous_authoring_state, new_authoring_state,
        previous_lifecycle_state, new_lifecycle_state,
        previous_archived, new_archived, duplicated_from_product_id,
        reason, source_system, actor_identity_id
    ) VALUES (
        v_event_id, p_product_id, p_product_code, p_display_name, v_event_type,
        NULL, 'DRAFT', NULL, 'NONSELECTABLE', NULL, false, p_duplicated_from_product_id,
        CASE WHEN p_duplicated_from_product_id IS NULL
             THEN 'Catalog draft created'
             ELSE 'Catalog draft duplicated from existing product' END,
        p_source_system, v_actor_identity_id
    );

    RETURN p_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revise_catalog_draft_product(
    p_session_token text,
    p_product_id uuid,
    p_display_name text,
    p_product_kind text,
    p_classification text,
    p_commercial_unit text,
    p_source_system text,
    p_source_type text,
    p_source_url text,
    p_source_display_label text,
    p_seed_version text,
    p_seed_effective_date date,
    p_reason text
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
        RAISE EXCEPTION 'Catalog draft does not exist' USING ERRCODE = '23503';
    END IF;
    IF v_product.authoring_state <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only an unpublished catalog draft may be edited directly' USING ERRCODE = '55000';
    END IF;

    UPDATE medialab_core.catalog_products
       SET display_name = p_display_name,
           product_kind = p_product_kind,
           classification = p_classification,
           commercial_unit = p_commercial_unit,
           source_system = p_source_system,
           source_type = p_source_type,
           source_url = p_source_url,
           source_display_label = p_source_display_label,
           seed_version = p_seed_version,
           seed_effective_date = p_seed_effective_date,
           updated_by_identity_id = v_actor_identity_id,
           updated_at = clock_timestamp()
     WHERE id = p_product_id;

    v_event_id := md5(p_product_id::text || clock_timestamp()::text || 'draft-revised')::uuid;
    INSERT INTO medialab_core.catalog_administration_events (
        id, product_id, product_code, display_name, event_type,
        previous_authoring_state, new_authoring_state,
        previous_lifecycle_state, new_lifecycle_state,
        previous_archived, new_archived, duplicated_from_product_id,
        reason, source_system, actor_identity_id
    ) VALUES (
        v_event_id, p_product_id, v_product.product_code, p_display_name, 'DRAFT_REVISED',
        'DRAFT', 'DRAFT', 'NONSELECTABLE', 'NONSELECTABLE',
        v_product.archived_at IS NOT NULL, v_product.archived_at IS NOT NULL,
        v_product.duplicated_from_product_id,
        p_reason, p_source_system, v_actor_identity_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.revise_published_catalog_product_definition(
    p_session_token text,
    p_product_id uuid,
    p_display_name text,
    p_product_kind text,
    p_classification text,
    p_commercial_unit text,
    p_reason text,
    p_source_system text
)
RETURNS void AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product medialab_core.catalog_products%ROWTYPE;
    v_revised_at timestamptz := clock_timestamp();
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
    IF v_product.authoring_state <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'Only a published catalog product may use definition revision' USING ERRCODE = '55000';
    END IF;

    UPDATE medialab_core.catalog_products
       SET display_name = p_display_name,
           product_kind = p_product_kind,
           classification = p_classification,
           commercial_unit = p_commercial_unit,
           source_system = p_source_system,
           updated_by_identity_id = v_actor_identity_id,
           updated_at = v_revised_at
     WHERE id = p_product_id;

    v_event_id := md5(p_product_id::text || v_revised_at::text || 'published-revised')::uuid;
    INSERT INTO medialab_core.catalog_administration_events (
        id, product_id, product_code, display_name,
        previous_definition, new_definition, event_type,
        previous_authoring_state, new_authoring_state,
        previous_lifecycle_state, new_lifecycle_state,
        previous_archived, new_archived, duplicated_from_product_id,
        reason, source_system, actor_identity_id, occurred_at
    ) VALUES (
        v_event_id, p_product_id, v_product.product_code, p_display_name,
        jsonb_build_object(
            'display_name', v_product.display_name,
            'product_kind', v_product.product_kind,
            'classification', v_product.classification,
            'commercial_unit', v_product.commercial_unit
        ),
        jsonb_build_object(
            'display_name', p_display_name,
            'product_kind', p_product_kind,
            'classification', p_classification,
            'commercial_unit', p_commercial_unit
        ),
        'PUBLISHED_REVISED',
        'PUBLISHED', 'PUBLISHED', v_product.lifecycle_state, v_product.lifecycle_state,
        v_product.archived_at IS NOT NULL, v_product.archived_at IS NOT NULL,
        v_product.duplicated_from_product_id,
        p_reason, p_source_system, v_actor_identity_id, v_revised_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.publish_catalog_draft_product(
    p_session_token text,
    p_product_id uuid,
    p_reason text,
    p_source_system text
)
RETURNS void AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product medialab_core.catalog_products%ROWTYPE;
    v_published_at timestamptz := clock_timestamp();
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
        RAISE EXCEPTION 'Catalog draft does not exist' USING ERRCODE = '23503';
    END IF;
    IF v_product.authoring_state <> 'DRAFT' THEN
        RAISE EXCEPTION 'Catalog product is already published' USING ERRCODE = '55000';
    END IF;

    UPDATE medialab_core.catalog_products
       SET authoring_state = 'PUBLISHED',
           published_at = v_published_at,
           published_by_identity_id = v_actor_identity_id,
           source_system = p_source_system,
           updated_by_identity_id = v_actor_identity_id,
           updated_at = v_published_at
     WHERE id = p_product_id;

    v_event_id := md5(p_product_id::text || v_published_at::text || 'draft-published')::uuid;
    INSERT INTO medialab_core.catalog_administration_events (
        id, product_id, product_code, display_name, event_type,
        previous_authoring_state, new_authoring_state,
        previous_lifecycle_state, new_lifecycle_state,
        previous_archived, new_archived, duplicated_from_product_id,
        reason, source_system, actor_identity_id, occurred_at
    ) VALUES (
        v_event_id, p_product_id, v_product.product_code, v_product.display_name, 'DRAFT_PUBLISHED',
        'DRAFT', 'PUBLISHED', v_product.lifecycle_state, v_product.lifecycle_state,
        v_product.archived_at IS NOT NULL, v_product.archived_at IS NOT NULL,
        v_product.duplicated_from_product_id,
        p_reason, p_source_system, v_actor_identity_id, v_published_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.set_catalog_product_archived(
    p_session_token text,
    p_product_id uuid,
    p_archived boolean,
    p_reason text,
    p_source_system text
)
RETURNS void AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product medialab_core.catalog_products%ROWTYPE;
    v_changed_at timestamptz := clock_timestamp();
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
    IF (v_product.archived_at IS NOT NULL) = p_archived THEN
        RAISE EXCEPTION 'Catalog archive state is already %', p_archived USING ERRCODE = '55000';
    END IF;

    UPDATE medialab_core.catalog_products
       SET archived_at = CASE WHEN p_archived THEN v_changed_at ELSE NULL END,
           archived_by_identity_id = CASE WHEN p_archived THEN v_actor_identity_id ELSE NULL END,
           source_system = p_source_system,
           updated_by_identity_id = v_actor_identity_id,
           updated_at = v_changed_at
     WHERE id = p_product_id;

    v_event_id := md5(p_product_id::text || v_changed_at::text || 'archive-state')::uuid;
    INSERT INTO medialab_core.catalog_administration_events (
        id, product_id, product_code, display_name, event_type,
        previous_authoring_state, new_authoring_state,
        previous_lifecycle_state, new_lifecycle_state,
        previous_archived, new_archived, duplicated_from_product_id,
        reason, source_system, actor_identity_id, occurred_at
    ) VALUES (
        v_event_id, p_product_id, v_product.product_code, v_product.display_name,
        CASE WHEN p_archived THEN 'ARCHIVED' ELSE 'UNARCHIVED' END,
        v_product.authoring_state, v_product.authoring_state,
        v_product.lifecycle_state, v_product.lifecycle_state,
        NOT p_archived, p_archived, v_product.duplicated_from_product_id,
        p_reason, p_source_system, v_actor_identity_id, v_changed_at
    );
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.delete_catalog_draft_product(
    p_session_token text,
    p_product_id uuid,
    p_reason text,
    p_source_system text
)
RETURNS uuid AS $$
DECLARE
    v_actor_identity_id uuid;
    v_actor_person_id uuid;
    v_product medialab_core.catalog_products%ROWTYPE;
    v_deleted_at timestamptz := clock_timestamp();
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
        RAISE EXCEPTION 'Catalog draft does not exist' USING ERRCODE = '23503';
    END IF;
    IF v_product.authoring_state <> 'DRAFT' OR v_product.lifecycle_state <> 'NONSELECTABLE' THEN
        RAISE EXCEPTION 'Only a never-published, nonselectable catalog draft may be deleted'
            USING ERRCODE = '55000';
    END IF;

    v_event_id := md5(p_product_id::text || v_deleted_at::text || 'draft-deleted')::uuid;
    INSERT INTO medialab_core.catalog_administration_events (
        id, product_id, product_code, display_name, event_type,
        previous_authoring_state, new_authoring_state,
        previous_lifecycle_state, new_lifecycle_state,
        previous_archived, new_archived, duplicated_from_product_id,
        reason, source_system, actor_identity_id, occurred_at
    ) VALUES (
        v_event_id, p_product_id, v_product.product_code, v_product.display_name, 'DRAFT_DELETED',
        'DRAFT', NULL, 'NONSELECTABLE', NULL,
        v_product.archived_at IS NOT NULL, NULL, v_product.duplicated_from_product_id,
        p_reason, p_source_system, v_actor_identity_id, v_deleted_at
    );

    DELETE FROM medialab_core.catalog_products WHERE id = p_product_id;
    RETURN p_product_id;
END;
$$ LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON TABLE medialab_core.catalog_administration_events FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.apply_catalog_product_administration_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.guard_catalog_draft_product_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_catalog_administration_products(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.create_catalog_draft_product(text, uuid, text, text, text, text, text, text, text, text, text, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.revise_catalog_draft_product(text, uuid, text, text, text, text, text, text, text, text, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.revise_published_catalog_product_definition(text, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.publish_catalog_draft_product(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.set_catalog_product_archived(text, uuid, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.delete_catalog_draft_product(text, uuid, text, text) FROM PUBLIC;
