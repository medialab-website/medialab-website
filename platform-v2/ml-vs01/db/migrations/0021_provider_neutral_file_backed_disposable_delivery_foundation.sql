-- P02-M15-D: Provider-neutral file-backed disposable delivery resolver foundation.
-- Nonproduction only: no provider credentials, network retrieval, public URL, or real customer media.

CREATE OR REPLACE FUNCTION medialab_core.resolve_temporary_download_center_delivery_source(
  p_credential uuid,
  p_presented_secret text,
  p_access_event_reference text,
  p_item uuid,
  p_evidence jsonb,
  p_provider text,
  p_storage_namespace text
) RETURNS jsonb AS $$
DECLARE
  gateway jsonb;
  item_record medialab_core.temporary_download_center_items%ROWTYPE;
  version_record medialab_core.media_asset_versions%ROWTYPE;
  storage_record medialab_core.media_storage_objects%ROWTYPE;
  storage_count bigint;
BEGIN
  gateway := medialab_core.evaluate_temporary_download_center_gateway_access(
    p_credential,
    p_presented_secret,
    'DOWNLOAD',
    p_access_event_reference,
    p_item,
    p_evidence
  );

  IF gateway->>'decision' <> 'ALLOW'
     OR gateway->>'item_id' IS DISTINCT FROM p_item::text THEN
    RETURN NULL;
  END IF;

  SELECT item.*
    INTO item_record
    FROM medialab_core.temporary_download_center_items item
   WHERE item.id = p_item
     AND item.center_id = (gateway->>'center_id')::uuid
     AND item.version_id = (gateway->>'current_version_id')::uuid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT version.*
    INTO version_record
    FROM medialab_core.media_asset_versions version
   WHERE version.id = item_record.media_asset_version_id
     AND version.asset_id = item_record.media_asset_id
     AND version.organization_id = item_record.organization_id
     AND version.job_id = item_record.source_job_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)
    INTO storage_count
    FROM medialab_core.media_storage_objects storage_object
   WHERE storage_object.version_id = version_record.id
     AND storage_object.organization_id = version_record.organization_id
     AND storage_object.job_id = version_record.job_id
     AND storage_object.provider = p_provider
     AND storage_object.storage_namespace = p_storage_namespace;

  IF storage_count <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT storage_object.*
    INTO storage_record
    FROM medialab_core.media_storage_objects storage_object
   WHERE storage_object.version_id = version_record.id
     AND storage_object.organization_id = version_record.organization_id
     AND storage_object.job_id = version_record.job_id
     AND storage_object.provider = p_provider
     AND storage_object.storage_namespace = p_storage_namespace;

  IF storage_record.checksum_sha256 <> version_record.checksum_sha256
     OR storage_record.byte_size <> version_record.byte_size
     OR storage_record.media_type <> version_record.media_type THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'item_id', item_record.id,
    'media_asset_id', item_record.media_asset_id,
    'media_asset_version_id', version_record.id,
    'storage_object_id', storage_record.id,
    'provider', storage_record.provider,
    'storage_namespace', storage_record.storage_namespace,
    'provider_object_identifier', storage_record.provider_object_identifier,
    'checksum_sha256', storage_record.checksum_sha256,
    'byte_size', storage_record.byte_size,
    'media_type', storage_record.media_type
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,medialab_core,pg_temp;

REVOKE ALL ON FUNCTION medialab_core.resolve_temporary_download_center_delivery_source(uuid,text,text,uuid,jsonb,text,text) FROM PUBLIC;

COMMENT ON FUNCTION medialab_core.resolve_temporary_download_center_delivery_source(uuid,text,text,uuid,jsonb,text,text) IS
  'M15-D internal source resolver. Reuses one exact M15-B DOWNLOAD gateway attempt and returns a provider-neutral descriptor only after exact current-item and canonical storage consistency checks.';
