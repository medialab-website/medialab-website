import { createHash } from "node:crypto";
import { contract } from "./contracts.js";

export const EXPECTED_OUTCOME = Object.freeze({
  scenarioId: "M16A_GOLDEN_PATH_QUICK_EDIT_V1", originals: 6, selected: 5, returned: 5,
  decisions: { ACCEPT: 4, QUICK_EDIT: 1 }, actionableQuickEdits: 1,
  operationAttempts: 2, verifiedReceipts: 1, finalVersions: 5, exactDownloads: 2,
});

export function compareReplay(observed: Record<string, unknown>) {
  const fields = Object.entries(EXPECTED_OUTCOME).map(([behavior, expected]) => {
    const actual = observed[behavior];
    return { behavior, expected, observed: actual, pass: JSON.stringify(actual) === JSON.stringify(expected) };
  });
  return contract("OperationalPilotComparisonV1", { scenarioId: EXPECTED_OUTCOME.scenarioId, fields,
    pass: fields.every((field) => field.pass), observedSha256: createHash("sha256").update(JSON.stringify(observed)).digest("hex") });
}

export interface AcceptanceMatrixRow {
  id: number;
  behavior: string;
  implementationSurface: string;
  test: string;
  pass: boolean;
  recoveryProof: string;
  remainingGap: string;
}

export function renderAcceptanceMatrix(rows: readonly AcceptanceMatrixRow[]) {
  if (rows.length !== 104 || rows.some((row, index) => row.id !== index + 1 || !row.pass)) throw new Error("acceptance matrix is incomplete");
  const json = JSON.stringify(contract("AcceptanceMatrixV1", { rows }), null, 2) + "\n";
  const safe = (value: string) => value.replaceAll("|", "\\|");
  const markdown = ["# P02-M16-A behavior acceptance matrix", "",
    "| REQUIRED BEHAVIOR | R69 IMPLEMENTATION SURFACE | TEST | RESULT | RECOVERY PROOF | REMAINING GAP |",
    "|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.id}. ${safe(row.behavior)} | ${safe(row.implementationSurface)} | ${safe(row.test)} | PASS | ${safe(row.recoveryProof)} | ${safe(row.remainingGap)} |`), ""].join("\n");
  return { json, markdown };
}
