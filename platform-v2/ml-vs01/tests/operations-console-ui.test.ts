import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

let html = "";
let javascript = "";
let css = "";

beforeAll(async () => {
  [html, javascript, css] = await Promise.all([
    readFile(new URL("../src/operations-console/public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/operations-console/public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/operations-console/public/styles.css", import.meta.url), "utf8"),
  ]);
});

function functionBody(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `${start} must exist`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `${end} must follow ${start}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("P02-M17-A Operations Console browser surface", () => {
  it("presents the exact bounded Customer to Confirmation flow without unrelated operational surfaces", () => {
    const steps = [...html.matchAll(/data-progress-step="([^"]+)"/g)].map((match) => match[1]);
    expect(steps).toEqual(["customer", "property", "services", "review", "create", "confirmation"]);
    expect(html).toContain("Who is this listing for?");
    expect(html).toContain("Where is the property?");
    expect(html).toContain("Choose services");
    expect(html).toContain("Review before creating");
    expect(html).toContain("Creating the listing safely");
    expect(html).toContain("Listing and order confirmed");
    expect(html).not.toMatch(/quick edit|culling|editor handoff|returned-editor review|delivery center/i);
  });

  it("uses only same-origin static assets, safe DOM construction, and no raw JSON presentation", () => {
    const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    expect(assetUrls).toEqual(["/styles.css", "/app.js", "#console-main"]);
    expect(html).not.toMatch(/\sstyle=|<script(?![^>]*\bsrc=)|<iframe|<pre\b/i);
    expect(javascript).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/);
    expect(javascript).toContain("document.createElement");
    expect(javascript).toContain("textContent");
    expect(javascript).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it("sends only the approved bounded session, preview, and creation request bodies", () => {
    expect(javascript).toContain('fetchJson("/session"');
    expect(javascript).toContain("body: JSON.stringify({}),");
    expect(javascript).toContain('fetchJson("/api/catalog")');
    expect(javascript).toContain('fetchJson("/api/listings/preview"');
    expect(javascript).toContain('fetchJson("/api/listings"');
    expect(javascript).toContain("fetchJson(`/api/orders/${encodeURIComponent(state.pendingOrderId)}`)");

    const previewBuilder = functionBody(javascript, "function buildPreviewRequest()", "function extractPreviewReceipt");
    expect(previewBuilder).toContain("customer: readCustomer()");
    expect(previewBuilder).toContain("property: readProperty()");
    expect(previewBuilder).toContain("services: selectedServices().map(({ choiceHandle, quantity }) => ({ choiceHandle, quantity }))");
    expect(previewBuilder).not.toMatch(/price|amount|total|actor|organization|membership|party|source|provider|uuid|idempotency/i);

    const propertyReader = functionBody(javascript, "function readProperty()", "function catalogArrays");
    expect(propertyReader).toContain("addressLine1:");
    expect(propertyReader).toContain("addressLine2:");
    expect(propertyReader).toContain("locality:");
    expect(propertyReader).toContain("administrativeArea:");
    expect(propertyReader).toContain("postalCode:");
    expect(propertyReader).toContain("countryCode:");
    expect(propertyReader).toContain("property.squareFeet = squareFeet");
    expect(propertyReader).not.toMatch(/price|amount|actor|organization|party|source|provider|uuid/i);

    const creation = functionBody(javascript, "async function createListing()", "async function initialize()");
    expect(creation).toContain("body: JSON.stringify({ previewReceipt: state.previewReceipt })");
    expect(creation).not.toMatch(/body:\s*JSON\.stringify\(\{[^}]*?(?:price|amount|actor|organization|party|source|provider|uuid|idempotency)/is);

    const namedInputs = [...html.matchAll(/<input[^>]+name="([^"]+)"/g)].map((match) => match[1]).sort();
    expect(namedInputs).toEqual([
      "addressLine1",
      "addressLine2",
      "administrativeArea",
      "countryCode",
      "customerEmail",
      "customerName",
      "locality",
      "postalCode",
      "squareFeet",
    ]);
    expect(html).not.toMatch(/type="hidden"|name="(?:price|amount|total|actor|organization|party|source|provider|uuid|idempotency)/i);
  });

  it("keeps packages at one, bounds individual quantities, and requires square feet only when selected pricing needs it", () => {
    expect(javascript).toContain('quantity.max = choice.isPackage ? "1" : "99"');
    expect(javascript).toContain("quantity.readOnly = choice.isPackage");
    expect(javascript).toContain("const quantity = choice?.isPackage ? 1 : Number(quantityField?.value)");
    expect(javascript).toContain("quantity >= 1 && quantity <= 99");
    expect(javascript).toContain('basis === "SQUARE_FEET"');
    expect(javascript).toContain("selections.some(({ choice }) => choice?.requiresSquareFeet)");
    expect(html).toContain('id="square-feet"');
    expect(html).toContain('min="1" max="1000000" step="1"');
  });

  it("provides keyboard focus, error, progress, loading, and double-submit protections", () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    const labelTargets = [...html.matchAll(/<label[^>]+for="([^"]+)"/g)].map((match) => match[1]);
    expect(labelTargets.length).toBeGreaterThanOrEqual(9);
    for (const target of labelTargets) expect(ids.has(target), `missing field for label ${target}`).toBe(true);

    expect(html).toContain('aria-label="New listing progress"');
    expect(html).toContain('role="alert" tabindex="-1"');
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(html).toContain('aria-atomic="true"');
    expect(javascript).toContain("summary.focus()");
    expect(javascript).toContain("heading.focus()");
    expect(javascript).toContain('field.setAttribute("aria-invalid", "true")');
    expect(javascript).toContain("if (state.previewing || state.creating) return");
    expect(javascript).toContain("if (state.creating || state.previewing || !state.previewReceipt) return");
    expect(javascript).toContain('button.setAttribute("aria-busy", String(busy))');
    expect(javascript).toContain("createButton.disabled = true");
    expect(css).toContain(":focus-visible");
  });

  it("is touch-friendly and adapts for narrow screens and reduced motion", () => {
    expect(css).toMatch(/\.button\s*\{[^}]*min-height:\s*48px/s);
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.button\s*\{[^}]*min-height:\s*52px/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms");
    expect(css).toContain("min-width: 320px");
  });

  it("makes the nonproduction authority boundary and excluded follow-on work unmistakable", () => {
    expect(html).toMatch(/Nonproduction environment/);
    expect(html).toMatch(/reconstructed nonproduction catalog evidence/i);
    expect(html).toMatch(/does not schedule appointments, create assignments or Mission Plans, process media, contact providers, or collect payment/i);
    expect(html).toMatch(/This console stops at order confirmation/i);
    expect(html).toMatch(/no appointment, assignment, or Mission Plan was created here/i);
    expect(javascript).toMatch(/No payment was processed by this console/i);
    expect(html).not.toMatch(/production[- ]ready|live customer|live provider/i);
  });
});
