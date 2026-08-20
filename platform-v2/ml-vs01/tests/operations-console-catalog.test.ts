import { describe, expect, it } from "vitest";
import {
  commercialFingerprint,
  OperationsConsoleDatabaseError,
  resolveCatalogSelections,
  type CatalogProjection,
  type CatalogProjectionRow,
} from "../src/operations-console/database.js";

const effectiveAt = "2026-08-03T00:00:00.000Z";

function packageRow(overrides: Partial<CatalogProjectionRow> = {}): CatalogProjectionRow {
  return {
    product_id: "61000000-0000-5000-8000-000000000002",
    product_code: "HOME_PACKAGE_MEDIUM",
    display_name: "Medium Home Package",
    product_kind: "PACKAGE",
    classification: "SERVICE",
    commercial_unit: "PACKAGE",
    price_evidence_id: null,
    amount_cents: 17500,
    currency: "USD",
    bracket_set_id: "66000000-0000-5000-8000-000000000002",
    bracket_id: "67000000-0000-5000-8000-000000000002",
    bracket_code: "FROM_1200_TO_2400",
    bracket_basis: "SQUARE_FEET",
    lower_bound: 1200,
    upper_bound: 2400,
    lower_inclusive: true,
    upper_inclusive: false,
    effective_at: effectiveAt,
    ...overrides,
  };
}

function addOnRow(): CatalogProjectionRow {
  return {
    product_id: "61000000-0000-5000-8000-000000000012",
    product_code: "VIRTUAL_TWILIGHT_PHOTO",
    display_name: "Virtual Twilight Photo",
    product_kind: "ADD_ON",
    classification: "SERVICE",
    commercial_unit: "PHOTO",
    price_evidence_id: "63000000-0000-5000-8000-000000000002",
    amount_cents: 1500,
    currency: "USD",
    bracket_set_id: null,
    bracket_id: null,
    bracket_code: null,
    bracket_basis: null,
    lower_bound: null,
    upper_bound: null,
    lower_inclusive: null,
    upper_inclusive: null,
    effective_at: effectiveAt,
  };
}

function projection(rows: CatalogProjectionRow[] = [packageRow(), addOnRow()]): CatalogProjection {
  return {
    effectiveAt,
    rows,
    inclusions: [{
      package_product_id: rows[0]!.product_id,
      package_product_code: rows[0]!.product_code,
      package_display_name: rows[0]!.display_name,
      package_version_id: "64000000-0000-5000-8000-000000000002",
      package_version_number: 1,
      included_product_id: "61000000-0000-5000-8000-000000000007",
      included_product_code: "INCLUDED_LISTING_PHOTO",
      included_display_name: "Listing Photo",
      included_classification: "SERVICE",
      quantity: "40.000",
      commercial_unit: "PHOTO",
      item_position: 1,
    }],
  };
}

describe("M17-A server-owned catalog and pricing", () => {
  it("resolves flat and bracketed amounts with ordered immutable inclusions", () => {
    const lines = resolveCatalogSelections(projection(), [
      { productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 },
      { productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 2 },
    ], 1800);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ unitAmountCents: 17500, lineTotalCents: 17500,
      basis: { kind: "SQUARE_FEET", value: 1800 }, bracketCode: "FROM_1200_TO_2400" });
    expect(lines[0]!.inclusions).toEqual([{ displayName: "Listing Photo", quantity: "40.000", commercialUnit: "PHOTO", position: 1 }]);
    expect(lines[1]).toMatchObject({ unitAmountCents: 1500, quantity: 2, lineTotalCents: 3000 });
    expect(commercialFingerprint(lines)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("honors inclusive lower and exclusive upper bracket boundaries", () => {
    expect(resolveCatalogSelections(projection([packageRow()]), [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 }], 1200)[0]!.unitAmountCents)
      .toBe(17500);
    expect(() => resolveCatalogSelections(projection([packageRow()]), [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 }], 2400))
      .toThrow(OperationsConsoleDatabaseError);
  });

  it("fails closed for missing basis, missing composition, and no matching bracket", () => {
    expect(() => resolveCatalogSelections(projection([packageRow()]), [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 }], null))
      .toThrow(/square feet/iu);
    const noComposition = projection([packageRow()]);
    noComposition.inclusions = [];
    expect(() => resolveCatalogSelections(noComposition, [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 }], 1800))
      .toThrow(/composition/iu);
    expect(() => resolveCatalogSelections(projection([packageRow()]), [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 }], 4000))
      .toThrow(/bracket/iu);
  });

  it("rejects duplicate products and out-of-policy quantities", () => {
    expect(() => resolveCatalogSelections(projection(), [
      { productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 1 },
      { productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 2 },
    ], 1800)).toThrow(/only once/iu);
    expect(() => resolveCatalogSelections(projection(), [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 2 }], 1800))
      .toThrow(/quantity must be one/iu);
    for (const quantity of [0, 100, 1.5]) {
      expect(() => resolveCatalogSelections(projection(), [{ productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity }], 1800))
        .toThrow(/quantity/iu);
    }
  });

  it("uses only the server projection for price and rejects unavailable product codes", () => {
    const line = resolveCatalogSelections(projection(), [{ productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 3 }], null)[0]!;
    expect(line.unitAmountCents).toBe(1500);
    expect(line.lineTotalCents).toBe(4500);
    expect(() => resolveCatalogSelections(projection(), [{ productCode: "BROWSER_PRICE_1", quantity: 1 }], null))
      .toThrow(/no longer available/iu);
  });
});
