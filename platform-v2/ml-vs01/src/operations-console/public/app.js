"use strict";

const STEP_ORDER = ["customer", "property", "services", "review", "create", "confirmation"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const state = {
  activeStep: "customer",
  catalog: null,
  choices: [],
  preview: null,
  previewReceipt: null,
  pendingOrderId: null,
  previewing: false,
  creating: false,
  ready: false,
};

const byId = (id) => document.getElementById(id);
const text = (value, fallback = "Not provided") => {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return clean && !UUID_PATTERN.test(clean) ? clean : fallback;
};
const firstString = (source, keys, fallback) => {
  if (!source || typeof source !== "object") return fallback;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() && !UUID_PATTERN.test(value.trim())) return value.trim();
  }
  return fallback;
};

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function announce(message) {
  byId("screen-reader-status").textContent = "";
  window.setTimeout(() => {
    byId("screen-reader-status").textContent = message;
  }, 20);
}

function hideError() {
  byId("error-summary").hidden = true;
  document.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute("aria-invalid"));
}

function showError(message, field) {
  const summary = byId("error-summary");
  byId("error-message").textContent = message;
  summary.hidden = false;
  if (field) field.setAttribute("aria-invalid", "true");
  summary.focus();
}

function cleanServerMessage(body, status) {
  const candidate = firstString(body?.error || body, ["message", "error", "errorCode"], "");
  if (candidate && candidate.length <= 240 && !/[\\/](Users|home|private|var)[\\/]|sql|stack|token/i.test(candidate)) return candidate;
  if (status === 401 || status === 403) return "The local operator session is unavailable. Refresh the page and try again.";
  if (status === 409) return "This preview no longer matches the current listing. Review the details and try again.";
  if (status === 422) return "The server could not validate these listing details.";
  return "The local console could not complete that request.";
}

async function fetchJson(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("accept", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    const error = new Error(cleanServerMessage(body, response.status));
    error.status = response.status;
    throw error;
  }
  return body;
}

function showStep(name, options = {}) {
  if (!STEP_ORDER.includes(name)) return;
  state.activeStep = name;
  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.stepPanel !== name;
  });
  const activeIndex = STEP_ORDER.indexOf(name);
  document.querySelectorAll("[data-progress-step]").forEach((item) => {
    const itemIndex = STEP_ORDER.indexOf(item.dataset.progressStep);
    item.toggleAttribute("aria-current", itemIndex === activeIndex);
    if (itemIndex === activeIndex) item.setAttribute("aria-current", "step");
    item.classList.toggle("is-complete", itemIndex < activeIndex);
  });
  hideError();
  if (options.focus !== false) {
    const heading = document.querySelector(`[data-step-panel="${name}"] h2`);
    if (heading) heading.focus();
  }
  announce(`${name === "create" ? "Create listing" : name} step`);
}

function markBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

function validForm(form) {
  hideError();
  const blankRequired = [...form.querySelectorAll("input[required]")].find((field) => !field.value.trim());
  const invalid = blankRequired || form.querySelector(":invalid");
  if (!invalid) return true;
  invalid.setAttribute("aria-invalid", "true");
  showError("Complete the required field before continuing.", invalid);
  invalid.focus();
  return false;
}

function readCustomer() {
  return {
    displayName: byId("customer-name").value.trim(),
    email: byId("customer-email").value.trim().toLowerCase(),
  };
}

function readProperty() {
  const property = {
    addressLine1: byId("address-line-1").value.trim(),
    addressLine2: byId("address-line-2").value.trim() || null,
    locality: byId("locality").value.trim(),
    administrativeArea: byId("administrative-area").value.trim().toUpperCase(),
    postalCode: byId("postal-code").value.trim().toUpperCase(),
    countryCode: byId("country-code").value.trim().toUpperCase(),
  };
  const squareFeet = Number(byId("square-feet").value);
  if (Number.isSafeInteger(squareFeet) && squareFeet > 0) property.squareFeet = squareFeet;
  return property;
}

function catalogArrays(payload) {
  if (!payload || typeof payload !== "object") return [];
  const catalog = payload.catalog && typeof payload.catalog === "object" ? payload.catalog : null;
  return [payload.choices, catalog?.choices, payload.products, catalog?.products, payload.items, catalog?.items]
    .filter(Array.isArray)
    .flat();
}

function normalizeChoice(raw, index) {
  if (!raw || typeof raw !== "object" || typeof raw.choiceHandle !== "string" || !raw.choiceHandle.trim()) return null;
  const kind = firstString(raw, ["choiceType", "kind", "type", "category"], "SERVICE").toUpperCase();
  const basis = firstString(raw, ["basisType", "basis", "pricingBasis"], "").toUpperCase();
  return {
    choiceHandle: raw.choiceHandle,
    name: firstString(raw, ["displayName", "name", "title", "frozenName"], `Catalog choice ${index + 1}`),
    description: firstString(raw, ["description", "summary"], "Available for this nonproduction listing."),
    amountLabel: moneyLabel(raw) || firstString(raw, ["displayAmount", "priceLabel", "formattedPrice"], "Calculated by the server at review"),
    isPackage: raw.isPackage === true || kind.includes("PACKAGE"),
    requiresSquareFeet: basis === "SQUARE_FEET" || raw.requiresSquareFeet === true,
  };
}

function renderCatalog(payload) {
  state.catalog = payload;
  const disclosure = firstString(payload, ["disclosure"], "");
  if (disclosure) byId("catalog-disclosure").textContent = disclosure;
  state.choices = catalogArrays(payload).map(normalizeChoice).filter(Boolean);
  const container = byId("catalog-choices");
  const status = byId("catalog-status");
  clearNode(container);
  if (!state.choices.length) {
    status.textContent = "No selectable catalog choices are available in this local environment.";
    byId("services-continue").disabled = true;
    return;
  }
  status.hidden = true;
  byId("services-continue").disabled = false;

  state.choices.forEach((choice, index) => {
    const card = element("div", "catalog-choice");
    const checkId = `service-choice-${index}`;
    const descriptionId = `service-description-${index}`;
    const control = element("label", "choice-control");
    const checkbox = document.createElement("input");
    checkbox.id = checkId;
    checkbox.type = "checkbox";
    checkbox.name = "serviceChoice";
    checkbox.value = String(index);
    checkbox.dataset.choiceIndex = String(index);
    checkbox.setAttribute("aria-describedby", descriptionId);
    const copy = element("span", "choice-copy");
    const titleRow = element("span", "choice-title-row");
    titleRow.append(element("strong", "choice-name", choice.name));
    titleRow.append(element("span", "choice-kind", choice.isPackage ? "Package" : "Service"));
    copy.append(titleRow, element("span", "choice-description", choice.description), element("span", "choice-amount", choice.amountLabel));
    control.append(checkbox, copy);

    const details = element("div", "choice-details");
    details.id = descriptionId;
    if (choice.requiresSquareFeet) details.append(element("p", "basis-note", "Uses the property square footage for the server calculation."));
    const quantityLabel = document.createElement("label");
    quantityLabel.setAttribute("for", `service-quantity-${index}`);
    quantityLabel.textContent = "Quantity";
    const quantity = document.createElement("input");
    quantity.id = `service-quantity-${index}`;
    quantity.type = "number";
    quantity.inputMode = "numeric";
    quantity.min = "1";
    quantity.max = choice.isPackage ? "1" : "99";
    quantity.step = "1";
    quantity.value = "1";
    quantity.disabled = true;
    quantity.readOnly = choice.isPackage;
    quantity.dataset.quantityIndex = String(index);
    quantityLabel.append(quantity);
    details.append(quantityLabel);
    card.append(control, details);
    container.append(card);
  });
}

function selectedServices() {
  return selectedChoiceViews()
    .filter(({ choice, quantity }) => choice && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 99)
    .map(({ choiceHandle, quantity }) => ({ choiceHandle, quantity }));
}

function selectedChoiceViews() {
  const selections = [];
  document.querySelectorAll('input[name="serviceChoice"]:checked').forEach((checkbox) => {
    const index = Number(checkbox.dataset.choiceIndex);
    const choice = state.choices[index];
    const quantityField = byId(`service-quantity-${index}`);
    const quantity = choice?.isPackage ? 1 : Number(quantityField?.value);
    if (choice) selections.push({ choiceHandle: choice.choiceHandle, quantity, choice });
  });
  return selections;
}

function buildPreviewRequest() {
  return {
    customer: readCustomer(),
    property: readProperty(),
    services: selectedServices().map(({ choiceHandle, quantity }) => ({ choiceHandle, quantity })),
  };
}

function extractPreviewReceipt(payload) {
  const candidates = [payload?.previewReceipt, payload?.preview?.previewReceipt, payload?.receipt?.previewReceipt];
  return candidates.find((value) => typeof value === "string" && value.length > 0) || null;
}

function moneyLabel(record) {
  if (!record || typeof record !== "object") return "";
  const direct = firstString(record, ["displayAmount", "formattedAmount", "amountLabel", "displayTotal", "formattedTotal"], "");
  if (direct) return direct;
  const minor = [
    record.totalAmountCents,
    record.lineAmountCents,
    record.unitAmountCents,
    record.subtotalCents,
    record.displayedPriceCents,
    record.totalMinor,
    record.amountMinor,
    record.extendedAmountMinor,
  ].find((value) => Number.isSafeInteger(value));
  const currency = firstString(record, ["currencyCode", "currency"], "USD");
  if (!Number.isSafeInteger(minor) || !/^[A-Z]{3}$/.test(currency)) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return "";
  }
}

function appendDefinition(list, term, value) {
  const wrapper = element("div", "definition-row");
  wrapper.append(element("dt", "", term), element("dd", "", value));
  list.append(wrapper);
}

function addressLabel(property) {
  const first = [property.addressLine1, property.addressLine2].map((value) => text(value, "")).filter(Boolean).join(", ");
  const second = [property.locality, property.administrativeArea, property.postalCode].map((value) => text(value, "")).filter(Boolean).join(" ");
  return [first, second, text(property.countryCode, "")].filter(Boolean).join(" · ");
}

function previewItems(payload) {
  const candidates = [payload?.services, payload?.items, payload?.preview?.services, payload?.preview?.items, payload?.order?.items, payload?.pricing?.items];
  return candidates.find(Array.isArray) || [];
}

function renderReview(payload) {
  const container = byId("review-content");
  clearNode(container);
  const customer = payload?.customer && typeof payload.customer === "object" ? payload.customer : readCustomer();
  const property = payload?.property && typeof payload.property === "object" ? payload.property : readProperty();

  const customerCard = element("section", "summary-card");
  customerCard.append(element("h3", "", "Customer"));
  const customerList = element("dl", "definition-list");
  appendDefinition(customerList, "Name", text(customer.displayName));
  appendDefinition(customerList, "Email", text(customer.email));
  customerCard.append(customerList);

  const propertyCard = element("section", "summary-card");
  propertyCard.append(element("h3", "", "Property"));
  const propertyList = element("dl", "definition-list");
  appendDefinition(propertyList, "Address", addressLabel(property));
  if (Number.isSafeInteger(property.squareFeet) && property.squareFeet > 0) appendDefinition(propertyList, "Square feet", new Intl.NumberFormat().format(property.squareFeet));
  propertyCard.append(propertyList);

  const servicesCard = element("section", "summary-card summary-card-wide");
  servicesCard.append(element("h3", "", "Services"));
  const list = element("ul", "review-services");
  const serverItems = previewItems(payload);
  selectedChoiceViews().forEach((selection, index) => {
    const serverItem = serverItems[index];
    const item = element("li", "review-service");
    const copy = element("div", "");
    copy.append(element("strong", "", firstString(serverItem, ["frozenName", "displayName", "name"], selection.choice?.name || "Selected service")));
    copy.append(element("span", "", `Quantity ${selection.quantity}`));
    item.append(copy);
    const amount = moneyLabel(serverItem);
    if (amount) item.append(element("span", "review-amount", amount));
    list.append(item);
  });
  servicesCard.append(list);
  const total = moneyLabel(payload?.totals || payload?.preview?.totals || payload?.pricing || payload);
  if (total) {
    const totalRow = element("div", "review-total");
    totalRow.append(element("span", "", "Server-calculated total"), element("strong", "", total));
    servicesCard.append(totalRow);
  }
  const expiresAt = firstString(payload, ["expiresAt"], "");
  if (expiresAt) {
    const parsed = new Date(expiresAt);
    servicesCard.append(element("p", "preview-expiry", Number.isNaN(parsed.valueOf()) ? `Preview expires ${expiresAt}` : `Preview expires ${parsed.toLocaleString()}`));
  }
  const disclosure = firstString(payload, ["disclosure"], "");
  if (disclosure) servicesCard.append(element("p", "preview-disclosure", disclosure));

  container.append(customerCard, propertyCard, servicesCard);
}

async function requestPreview() {
  if (state.previewing || state.creating) return;
  const selections = selectedChoiceViews();
  if (!selections.length) {
    showError("Select at least one package or service before continuing.", byId("catalog-choices"));
    return;
  }
  if (selections.length > 50) {
    showError("Select no more than 50 catalog choices for one listing.", byId("catalog-choices"));
    return;
  }
  const invalidQuantity = selections.find(({ quantity }) => !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99);
  if (invalidQuantity) {
    showError("Every individual service quantity must be a whole number from 1 to 99.");
    return;
  }
  if (selections.some(({ choice }) => choice?.requiresSquareFeet) && !readProperty().squareFeet) {
    showStep("property");
    showError("Add square feet because one of the selected packages uses square-foot pricing.", byId("square-feet"));
    byId("square-feet").focus();
    return;
  }

  state.previewing = true;
  const button = byId("services-continue");
  markBusy(button, true, "Preparing review…");
  try {
    const previewRequest = buildPreviewRequest();
    const preview = await fetchJson("/api/listings/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(previewRequest),
    });
    const receipt = extractPreviewReceipt(preview);
    if (!receipt) throw new Error("The server did not return a usable listing preview.");
    state.preview = preview;
    state.previewReceipt = receipt;
    renderReview(preview);
    showStep("review");
  } catch (error) {
    showError(error instanceof Error ? error.message : "The listing preview could not be prepared.");
  } finally {
    state.previewing = false;
    markBusy(button, false, "Preparing review…");
  }
}

function extractOrderId(payload) {
  const candidates = [payload?.orderId, payload?.receipt?.orderId, payload?.order?.orderId, payload?.confirmation?.orderId];
  return candidates.find((value) => typeof value === "string" && value.length > 0) || null;
}

function canonicalRecord(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload.confirmation || payload.canonicalOrder || payload.orderRecord || payload;
}

function confirmationItems(record) {
  const candidates = [record.items, record.order?.items, record.canonicalOrder?.items];
  return candidates.find(Array.isArray) || [];
}

function renderOutcomes(container, record) {
  const source = record.outcomes || record.reconciliation || {};
  const labels = [
    ["Customer", source.customer || source.customerOutcome || record.customerOutcome],
    ["Property", source.property || source.propertyOutcome || record.propertyOutcome],
    ["Property snapshot", source.propertySnapshot || source.propertySnapshotOutcome || record.propertySnapshotOutcome],
    ["Order", source.order || source.orderOutcome || record.orderOutcome],
  ];
  const usable = labels.filter(([, value]) => typeof value === "string" && value.trim() && !UUID_PATTERN.test(value.trim()));
  if (!usable.length) return;
  const section = element("section", "confirmation-section");
  section.append(element("h3", "", "Reconciliation outcomes"));
  const list = element("ul", "outcome-list");
  usable.forEach(([label, value]) => {
    const item = element("li", "");
    item.append(element("span", "", label), element("strong", "", text(value)));
    list.append(item);
  });
  section.append(list);
  container.append(section);
}

function renderConfirmation(payload) {
  const record = canonicalRecord(payload);
  const container = byId("confirmation-content");
  clearNode(container);

  const overview = element("section", "confirmation-section confirmation-overview");
  overview.append(element("h3", "", "Canonical order"));
  const definitions = element("dl", "definition-list");
  const order = record.order && typeof record.order === "object" ? record.order : record;
  const reference = firstString(order, ["displayReference", "orderNumber", "reference", "orderCode"], "Created");
  appendDefinition(definitions, "Order", reference);
  appendDefinition(definitions, "Status", firstString(order, ["status", "currentState", "current_state"], "Confirmed"));
  const customer = record.customer && typeof record.customer === "object" ? record.customer : {};
  const customerName = firstString(customer, ["displayName", "name"], "");
  if (customerName) appendDefinition(definitions, "Customer", customerName);
  const createdAt = firstString(order, ["createdAt", "created_at", "orderedAt"], "");
  if (createdAt) {
    const parsed = new Date(createdAt);
    appendDefinition(definitions, "Created", Number.isNaN(parsed.valueOf()) ? createdAt : parsed.toLocaleString());
  }
  const confirmedAt = firstString(record, ["confirmedAt"], "");
  if (confirmedAt) {
    const parsed = new Date(confirmedAt);
    appendDefinition(definitions, "Confirmed", Number.isNaN(parsed.valueOf()) ? confirmedAt : parsed.toLocaleString());
  }
  const property = record.propertySnapshot || record.property || {};
  const canonicalAddress = addressLabel({
    addressLine1: property.addressLine1 || property.address_line_1,
    addressLine2: property.addressLine2 || property.address_line_2,
    locality: property.locality,
    administrativeArea: property.administrativeArea || property.administrative_area,
    postalCode: property.postalCode || property.postal_code,
    countryCode: property.countryCode || property.country_code,
  });
  if (canonicalAddress) appendDefinition(definitions, "Property", canonicalAddress);
  overview.append(definitions);
  container.append(overview);

  const items = confirmationItems(record);
  if (items.length) {
    const itemsSection = element("section", "confirmation-section");
    itemsSection.append(element("h3", "", "Frozen order items"));
    const list = element("ul", "confirmation-items");
    items.forEach((itemRecord) => {
      const item = element("li", "");
      const copy = element("div", "");
      copy.append(element("strong", "", firstString(itemRecord, ["frozenName", "displayName", "name", "productName"], "Order item")));
      const quantity = Number(itemRecord.quantity);
      if (Number.isSafeInteger(quantity) && quantity > 0) copy.append(element("span", "", `Quantity ${quantity}`));
      item.append(copy);
      const amount = moneyLabel(itemRecord);
      if (amount) item.append(element("span", "confirmation-amount", amount));
      list.append(item);
    });
    itemsSection.append(list);
    const total = moneyLabel(record.totals || order.totals || order);
    if (total) {
      const totalRow = element("div", "confirmation-total");
      totalRow.append(element("span", "", "Confirmed total"), element("strong", "", total));
      itemsSection.append(totalRow);
    }
    container.append(itemsSection);
  }

  renderOutcomes(container, record);

  const nextStepMessage = firstString(record, ["nextStepMessage"], "");
  if (nextStepMessage) {
    const nextStep = element("section", "confirmation-section compact-section");
    nextStep.append(element("h3", "", "Canonical next step"), element("p", "", nextStepMessage));
    container.append(nextStep);
  }

  const disposition = firstString(record.payment || order, ["disposition", "paymentDisposition"], "");
  if (disposition.toUpperCase() === "PAY_NOW") {
    const payment = element("section", "confirmation-section compact-section");
    payment.append(element("h3", "", "Payment disposition"), element("p", "", "Pay now was recorded as an order disposition. No payment was processed by this console."));
    container.append(payment);
  }
}

async function createListing() {
  if (state.creating || state.previewing || !state.previewReceipt) return;
  state.creating = true;
  const createButton = byId("create-listing");
  createButton.disabled = true;
  showStep("create");
  byId("create-step").setAttribute("aria-busy", "true");
  try {
    if (!state.pendingOrderId) {
      const creation = await fetchJson("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewReceipt: state.previewReceipt }),
      });
      state.pendingOrderId = extractOrderId(creation);
      if (!state.pendingOrderId) throw new Error("The server did not return a canonical order reference.");
    }
    const confirmation = await fetchJson(`/api/orders/${encodeURIComponent(state.pendingOrderId)}`);
    renderConfirmation(confirmation);
    state.pendingOrderId = null;
    showStep("confirmation");
  } catch (error) {
    showStep("review");
    const message = state.pendingOrderId
      ? "The listing was created, but canonical confirmation could not be loaded. Use Reload confirmation; do not submit a second listing."
      : error instanceof Error
        ? error.message
        : "The listing could not be confirmed. Repeating this same bound action is replay-safe.";
    showError(message);
    createButton.textContent = state.pendingOrderId ? "Reload confirmation" : "Create listing";
    createButton.disabled = false;
  } finally {
    state.creating = false;
    byId("create-step").setAttribute("aria-busy", "false");
  }
}

async function initialize() {
  state.ready = false;
  const status = byId("startup-status");
  const retry = byId("retry-startup");
  const continueButton = byId("customer-continue");
  status.hidden = false;
  status.classList.remove("has-error");
  retry.hidden = true;
  continueButton.disabled = true;
  byId("startup-message").textContent = "Opening a private local operator session…";
  try {
    await fetchJson("/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const catalog = await fetchJson("/api/catalog");
    renderCatalog(catalog);
    state.ready = true;
    continueButton.disabled = false;
    status.hidden = true;
    announce("Local operator session and catalog are ready.");
  } catch (error) {
    status.classList.add("has-error");
    byId("startup-message").textContent = error instanceof Error ? error.message : "The local console is unavailable.";
    retry.hidden = false;
    retry.focus();
  }
}

function bindEvents() {
  byId("customer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.ready || !validForm(event.currentTarget)) return;
    state.preview = null;
    state.previewReceipt = null;
    state.pendingOrderId = null;
    showStep("property");
  });

  byId("property-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validForm(event.currentTarget)) return;
    state.preview = null;
    state.previewReceipt = null;
    state.pendingOrderId = null;
    showStep("services");
  });

  byId("services-form").addEventListener("submit", (event) => {
    event.preventDefault();
    requestPreview();
  });

  byId("catalog-choices").addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[name="serviceChoice"]');
    if (!checkbox) return;
    const quantity = byId(`service-quantity-${checkbox.dataset.choiceIndex}`);
    if (quantity) quantity.disabled = !checkbox.checked;
    checkbox.closest(".catalog-choice")?.classList.toggle("is-selected", checkbox.checked);
    state.preview = null;
    state.previewReceipt = null;
    hideError();
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.creating) return;
      state.preview = null;
      state.previewReceipt = null;
      state.pendingOrderId = null;
      showStep(button.dataset.back);
    });
  });

  document.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      if (!byId("error-summary").hidden) hideError();
      if (state.activeStep !== "confirmation") {
        state.preview = null;
        state.previewReceipt = null;
        state.pendingOrderId = null;
      }
    });
  });

  byId("create-listing").addEventListener("click", createListing);
  byId("retry-startup").addEventListener("click", initialize);
}

bindEvents();
initialize();
