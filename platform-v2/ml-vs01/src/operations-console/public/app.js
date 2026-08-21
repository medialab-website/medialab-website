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
  serviceMode: "PACKAGE",
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
    description: firstString(raw, ["description", "summary"], "Available for this property."),
    amountLabel: moneyLabel(raw) || (Array.isArray(raw.priceBrackets) && raw.priceBrackets.length === 1
      ? moneyLabel({ displayedPriceCents: raw.priceBrackets[0].amountCents, currencyCode: raw.priceBrackets[0].currencyCode }) : "Calculated at review"),
    isPackage: raw.isPackage === true || kind.includes("PACKAGE"),
    requiresSquareFeet: basis === "SQUARE_FEET" || raw.requiresSquareFeet === true,
    inclusions: Array.isArray(raw.inclusions) ? raw.inclusions : [],
    priceBrackets: Array.isArray(raw.priceBrackets) ? raw.priceBrackets : [],
  };
}

function isStandardPropertyPackage(choice) {
  return choice.isPackage && choice.inclusions.length > 0;
}

function propertyPackageOrder(choice) {
  const bracket = choice.priceBrackets[0];
  if (!bracket || bracket.basis !== "SQUARE_FEET") return Number.MAX_SAFE_INTEGER;
  return bracket.lowerBound === null ? 0 : Number(bracket.lowerBound);
}

function addOnGroup(choice) {
  const name = choice.name.toLowerCase();
  if (name === "3d video" || /gla report|cad files/.test(name)) return "CubiCasa & floor plans";
  if (/matterport/.test(name)) return "Matterport";
  if (/zillow/.test(name)) return "Zillow 3D Home";
  if (/video|agent intro/.test(name)) return "Video";
  return "Photo";
}

function packageRangeLabel(choice) {
  const bracket = choice.priceBrackets[0];
  if (!bracket) return choice.requiresSquareFeet ? "Square-foot pricing" : "Property package";
  if (bracket.basis !== "SQUARE_FEET") return "Land and non-home properties";
  const lower = bracket.lowerBound === null ? null : Number(bracket.lowerBound);
  const upper = bracket.upperBound === null ? null : Number(bracket.upperBound);
  if ((lower === null || lower <= 0) && upper !== null) return `${bracket.upperInclusive ? "Up to" : "Under"} ${upper.toLocaleString()} sq ft`;
  if (lower !== null && upper === null) return `Over ${lower.toLocaleString()} sq ft`;
  if (lower !== null && upper !== null) return `${lower.toLocaleString()}–${upper.toLocaleString()} sq ft`;
  return "Square-foot pricing";
}

function packageMatchesSquareFeet(choice, squareFeet) {
  const bracket = choice.priceBrackets.find((item) => item.basis === "SQUARE_FEET");
  if (!bracket || !Number.isSafeInteger(squareFeet) || squareFeet <= 0) return false;
  const lower = bracket.lowerBound === null ? null : Number(bracket.lowerBound);
  const upper = bracket.upperBound === null ? null : Number(bracket.upperBound);
  const lowerOk = lower === null || (bracket.lowerInclusive ? squareFeet >= lower : squareFeet > lower);
  const upperOk = upper === null || (bracket.upperInclusive ? squareFeet <= upper : squareFeet < upper);
  return lowerOk && upperOk;
}

function renderCatalogChoice(choice, index, compact = false) {
  const card = element("div", `catalog-choice${compact ? " is-compact" : ""}`);
  card.dataset.standardPackage = String(isStandardPropertyPackage(choice));
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
  titleRow.append(element("strong", "choice-name", choice.name), element("span", "choice-amount", choice.amountLabel));
  copy.append(titleRow);
  copy.append(element("span", "choice-description", isStandardPropertyPackage(choice) ? packageRangeLabel(choice) : choice.description));
  if (isStandardPropertyPackage(choice) && packageMatchesSquareFeet(choice, readProperty().squareFeet)) {
    copy.append(element("span", "recommended-chip", "Recommended for this square footage"));
  }
  control.append(checkbox, copy);

  const details = element("div", "choice-details");
  details.id = descriptionId;
  if (choice.inclusions.length) {
    const inclusion = document.createElement("details"); inclusion.className = "package-inclusions";
    const summary = document.createElement("summary"); summary.textContent = "What’s included"; inclusion.append(summary);
    const list = element("ul", ""); choice.inclusions.forEach((item) => list.append(element("li", "", `${item.displayName} × ${item.quantity}`)));
    inclusion.append(list); details.append(inclusion);
  }
  const quantityLabel = document.createElement("label");
  quantityLabel.className = `choice-quantity${choice.isPackage ? " is-fixed" : ""}`;
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
  return card;
}

function updateServiceMode() {
  document.querySelectorAll("[data-service-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.serviceMode === state.serviceMode)));
  const packages = byId("standard-package-section");
  if (packages) packages.hidden = state.serviceMode !== "PACKAGE";
  const addOns = byId("add-on-section");
  const selectedPackage = document.querySelector('.catalog-choice[data-standard-package="true"] input[name="serviceChoice"]:checked');
  if (addOns) addOns.hidden = state.serviceMode === "PACKAGE" && !selectedPackage;
  const addOnHeading = byId("add-on-heading");
  if (addOnHeading) addOnHeading.textContent = state.serviceMode === "PACKAGE" ? "2. Add anything else" : "Choose the services needed";
  const prompt = byId("add-on-prompt");
  if (prompt) prompt.hidden = state.serviceMode !== "PACKAGE" || Boolean(selectedPackage);
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

  const path = element("div", "service-path");
  path.append(element("p", "service-path-title", "How would you like to start?"));
  const pathButtons = element("div", "service-path-buttons");
  [["PACKAGE", "Choose a property package"], ["A_LA_CARTE", "Choose à la carte"]].forEach(([value, label]) => {
    const button = element("button", "service-path-button", label); button.type = "button"; button.dataset.serviceMode = value;
    button.addEventListener("click", () => {
      state.serviceMode = value;
      if (value === "A_LA_CARTE") {
        document.querySelectorAll('.catalog-choice[data-standard-package="true"] input[name="serviceChoice"]:checked').forEach((checkbox) => {
          checkbox.checked = false; checkbox.closest(".catalog-choice")?.classList.remove("is-selected");
        });
      }
      state.preview = null; state.previewReceipt = null; updateServiceMode();
    }); pathButtons.append(button);
  });
  path.append(pathButtons); container.append(path);

  const packageSection = element("section", "catalog-section"); packageSection.id = "standard-package-section";
  packageSection.append(element("h3", "", "1. Choose the property package"), element("p", "section-intro", "Home packages are matched to square footage. Choose Land Package for land-only work."));
  const packageGrid = element("div", "package-grid");
  state.choices.map((choice, index) => ({ choice, index })).filter(({ choice }) => isStandardPropertyPackage(choice))
    .sort((left, right) => propertyPackageOrder(left.choice) - propertyPackageOrder(right.choice))
    .forEach(({ choice, index }) => packageGrid.append(renderCatalogChoice(choice, index)));
  packageSection.append(packageGrid); container.append(packageSection);

  const addOnPrompt = element("p", "add-on-prompt", "Choose a property package to reveal its add-ons."); addOnPrompt.id = "add-on-prompt"; container.append(addOnPrompt);
  const addOnSection = element("section", "catalog-section"); addOnSection.id = "add-on-section";
  const addOnHeading = element("h3", "", "2. Add anything else"); addOnHeading.id = "add-on-heading";
  addOnSection.append(addOnHeading, element("p", "section-intro", "Open only the group you need. Quantities can be adjusted for individual services."));
  const groups = ["Video", "Photo", "Matterport", "Zillow 3D Home", "CubiCasa & floor plans"];
  groups.forEach((groupName) => {
    const choices = state.choices.map((choice, index) => ({ choice, index })).filter(({ choice }) => !isStandardPropertyPackage(choice) && addOnGroup(choice) === groupName);
    if (!choices.length) return;
    const group = document.createElement("details"); group.className = "add-on-group";
    const summary = document.createElement("summary"); summary.append(element("span", "", groupName), element("span", "group-count", `${choices.length} option${choices.length === 1 ? "" : "s"}`)); group.append(summary);
    const grid = element("div", "add-on-grid"); choices.forEach(({ choice, index }) => grid.append(renderCatalogChoice(choice, index, true))); group.append(grid); addOnSection.append(group);
  });
  container.append(addOnSection); updateServiceMode();
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
  const operationsLink = byId("open-order-operations");
  const canonicalOrderId = extractOrderId(record);
  if (operationsLink && canonicalOrderId) operationsLink.href = `/operations?queue=attention&orderId=${encodeURIComponent(canonicalOrderId)}`;
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
    if (state.catalog) renderCatalog(state.catalog);
    showStep("services");
  });

  byId("services-form").addEventListener("submit", (event) => {
    event.preventDefault();
    requestPreview();
  });

  byId("catalog-choices").addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[name="serviceChoice"]');
    if (!checkbox) return;
    const choice = state.choices[Number(checkbox.dataset.choiceIndex)];
    if (checkbox.checked && isStandardPropertyPackage(choice)) {
      document.querySelectorAll('.catalog-choice[data-standard-package="true"] input[name="serviceChoice"]:checked').forEach((other) => {
        if (other !== checkbox) { other.checked = false; other.closest(".catalog-choice")?.classList.remove("is-selected"); }
      });
    }
    const quantity = byId(`service-quantity-${checkbox.dataset.choiceIndex}`);
    if (quantity) quantity.disabled = !checkbox.checked;
    checkbox.closest(".catalog-choice")?.classList.toggle("is-selected", checkbox.checked);
    state.preview = null;
    state.previewReceipt = null;
    hideError();
    updateServiceMode();
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

const operationsState = { queue: "attention", home: null, selectedOrderId: null, candidates: [] };

function operationsError(message) {
  byId("operations-error-message").textContent = message;
  byId("operations-error").hidden = false;
  byId("operations-error").focus();
}

function operationsSuccess(message) {
  byId("operations-success-message").textContent = message;
  byId("operations-success").hidden = false;
  announce(message);
}

function clearOperationsSuccess() { byId("operations-success").hidden = true; }

function operationsAddress(context) {
  return [context.property.addressLine1, context.property.addressLine2, context.property.locality,
    context.property.administrativeArea].filter(Boolean).join(", ");
}

function attentionLabel(code) {
  return ({
    OPERATIONAL_CONTEXT_NOT_STARTED: "Setup needed",
    SCHEDULING_WINDOW_NEEDED: "Scheduling window needed",
    APPOINTMENT_NOT_CONFIRMED: "Appointment not confirmed",
    PRIMARY_OPERATOR_UNASSIGNED: "Primary operator unassigned",
    JOB_BLOCKED: "Job blocked",
    WORKSTREAM_BLOCKED: "Service blocked",
  })[code] || "Needs attention";
}

function operationalDateTime(localStartsAt, ianaTimezone) {
  const local = String(localStartsAt || "").replace(" ", "T");
  const parsed = new Date(`${local.slice(0, 19)}Z`);
  if (Number.isNaN(parsed.valueOf())) return `${localStartsAt} · ${ianaTimezone}`;
  // UTC formatting preserves the canonical local wall clock instead of applying the viewer's browser timezone.
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric",
    minute: "2-digit", hour12: true, timeZone: "UTC" }).format(parsed)
    .replace(/\s+at\s+/u, " · ").replace(/\bAM\b/u, "a.m.").replace(/\bPM\b/u, "p.m.");
}

function queueItems() {
  const sections = operationsState.home?.sections;
  if (!sections) return [];
  if (operationsState.queue === "attention") return sections.needsAttention;
  if (operationsState.queue === "completed") return (operationsState.home.items || []).filter((item) => item.job?.state === "COMPLETED");
  if (operationsState.queue === "today") return sections.today.filter((item) => item.job?.state !== "COMPLETED");
  return sections.upcoming.filter((item) => item.job?.state !== "COMPLETED");
}

function renderOperationsQueue() {
  const counts = operationsState.home?.counts || { today: 0, upcoming: 0, needsAttention: 0 };
  byId("today-count").textContent = String((operationsState.home?.sections.today || []).filter((item) => item.job?.state !== "COMPLETED").length);
  byId("upcoming-count").textContent = String((operationsState.home?.sections.upcoming || []).filter((item) => item.job?.state !== "COMPLETED").length);
  byId("attention-count").textContent = String(counts.needsAttention);
  byId("completed-count").textContent = String((operationsState.home?.items || []).filter((item) => item.job?.state === "COMPLETED").length);
  byId("queue-heading").textContent = operationsState.queue === "attention" ? "Needs attention" :
    operationsState.queue === "upcoming" ? "Upcoming" : operationsState.queue === "completed" ? "Completed" : "Today";
  const list = byId("operations-list"); clearNode(list);
  const items = queueItems();
  if (!items.length) {
    const empty = element("div", "queue-empty");
    empty.append(element("strong", "", "Nothing here right now"), element("p", "", "Choose another view or refresh the queue."));
    list.append(empty); return;
  }
  items.forEach((item) => {
    const button = element("button", `operation-card${operationsState.selectedOrderId === item.orderId ? " is-selected" : ""}`);
    button.type = "button"; button.dataset.orderId = item.orderId;
    const top = element("span", "operation-card-top");
    top.append(element("strong", "", operationsAddress(item)),
      element("span", "appointment-time", item.appointment ? operationalDateTime(item.appointment.localStartsAt, item.appointment.ianaTimezone) : "Not scheduled"));
    const services = item.services.map((service) => service.displayName).join(" · ");
    button.append(top, element("span", "operation-address", item.customer.displayName || "Customer"), element("span", "operation-services", services));
    if (item.attention.length) {
      const alerts = element("span", "operation-alerts");
      item.attention.slice(0, 2).forEach((code) => alerts.append(element("span", "attention-chip", attentionLabel(code))));
      button.append(alerts);
    }
    list.append(button);
  });
}

function detailSection(title, copy) {
  const section = element("section", "detail-section"); section.append(element("h4", "", title));
  if (copy) section.append(element("p", "detail-copy", copy)); return section;
}

function field(label, type, name, value = "", required = true) {
  const wrapper = element("label", "operation-field"); wrapper.append(element("span", "", label));
  const input = document.createElement("input"); input.type = type; input.name = name; input.value = value; input.required = required;
  wrapper.append(input); return wrapper;
}

function selectField(label, name, choices) {
  const wrapper = element("label", "operation-field"); wrapper.append(element("span", "", label));
  const select = document.createElement("select"); select.name = name; select.required = true;
  choices.forEach(([value, display]) => { const option = document.createElement("option"); option.value = value; option.textContent = display; select.append(option); });
  wrapper.append(select); return wrapper;
}

function actionButton(label) { const button = element("button", "button button-primary", label); button.type = "submit"; return button; }

async function runOperation(path, body, button, options = {}) {
  markBusy(button, true, "Saving…"); byId("operations-error").hidden = true; clearOperationsSuccess();
  try {
    const receipt = await fetchJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    operationsState.selectedOrderId = receipt.context.orderId;
    await loadOperationsHome(false);
    if (!queueItems().some((item) => item.orderId === receipt.context.orderId)) {
      const destinations = ["attention", "today", "upcoming", "completed"];
      const destination = destinations.find((queue) => { operationsState.queue = queue; return queueItems().some((item) => item.orderId === receipt.context.orderId); });
      if (!destination) operationsState.queue = "attention";
      document.querySelectorAll("[data-queue]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.queue === operationsState.queue)));
      renderOperationsQueue();
    }
    await openOperationsDetail(receipt.context.orderId);
    operationsSuccess(options.message || "Operational change saved.");
  } catch (error) { operationsError(error instanceof Error ? error.message : "The operational change could not be saved."); }
  finally { markBusy(button, false, "Saving…"); }
}

function openOperationsDialog(heading, contentNode, confirmLabel, onConfirm) {
  const dialog = byId("operations-dialog"); byId("operations-dialog-heading").textContent = heading;
  const content = byId("operations-dialog-content"); const actions = byId("operations-dialog-actions"); clearNode(content); clearNode(actions);
  content.append(contentNode);
  const cancel = element("button", "button button-secondary", "Not yet"); cancel.type = "button"; cancel.addEventListener("click", () => dialog.close());
  const confirm = element("button", "button button-primary", confirmLabel); confirm.type = "button";
  confirm.addEventListener("click", () => { dialog.close(); onConfirm(confirm); }); actions.append(cancel, confirm); dialog.showModal();
}

function schedulingForm(context) {
  const section = detailSection("Scheduling", "Add a customer-requested window or a staff alternate. Times retain both instant and local timezone evidence.");
  if (context.scheduling?.state === "REQUESTED") {
    const form = element("form", "operation-form");
    const kind = selectField("Window type", "kind", [["REQUESTED", "Customer requested"], ["STAFF_PROPOSED", "Staff alternate"]]);
    form.append(kind, field("Starts", "datetime-local", "startsAt"), field("Ends", "datetime-local", "endsAt"), field("Reason for staff alternate", "text", "reason", "", false), actionButton("Add window"));
    form.addEventListener("submit", (event) => {
      event.preventDefault(); const data = new FormData(form); const starts = String(data.get("startsAt")); const ends = String(data.get("endsAt"));
      const kindValue = String(data.get("kind")); const body = { startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(),
        ianaTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", localStartsAt: starts, localEndsAt: ends };
      const button = form.querySelector("button");
      if (kindValue === "STAFF_PROPOSED") { body.reason = String(data.get("reason") || "Staff proposed an operational alternate").trim();
        runOperation(`/api/operations/orders/${context.orderId}/scheduling/${context.scheduling.requestId}/proposed-windows`, body, button); }
      else runOperation(`/api/operations/orders/${context.orderId}/scheduling/${context.scheduling.requestId}/requested-windows`, body, button);
    });
    section.append(form);
  } else {
    section.append(element("p", "state-note", `This scheduling request is ${String(context.scheduling?.state || "closed").toLowerCase()}.`));
  }
  if (context.scheduling?.windows.length) {
    const windows = element("div", "window-list");
    context.scheduling.windows.forEach((windowRecord) => {
      const row = element("div", "window-row");
      row.append(element("span", "", `${windowRecord.kind === "REQUESTED" ? "Requested" : "Staff alternate"} · ${operationalDateTime(windowRecord.localStartsAt, windowRecord.ianaTimezone)}`));
      if (!context.appointment && windowRecord.kind === "REQUESTED") {
        const confirm = element("button", "button button-secondary button-compact", "Confirm"); confirm.type = "button";
        confirm.addEventListener("click", () => openOperationsDialog("Confirm this appointment", element("p", "", `${operationalDateTime(windowRecord.localStartsAt, windowRecord.ianaTimezone)} will become the canonical appointment.`), "Confirm time", (dialogButton) =>
          runOperation(`/api/operations/orders/${context.orderId}/scheduling/${context.scheduling.requestId}/confirm`,
            { windowId: windowRecord.windowId, reason: "Requested operational window confirmed" }, dialogButton,
            { tab: "crew", message: "Appointment confirmed. Crew and services are ready." }))); row.append(confirm);
      }
      if (!context.appointment && windowRecord.kind === "STAFF_PROPOSED") {
        if (windowRecord.accepted) {
          const confirm = element("button", "button button-secondary button-compact", "Confirm accepted time"); confirm.type = "button";
          confirm.addEventListener("click", () => openOperationsDialog("Confirm the accepted time", element("p", "", `${operationalDateTime(windowRecord.localStartsAt, windowRecord.ianaTimezone)} will become the canonical appointment.`), "Confirm time", (dialogButton) =>
            runOperation(`/api/operations/orders/${context.orderId}/scheduling/${context.scheduling.requestId}/confirm`,
              { windowId: windowRecord.windowId, reason: "Accepted staff alternate confirmed" }, dialogButton,
              { tab: "crew", message: "Appointment confirmed. Crew and services are ready." }))); row.append(confirm);
        } else {
          const acceptance = element("button", "button button-secondary button-compact", "Record acceptance"); acceptance.type = "button";
          acceptance.addEventListener("click", () => {
            const fields = element("div", "operation-form");
            const method = selectField("Acceptance recorded by", "acceptanceMethod", [["PHONE", "Phone"], ["TEXT", "Text"], ["EMAIL", "Email"], ["IN_PERSON", "In person"], ["OTHER", "Other"]]);
            const note = field("Acceptance note", "text", "note", "", false); fields.append(element("p", "operation-field-wide", operationalDateTime(windowRecord.localStartsAt, windowRecord.ianaTimezone)), method, note);
            openOperationsDialog("Record customer acceptance", fields, "Record acceptance", (dialogButton) => {
              const noteValue = note.querySelector("input").value.trim(); const payload = { windowId: windowRecord.windowId,
                acceptanceMethod: method.querySelector("select").value }; if (noteValue) payload.note = noteValue;
              runOperation(`/api/operations/orders/${context.orderId}/scheduling/${context.scheduling.requestId}/accept-proposal`, payload, dialogButton,
                { tab: "schedule", message: "Customer acceptance recorded. Confirm the accepted time when ready." });
            });
          });
          row.append(acceptance);
        }
      }
      windows.append(row);
    }); section.append(windows);
  }
  return section;
}

function appointmentSection(context) {
  if (!context.appointment) return null;
  const appointment = context.appointment;
  if (!["CONFIRMED", "WEATHER_DELAYED"].includes(appointment.state)) {
    return element("p", "state-note", "This appointment is closed; appointment and crew controls are unavailable.");
  }
  const actions = element("div", "compact-actions");
  const cancel = element("button", "button button-secondary button-compact", "Cancel appointment"); cancel.type = "button";
  cancel.addEventListener("click", () => openOperationsDialog("Cancel this appointment?",
    element("p", "", "This will cancel the confirmed appointment. The order will remain in Mission Control for follow-up."),
    "Cancel appointment", (dialogButton) => runOperation(
      `/api/operations/orders/${context.orderId}/appointments/${appointment.appointmentId}/cancel`,
      { reason: "Cancelled from Mission Control after operator confirmation" }, dialogButton)));
  const rescheduleDetails = document.createElement("details"); rescheduleDetails.className = "inline-editor";
  const rescheduleSummary = document.createElement("summary"); rescheduleSummary.className = "button button-secondary button-compact"; rescheduleSummary.textContent = "Reschedule";
  const reschedule = element("form", "operation-form");
  reschedule.append(field("New start", "datetime-local", "startsAt"), field("New end", "datetime-local", "endsAt"),
    selectField("Customer acceptance", "acceptanceMethod", [["PHONE", "Phone"], ["TEXT", "Text"], ["EMAIL", "Email"], ["IN_PERSON", "In person"], ["OTHER", "Other"]]),
    field("Reason", "text", "reason"), field("Acceptance note", "text", "note"), actionButton("Reschedule"));
  reschedule.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(reschedule); const starts = String(data.get("startsAt")); const ends = String(data.get("endsAt"));
    const note = String(data.get("note") || "").trim(); const payload = { startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(),
      ianaTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", localStartsAt: starts, localEndsAt: ends,
      acceptanceMethod: String(data.get("acceptanceMethod")), reason: String(data.get("reason")) }; if (note) payload.note = note;
    runOperation(`/api/operations/orders/${context.orderId}/appointments/${appointment.appointmentId}/reschedule`, payload, reschedule.querySelector("button")); });
  rescheduleDetails.append(rescheduleSummary, reschedule); actions.append(rescheduleDetails, cancel); return actions;
}

function assignmentSection(context) {
  if (!context.appointment || !["CONFIRMED", "WEATHER_DELAYED"].includes(context.appointment.state)) return null;
  const section = element("div", "");
  const candidateChoices = operationsState.candidates.map((person) => [person.personId, `${person.displayName}${person.title ? ` · ${person.title}` : ""}`]);
  const assigned = context.appointment.assignments;
  const summary = element("div", "info-list");
  if (assigned.length) assigned.forEach((assignment) => summary.append(element("p", "", `${assignment.displayName} · ${assignment.operationalRole.toLowerCase().replaceAll("_", " ")}`)));
  else summary.append(element("p", "state-note", "No crew assigned yet."));
  section.append(summary);
  const editor = document.createElement("details"); editor.className = "inline-editor";
  const editorSummary = document.createElement("summary"); editorSummary.className = "button button-secondary button-compact";
  editorSummary.textContent = assigned.length ? "Edit crew" : "Assign"; editor.append(editorSummary);
  const form = element("form", "operation-form");
  form.append(selectField("Crew member", "personId", candidateChoices), selectField("Role", "operationalRole", [
    ["PRIMARY_OPERATOR", "Primary operator"], ["ADDITIONAL_OPERATOR", "Additional operator"], ["COORDINATOR", "Coordinator"]]), actionButton("Assign crew"));
  form.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(form);
    runOperation(`/api/operations/orders/${context.orderId}/appointments/${context.appointment.appointmentId}/assignments`, { personId: String(data.get("personId")), operationalRole: String(data.get("operationalRole")) }, form.querySelector("button"),
      { message: "Crew assignment saved." }); });
  editor.append(form);
  assigned.forEach((assignment) => {
    const row = element("form", "assignment-row"); row.append(element("div", "", `${assignment.displayName} · ${attentionLabel(assignment.operationalRole).replace("Needs attention", assignment.operationalRole.toLowerCase().replaceAll("_", " "))}`));
    row.append(selectField("Replacement", "replacementPersonId", candidateChoices), field("Reason", "text", "reason"), actionButton("Replace"));
    row.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(row);
      runOperation(`/api/operations/orders/${context.orderId}/appointments/${context.appointment.appointmentId}/assignments/${assignment.assignmentId}/replace`,
        { replacementPersonId: String(data.get("replacementPersonId")), reason: String(data.get("reason")) }, row.querySelector("button"),
        { message: "Crew replacement saved." }); });
    editor.append(row);
  }); section.append(editor); return section;
}

function textareaField(label, name, value, rows = 4) {
  const wrapper = element("label", "operation-field operation-field-wide"); wrapper.append(element("span", "", label));
  const textarea = document.createElement("textarea"); textarea.name = name; textarea.value = value; textarea.rows = rows;
  textarea.maxLength = 5000; textarea.required = true; wrapper.append(textarea); return wrapper;
}

async function runMissionPlan(path, body, button, context, pane, busyLabel = "Saving…") {
  markBusy(button, true, busyLabel); byId("operations-error").hidden = true; clearOperationsSuccess();
  try {
    await fetchJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await loadMissionPlanPane(context, pane); operationsSuccess("Mission Plan change saved.");
  } catch (error) { operationsError(error instanceof Error ? error.message : "The Mission Plan change could not be saved."); }
  finally { markBusy(button, false, busyLabel); }
}

function directionsUrl(context) {
  const destination = [context.property.addressLine1, context.property.addressLine2, context.property.locality,
    context.property.administrativeArea, context.property.postalCode].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

async function downloadMissionPlanPacket(context, plan, version) {
  const response = await fetch(`/api/operations/orders/${context.orderId}/mission-plans/${plan.mission_plan_id}/offline-packet`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId: version.mission_plan_version_id }),
  });
  if (!response.ok) { const failure = await response.json(); throw new Error(failure?.error?.message || "The offline packet could not be prepared."); }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `medialab-mission-plan-v${version.version_number}.html`; document.body.append(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

async function downloadMissionPlan(context, plan, version, button) {
  markBusy(button, true, "Preparing…");
  try { await downloadMissionPlanPacket(context, plan, version); announce("Offline Mission Plan downloaded."); }
  catch (error) { operationsError(error instanceof Error ? error.message : "The offline packet could not be prepared."); }
  finally { markBusy(button, false, "Preparing…"); }
}

async function saveMissionPlanOffline(context, plan, latest, button, pane) {
  markBusy(button, true, "Saving…"); byId("operations-error").hidden = true; clearOperationsSuccess();
  try {
    let downloadablePlan = plan; let downloadableVersion = latest;
    if (!downloadableVersion) {
      const receipt = await fetchJson(`/api/operations/orders/${context.orderId}/mission-plans/${plan.mission_plan_id}/issue`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      });
      downloadablePlan = receipt.plan; downloadableVersion = downloadablePlan.versions.at(-1);
    }
    if (!downloadableVersion) throw new Error("Save this Mission Plan as a version before using it offline.");
    await downloadMissionPlanPacket(context, downloadablePlan, downloadableVersion);
    await loadMissionPlanPane(context, pane); operationsSuccess("Mission Plan saved for offline use.");
  } catch (error) { operationsError(error instanceof Error ? error.message : "The offline Mission Plan could not be saved."); }
  finally { markBusy(button, false, "Saving…"); }
}

function missionPlanEditor(context, workspace, pane) {
  const plan = workspace.plan;
  const controls = workspace.controls;
  if (!plan) {
    const section = detailSection("Mission Plan", workspace.readiness === "READY"
      ? "Generate a clean, offline-ready plan from the confirmed appointment, crew, property, and ordered services."
      : "Confirm the appointment and its Job relationship before creating a Mission Plan.");
    if (workspace.readiness === "READY") {
      const create = actionButton("Generate Mission Plan");
      create.addEventListener("click", () => runMissionPlan(`/api/operations/orders/${context.orderId}/mission-plan`, {}, create, context, pane, "Creating…"));
      section.append(create);
    }
    pane.append(section); return;
  }

  const latest = plan.versions.at(-1);
  const status = detailSection("Mission Plan", `${plan.draft ? "Ready to use" : "No active draft"} · ${plan.versions.length} saved version${plan.versions.length === 1 ? "" : "s"}`);
  const statusRow = element("div", "mission-status-row");
  statusRow.append(element("span", `mission-state ${latest ? "is-issued" : "is-draft"}`, latest ? `Latest issued · v${latest.version_number}` : "Draft only"));
  if (plan.draft) {
    const refresh = element("button", "button button-secondary button-compact", "Refresh Mission Plan"); refresh.type = "button";
    refresh.addEventListener("click", () => runMissionPlan(`/api/operations/orders/${context.orderId}/mission-plans/${plan.mission_plan_id}/refresh`, {}, refresh, context, pane, "Refreshing…"));
    statusRow.append(refresh);
  }
  const offline = element("button", "button button-primary button-compact", "Save Mission Plan Offline"); offline.type = "button";
  offline.addEventListener("click", () => saveMissionPlanOffline(context, plan, latest, offline, pane)); statusRow.append(offline);
  status.append(statusRow); pane.append(status);

  if (controls?.stale) {
    const stale = detailSection("Source changes need review", "The appointment, crew, contacts, or services changed after this draft was last refreshed. Refresh sources before issuing.");
    stale.classList.add("mission-stale"); pane.append(stale);
  }

  if (plan.draft) {
    const accordions = element("div", "mission-accordions");
    const weather = document.createElement("details"); weather.className = "mission-accordion";
    const weatherSummary = document.createElement("summary"); weatherSummary.textContent = "Weather";
    weather.append(weatherSummary, element("p", "", plan.draft.weather_status === "AVAILABLE"
      ? "Canonical weather evidence is attached." : "Live weather is not connected in this nonproduction build.")); accordions.append(weather);
    plan.draft.content.sections.forEach((section) => {
      const item = document.createElement("details"); item.className = "mission-accordion";
      const summary = document.createElement("summary"); summary.textContent = section.label;
      const content = element("p", "mission-accordion-content", section.content); item.append(summary, content); accordions.append(item);
    }); pane.append(accordions);

    const editDetails = document.createElement("details"); editDetails.className = "mission-edit-details";
    const editSummary = document.createElement("summary"); editSummary.textContent = "Edit Mission Plan";
    const editContent = element("div", ""); editDetails.append(editSummary, editContent); pane.append(editDetails);
    const editor = detailSection("Mission Plan sections", "Refine the plan only when the generated information needs an exception or clarification.");
    const form = element("form", "mission-editor");
    plan.draft.content.sections.forEach((section, index) => {
      const card = element("div", "mission-section-card");
      const title = element("div", "mission-section-heading"); title.append(element("strong", "", section.label), element("span", "visibility-chip", section.visibility.replaceAll("_", " ")));
      const label = field("Section title", "text", `label-${index}`, section.label); label.querySelector("input").maxLength = 120;
      const visibility = selectField("Visibility", `visibility-${index}`, [
        ["ASSIGNED_CREW_ONLY", "Assigned crew"], ["POTENTIALLY_CUSTOMER_VISIBLE", "Potentially customer visible"], ["INTERNAL_STAFF_ONLY", "Internal staff only"],
      ]); visibility.querySelector("select").value = section.visibility;
      card.append(title, label, visibility, textareaField("Content", `content-${index}`, section.content, 4)); form.append(card);
    });
    const issueRow = element("div", "mission-actions"); const save = actionButton("Save draft");
    const issue = element("button", "button button-secondary", "Save Mission Plan version"); issue.type = "button";
    issueRow.append(save, issue); form.append(issueRow);
    form.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(form);
      const sections = plan.draft.content.sections.map((_section, index) => ({ label: String(data.get(`label-${index}`)),
        content: String(data.get(`content-${index}`)), visibility: String(data.get(`visibility-${index}`)) }));
      runMissionPlan(`/api/operations/orders/${context.orderId}/mission-plans/${plan.mission_plan_id}/revise`, { sections }, save, context, pane); });
    issue.addEventListener("click", () => runMissionPlan(`/api/operations/orders/${context.orderId}/mission-plans/${plan.mission_plan_id}/issue`, {}, issue, context, pane, "Issuing…"));
    editor.append(form); editContent.append(editor);

    const notes = detailSection("Add a Mission Plan note", "Notes become part of the next saved version.");
    const noteForm = element("form", "operation-form mission-note-form");
    noteForm.append(selectField("Visibility", "visibility", [["ASSIGNED_CREW_ONLY", "Assigned crew"], ["POTENTIALLY_CUSTOMER_VISIBLE", "Potentially customer visible"], ["INTERNAL_STAFF_ONLY", "Internal staff only"]]),
      textareaField("Note", "note", "", 3), actionButton("Add note"));
    noteForm.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(noteForm);
      runMissionPlan(`/api/operations/orders/${context.orderId}/mission-plans/${plan.mission_plan_id}/notes`,
        { visibility: String(data.get("visibility")), note: String(data.get("note")) }, noteForm.querySelector("button"), context, pane); });
    notes.append(noteForm); editContent.append(notes);
    if (controls?.notes.length) {
      const history = element("div", "mission-note-list"); controls.notes.forEach((note) => {
        const row = element("div", "mission-note-row"); row.append(element("span", "visibility-chip", note.visibility.replaceAll("_", " ")),
          element("p", "", note.text)); history.append(row); }); notes.append(history);
    }
  }

  if (plan.versions.length) {
    const history = detailSection("Saved Mission Plan versions", "Saved versions remain immutable and available offline.");
    const list = element("div", "mission-version-list");
    [...plan.versions].reverse().forEach((version, index) => {
      const row = element("div", "mission-version-row");
      const copy = element("div", ""); copy.append(element("strong", "", `Version ${version.version_number}`),
        element("span", "mission-version-meta", new Date(version.issued_at).toLocaleString())); row.append(copy);
      const actions = element("div", "mission-version-actions"); const download = element("button", "button button-secondary button-compact", "Offline packet"); download.type = "button";
      download.addEventListener("click", () => downloadMissionPlan(context, plan, version, download)); actions.append(download);
      if (index === 0) { const supersede = element("button", "button button-secondary button-compact", "Revise from this version"); supersede.type = "button";
        supersede.addEventListener("click", () => runMissionPlan(`/api/operations/orders/${context.orderId}/mission-plans/${plan.mission_plan_id}/supersede`,
          { versionId: version.mission_plan_version_id }, supersede, context, pane, "Opening…")); actions.append(supersede); }
      row.append(actions); list.append(row);
    }); history.append(list); pane.append(history);
  }
}

async function loadMissionPlanPane(context, pane) {
  clearNode(pane); const loading = detailSection("Mission Plan", "Loading the canonical Mission Plan…"); pane.append(loading);
  try {
    const workspace = await fetchJson(`/api/operations/orders/${context.orderId}/mission-plan`); clearNode(pane); missionPlanEditor(context, workspace, pane);
  } catch (error) { clearNode(pane); pane.append(detailSection("Mission Plan unavailable", error instanceof Error ? error.message : "The Mission Plan could not be loaded.")); }
}

function productionCount(label, value, detail) {
  const item = element("div", "production-count");
  item.append(element("span", "summary-label", label), element("strong", "", String(value)), element("small", "", detail));
  return item;
}

function productionLaneCard(lane) {
  const card = element("article", `production-lane-card lane-${lane.lane.toLowerCase()}`);
  const heading = element("div", "production-lane-heading");
  const title = element("div", ""); title.append(element("p", "eyebrow", `${lane.lane} lane`),
    element("h4", "", lane.lane === "PHOTO" ? "Listing photos" : "Listing video"));
  heading.append(title, element("span", `production-stage stage-${lane.stage.toLowerCase()}`, lane.stageLabel));
  card.append(heading);
  if (lane.workstreams.length) {
    const workstreams = element("ul", "production-workstreams");
    lane.workstreams.forEach((workstream) => workstreams.append(element("li", "", workstream.displayName)));
    card.append(workstreams);
  } else {
    card.append(element("p", "production-muted", lane.expected
      ? "Canonical lane evidence exists without a selected Mission Plan workstream."
      : "This lane is not part of the current issued Mission Plan."));
  }
  const counts = element("div", "production-counts");
  counts.append(
    productionCount("Ingest", lane.capture.sessionCount, lane.capture.sessionCount ? lane.capture.states.join(" · ") : "Not started"),
    productionCount("Cull", lane.cull.workspaceCount, lane.cull.currentState ? lane.cull.currentState.replaceAll("_", " ") : "Not started"),
    productionCount("Handoff", lane.handoff.batchCount, lane.handoff.currentState ? lane.handoff.currentState.replaceAll("_", " ") : "Not started"),
    productionCount("Review", lane.review.batchCount, lane.review.currentState ? lane.review.currentState.replaceAll("_", " ") : "Not started"),
  );
  card.append(counts);
  const next = element("div", "production-next"); next.append(element("span", "summary-label", "Next action"), element("p", "", lane.nextAction)); card.append(next);
  if (lane.exceptions.length) {
    const exceptions = element("div", "production-exceptions"); exceptions.append(element("strong", "", "Needs attention"));
    lane.exceptions.forEach((message) => exceptions.append(element("p", "", message))); card.append(exceptions);
  }
  return card;
}

async function downloadDesktopWorkPacket(context, button) {
  markBusy(button, true, "Preparing…"); byId("operations-error").hidden = true; clearOperationsSuccess();
  try {
    const response = await fetch(`/api/operations/orders/${context.orderId}/desktop-work-packet`);
    if (!response.ok) { const failure = await response.json(); throw new Error(failure?.error?.message || "The Desktop work packet could not be prepared."); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    const disposition = response.headers.get("content-disposition") || ""; const filename = disposition.match(/filename="([^"]+)"/u)?.[1] || "medialab-desktop-work-packet.json";
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    operationsSuccess("Desktop work packet downloaded. No media was moved.");
  } catch (error) { operationsError(error instanceof Error ? error.message : "The Desktop work packet could not be prepared."); }
  finally { markBusy(button, false, "Preparing…"); }
}

function renderProductionWorkspace(context, workspace, pane, openMissionPlan) {
  clearNode(pane);
  const heading = element("section", "production-heading");
  const copy = element("div", ""); copy.append(element("p", "eyebrow", "Web-first production"), element("h3", "", "Production workspace"),
    element("p", "production-muted", "Track large-file work here while source media stays in the native Desktop workflow."));
  const action = workspace.desktopWorkPacketReady
    ? element("button", "button button-primary", "Download Desktop work packet")
    : element("button", "button button-secondary", "Open Mission Plan");
  action.type = "button";
  if (workspace.desktopWorkPacketReady) action.addEventListener("click", () => downloadDesktopWorkPacket(context, action));
  else action.addEventListener("click", openMissionPlan);
  heading.append(copy, action); pane.append(heading);

  const mission = element("section", "production-mission-binding");
  if (workspace.missionPlan) {
    mission.append(summaryField("Issued Mission Plan", `Version ${workspace.missionPlan.versionNumber}`),
      summaryField("Integrity", workspace.missionPlan.integritySha256),
      summaryField("Issued", new Date(workspace.missionPlan.issuedAt).toLocaleString()));
  } else {
    mission.append(summaryField("Issued Mission Plan", "Required before Desktop work"));
  }
  pane.append(mission);
  if (workspace.exceptions.length) {
    const exceptions = detailSection("Before Desktop work");
    workspace.exceptions.forEach((message) => exceptions.append(element("p", "state-note", message))); pane.append(exceptions);
  }
  const lanes = element("div", "production-lanes"); workspace.lanes.forEach((lane) => lanes.append(productionLaneCard(lane))); pane.append(lanes);
  pane.append(element("p", "production-disclosure", workspace.disclosure));
}

async function loadProductionPane(context, pane, openMissionPlan) {
  clearNode(pane); pane.append(detailSection("Production workspace", "Loading canonical PHOTO and VIDEO status…"));
  try {
    const workspace = await fetchJson(`/api/operations/orders/${context.orderId}/production`);
    renderProductionWorkspace(context, workspace, pane, openMissionPlan);
  } catch (error) { clearNode(pane); pane.append(detailSection("Production workspace unavailable", error instanceof Error ? error.message : "Production status could not be loaded.")); }
}

function productionWorkspaceSwitcher(context, pane) {
  const switcher = element("nav", "workspace-switcher"); switcher.setAttribute("aria-label", "Selected property workspace");
  const production = element("button", "workspace-switch", "Production"); production.type = "button";
  const mission = element("button", "workspace-switch", "Mission Plan"); mission.type = "button";
  const activate = (name) => {
    production.setAttribute("aria-pressed", String(name === "production")); mission.setAttribute("aria-pressed", String(name === "mission"));
    if (name === "production") loadProductionPane(context, pane, () => activate("mission")); else loadMissionPlanPane(context, pane);
  };
  production.addEventListener("click", () => activate("production")); mission.addEventListener("click", () => activate("mission"));
  switcher.append(production, mission); activate("production"); return switcher;
}

function customerActions(context) {
  const actions = element("div", "compact-actions");
  const email = element("a", "button button-secondary button-compact", "Email"); email.href = `mailto:${context.customer.email}`; actions.append(email);
  const phone = context.customer.contacts?.find((item) => item.contactType === "PHONE");
  if (phone) {
    const call = element("a", "button button-secondary button-compact", "Call"); call.href = `tel:${phone.displayValue}`;
    const message = element("a", "button button-secondary button-compact", "Text"); message.href = `sms:${phone.displayValue}`; actions.prepend(call, message);
  }
  return actions;
}

function summaryField(label, content) {
  const field = element("div", "summary-field"); field.append(element("span", "summary-label", label));
  if (typeof content === "string") field.append(element("strong", "", content)); else field.append(content);
  return field;
}

function missionControlSummary(context) {
  const summary = element("section", "mission-control-summary");
  const appointment = element("div", "summary-block"); appointment.append(element("h4", "", "Appointment & Scheduling"));
  const appointmentGrid = element("div", "summary-information-grid");
  appointmentGrid.append(summaryField("Date & time", context.appointment
    ? operationalDateTime(context.appointment.localStartsAt, context.appointment.ianaTimezone) : "Not scheduled"),
  summaryField("Status", context.appointment ? context.appointment.state.toLowerCase().replaceAll("_", " ") : "Not scheduled"));
  const crewContent = assignmentSection(context);
  appointmentGrid.append(summaryField("Assigned crew", crewContent || element("p", "state-note", "Crew becomes available after the appointment is confirmed.")));
  appointment.append(appointmentGrid);
  const appointmentActions = appointmentSection(context); if (appointmentActions) appointment.append(appointmentActions);
  const services = element("div", "summary-block"); services.append(element("h4", "", "Order Scope"));
  const serviceList = element("ul", "clean-list"); context.services.forEach((service) => serviceList.append(element("li", "", `${service.displayName}${service.quantity > 1 ? ` × ${service.quantity}` : ""}`))); services.append(serviceList);
  const customer = element("div", "summary-block"); customer.append(element("h4", "", "Customer Information"));
  const customerGrid = element("div", "summary-information-grid summary-customer-grid");
  customerGrid.append(summaryField("Name", context.customer.displayName), summaryField("Contact", context.customer.email));
  customer.append(customerGrid, customerActions(context));
  summary.append(appointment, services, customer); return summary;
}

async function openOperationsDetail(orderId) {
  operationsState.selectedOrderId = orderId; renderOperationsQueue();
  try {
    const context = await fetchJson(`/api/operations/orders/${encodeURIComponent(orderId)}`);
    if (context.propertyHubId && context.scheduling && context.job) {
      const candidates = await fetchJson(`/api/operations/assignment-candidates?organizationId=${encodeURIComponent(context.organizationId)}`);
      operationsState.candidates = candidates.candidates || [];
    }
    const detail = byId("operations-detail"); clearNode(detail);
    const header = element("div", "detail-header"); const heading = element("div", "detail-header-copy");
    heading.append(element("p", "eyebrow", "Selected property"), element("h3", "", operationsAddress(context)));
    if (context.appointment) heading.append(element("span", "mission-state is-issued", context.appointment.state.toLowerCase().replaceAll("_", " ")));
    const directions = element("a", "button button-primary", "Get Directions"); directions.href = directionsUrl(context);
    directions.target = "_blank"; directions.rel = "noopener noreferrer"; header.append(heading, directions);
    detail.append(header, missionControlSummary(context));
    if (context.attention.length) { const alerts = detailSection("Needs attention"); const chips = element("div", "detail-alerts");
      context.attention.forEach((code) => chips.append(element("span", "attention-chip", attentionLabel(code)))); alerts.append(chips); detail.append(alerts); }
    if (!context.propertyHubId || !context.scheduling || !context.job) {
      const setup = detailSection("Start operational context", "Create the canonical Property Hub, Scheduling Request, Job, and one Workstream per ordered service as a single replay-safe action.");
      const button = actionButton("Start Mission Control"); button.addEventListener("click", () => runOperation(`/api/operations/orders/${context.orderId}/initialize`, {}, button)); setup.append(button); detail.append(setup); return;
    }
    if (!context.appointment) detail.append(schedulingForm(context));
    const workspacePane = element("div", "mission-plan-pane production-workspace-pane");
    detail.append(productionWorkspaceSwitcher(context, workspacePane), workspacePane);
  } catch (error) { operationsError(error instanceof Error ? error.message : "Operational context could not be loaded."); }
}

async function loadOperationsHome(showStatus = true) {
  const status = byId("operations-status"); if (showStatus) status.hidden = false;
  try {
    const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(from); to.setDate(to.getDate() + 60);
    operationsState.home = await fetchJson(`/api/operations?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    renderOperationsQueue(); status.hidden = true;
  } catch (error) { status.hidden = true; operationsError(error instanceof Error ? error.message : "The operations queue could not be loaded."); }
}

async function initializeOperationsPage() {
  document.title = "Mission Control · MediaLab";
  document.body.classList.add("operations-mode");
  document.querySelector(".header-copy h1").textContent = "MISSION CONTROL";
  document.querySelector(".header-copy .eyebrow").hidden = true;
  document.querySelector(".header-copy .lede").hidden = true;
  document.querySelector(".boundary-notice").hidden = true;
  document.querySelector(".skip-link").href = "#operations-main"; document.querySelector(".skip-link").textContent = "Skip to Mission Control";
  document.querySelector(".progress-shell").hidden = true; byId("console-main").hidden = true; byId("operations-main").hidden = false;
  try {
    const params = new URLSearchParams(window.location.search); const requestedQueue = params.get("queue");
    if (["attention", "today", "upcoming", "completed"].includes(requestedQueue)) operationsState.queue = requestedQueue;
    document.querySelectorAll("[data-queue]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.queue === operationsState.queue)));
    await fetchJson("/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    await loadOperationsHome();
    const orderId = params.get("orderId"); if (orderId && UUID_PATTERN.test(orderId)) openOperationsDetail(orderId);
  } catch (error) { operationsError(error instanceof Error ? error.message : "The local operator session is unavailable."); }
}

if (typeof window !== "undefined" && typeof document !== "undefined" && window.location.pathname === "/operations") {
  document.querySelectorAll("[data-queue]").forEach((button) => button.addEventListener("click", () => {
    operationsState.queue = button.dataset.queue; document.querySelectorAll("[data-queue]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    if (operationsState.selectedOrderId && !queueItems().some((item) => item.orderId === operationsState.selectedOrderId)) {
      operationsState.selectedOrderId = null; clearNode(byId("operations-detail"));
      byId("operations-detail").append(element("div", "empty-detail", "Select an order in this view to open its details."));
    }
    renderOperationsQueue();
  }));
  byId("operations-list").addEventListener("click", (event) => { const card = event.target.closest("[data-order-id]"); if (card) openOperationsDetail(card.dataset.orderId); });
  byId("refresh-operations").addEventListener("click", () => loadOperationsHome());
  initializeOperationsPage();
} else if (typeof window !== "undefined" && typeof document !== "undefined") {
  bindEvents(); initialize();
}
