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

export interface GatewayDecision {
  decision: 'ALLOW' | 'DENY';
  reason_code: 'GATEWAY_ALLOWED' | 'ACCESS_DENIED';
  item_id: string | null;
  access_event_reference: string;
  replayed: boolean;
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

export interface DisposableDeliveryDatabase {
  getManifest(input: GatewayInput): Promise<DeliveryManifest | null>;
  authorizeDownload(input: DownloadGatewayInput): Promise<GatewayDecision>;
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

    async authorizeDownload(input) {
      const result = await pool.query<{ decision: GatewayDecision }>(
        `SELECT medialab_core.evaluate_temporary_download_center_gateway_access($1::uuid,$2::text,'DOWNLOAD',$3::text,$4::uuid,$5::jsonb) AS decision`,
        [input.credentialId, input.secret, input.accessEventReference, input.itemId, input.evidence]
      );
      return result.rows[0]!.decision;
    },

    async close() {
      await pool.end();
    }
  };
}
