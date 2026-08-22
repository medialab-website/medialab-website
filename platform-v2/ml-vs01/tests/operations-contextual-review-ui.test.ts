import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

let javascript = "";
let css = "";
let html = "";

beforeAll(async () => {
  [javascript, css, html] = await Promise.all([
    readFile(new URL("../src/operations-console/public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/operations-console/public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/operations-console/public/index.html", import.meta.url), "utf8"),
  ]);
});

function sourceBetween(start: string, end: string): string {
  const startIndex = javascript.indexOf(start);
  const endIndex = javascript.indexOf(end, startIndex + start.length);
  expect(startIndex, `${start} must exist`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `${end} must follow ${start}`).toBeGreaterThan(startIndex);
  return javascript.slice(startIndex, endIndex);
}

describe("P02-M22-A dedicated contextual Review Edits and Quick Edits rooms", () => {
  it("reduces each Needs Attention card to one current reason and routes the whole card", () => {
    const helpers = sourceBetween("function reviewActionWorkspace", "function reviewActionsFor");
    const listingContextualActions = runInNewContext(`${helpers}; listingContextualActions`);
    const result = listingContextualActions([
      { code: "EDITOR_REVIEW_READY" },
      { code: "EDITOR_REVIEW_IN_PROGRESS" },
      { code: "EDITOR_REVISION_REQUIRED" },
      { code: "QUICK_EDIT_REQUIRED" },
      { code: "QUICK_EDIT_REQUIRED" },
    ]);
    expect(result).toEqual([
      { workspace: "review", label: "Review Edits" },
      { workspace: "quick-edit", label: "Quick Edits" },
    ]);
    expect(listingContextualActions([{ code: "EDITOR_REVIEW_READY" }])).toEqual([
      { workspace: "review", label: "Review Edits" },
    ]);

    const queueAction = sourceBetween("function queueCardAction", "function queueAppointmentDisplay");
    expect(queueAction).toContain('{ label: "QUICK EDITS", tone: "quick-edit", workspace: "quick-edit" }');
    expect(queueAction).toContain('{ label: "REVIEW EDITS", tone: "urgent", workspace: "review" }');
    expect(queueAction).toContain('{ label: "CONFIRM SCHEDULING", tone: "urgent", workspace: "mission-plan" }');

    const queue = sourceBetween("function renderOperationsQueue", "function detailSection");
    expect(queue).toContain("const action = queueCardAction(item)");
    expect(queue).toContain("button.dataset.contextWorkspace = action.workspace");
    expect(queue).toContain('"operation-card-address"');
    expect(queue).toContain('"operation-listing-agent"');
    expect(queue).toContain('`operation-reason operation-reason-${action.tone}`');
    expect(queue).not.toContain("operation-card-actions");
    expect(queue).not.toContain("operation-alerts");
    expect(queue).not.toContain("attentionLabel(code)");
    expect(queue).not.toContain("operation-services");
    expect(css).toContain(".appointment-time.is-requested { color: #ff8c85; }");
    expect(css).toContain(".operation-reason-urgent");
    expect(css).toContain(".operation-reason-quick-edit");
  });

  it("makes Mission Plan the default and exposes Production only after culling while contextual work remains a sibling room", () => {
    const availability = sourceBetween("function hasCulledProduction", "async function loadProductionPane");
    const hasCulledProduction = runInNewContext(`${availability}; hasCulledProduction`);
    expect(hasCulledProduction({ lanes: [{ cull: { currentState: "NOT_STARTED" } }] })).toBe(false);
    expect(hasCulledProduction({ lanes: [{ cull: { currentState: "COMPLETE" } }] })).toBe(true);
    expect(hasCulledProduction({ lanes: [{ cull: { inventorySealed: true, hasCurrentSelection: true } }] })).toBe(true);

    const switcher = sourceBetween("function productionWorkspaceSwitcher", "function customerActions");
    const permanentTabs = [...switcher.matchAll(/element\("button", "workspace-switch", "([^"]+)"\)/g)]
      .map((match) => match[1]);
    expect(permanentTabs).toEqual(["Production", "Mission Plan"]);
    expect(switcher).toContain("if (productionAvailable) switcher.append(production)");
    expect(switcher).toContain('route.workspace : "mission-plan"');
    expect(switcher).toContain('if (name === "production" && !productionAvailable) name = "mission-plan"');
    expect(switcher).not.toMatch(/renderReviewWorkspace|renderQuickEditWorkspace|contextual-workspace/u);

    const room = sourceBetween("function ensureContextualRoom", "function announceContextualRoom");
    expect(room).toContain('room = document.createElement("section")');
    expect(room).toContain('room.id = "operations-contextual-room"');
    expect(room).toContain('byId("operations-main").append(room)');
    expect(room).not.toContain('byId("operations-detail")');
    expect(room).toContain('document.querySelectorAll(".operations-hero, .queue-tabs, .operations-layout")');
    expect(room).toContain("surface.hidden = active");
    expect(room).toContain("room.hidden = !active");
    expect(css).toContain(".operations-contextual-room");
    expect(css).toContain(".is-contextual-room .operations-shell");
  });

  it("restores contextual deep links and Quick Edit card history", () => {
    for (const key of ["queue", "orderId", "workspace", "reviewBatchId", "reviewItemId", "quickEditRequestId"]) {
      expect(javascript).toContain(`params.get("${key}")`);
    }
    expect(javascript).toContain("window.history.pushState");
    expect(javascript).toContain("window.history.replaceState");
    expect(javascript).toContain('history: "push", focus: true');
    expect(javascript).toContain('quickEditRequestId: next.quickEditRequestId }, "replace")');
    expect(javascript).toContain('window.addEventListener("popstate"');
    expect(javascript).toContain("applyOperationsRouteFromHistory()");
    expect(javascript).toContain('openOperationsDetail(context.orderId, { workspace: "mission-plan", history: "replace", focus: true })');
    const detail = sourceBetween("async function openOperationsDetail", "async function loadOperationsHome");
    expect(detail).toContain('const contextual = ["review", "quick-edit"].includes(route.workspace)');
    expect(detail).toContain("renderContextualRoomLoading(route.workspace)");
    expect(detail).toContain("workspace.context");
  });

  it("toggles between a status thumbnail grid and one filmstrip-navigated review card", () => {
    const selectionHelpers = sourceBetween("function roomItemIndex", "function isRoomInteractionTarget");
    const helpers = runInNewContext(`${selectionHelpers}; ({ roomItemIndex, roomSwipeDirection })`);
    const items = [
      { id: "one", currentDisposition: "ACCEPT" },
      { id: "two", currentDisposition: null },
      { id: "three", currentDisposition: null },
    ];
    expect(helpers.roomItemIndex(items, "three", "id", true)).toBe(2);
    expect(helpers.roomItemIndex(items, "missing", "id", true)).toBe(1);
    expect(helpers.roomItemIndex(items, null, "id", false)).toBe(0);
    expect(helpers.roomItemIndex([], null, "id", true)).toBe(-1);
    expect(helpers.roomSwipeDirection(-80, 8, 320)).toBe(1);
    expect(helpers.roomSwipeDirection(80, 8, 320)).toBe(-1);
    expect(helpers.roomSwipeDirection(40, 2, 320)).toBe(0);
    expect(helpers.roomSwipeDirection(90, 100, 320)).toBe(0);

    const reviewRoom = sourceBetween("function renderReviewWorkspace", "function quickEditFileType");
    const quickRoom = sourceBetween("function renderQuickEditWorkspace", "async function openOperationsDetail");
    expect(reviewRoom).toContain('operationsState.reviewView === "grid"');
    expect(reviewRoom).toContain("reviewThumbnailGrid(context, batch, items, {");
    expect(reviewRoom).toContain("onBulkStage: (disposition, batchNote)");
    expect(reviewRoom).toContain("onToggleAll: (selected)");
    expect(reviewRoom).toContain("operationsState.reviewGridSelection.add(selectedItem.reviewItemId)");
    expect(reviewRoom).toContain("reviewFilmstrip(context, batch, items, item, selectItem)");
    expect(reviewRoom).toContain('card.querySelector(".review-media-figure")?.after(filmstrip)');
    expect(reviewRoom).toContain("const card = reviewDecisionCard(context, batch, item, onSingleStage)");
    expect(reviewRoom).toContain('disposition === "ACCEPT" && items[index + 1]');
    expect(reviewRoom).toContain('.review-note-slot textarea`');
    expect(reviewRoom).not.toContain('contextualRoomPager("Photo"');
    expect(reviewRoom).toContain("bindRoomCardNavigation(card, move)");
    expect(reviewRoom).toContain("bindContextualRoomKeyboard(pane, move)");
    expect(quickRoom).toContain("const rendered = quickEditCard(context, item, index)");
    expect(quickRoom).not.toMatch(/items\.forEach/u);

    const thumbnails = sourceBetween("function reviewItemStatus", "function completedReviewHistory");
    expect(thumbnails).toContain('ACCEPT: { className: "is-accepted", label: "Accepted" }');
    expect(thumbnails).toContain('QUICK_EDIT: { className: "is-quick-edit", label: "Quick Edit" }');
    expect(thumbnails).toContain('REJECT_REVISION: { className: "is-rejected", label: "Rejected" }');
    expect(thumbnails).toContain('{ className: "is-pending", label: "Not selected" }');
    expect(thumbnails).toContain('["grid", "Grid"]');
    expect(thumbnails).toContain('["single", "Single photo"]');
    expect(thumbnails).toContain('allSelected ? "Deselect all" : "Select all"');
    expect(thumbnails).toContain('reviewTextarea("Batch note (optional)"');
    expect(thumbnails).toContain("callbacks.onBulkStage(disposition, note.querySelector");
    expect(css).toContain(".review-thumbnail-grid");
    expect(css).toContain(".review-filmstrip");
    expect(css).toContain(".review-status-light.is-accepted { background: #55d788; }");
    expect(css).toContain(".review-status-light.is-quick-edit { background: #ffd84d; }");
    expect(css).toContain(".review-thumbnail.is-selected");
    expect(css).toContain(".review-grid-bulk-actions");
    expect(css).toContain("padding: .38rem calc(50% - 1.9rem)");
    expect(css).toContain("scroll-snap-type: x proximity");
    expect(thumbnails).toContain("operationsState.reviewFilmstripPosition");
    expect(thumbnails).toContain("strip.scrollLeft = saved.scrollLeft");
    expect(thumbnails).toContain('behavior: saved && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto"');
    expect(css).toContain("max-height: 50svh");
    expect(css).toContain(".review-decision-button.is-accept");
    expect(css).toContain(".review-decision-button.is-reject-revision");
    expect(css).toContain(".review-decision-button.is-quick-edit");

    const pager = sourceBetween("function contextualRoomPager", "function bindContextualRoomKeyboard");
    expect(pager).toContain('"Previous"');
    expect(pager).toContain('"Next"');
    expect(pager).toContain("previous.disabled = index <= 0");
    expect(pager).toContain("next.disabled = index >= total - 1");
    const gestures = sourceBetween("function isRoomInteractionTarget", "function contextualRoomPager");
    expect(gestures).toContain('target.closest("button, a, input, textarea, select, label")');
    expect(gestures).toContain('["touch", "pen"].includes(event.pointerType)');
    expect(gestures).toContain('card.addEventListener("pointermove"');
    expect(gestures).toContain("event.preventDefault()");
    expect(javascript).toContain('event.key === "ArrowLeft"');
    expect(javascript).toContain('event.key === "ArrowRight"');
    expect(css).toContain("touch-action: pan-y");
  });

  it("lazy-loads thumbnails and preloads only adjacent single-photo media without browser persistence", () => {
    const media = sourceBetween("function createRoomMediaImage", "function contextualContextStrip");
    expect(media).toContain("[index - 1, index, index + 1]");
    expect(media).toContain("operationsState.mediaPreloads.delete(url)");
    expect(media).toContain('candidateIndex === index ? "high" : "low"');
    expect(media).toContain('image.loading = "eager"');
    expect(javascript).toContain('preloadAdjacentRoomMedia(context, items, index, "REVIEW_PREVIEW", batch.reviewBatchId)');
    expect(javascript).toContain('preloadAdjacentRoomMedia(context, items, index, "QUICK_EDIT_DOWNLOAD")');
    const figure = sourceBetween("function reviewMediaFigure", "function reviewTextarea");
    expect(figure).toContain("options.lazy");
    expect(figure).toContain('lazyImage.loading = "lazy"');
    expect(figure).toContain('lazyImage.fetchPriority = "low"');
    expect(javascript).toContain('image.loading = "lazy"');
    expect(javascript).toContain('image.fetchPriority = active ? "high" : "low"');
    expect(javascript).toContain("clearRoomMediaPreloads()");
    expect(media).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|CacheStorage|URL\.createObjectURL/u);
  });

  it("puts the three decisions beneath the selected photo and opens a full-size inspection room", () => {
    const figure = sourceBetween("function openReviewImageLightbox", "function reviewTextarea");
    expect(figure).toContain('dialog.className = "review-image-lightbox"');
    expect(figure).toContain('inspect.setAttribute("aria-label", `Open full-size photo');
    expect(figure).toContain("openReviewImageLightbox(url, version)");
    expect(figure).toContain("dialog.showModal()");
    expect(css).toContain(".review-gallery");
    expect(css).toContain(".review-image-lightbox-image");
  });

  it("stages exactly three choices in memory and submits one sorted full-review payload", () => {
    const card = sourceBetween("function reviewDecisionCard", "function completedReviewHistory");
    for (const decision of [
      '["ACCEPT", "Accept"]',
      '["REJECT_REVISION", "Reject"]',
      '["QUICK_EDIT", "Quick Edit"]',
    ]) expect(card).toContain(decision);
    expect(card).not.toMatch(/USE_ORIGINAL|SKIP_QUICK_EDIT|Decision needed|review-item-state/u);
    expect(card).not.toMatch(/createElement\("select"\)|selectField\(/u);
    expect(card).toContain('reviewTextarea("Note (optional)"');
    expect(card).toContain('if (["REJECT_REVISION", "QUICK_EDIT"].includes(draft?.disposition))');
    expect(card).not.toMatch(/review-note-confirm|Save Quick Edit|Save revision|Cancel/u);
    expect(card).not.toContain('reviewTextarea("Reason"');
    expect(card).not.toContain('reviewTextarea("Instructions"');

    const staging = sourceBetween("function reviewDraftKey", "function reviewDecisionCard");
    expect(staging).toContain("operationsState.roomDrafts.set");
    expect(staging).toContain(".sort((left, right)");
    expect(staging).toContain("reviewItemId: item.reviewItemId");
    expect(staging).toContain("disposition: draft.disposition");
    expect(staging).toContain("expectedGeneration: item.decisionGeneration");
    expect(staging).toContain("currentDecisionId: item.currentDecisionId || null");
    expect(javascript).not.toMatch(/\/items\/\$\{encodeURIComponent\(item\.reviewItemId\)\}\/decision/u);

    const submit = sourceBetween("async function submitEditorReview", "async function startEditorReview");
    expect(submit).toContain("expectedGeneration: batch.lifecycleGeneration");
    expect(submit).toContain("expectedGeneration: batch.lifecycleGeneration, decisions");
    expect(submit).not.toMatch(/textarea|reasonField|reason\s*[,}]/u);
    const reviewRoom = sourceBetween("function renderReviewWorkspace", "function quickEditFileType");
    expect(reviewRoom).toContain("const decisions = stagedReviewDecisions");
    expect(reviewRoom).toContain("progress.value = decisions.length");
    expect(reviewRoom).toContain("if (decisions.length !== items.length || !items.length) return");
    expect(reviewRoom).toContain('"Submit Review"');
    expect(reviewRoom).not.toMatch(/submissionReason|Submission reason|batch\.unresolvedCount|batch\.resolvedCount/u);
    const history = sourceBetween("function completedReviewHistory", "async function submitEditorReview");
    expect(history).toContain("if (decision.reason)");
    expect(history).toContain("if (decision.instructions)");
  });

  it("shows exactly Download and Upload Revision while retaining safe automatic upload and navigation guards", () => {
    const quickEdit = sourceBetween("function quickEditFileType", "function renderQuickEditWorkspace");
    const card = sourceBetween("function quickEditCard", "function renderQuickEditWorkspace");
    expect(card).toContain('"Download"');
    expect(card).toContain('"Upload Revision"');
    expect(card.match(/element\("button"/g)).toHaveLength(1);
    expect(card.match(/element\("a"/g)).toHaveLength(1);
    expect(card).not.toMatch(/Download photo|Choose revision|Clear selected|quick-edit-steps|quick-edit-instructions|Apply the needed|Lightroom|Camera Roll/u);
    expect(card).toContain('element("p", "quick-edit-upload-message", "")');
    expect(card).not.toContain("item.uploadMessage");
    expect(quickEdit).toContain('input.type = "file"');
    expect(quickEdit).toContain('input.accept = "image/jpeg,image/png,.jpg,.jpeg,.png"');
    expect(quickEdit).toContain("input.multiple = false");
    expect(quickEdit).toContain("input.hidden = true");
    expect(quickEdit).toContain("files.length === 1");
    expect(quickEdit).toContain("button.addEventListener(\"click\", () => input.click())");
    expect(quickEdit).toContain('input.addEventListener("change", async () =>');
    expect(quickEdit).toContain("await uploadQuickEditRevision");
    expect(quickEdit).toContain("if (!uploading && !input.files?.length) return false");
    expect(quickEdit).toContain('headers: { "content-type": mediaType }, body: file');
    expect(quickEdit).toContain("idempotencyKey=${encodeURIComponent(button.dataset.idempotencyKey)}&filename=${encodeURIComponent(file.name)}");
    expect(javascript).toContain('window.addEventListener("beforeunload"');
    expect(javascript).toContain("operationsState.roomNavigationGuard?.()");
    expect(javascript).toContain("window.history.forward()");
    expect(quickEdit).not.toMatch(/\.capture\s*=|setAttribute\("capture"/u);
    expect(javascript).toContain('"Quick Edit revision uploaded and finalized."');
    expect(javascript).not.toContain('uploadState: "SUCCESSOR_REVIEW_READY"');
  });

  it("uses MediaLab yellow as a strategic review-room accent over neutral charcoal surfaces", () => {
    expect(css).toContain(".contextual-room-header");
    expect(css).toContain("background: linear-gradient(135deg, #151515, #2a2a2a)");
    expect(css).toContain("border-top: 2px solid #ffc107");
    expect(css).toContain(".review-note-editor { display: grid; gap: .75rem; padding: .9rem; background: #181818; border: 1px solid #444");
    expect(css).toContain(".review-submit-gate { display: flex; justify-content: flex-end;");
    expect(css).toContain("background: #1d1d1d; border: 1px solid #444");
    expect(css).toContain('.review-decision-button.is-accept { color: #f4fff8; background: #2b684a; border-color: #55d788; }');
    expect(css).toContain('.review-decision-button.is-reject-revision { color: #fff5f4; background: #7d3439; border-color: #ff6f68; }');
    expect(css).toContain('.review-decision-button.is-quick-edit { color: #17130a; background: #ffd84d; border-color: #ffe989; }');
    expect(css).toContain(".review-decision-card.is-decided { border-color: #555; }");
    expect(css).toContain(".button-secondary { color: #e0e0e0; background: #2a2a2a; border-color: #555; }");
    expect(css).toContain(".queue-tabs button[aria-pressed=\"true\"], .detail-tabs button[aria-pressed=\"true\"] { color: #ffc107; background: #333;");
    expect(css).toContain(".workspace-switch[aria-pressed=\"true\"] { color: #ffc107; background: #333;");
    expect(css).toContain(".eyebrow, .step-kicker { color: #a6a6a6; }");
  });

  it("separates global navigation from listing work without exposing unfinished destinations as actions", () => {
    expect(html).toContain('class="workspace-toolbar"');
    expect(html).toContain('data-workspace-destination="real-estate"');
    expect(html).toContain('data-workspace-destination="weddings"');
    expect(html).toContain('data-workspace-destination="commercial"');
    expect(html).toContain('data-workspace-destination="clients"');
    expect(html).not.toContain("<details class=\"workspace-menu\">");
    expect(javascript).toContain('const route = readOperationsRoute();');
    expect(javascript).toContain('route.section;');
    expect(javascript).toContain('WORKSPACE_NAV_DESTINATIONS.includes(section || "") ? section : "real-estate"');
    expect(javascript).toContain('params.set("section", section);');
    expect(css).toContain('.workspace-toolbar-link[aria-current="page"] { color: #ffc107; background: #333;');
    expect(css).toContain('.operations-mode .header-copy h1 { margin: 0; font-size: clamp(2rem, 3.6vw, 3.35rem);');
  });

  it("keeps the active rooms purposeful instead of repeating helper copy", () => {
    const header = sourceBetween("function contextualRoomHeader", "function renderContextualRoomLoading");
    expect(header).not.toMatch(/Mission Control task room|production-muted|description/u);
    const strip = sourceBetween("function contextualContextStrip", "function openReviewImageLightbox");
    expect(strip).toContain("operationsAddress(context)");
    expect(strip).not.toMatch(/Order scope|Production lane|Review cycle|summaryField/u);
    const reviewRoom = sourceBetween("function renderReviewWorkspace", "function quickEditFileType");
    expect(reviewRoom).not.toMatch(/Review one returned photo|choices stay staged|Review progress|Ready to submit|Stage one choice|All choices are staged/u);
    expect(javascript).toContain('contextualRoomHeader(context, "Quick Edits")');
    expect(javascript).not.toContain('"One revision at a time."');
  });

  it("uses safe DOM rendering and mobile/reduced-motion accessibility at the 320px floor", () => {
    expect(javascript).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/u);
    expect(css).toContain("min-width: 320px");
    expect(css).toContain(".contextual-room-pager");
    expect(css).toContain("min-height: 52px");
    expect(css).toContain("env(safe-area-inset-left)");
    expect(css).toContain("max-height: 48svh");
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.review-decision-card[\s\S]*grid-template-columns:\s*1fr/u);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.review-decision-card, \.quick-edit-card\s*\{\s*transition: none !important;/u);
    expect(javascript).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(javascript).toContain('status.setAttribute("aria-live", "polite")');
  });
});
