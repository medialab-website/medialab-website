import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  CURRENT_OPERATIONS_ADMISSION_SCHEMA,
  type AryeoDatasetDefinition,
  type AryeoDatasetSnapshotV1,
  type AryeoSnapshotManifestFileV1,
  type AryeoSnapshotManifestV1,
} from "./contracts.js";

export const ARYEO_API_BASE_URL = "https://api.aryeo.com/v1" as const;
export const ARYEO_MAX_PAGE_COUNT = 1_000;
export const ARYEO_PAGE_SIZE = 100;

export const ARYEO_READ_DATASETS: readonly AryeoDatasetDefinition[] = Object.freeze([
  { id: "customer-users", path: "/customer-users", query: {} },
  { id: "customers", path: "/customers", query: {} },
  { id: "company-team-members", path: "/company-team-members", query: { include: "company" } },
  {
    id: "orders",
    path: "/orders",
    query: {
      include: "customer,listing,appointments,appointments.users,unconfirmed_appointments,items,order_form,discounts,discounts.coupon",
      sort: "-created_at",
    },
  },
  { id: "listings", path: "/listings", query: { sort: "-created_at" } },
  {
    id: "appointments",
    path: "/appointments",
    query: {
      include: "owner,items,users,order,order.address,order.customer,order.customerGroup,order.listing,order.items,order.items.appointment",
    },
  },
  { id: "products", path: "/products", query: { "filter[include_inactive]": "true", sort: "title" } },
  // The published reference advertises `title`, but the live provider accepts
  // only `name` or `created_at` for this collection. Pin the stable live sort.
  { id: "product-categories", path: "/product-categories", query: { sort: "name" } },
] as AryeoDatasetDefinition[]);

export interface AryeoAcquisitionOptions {
  apiKey: string;
  outputRoot: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  retryDelay?: (milliseconds: number) => Promise<void>;
}

interface AryeoPagePayload {
  data?: unknown;
  meta?: {
    total?: unknown;
    last_page?: unknown;
    current_page?: unknown;
    per_page?: unknown;
  };
  timestamp?: unknown;
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const delay = (milliseconds: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function boundedInteger(value: unknown, fallback: number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > ARYEO_MAX_PAGE_COUNT * ARYEO_PAGE_SIZE) {
    throw new Error(`ARYEO_SOURCE_SCHEMA_DIVERGENCE: invalid ${label}`);
  }
  return parsed;
}

function parseApiKeyLine(contents: string): string | null {
  const match = contents.match(/^ARYEO_API_KEY=(.*)$/m);
  if (!match) return null;
  const raw = match[1]!.trim();
  const quoted = raw.match(/^(["'])(.*)\1$/s);
  return (quoted?.[2] ?? raw).trim() || null;
}

export async function readAryeoApiKeyFromEnvFile(envFile: string): Promise<string> {
  const value = parseApiKeyLine(await readFile(envFile, "utf8"));
  if (!value) throw new Error("ARYEO_CREDENTIAL_NOT_CONFIGURED: ARYEO_API_KEY is missing");
  return value;
}

async function assertNarrowNewOutputRoot(outputRoot: string): Promise<{ root: string; parent: string }> {
  if (!isAbsolute(outputRoot)) throw new Error("ARYEO_SOURCE_OUTPUT_BOUNDARY_FAILURE: output root must be absolute");
  const root = resolve(outputRoot);
  const parent = dirname(root);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error("ARYEO_SOURCE_OUTPUT_BOUNDARY_FAILURE: output parent must be an existing canonical non-symlink directory");
  }
  try {
    await lstat(root);
    throw new Error("ARYEO_SOURCE_OUTPUT_BOUNDARY_FAILURE: output root already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { root, parent };
}

function requestUrl(dataset: AryeoDatasetDefinition, page: number): string {
  const url = new URL(`${ARYEO_API_BASE_URL}${dataset.path}`);
  for (const [key, value] of Object.entries(dataset.query)) url.searchParams.set(key, value);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(ARYEO_PAGE_SIZE));
  return url.toString();
}

async function fetchPage(
  fetchImpl: typeof fetch,
  apiKey: string,
  dataset: AryeoDatasetDefinition,
  page: number,
  retryDelay: (milliseconds: number) => Promise<void>,
): Promise<{ records: unknown[]; lastPage: number; reportedTotal: number; timestamp: string | null }> {
  const url = requestUrl(dataset, page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (response.ok) {
      const payload = await response.json() as AryeoPagePayload;
      if (!Array.isArray(payload.data)) throw new Error(`ARYEO_SOURCE_SCHEMA_DIVERGENCE: ${dataset.id} data is not an array`);
      const lastPage = boundedInteger(payload.meta?.last_page, 1, `${dataset.id}.meta.last_page`);
      const reportedTotal = boundedInteger(payload.meta?.total, payload.data.length, `${dataset.id}.meta.total`);
      if (lastPage < 1 || lastPage > ARYEO_MAX_PAGE_COUNT) {
        throw new Error(`ARYEO_SOURCE_SAFETY_LIMIT: ${dataset.id} page count exceeds ${ARYEO_MAX_PAGE_COUNT}`);
      }
      return {
        records: payload.data,
        lastPage,
        reportedTotal,
        timestamp: typeof payload.timestamp === "string" ? payload.timestamp : null,
      };
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await retryDelay(Math.min(2_000, 250 * 2 ** attempt));
      continue;
    }
    throw new Error(`ARYEO_PROVIDER_READ_FAILURE: ${dataset.id} page ${page} returned HTTP ${response.status}`);
  }
  throw new Error(`ARYEO_PROVIDER_READ_FAILURE: ${dataset.id} page ${page} exhausted retries`);
}

async function acquireDataset(
  dataset: AryeoDatasetDefinition,
  apiKey: string,
  fetchImpl: typeof fetch,
  acquiredAt: string,
  retryDelay: (milliseconds: number) => Promise<void>,
): Promise<AryeoDatasetSnapshotV1> {
  const first = await fetchPage(fetchImpl, apiKey, dataset, 1, retryDelay);
  const pages = new Map<number, unknown[]>([[1, first.records]]);
  const timestamps = new Set<string>(first.timestamp ? [first.timestamp] : []);
  for (let start = 2; start <= first.lastPage; start += 4) {
    const pageNumbers = Array.from({ length: Math.min(4, first.lastPage - start + 1) }, (_unused, index) => start + index);
    const results = await Promise.all(pageNumbers.map((page) => fetchPage(fetchImpl, apiKey, dataset, page, retryDelay)));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      if (result.lastPage !== first.lastPage || result.reportedTotal !== first.reportedTotal) {
        throw new Error(`ARYEO_SOURCE_PAGINATION_DIVERGENCE: ${dataset.id} metadata changed during acquisition`);
      }
      pages.set(pageNumbers[index]!, result.records);
      if (result.timestamp) timestamps.add(result.timestamp);
    }
  }
  const records = [...pages.entries()].sort(([left], [right]) => left - right).flatMap(([_page, values]) => values);
  if (records.length !== first.reportedTotal) {
    throw new Error(`ARYEO_SOURCE_PAGINATION_DIVERGENCE: ${dataset.id} reported ${first.reportedTotal} but returned ${records.length}`);
  }
  return {
    schema: CURRENT_OPERATIONS_ADMISSION_SCHEMA,
    contract: "AryeoDatasetSnapshotV1",
    datasetId: dataset.id,
    endpointPath: dataset.path,
    method: "GET",
    acquiredAt,
    pageCount: first.lastPage,
    reportedTotal: first.reportedTotal,
    recordCount: records.length,
    providerTimestamps: [...timestamps].sort(),
    records,
  };
}

export async function acquireAryeoCurrentOperations(options: AryeoAcquisitionOptions): Promise<AryeoSnapshotManifestV1> {
  if (!options.apiKey.trim()) throw new Error("ARYEO_CREDENTIAL_NOT_CONFIGURED: API key is empty");
  const { root, parent } = await assertNarrowNewOutputRoot(options.outputRoot);
  const temporaryRoot = join(parent, `.${root.split("/").at(-1)}.partial-${process.pid}-${randomUUID()}`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const retryDelay = options.retryDelay ?? delay;
  const startedAt = now().toISOString();
  const files: AryeoSnapshotManifestFileV1[] = [];
  try {
    await mkdir(temporaryRoot, { mode: 0o700 });
    for (const dataset of ARYEO_READ_DATASETS) {
      const snapshot = await acquireDataset(dataset, options.apiKey, fetchImpl, startedAt, retryDelay);
      const relativePath = `${dataset.id}.json`;
      const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
      if (serialized.includes(options.apiKey)) throw new Error("ARYEO_SECRET_LEAKAGE_FAILURE: API key appeared in snapshot bytes");
      const path = join(temporaryRoot, relativePath);
      await writeFile(path, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
      files.push({
        datasetId: dataset.id,
        relativePath,
        byteSize: Buffer.byteLength(serialized),
        sha256: sha256(serialized),
        pageCount: snapshot.pageCount,
        reportedTotal: snapshot.reportedTotal,
        recordCount: snapshot.recordCount,
      });
    }
    const completedAt = now().toISOString();
    const manifest: AryeoSnapshotManifestV1 = {
      schema: CURRENT_OPERATIONS_ADMISSION_SCHEMA,
      contract: "AryeoSnapshotManifestV1",
      method: "GET_ONLY",
      apiBaseUrl: ARYEO_API_BASE_URL,
      startedAt,
      completedAt,
      allowlistedDatasetCount: ARYEO_READ_DATASETS.length,
      datasetFiles: files,
      totalRecords: files.reduce((sum, file) => sum + file.recordCount, 0),
      secretMaterialIncluded: false,
      providerMutationCount: 0,
    };
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    if (manifestBytes.includes(options.apiKey)) throw new Error("ARYEO_SECRET_LEAKAGE_FAILURE: API key appeared in manifest bytes");
    await writeFile(join(temporaryRoot, "MANIFEST.json"), manifestBytes, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryRoot, root);
    for (const file of files) {
      const info = await stat(join(root, file.relativePath));
      if (info.size !== file.byteSize || sha256(await readFile(join(root, file.relativePath))) !== file.sha256) {
        throw new Error(`ARYEO_SOURCE_FREEZE_FAILURE: post-rename identity mismatch for ${file.relativePath}`);
      }
    }
    return manifest;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
