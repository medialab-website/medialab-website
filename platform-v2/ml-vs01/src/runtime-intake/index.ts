import type pg from "pg";
import type {
  CustomerPersonIntakeResultV1,
  CustomerPersonIntakeV1,
  PropertySnapshotIntakeResultV1,
  PropertySnapshotIntakeV1,
} from "./contracts.js";

export async function reconcileCustomerPersonIntake(
  pool: pg.Pool,
  sessionToken: string,
  input: CustomerPersonIntakeV1,
): Promise<CustomerPersonIntakeResultV1> {
  const result = await pool.query<{ reconcile_customer_person_intake: CustomerPersonIntakeResultV1 }>(
    `SELECT medialab_core.reconcile_customer_person_intake(
       $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10
     )`,
    [
      sessionToken, input.idempotencyKey, input.organizationId, input.sourceSystem,
      input.sourceScope, input.externalRecordType, input.externalIdentifier,
      input.sourceEvidenceFingerprint, input.displayName, input.email,
    ],
  );
  const value = result.rows[0]?.reconcile_customer_person_intake;
  if (!value) throw new Error("Customer Person intake returned no result");
  return value;
}

export async function reconcilePropertySnapshotIntake(
  pool: pg.Pool,
  sessionToken: string,
  input: PropertySnapshotIntakeV1,
): Promise<PropertySnapshotIntakeResultV1> {
  const result = await pool.query<{ reconcile_property_snapshot_intake: PropertySnapshotIntakeResultV1 }>(
    `SELECT medialab_core.reconcile_property_snapshot_intake(
       $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12
     )`,
    [
      sessionToken, input.idempotencyKey, input.organizationId, input.sourceSystem,
      input.sourceEvidenceFingerprint, input.addressLine1, input.addressLine2,
      input.locality, input.administrativeArea, input.postalCode, input.countryCode,
      input.reportedSquareFeet,
    ],
  );
  const value = result.rows[0]?.reconcile_property_snapshot_intake;
  if (!value) throw new Error("Property Snapshot intake returned no result");
  return value;
}
