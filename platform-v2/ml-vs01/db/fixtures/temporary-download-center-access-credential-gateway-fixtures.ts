export const TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL_GATEWAY_FIXTURE_POLICY = {
  verifierAlgorithm: 'SHA256-HEX-V1',
  usableSecretBytes: 32,
  usableSecretPattern: '^[0-9a-f]{64}$',
  gatewayEventKinds: ['OPEN', 'DOWNLOAD'] as const,
  gatewayDecisions: ['ALLOW', 'DENY'] as const
} as const;

// M15-B deliberately seeds no credential, verifier, gateway attempt, or access observation.
export const TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL_GATEWAY_FOUNDATION_FIXTURE_TABLES: readonly {
  table: string;
  keys: readonly string[];
  rows: readonly Record<string, unknown>[];
}[] = [];

export const TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL_GATEWAY_FOUNDATION_ROW_COUNT_INCREMENTS: Record<string, number> = {};
