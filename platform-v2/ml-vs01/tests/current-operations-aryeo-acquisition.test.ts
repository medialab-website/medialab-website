import { mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARYEO_READ_DATASETS,
  acquireAryeoCurrentOperations,
  readAryeoApiKeyFromEnvFile,
} from "../src/current-admission/aryeo-acquisition.js";

const TOKEN = "synthetic-aryeo-token-never-write";

function responseFor(url: string): Response {
  const parsed = new URL(url);
  const dataset = parsed.pathname.split("/").at(-1)!;
  const page = Number(parsed.searchParams.get("page"));
  const pageCount = dataset === "orders" ? 2 : 1;
  const total = pageCount;
  return Response.json({
    status: "success",
    data: [{ object: dataset.toUpperCase(), id: `${dataset}-${page}` }],
    meta: { total, last_page: pageCount, current_page: page, per_page: 100 },
    timestamp: `2026-08-21T00:00:0${page}Z`,
  });
}

describe("P02-M23-A read-only Aryeo current-operations acquisition", () => {
  it("freezes every allowlisted GET dataset atomically without credential bytes", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "m23a-aryeo-source-")));
    const outputRoot = join(parent, "snapshot");
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), method: String(init?.method), authorization: headers.get("authorization") });
      return responseFor(String(input));
    };
    const times = [new Date("2026-08-21T00:00:00Z"), new Date("2026-08-21T00:01:00Z")];
    const manifest = await acquireAryeoCurrentOperations({
      apiKey: TOKEN,
      outputRoot,
      fetchImpl,
      now: () => times.shift() ?? new Date("2026-08-21T00:01:00Z"),
      retryDelay: async () => undefined,
    });

    expect(manifest.allowlistedDatasetCount).toBe(ARYEO_READ_DATASETS.length);
    expect(manifest.method).toBe("GET_ONLY");
    expect(manifest.providerMutationCount).toBe(0);
    expect(manifest.datasetFiles.find((file) => file.datasetId === "orders")?.recordCount).toBe(2);
    expect(requests.every((request) => request.method === "GET" && request.authorization === `Bearer ${TOKEN}`)).toBe(true);
    const categoryRequest = requests.find((request) => new URL(request.url).pathname.endsWith("/product-categories"));
    expect(new URL(categoryRequest!.url).searchParams.get("sort")).toBe("name");
    const fileNames = (await readdir(outputRoot)).sort();
    expect(fileNames).toEqual(["MANIFEST.json", ...ARYEO_READ_DATASETS.map((dataset) => `${dataset.id}.json`)].sort());
    const allBytes = (await Promise.all(fileNames.map((name) => readFile(join(outputRoot, name), "utf8")))).join("\n");
    expect(allBytes).not.toContain(TOKEN);
  });

  it("removes its bounded partial output after an upstream failure", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "m23a-aryeo-failure-")));
    const outputRoot = join(parent, "snapshot");
    const fetchImpl: typeof fetch = async () => new Response("unavailable", { status: 403 });
    await expect(acquireAryeoCurrentOperations({ apiKey: TOKEN, outputRoot, fetchImpl, retryDelay: async () => undefined }))
      .rejects.toThrow(/HTTP 403/);
    expect(await readdir(parent)).toEqual([]);
  });

  it("reads the exact environment variable without exposing or accepting an empty value", async () => {
    const parent = await mkdtemp(join(tmpdir(), "m23a-aryeo-env-"));
    const configured = join(parent, ".env");
    const empty = join(parent, ".env.empty");
    await writeFile(configured, `OTHER=value\nARYEO_API_KEY='${TOKEN}'\n`);
    await writeFile(empty, "ARYEO_API_KEY=\n");
    expect(await readAryeoApiKeyFromEnvFile(configured)).toBe(TOKEN);
    await expect(readAryeoApiKeyFromEnvFile(empty)).rejects.toThrow(/NOT_CONFIGURED/);
  });
});
