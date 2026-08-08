import pg from 'pg';

export interface DeliveryCategoryItem {
  item_id: string;
  label: string;
  ordinal: number;
}

export interface DeliveryCategory {
  category_code: string;
  category_label: string;
  items: DeliveryCategoryItem[];
}

export interface DeliveryManifest {
  status: 'AVAILABLE';
  expires_at: string;
  stakeholder_label: string | null;
  categories: DeliveryCategory[];
}

export interface GatewayInput {
  credentialId: string;
  secret: string;
  accessEventReference: string;
  evidence: Record<string, string>;
}

export interface DownloadGatewayInput extends GatewayInput {
  itemId: string;
}

export interface DeliverySourceDescriptor {
  item_id: string;
  media_asset_id: string;
  media_asset_version_id: string;
  storage_object_id: string;
  provider: string;
  storage_namespace: string;
  provider_object_identifier: string;
  checksum_sha256: string;
  byte_size: number;
  media_type: string;
}

export interface DisposableDeliveryDatabase {
  getManifest(input: GatewayInput): Promise<DeliveryManifest | null>;
  resolveDownloadSource(input: DownloadGatewayInput): Promise<DeliverySourceDescriptor | null>;
  close(): Promise<void>;
}

export function createDisposableDeliveryDatabase(config: pg.PoolConfig): DisposableDeliveryDatabase {
  const pool = new pg.Pool(config);

  return {
    async getManifest(input) {
      const result = await pool.query<{ manifest: DeliveryManifest | null }>(
        `SELECT medialab_core.get_temporary_download_center_delivery_manifest($1::uuid,$2::text,$3::text,$4::jsonb) AS manifest`,
        [input.credentialId, input.secret, input.accessEventReference, input.evidence]
      );
      return result.rows[0]?.manifest ?? null;
    },

    async resolveDownloadSource(input) {
      const result = await pool.query<{ descriptor: DeliverySourceDescriptor | null }>(
        `SELECT medialab_core.resolve_temporary_download_center_delivery_source($1::uuid,$2::text,$3::text,$4::uuid,$5::jsonb,$6::text,$7::text) AS descriptor`,
        [input.credentialId, input.secret, input.accessEventReference, input.itemId, input.evidence, 'LOCAL_FIXTURE', 'M15D_DELIVERY']
      );
      return result.rows[0]?.descriptor ?? null;
    },

    async close() {
      await pool.end();
    }
  };
}
