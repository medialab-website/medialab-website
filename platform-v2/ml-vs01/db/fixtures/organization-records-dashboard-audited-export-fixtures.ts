export const ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY = {
  classifications: ['ORGANIZATION_FUNDED', 'PERSONAL_FUNDED', 'INELIGIBLE'],
  visibilityBases: ['ORGANIZATION_FUNDED', 'PERSONAL_SUMMARY_SHARED'],
  exportFormats: ['CSV', 'JSON'],
  restrictedRuntimeFunctions: [
    'share_personal_order_summary',
    'revoke_personal_order_summary'
  ],
  customerDashboardRuntimeActivated: false,
  trustedBillingImplemented: false,
  paymentLedgerImplemented: false,
  mediaAuthorityImplemented: false
} as const;

export const ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_TABLES: readonly {
  table: string;
  keys: readonly string[];
  rows: readonly Record<string, unknown>[];
}[] = [];

export const ORGANIZATION_RECORDS_AUDITED_EXPORT_FOUNDATION_ROW_COUNT_INCREMENTS = {
  organization_record_personal_summary_shares: 0,
  organization_record_personal_summary_revocations: 0,
  organization_record_export_snapshots: 0,
  organization_record_export_items: 0,
  organization_record_access_events: 0
};
