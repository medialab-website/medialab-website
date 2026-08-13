import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOperationalPilotApp, type PilotService } from "../src/operational-pilot/app.js";
import { deterministicPng } from "../src/operational-pilot/fixture-media.js";

const roots: string[] = []; afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "m16a-ui-")); roots.push(root); const sessions = new Map<string, { session: string; mode: "review" | "quick-edit" }>();
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, filename: `returned-${i + 1}.png`, previewUrl: `/preview/${i}`, decision: null as string | null }));
  const service: PilotService = {
    sessionForCookie: vi.fn(async (cookie) => { if (cookie.includes(":")) { const [mode, value] = cookie.split(":") as ["review" | "quick-edit", string]; sessions.set(value!, { session: "opaque-server-session", mode }); return sessions.get(value!)!; } return sessions.get(cookie) ?? null; }),
    overview: vi.fn(async () => ({ job: "Synthetic listing" })), missionPlan: vi.fn(async () => ({ filename: "mission.html", bytes: Buffer.from("<h1>Mission</h1>"), sha256: "a".repeat(64) })),
    review: vi.fn(async () => ({ context: "Synthetic Job · PHOTO", items })), decide: vi.fn(async (_s, id, decision) => { items.find((x) => x.id === id)!.decision = decision; return { saved: true }; }),
    submitReview: vi.fn(async () => { if (items.some((x) => !x.decision)) throw new Error("unresolved review items remain"); return { completed: true }; }), queue: vi.fn(async () => ({ actionable: [] })),
    workingFile: vi.fn(async () => { const bytes = deterministicPng(21); return { filename: "returned.png", bytes, mediaType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") }; }),
    createCorrectionContext: vi.fn(async () => ({ correctedVersionId: "version", operationId: "operation", finalApproved: false })), operation: vi.fn(async () => ({})), retry: vi.fn(async () => ({})),
    disposition: vi.fn(async () => ({})), publication: vi.fn(async () => ({})), observability: vi.fn(async () => ({})),
  };
  return { app: createOperationalPilotApp(service, root), service, items };
}

describe("P02-M16-A operational whole-listing UI", () => {
  it("renders direct labeled actions, progress, disabled submit, keyboard, and responsive touch rules", async () => {
    const { app } = await setup(); const page = await app.inject({ method: "GET", url: "/" }); const js = await app.inject({ method: "GET", url: "/app.js" }); const css = await app.inject({ method: "GET", url: "/styles.css" });
    expect(page.body).toContain("Accept"); expect(page.body).toContain("Reject / Send Back"); expect(page.body).toContain("Quick Edit"); expect(page.body).toMatch(/id="submit" disabled/);
    expect(js.body).toContain('key==="a"'); expect(js.body).toContain('key==="q"'); expect(js.body).toContain("resolved!==5"); expect(css.body).toContain("@media(max-width:720px)"); await app.close();
  });
  it("uses HttpOnly local cookies without returning database tokens", async () => {
    const { app } = await setup(); const response = await app.inject({ method: "POST", url: "/session", payload: { mode: "review" } });
    expect(response.statusCode).toBe(200); expect(response.headers["set-cookie"]).toMatch(/HttpOnly; SameSite=Strict/); expect(response.body).not.toMatch(/opaque-server-session|token/i); await app.close();
  });
  it("fails closed on server-side submission before all five decisions", async () => {
    const { app } = await setup(); const login = await app.inject({ method: "POST", url: "/session", payload: { mode: "review" } }); const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const response = await app.inject({ method: "POST", url: "/api/review/submit", headers: { cookie } }); expect(response.statusCode).toBe(400); expect(response.body).toContain("unresolved"); expect(response.body).not.toMatch(/stack|sql|\/Users\//i); await app.close();
  });
  it("accepts correction bytes only as bounded raw octet stream and returns queued evidence without approval", async () => {
    const { app, service } = await setup(); const login = await app.inject({ method: "POST", url: "/session", payload: { mode: "quick-edit" } }); const cookie = String(login.headers["set-cookie"]).split(";")[0]; const bytes = deterministicPng(99);
    const response = await app.inject({ method: "POST", url: "/api/quick-edit/request-1/correction?idempotencyKey=stable-correction-1", headers: { cookie, "content-type": "application/octet-stream" }, payload: bytes });
    expect(response.statusCode).toBe(202); expect(response.json()).toMatchObject({ queued: true, context: { finalApproved: false } }); expect(service.createCorrectionContext).toHaveBeenCalledOnce();
    const json = await app.inject({ method: "POST", url: "/api/quick-edit/request-1/correction?idempotencyKey=stable-correction-2", headers: { cookie, "content-type": "application/json" }, payload: { bytes: bytes.toString("base64") } }); expect(json.statusCode).toBe(400); expect(json.body).not.toContain(bytes.toString("base64")); await app.close();
  });
});
