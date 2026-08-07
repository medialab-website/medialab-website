-- P02-M15-C: Disposable loopback delivery surface and local synthetic fixture foundation.
-- Nonproduction only: no public route, provider URL, storage access, customer media, or deployment.

CREATE OR REPLACE FUNCTION medialab_core.get_temporary_download_center_delivery_manifest(
  p_credential uuid,
  p_presented_secret text,
  p_access_event_reference text,
  p_evidence jsonb
) RETURNS jsonb AS $$
DECLARE
  gateway jsonb;
  center_record medialab_core.temporary_download_centers%ROWTYPE;
  current_record medialab_core.temporary_download_center_current%ROWTYPE;
  manifest jsonb;
BEGIN
  gateway := medialab_core.evaluate_temporary_download_center_gateway_access(
    p_credential,
    p_presented_secret,
    'OPEN',
    p_access_event_reference,
    NULL,
    p_evidence
  );

  IF gateway->>'decision' <> 'ALLOW' THEN
    RETURN NULL;
  END IF;

  SELECT c.*
    INTO center_record
    FROM medialab_core.temporary_download_center_access_credentials credential
    JOIN medialab_core.temporary_download_centers c ON c.id = credential.center_id
   WHERE credential.id = p_credential
  ;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT current_state.*
    INTO current_record
    FROM medialab_core.temporary_download_center_current current_state
   WHERE current_state.center_id = center_record.id
     AND current_state.current_version_id = (gateway->>'current_version_id')::uuid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'status', 'AVAILABLE',
    'expires_at', center_record.expires_at,
    'stakeholder_label', center_record.stakeholder_label,
    'categories', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'category_code', category.category_code,
          'category_label', initcap(replace(lower(category.category_code), '_', ' ')),
          'items', category.items
        )
        ORDER BY category.first_ordinal, category.category_code
      )
      FROM (
        SELECT
          item.category_code,
          min(item.materialized_ordinal) AS first_ordinal,
          jsonb_agg(
            jsonb_build_object(
              'item_id', item.id,
              'label', initcap(replace(lower(item.category_code), '_', ' ')) || ' ' || item.placement_ordinal::text,
              'ordinal', item.materialized_ordinal
            )
            ORDER BY item.materialized_ordinal, item.id
          ) AS items
        FROM medialab_core.temporary_download_center_items item
        WHERE item.center_id = center_record.id
          AND item.version_id = current_record.current_version_id
        GROUP BY item.category_code
      ) category
    ), '[]'::jsonb)
  ) INTO manifest;

  RETURN manifest;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,medialab_core,pg_temp;

REVOKE ALL ON FUNCTION medialab_core.get_temporary_download_center_delivery_manifest(uuid,text,text,jsonb) FROM PUBLIC;

COMMENT ON FUNCTION medialab_core.get_temporary_download_center_delivery_manifest(uuid,text,text,jsonb) IS
  'M15-C safe manifest projection. Reuses the M15-B OPEN gateway and returns no secret, verifier, URL, provider path, or media bytes.';
