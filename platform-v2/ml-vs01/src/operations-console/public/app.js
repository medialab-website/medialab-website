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

const OPERATIONS_QUEUES = ["attention", "upcoming", "completed"];
const CONTEXTUAL_WORKSPACES = ["production", "mission-plan", "review", "quick-edit"];
const WORKSPACE_NAV_DESTINATIONS = ["real-estate", "weddings", "commercial", "clients"];
const MAXIMUM_QUICK_EDIT_BYTES = 25 * 1024 * 1024;
const operationsState = {
  section: "real-estate",
  queue: "attention",
  home: null,
  selectedOrderId: null,
  selectedWorkspace: "mission-plan",
  reviewAttention: new Map(),
  reviewWorkspace: null,
  reviewWorkspaceError: null,
  candidates: [],
  detailRequest: 0,
  roomKey: null,
  reviewView: "single",
  reviewGridSelectMode: false,
  reviewGridSelection: new Set(),
  roomDrafts: new Map(),
  mediaPreloads: new Map(),
  reviewFilmstripPosition: null,
  roomNavigationGuard: null,
  restoringRoomHistory: false,
};

function readOperationsRoute() {
  const params = new URLSearchParams(window.location.search);
  const requestedQueue = params.get("queue");
  const queue = requestedQueue === "today" ? "upcoming" : requestedQueue;
  const section = params.get("section");
  const orderId = params.get("orderId");
  const workspace = params.get("workspace");
  const validOrderId = orderId && UUID_PATTERN.test(orderId) ? orderId : null;
  return {
    section: WORKSPACE_NAV_DESTINATIONS.includes(section || "") ? section : "real-estate",
    queue: OPERATIONS_QUEUES.includes(queue) ? queue : "attention",
    orderId: validOrderId,
    workspace: validOrderId && CONTEXTUAL_WORKSPACES.includes(workspace) ? workspace : "mission-plan",
    reviewBatchId: validOrderId && UUID_PATTERN.test(params.get("reviewBatchId") || "") ? params.get("reviewBatchId") : null,
    reviewItemId: validOrderId && UUID_PATTERN.test(params.get("reviewItemId") || "") ? params.get("reviewItemId") : null,
    quickEditRequestId: validOrderId && UUID_PATTERN.test(params.get("quickEditRequestId") || "") ? params.get("quickEditRequestId") : null,
  };
}

function writeOperationsRoute(route, mode = "push") {
  const params = new URLSearchParams();
  const section = WORKSPACE_NAV_DESTINATIONS.includes(route.section || operationsState.section || "")
    ? (route.section || operationsState.section)
    : "real-estate";
  params.set("section", section);
  params.set("queue", route.queue || operationsState.queue);
  if (route.orderId && UUID_PATTERN.test(route.orderId)) params.set("orderId", route.orderId);
  if (route.orderId && route.workspace && route.workspace !== "production") params.set("workspace", route.workspace);
  if (route.orderId && route.workspace === "review" && route.reviewBatchId && UUID_PATTERN.test(route.reviewBatchId)) {
    params.set("reviewBatchId", route.reviewBatchId);
  }
  if (route.orderId && route.workspace === "review" && route.reviewItemId && UUID_PATTERN.test(route.reviewItemId)) {
    params.set("reviewItemId", route.reviewItemId);
  }
  if (route.orderId && route.workspace === "quick-edit" && route.quickEditRequestId && UUID_PATTERN.test(route.quickEditRequestId)) {
    params.set("quickEditRequestId", route.quickEditRequestId);
  }
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  if (mode === "replace") window.history.replaceState({ operationsRoute: true }, "", nextUrl);
  else window.history.pushState({ operationsRoute: true }, "", nextUrl);
}

function setQueuePressedState() {
  document.querySelectorAll("[data-queue]").forEach((item) => {
    item.setAttribute("aria-pressed", String(item.dataset.queue === operationsState.queue));
  });
}

function newIdempotencyKey() {
  return window.crypto.randomUUID();
}

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
    EDITOR_REVIEW_READY: "Editor review ready",
    EDITOR_REVIEW_IN_PROGRESS: "Editor review in progress",
    EDITOR_REVISION_REQUIRED: "Editor revision ready",
    QUICK_EDIT_REQUIRED: "Quick Edit required",
  })[code] || "Needs attention";
}

function reviewActionWorkspace(action) {
  return action?.code === "QUICK_EDIT_REQUIRED" ? "quick-edit" : "review";
}

function listingContextualActions(actions) {
  const available = Array.isArray(actions) ? actions : [];
  const result = [];
  if (available.some((action) => reviewActionWorkspace(action) === "review")) {
    result.push({ workspace: "review", label: "Review Edits" });
  }
  if (available.some((action) => reviewActionWorkspace(action) === "quick-edit")) {
    result.push({ workspace: "quick-edit", label: "Quick Edits" });
  }
  return result;
}

function queueCardAction(item) {
  const actions = reviewActionsFor(item.orderId);
  if (actions.some((action) => reviewActionWorkspace(action) === "quick-edit")) {
    return { label: "QUICK EDITS", tone: "quick-edit", workspace: "quick-edit" };
  }
  if (actions.some((action) => reviewActionWorkspace(action) === "review")) {
    return { label: "REVIEW EDITS", tone: "urgent", workspace: "review" };
  }
  const attention = Array.isArray(item.attention) ? item.attention : [];
  if (attention.includes("APPOINTMENT_NOT_CONFIRMED") || attention.includes("SCHEDULING_WINDOW_NEEDED")) {
    return { label: "CONFIRM SCHEDULING", tone: "urgent", workspace: "mission-plan" };
  }
  return null;
}

function queueAppointmentDisplay(item) {
  if (item.appointment) {
    return {
      label: operationalDateTime(item.appointment.localStartsAt, item.appointment.ianaTimezone),
      confirmed: ["CONFIRMED", "WEATHER_DELAYED"].includes(item.appointment.state),
    };
  }
  const windows = Array.isArray(item.scheduling?.windows) ? item.scheduling.windows : [];
  const requested = windows.find((windowRecord) => windowRecord.kind === "REQUESTED") ||
    windows.find((windowRecord) => windowRecord.accepted && windowRecord.kind === "STAFF_PROPOSED") || windows[0];
  return {
    label: requested ? operationalDateTime(requested.localStartsAt, requested.ianaTimezone) : "Requested time unavailable",
    confirmed: false,
  };
}

function reviewActionsFor(orderId) {
  return operationsState.reviewAttention.get(orderId)?.actions || [];
}

function indexReviewAttention(payload) {
  const indexed = new Map();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  items.forEach((item) => {
    if (!UUID_PATTERN.test(item?.orderId || "") || !Array.isArray(item.actions)) return;
    indexed.set(item.orderId, { ...item, actions: item.actions.filter((action) => action && typeof action.code === "string") });
  });
  operationsState.reviewAttention = indexed;
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

function upcomingQueueItems(sections) {
  const seen = new Set();
  return [...(sections?.today || []), ...(sections?.upcoming || [])].filter((item) => {
    if (item.job?.state === "COMPLETED" || seen.has(item.orderId)) return false;
    seen.add(item.orderId); return true;
  });
}

function queueItems() {
  const sections = operationsState.home?.sections;
  if (!sections) return [];
  if (operationsState.queue === "attention") {
    const items = [...(sections.needsAttention || [])];
    const included = new Set(items.map((item) => item.orderId));
    (operationsState.home?.items || []).forEach((item) => {
      if (operationsState.reviewAttention.has(item.orderId) && !included.has(item.orderId)) {
        items.push(item); included.add(item.orderId);
      }
    });
    return items;
  }
  if (operationsState.queue === "completed") return (operationsState.home.items || []).filter((item) => item.job?.state === "COMPLETED");
  return upcomingQueueItems(sections);
}

function renderOperationsQueue() {
  byId("upcoming-count").textContent = String(upcomingQueueItems(operationsState.home?.sections).length);
  byId("attention-count").textContent = String(operationsState.queue === "attention" ? queueItems().length :
    new Set([...(operationsState.home?.sections.needsAttention || []).map((item) => item.orderId), ...operationsState.reviewAttention.keys()]).size);
  byId("completed-count").textContent = String((operationsState.home?.items || []).filter((item) => item.job?.state === "COMPLETED").length);
  byId("queue-heading").textContent = operationsState.queue === "attention" ? "Needs attention" :
    operationsState.queue === "completed" ? "Completed" : "Upcoming";
  const list = byId("operations-list"); clearNode(list);
  const items = queueItems();
  if (!items.length) {
    const empty = element("div", "queue-empty");
    empty.append(element("strong", "", "Nothing here right now"), element("p", "", "Choose another view or refresh the queue."));
    list.append(empty); return;
  }
  items.forEach((item) => {
    const card = element("article", `operation-card${operationsState.selectedOrderId === item.orderId ? " is-selected" : ""}`);
    const button = element("button", "operation-card-main"); button.type = "button"; button.dataset.orderId = item.orderId;
    const appointment = queueAppointmentDisplay(item);
    const action = queueCardAction(item);
    if (action) button.dataset.contextWorkspace = action.workspace;
    button.append(
      element("strong", "operation-card-address", operationsAddress(item)),
      element("span", `appointment-time${appointment.confirmed ? "" : " is-requested"}`, appointment.label),
      element("span", "operation-listing-agent", item.customer.displayName || "Listing agent unavailable"),
    );
    if (action) {
      button.append(element("span", `operation-reason operation-reason-${action.tone}`, action.label));
    }
    card.append(button);
    list.append(card);
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
      const destinations = ["attention", "upcoming", "completed"];
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

function appointmentWindowFromDateAndTimes(date, startTime, endTime) {
  const localStartsAt = `${date}T${startTime}`;
  const localEndsAt = `${date}T${endTime}`;
  const start = new Date(localStartsAt);
  const end = new Date(localEndsAt);
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || end <= start) return null;
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    localStartsAt,
    localEndsAt,
  };
}

function schedulingForm(context) {
  const section = detailSection("Scheduling", "Choose one date with start and end times. Multi-day work uses additional appointments.");
  if (context.scheduling?.state === "REQUESTED") {
    const form = element("form", "operation-form");
    const kind = selectField("Window type", "kind", [["REQUESTED", "Customer requested"], ["STAFF_PROPOSED", "Staff alternate"]]);
    form.append(kind, field("Appointment date", "date", "appointmentDate"), field("Start time", "time", "startTime"),
      field("End time", "time", "endTime"), field("Reason for staff alternate", "text", "reason", "", false), actionButton("Add appointment time"));
    form.addEventListener("submit", (event) => {
      event.preventDefault(); const data = new FormData(form);
      const windowEvidence = appointmentWindowFromDateAndTimes(String(data.get("appointmentDate")), String(data.get("startTime")), String(data.get("endTime")));
      if (!windowEvidence) { operationsError("End time must be after the start time on the same appointment date."); return; }
      const kindValue = String(data.get("kind")); const body = { ...windowEvidence,
        ianaTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
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
  const localStart = String(appointment.localStartsAt || "").replace(" ", "T");
  const localEnd = String(appointment.localEndsAt || "").replace(" ", "T");
  reschedule.append(field("Appointment date", "date", "appointmentDate", localStart.slice(0, 10)),
    field("Start time", "time", "startTime", localStart.slice(11, 16)), field("End time", "time", "endTime", localEnd.slice(11, 16)),
    selectField("Customer acceptance", "acceptanceMethod", [["PHONE", "Phone"], ["TEXT", "Text"], ["EMAIL", "Email"], ["IN_PERSON", "In person"], ["OTHER", "Other"]]),
    field("Reason", "text", "reason"), field("Acceptance note", "text", "note"), actionButton("Reschedule"));
  reschedule.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(reschedule);
    const windowEvidence = appointmentWindowFromDateAndTimes(String(data.get("appointmentDate")), String(data.get("startTime")), String(data.get("endTime")));
    if (!windowEvidence) { operationsError("End time must be after the start time on the same appointment date."); return; }
    const note = String(data.get("note") || "").trim(); const payload = { ...windowEvidence,
      ianaTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
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

async function loadMissionPlanPane(context, pane, isCurrent = () => true) {
  clearNode(pane); const loading = detailSection("Mission Plan", "Loading the canonical Mission Plan…"); pane.append(loading);
  try {
    const workspace = await fetchJson(`/api/operations/orders/${context.orderId}/mission-plan`);
    if (!isCurrent()) return; clearNode(pane); missionPlanEditor(context, workspace, pane);
  } catch (error) { if (!isCurrent()) return; clearNode(pane); pane.append(detailSection("Mission Plan unavailable", error instanceof Error ? error.message : "The Mission Plan could not be loaded.")); }
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

function renderProductionWorkspace(context, workspace, pane) {
  clearNode(pane);
  const heading = element("section", "production-heading");
  const copy = element("div", ""); copy.append(element("p", "eyebrow", "Web-first production"), element("h3", "", "Production workspace"),
    element("p", "production-muted", "Track large-file work here while source media stays in the native Desktop workflow."));
  if (workspace.desktopWorkPacketReady) {
    const action = element("button", "button button-primary", "Download Desktop work packet");
    action.type = "button";
    action.addEventListener("click", () => downloadDesktopWorkPacket(context, action));
    heading.append(copy, action);
  } else {
    heading.append(copy);
  }
  pane.append(heading);

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

function hasCulledProduction(workspace) {
  return Boolean(workspace?.lanes?.some((lane) => lane.cull?.currentState === "COMPLETE" ||
    (lane.cull?.inventorySealed === true && lane.cull?.hasCurrentSelection === true)));
}

async function loadProductionPane(context, pane, isCurrent = () => true, initialWorkspace = null) {
  clearNode(pane); pane.append(detailSection("Production workspace", "Loading canonical PHOTO and VIDEO status…"));
  try {
    const workspace = initialWorkspace || await fetchJson(`/api/operations/orders/${context.orderId}/production`);
    if (!isCurrent()) return; renderProductionWorkspace(context, workspace, pane);
  } catch (error) { if (!isCurrent()) return; clearNode(pane); pane.append(detailSection("Production workspace unavailable", error instanceof Error ? error.message : "Production status could not be loaded.")); }
}

function productionWorkspaceSwitcher(context, pane, route = {}, productionWorkspace = null) {
  const navigation = element("div", "workspace-navigation");
  let activationGeneration = 0;
  const switcher = element("nav", "workspace-switcher"); switcher.setAttribute("aria-label", "Selected property workspace");
  const production = element("button", "workspace-switch", "Production"); production.type = "button";
  const mission = element("button", "workspace-switch", "Mission Plan"); mission.type = "button";
  const productionAvailable = hasCulledProduction(productionWorkspace);
  const activate = (name, options = {}) => {
    if (name === "production" && !productionAvailable) name = "mission-plan";
    const currentGeneration = ++activationGeneration;
    operationsState.selectedWorkspace = name;
    production.setAttribute("aria-pressed", String(name === "production")); mission.setAttribute("aria-pressed", String(name === "mission-plan"));
    if (name === "production") loadProductionPane(context, pane, () => currentGeneration === activationGeneration, productionWorkspace);
    else loadMissionPlanPane(context, pane, () => currentGeneration === activationGeneration);
    if (options.history) {
      writeOperationsRoute({ queue: operationsState.queue, orderId: context.orderId, workspace: name }, options.history);
    }
    if (options.focus) focusOperationsWorkspace(pane, name);
  };
  production.addEventListener("click", () => activate("production", { history: "push", focus: true }));
  mission.addEventListener("click", () => activate("mission-plan", { history: "push", focus: true }));
  if (productionAvailable) switcher.append(production);
  switcher.append(mission); navigation.append(switcher);
  const requestedWorkspace = ["production", "mission-plan"].includes(route.workspace) ? route.workspace : "mission-plan";
  activate(requestedWorkspace);
  return navigation;
}

function customerActions(context) {
  const actions = element("div", "overview-client-actions");
  const iconLink = (icon, label, href) => {
    const link = element("a", "overview-icon-action", icon); link.href = href;
    link.setAttribute("aria-label", label); link.title = label; return link;
  };
  const email = iconLink("✉", "Email listing agent", `mailto:${context.customer.email}`); actions.append(email);
  const phone = context.customer.contacts?.find((item) => item.contactType === "PHONE");
  if (phone) {
    const call = iconLink("☎", "Call listing agent", `tel:${phone.displayValue}`);
    const message = iconLink("💬", "Text listing agent", `sms:${phone.displayValue}`); message.classList.add("is-message");
    actions.prepend(call, message);
  }
  return actions;
}

function customerDetails(context) {
  const details = document.createElement("details"); details.className = "overview-client-details";
  const summary = document.createElement("summary"); summary.textContent = "Details";
  const content = element("div", "overview-client-detail-content");
  const phone = context.customer.contacts?.find((item) => item.contactType === "PHONE");
  content.append(element("p", "", context.customer.email));
  if (phone) content.append(element("p", "", phone.displayValue));
  const edit = element("button", "overview-edit-client", "✎"); edit.type = "button";
  edit.setAttribute("aria-label", "Edit client information"); edit.title = "Client editing will open in Clients";
  edit.addEventListener("click", () => {
    operationsState.section = "clients";
    writeOperationsRoute({ section: "clients", queue: operationsState.queue, orderId: context.orderId, workspace: "production" }, "push");
    document.querySelectorAll("[data-workspace-destination]").forEach((destination) => {
      if (destination.dataset.workspaceDestination === "clients") destination.setAttribute("aria-current", "page");
      else destination.removeAttribute("aria-current");
    });
    operationsSuccess("Client selected. Full client editing will live in Clients.");
  });
  content.prepend(edit); details.append(summary, content); return details;
}

function summaryField(label, content) {
  const field = element("div", "summary-field");
  field.append(element("span", "summary-label", label));
  if (typeof content === "string") field.append(element("strong", "", content)); else field.append(content);
  return field;
}

function summaryValueField(content) {
  const field = element("div", "summary-field summary-field-value-only");
  if (typeof content === "string") {
    field.append(element("strong", "", content));
  } else {
    field.append(content);
  }
  return field;
}

function confirmableWindow(context) {
  const windows = Array.isArray(context.scheduling?.windows) ? context.scheduling.windows : [];
  return windows.find((windowRecord) => windowRecord.kind === "REQUESTED") ||
    windows.find((windowRecord) => windowRecord.accepted && windowRecord.kind === "STAFF_PROPOSED") ||
    windows[0] || null;
}

function scheduledDisplayDateTime(context) {
  if (context.appointment) return operationalDateTime(context.appointment.localStartsAt, context.appointment.ianaTimezone);
  const candidate = confirmableWindow(context);
  return candidate ? operationalDateTime(candidate.localStartsAt, candidate.ianaTimezone) : "Requested time unavailable";
}

function appendUnconfirmedStatusActions(context, statusButton, actionHost) {
  actionHost.classList.add("summary-status-actions");
  actionHost.hidden = true;
  const windows = Array.isArray(context.scheduling?.windows) ? context.scheduling.windows : [];
  const confirmHost = element("div", "summary-status-action-group");
  const confirmButton = element("button", "button button-secondary button-compact", "Confirm customer's request");
  confirmButton.type = "button";
  confirmButton.id = `mission-control-confirm-request-${context.orderId}`;
  const confirmWindow = confirmableWindow(context);
  if (!confirmWindow || !context.scheduling?.requestId) {
    confirmButton.disabled = true;
  } else {
    confirmButton.addEventListener("click", () => openOperationsDialog(
      "Confirm customer request",
      element("p", "", `${operationalDateTime(confirmWindow.localStartsAt, confirmWindow.ianaTimezone)} will become the canonical appointment.`),
      "Confirm time",
      (dialogButton) => runOperation(`/api/operations/orders/${context.orderId}/scheduling/${context.scheduling.requestId}/confirm`, {
        windowId: confirmWindow.windowId,
        reason: "Customer request confirmed from Operations Console"
      }, dialogButton, {
        tab: "crew",
        message: "Appointment confirmed. Crew and services are ready."
      })
    ));
  }
  const alterButton = element("button", "button button-secondary button-compact", "Alter request");
  alterButton.type = "button";
  const scheduler = schedulingForm(context);
  scheduler.hidden = true;
  scheduler.id = `mission-control-scheduler-${context.orderId}`;
  scheduler.classList.add("summary-scheduling-form");
  alterButton.addEventListener("click", () => {
    scheduler.hidden = !scheduler.hidden;
    alterButton.textContent = scheduler.hidden ? "Alter request" : "Hide request editor";
    if (!scheduler.hidden) {
      scheduler.scrollIntoView({ behavior: "smooth", block: "nearest" });
      statusButton.setAttribute("aria-expanded", "true");
      scheduler.querySelector("select, input, button")?.focus();
    }
  });
  if (!windows.length) {
    confirmButton.textContent = "No requested times yet";
    confirmButton.disabled = true;
  }
  confirmHost.append(confirmButton, alterButton);
  actionHost.append(confirmHost, scheduler);
  statusButton.addEventListener("click", () => {
    actionHost.hidden = !actionHost.hidden;
    statusButton.setAttribute("aria-expanded", String(!actionHost.hidden));
  });
}

function unconfirmedStatusField(context) {
  const statusWrap = element("div", "summary-status-wrap");
  const statusButton = element("button", "button button-compact status-pill status-not-confirmed", "Pending Confirmation");
  statusButton.type = "button";
  statusButton.setAttribute("aria-expanded", "false");
  const actionHost = element("div", "summary-status-controls");
  appendUnconfirmedStatusActions(context, statusButton, actionHost);
  statusWrap.append(statusButton, actionHost);
  return statusWrap;
}

function statusFieldValue(context) {
  const isConfirmed = context.appointment && ["CONFIRMED", "WEATHER_DELAYED"].includes(context.appointment.state);
  if (isConfirmed) return element("span", "status-chip status-scheduled", "Scheduled");
  return unconfirmedStatusField(context);
}

function servicePriceLabel(service) {
  if (!Number.isFinite(service.lineTotalCents)) return "Price unavailable";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: service.currency || "USD" })
      .format(service.lineTotalCents / 100);
  } catch { return `$${(service.lineTotalCents / 100).toFixed(2)}`; }
}

function compactServiceDetails(service) {
  const details = document.createElement("details"); details.className = "overview-service";
  const summary = document.createElement("summary");
  summary.append(element("span", "", `${service.displayName}${service.quantity > 1 ? ` × ${service.quantity}` : ""}`),
    element("strong", "", servicePriceLabel(service)));
  const description = text(service.description,
    `${service.quantity} ${String(service.commercialUnit || "service").toLowerCase().replaceAll("_", " ")}`);
  details.append(summary, element("p", "", description)); return details;
}

function missionControlSummary(context) {
  const summary = element("section", "mission-control-summary");
  const card = element("div", "listing-overview-card");
  const appointment = element("div", "overview-row overview-appointment");
  const time = element("strong", `overview-appointment-time${context.appointment ? "" : " is-requested"}`,
    scheduledDisplayDateTime(context));
  appointment.append(statusFieldValue(context), time);

  const crew = element("div", "overview-row overview-crew");
  crew.append(assignmentSection(context) || element("span", "overview-muted", "Crew unassigned"));

  const services = element("div", "overview-row overview-services");
  context.services.forEach((service) => services.append(compactServiceDetails(service)));

  const client = element("div", "overview-row overview-client");
  client.append(element("strong", "overview-client-name", context.customer.displayName),
    customerActions(context), customerDetails(context));
  card.append(appointment, crew, services, client); summary.append(card); return summary;
}

function focusOperationsWorkspace(pane, workspace, locator = {}) {
  window.requestAnimationFrame(() => {
    let target = null;
    if (workspace === "review" && locator.reviewItemId) {
      target = pane.querySelector(`[data-review-item-id="${locator.reviewItemId}"]`);
    } else if (workspace === "quick-edit" && locator.quickEditRequestId) {
      target = pane.querySelector(`[data-quick-edit-request-id="${locator.quickEditRequestId}"]`);
    }
    target ||= pane.querySelector(".contextual-pane-heading, h3, h4");
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 760px)").matches) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  });
}

function clearRoomMediaPreloads() {
  operationsState.mediaPreloads.forEach((image) => {
    image.onerror = null;
    image.removeAttribute("src");
  });
  operationsState.mediaPreloads.clear();
}

function ensureContextualRoom() {
  let room = byId("operations-contextual-room");
  if (room) return room;
  room = document.createElement("section");
  room.id = "operations-contextual-room";
  room.className = "operations-contextual-room";
  room.setAttribute("aria-labelledby", "contextual-room-heading");
  room.hidden = true;
  byId("operations-main").append(room);
  return room;
}

function setContextualRoomMode(active, roomKey = null) {
  const room = ensureContextualRoom();
  document.querySelectorAll(".operations-hero, .queue-tabs, .operations-layout").forEach((surface) => {
    surface.hidden = active;
  });
  room.hidden = !active;
  document.body.classList.toggle("is-contextual-room", active);
  if (!active || (roomKey && roomKey !== operationsState.roomKey)) {
    clearRoomMediaPreloads();
    operationsState.roomDrafts.clear();
    operationsState.reviewGridSelectMode = false;
    operationsState.reviewGridSelection.clear();
  }
  if (!active) {
    operationsState.roomKey = null;
    operationsState.roomNavigationGuard = null;
    clearNode(room);
  } else if (roomKey) {
    operationsState.roomKey = roomKey;
  }
  return room;
}

function announceContextualRoom(message) {
  const status = byId("contextual-room-status");
  if (!status) return;
  status.textContent = "";
  window.setTimeout(() => { status.textContent = message; }, 10);
}

function contextualRoomHeader(context, title) {
  const header = element("header", "contextual-room-header");
  const back = element("button", "button button-secondary contextual-room-back", "Back to listing");
  back.type = "button";
  back.addEventListener("click", () => {
    if (operationsState.roomNavigationGuard?.()) return;
    openOperationsDetail(context.orderId, { workspace: "mission-plan", history: "replace", focus: true });
  });
  const copy = element("div", "contextual-room-heading-copy");
  const heading = element("h2", "", title); heading.id = "contextual-room-heading";
  copy.append(heading);
  const status = element("p", "visually-hidden", ""); status.id = "contextual-room-status";
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.setAttribute("aria-atomic", "true");
  header.append(back, copy, status);
  return header;
}

function renderContextualRoomLoading(workspace) {
  const room = setContextualRoomMode(true);
  clearNode(room);
  const title = workspace === "quick-edit" ? "Quick Edits" : "Review Edits";
  const heading = element("h2", "", title); heading.id = "contextual-room-heading";
  const loading = element("section", "contextual-room-loading");
  loading.append(heading, element("p", "production-muted", `Opening ${title}…`));
  room.append(loading);
}

function renderContextualRoomUnavailable(orderId, workspace, message) {
  const room = setContextualRoomMode(true); clearNode(room); operationsState.roomNavigationGuard = null;
  const back = element("button", "button button-secondary contextual-room-back", "Back to listing"); back.type = "button";
  back.addEventListener("click", () => openOperationsDetail(orderId, { workspace: "mission-plan", history: "replace", focus: true }));
  const heading = element("h2", "", workspace === "quick-edit" ? "Quick Edits unavailable" : "Review Edits unavailable");
  heading.id = "contextual-room-heading";
  const content = element("section", "contextual-room-loading"); content.append(back, heading, element("p", "production-muted", message));
  room.append(content);
}

function roomItemIndex(items, locator, key, preferUnresolved = false) {
  if (!Array.isArray(items) || !items.length) return -1;
  const located = locator ? items.findIndex((item) => item?.[key] === locator) : -1;
  if (located >= 0) return located;
  if (preferUnresolved) {
    const unresolved = items.findIndex((item) => !item.currentDisposition);
    if (unresolved >= 0) return unresolved;
  }
  return 0;
}

function roomSwipeDirection(deltaX, deltaY, width) {
  const threshold = Math.max(56, Number(width || 0) * .15);
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return 0;
  return deltaX < 0 ? 1 : -1;
}

function isRoomInteractionTarget(target) {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, label"));
}

function bindRoomCardNavigation(card, move) {
  let gesture = null;
  const reset = () => {
    gesture = null;
    card.classList.remove("is-swiping");
    card.style.removeProperty("--swipe-offset");
  };
  card.addEventListener("pointerdown", (event) => {
    if (!["touch", "pen"].includes(event.pointerType) || isRoomInteractionTarget(event.target)) return;
    gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, deltaX: 0, deltaY: 0 };
    card.setPointerCapture?.(event.pointerId);
  });
  card.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.deltaX = event.clientX - gesture.startX; gesture.deltaY = event.clientY - gesture.startY;
    if (Math.abs(gesture.deltaX) <= Math.abs(gesture.deltaY) * 1.25) return;
    event.preventDefault();
    card.classList.add("is-swiping"); card.style.setProperty("--swipe-offset", `${gesture.deltaX}px`);
  });
  card.addEventListener("pointerup", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const direction = roomSwipeDirection(gesture.deltaX, gesture.deltaY, card.clientWidth);
    reset(); if (direction) move(direction);
  });
  card.addEventListener("pointercancel", reset);
}

function contextualRoomPager(kind, index, total, move, overviewButton = null) {
  const navigation = element("nav", "contextual-room-pager");
  navigation.setAttribute("aria-label", `${kind} navigation`);
  const previous = element("button", "button button-secondary room-previous", "Previous"); previous.type = "button";
  previous.disabled = index <= 0; previous.addEventListener("click", () => move(-1));
  const center = element("div", "contextual-room-pager-center");
  const position = element("strong", "contextual-room-position", `${kind} ${index + 1} of ${total}`);
  position.setAttribute("aria-live", "polite");
  center.append(position); if (overviewButton) center.append(overviewButton);
  const next = element("button", "button button-secondary room-next", "Next"); next.type = "button";
  next.disabled = index >= total - 1; next.addEventListener("click", () => move(1));
  navigation.append(previous, center, next);
  return navigation;
}

function bindContextualRoomKeyboard(room, move) {
  room.onkeydown = (event) => {
    if (isRoomInteractionTarget(event.target)) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
  };
}

function focusContextualCard(card, label, shouldFocus) {
  if (!shouldFocus) return;
  window.requestAnimationFrame(() => {
    card.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 760px)").matches) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
    announceContextualRoom(label);
  });
}

function reviewMediaUrl(context, reviewBatchId, reviewItemId, purpose) {
  return `/api/operations/orders/${encodeURIComponent(context.orderId)}/review-media/${encodeURIComponent(reviewBatchId)}` +
    `/items/${encodeURIComponent(reviewItemId)}?purpose=${encodeURIComponent(purpose)}`;
}

function createRoomMediaImage(url, priority = "low") {
  const image = document.createElement("img");
  image.className = "review-media-image"; image.loading = "eager"; image.decoding = "async";
  image.fetchPriority = priority;
  image.onerror = () => { image.dataset.loadFailed = "true"; };
  image.src = url;
  operationsState.mediaPreloads.set(url, image);
  return image;
}

function preloadAdjacentRoomMedia(context, items, index, purpose, fixedBatchId = null) {
  const desired = new Map();
  [index - 1, index, index + 1].forEach((candidateIndex) => {
    const item = items[candidateIndex];
    if (!item) return;
    const available = purpose === "REVIEW_PREVIEW" ? item.previewAvailable : item.downloadAvailable;
    if (!available) return;
    const batchId = fixedBatchId || item.reviewBatchId;
    const url = reviewMediaUrl(context, batchId, item.reviewItemId, purpose);
    desired.set(url, candidateIndex === index ? "high" : "low");
  });
  operationsState.mediaPreloads.forEach((image, url) => {
    if (desired.has(url)) return;
    image.onerror = null; image.removeAttribute("src"); operationsState.mediaPreloads.delete(url);
  });
  desired.forEach((priority, url) => {
    const image = operationsState.mediaPreloads.get(url) || createRoomMediaImage(url, priority);
    image.fetchPriority = priority;
  });
}

function contextualContextStrip(context) {
  const strip = element("section", "contextual-context-strip");
  strip.append(element("strong", "contextual-property", operationsAddress(context)));
  return strip;
}

function openReviewImageLightbox(url, version) {
  const dialog = document.createElement("dialog"); dialog.className = "review-image-lightbox";
  const shell = element("div", "review-image-lightbox-shell");
  const close = element("button", "button button-secondary review-image-lightbox-close", "Close"); close.type = "button";
  const image = document.createElement("img"); image.className = "review-image-lightbox-image";
  image.src = url; image.alt = `Full-size review photo ${text(version?.observedFilename, "preview")}`;
  shell.append(close, image, element("p", "review-image-lightbox-caption", text(version?.observedFilename, "Review photo")));
  dialog.append(shell); document.body.append(dialog);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal(); close.focus();
}

function reviewMediaFigure(context, reviewBatchId, reviewItemId, version, purpose, available = true, options = {}) {
  const figure = element("figure", "review-media-figure");
  const fallback = element("p", "review-media-fallback", available ? "Preview could not be displayed." : "Preview is unavailable.");
  fallback.hidden = available;
  if (available) {
    const url = reviewMediaUrl(context, reviewBatchId, reviewItemId, purpose);
    const image = options.lazy
      ? (() => {
        const lazyImage = document.createElement("img"); lazyImage.className = "review-media-image";
        lazyImage.loading = "lazy"; lazyImage.decoding = "async"; lazyImage.fetchPriority = "low"; lazyImage.src = url;
        return lazyImage;
      })()
      : operationsState.mediaPreloads.get(url) || createRoomMediaImage(url, "high");
    image.alt = `Review photo ${text(version?.observedFilename, "preview")}`;
    image.hidden = image.dataset.loadFailed === "true"; fallback.hidden = !image.hidden;
    const inspect = element("button", "review-media-inspect"); inspect.type = "button";
    inspect.setAttribute("aria-label", `Open full-size photo ${text(version?.observedFilename, "preview")}`);
    image.onerror = () => {
      image.dataset.loadFailed = "true"; image.hidden = true; fallback.hidden = false; inspect.disabled = true;
    };
    inspect.addEventListener("click", () => openReviewImageLightbox(url, version));
    inspect.append(image); figure.append(inspect);
  }
  const caption = element("figcaption", "review-media-caption", text(version?.observedFilename, "Review photo"));
  figure.append(fallback, caption);
  return figure;
}

function reviewTextarea(label, name, placeholder, value = "", maximumLength = 1000) {
  const wrapper = element("label", "operation-field operation-field-wide review-textarea");
  wrapper.append(element("span", "", label));
  const textarea = document.createElement("textarea");
  textarea.name = name; textarea.rows = 3; textarea.placeholder = placeholder; textarea.value = value || "";
  textarea.maxLength = maximumLength;
  wrapper.append(textarea);
  return wrapper;
}

async function refreshAfterContextualMutation(context, route, message) {
  await loadOperationsHome(false);
  await openOperationsDetail(context.orderId, { ...route, history: "replace", focus: true });
  operationsSuccess(message);
}

function reviewDraftKey(context, batch, item) {
  return `${context.orderId}:${batch.reviewBatchId}:${item.reviewItemId}`;
}

function initializeReviewDrafts(context, batch, items) {
  items.forEach((item) => {
    const key = reviewDraftKey(context, batch, item);
    if (operationsState.roomDrafts.has(key)) return;
    if (!["ACCEPT", "REJECT_REVISION", "QUICK_EDIT"].includes(item.currentDisposition)) return;
    operationsState.roomDrafts.set(key, { disposition: item.currentDisposition, note: item.instructions || "" });
  });
}

function stagedReviewDecisions(context, batch, items) {
  return items.map((item) => ({ item, draft: operationsState.roomDrafts.get(reviewDraftKey(context, batch, item)) }))
    .filter(({ draft }) => ["ACCEPT", "REJECT_REVISION", "QUICK_EDIT"].includes(draft?.disposition))
    .sort((left, right) => Number(left.item.ordinal || 0) - Number(right.item.ordinal || 0) ||
      left.item.reviewItemId.localeCompare(right.item.reviewItemId))
    .map(({ item, draft }) => ({
      reviewItemId: item.reviewItemId,
      disposition: draft.disposition,
      instructions: ["REJECT_REVISION", "QUICK_EDIT"].includes(draft.disposition) ? String(draft.note || "").trim() || null : null,
      expectedGeneration: item.decisionGeneration,
      currentDecisionId: item.currentDecisionId || null,
    }));
}

function reviewDecisionCard(context, batch, item, onStage) {
  const card = element("article", "review-decision-card"); card.dataset.reviewItemId = item.reviewItemId; card.tabIndex = 0;
  card.append(reviewMediaFigure(context, batch.reviewBatchId, item.reviewItemId, item.version,
    "REVIEW_PREVIEW", item.previewAvailable, { lazy: true }));
  const body = element("div", "review-decision-body");
  const heading = element("div", "review-card-heading");
  heading.append(element("h4", "", `Photo ${item.ordinal}`));
  const controls = element("div", "review-decision-controls"); controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", `Decision for photo ${item.ordinal}`);
  const noteSlot = element("div", "review-note-slot");
  const draftKey = reviewDraftKey(context, batch, item);
  const draft = operationsState.roomDrafts.get(draftKey);
  card.classList.toggle("is-decided", Boolean(draft));
  const decisions = [
    ["ACCEPT", "Accept"],
    ["REJECT_REVISION", "Reject"],
    ["QUICK_EDIT", "Quick Edit"],
  ];
  decisions.forEach(([disposition, label]) => {
    const button = element("button", "button review-decision-button", label); button.type = "button";
    button.dataset.disposition = disposition;
    button.classList.add(`is-${disposition.toLowerCase().replaceAll("_", "-")}`);
    button.setAttribute("aria-pressed", String(draft?.disposition === disposition));
    if (["REJECT_REVISION", "QUICK_EDIT"].includes(disposition)) {
      button.setAttribute("aria-controls", `review-note-${item.reviewItemId}`);
      button.setAttribute("aria-expanded", String(draft?.disposition === disposition));
    }
    button.addEventListener("click", () => onStage(item, disposition));
    controls.append(button);
  });
  if (["REJECT_REVISION", "QUICK_EDIT"].includes(draft?.disposition)) {
    const editor = element("div", "review-note-editor"); editor.id = `review-note-${item.reviewItemId}`;
    const note = reviewTextarea("Note (optional)", "note",
      draft.disposition === "QUICK_EDIT" ? "Describe the Quick Edit, if useful." : "Describe the rejected revision, if useful.",
      draft.note || "", 2000);
    note.querySelector("textarea").addEventListener("input", (event) => {
      operationsState.roomDrafts.set(draftKey, { disposition: draft.disposition, note: event.target.value });
    });
    editor.append(note); noteSlot.append(editor);
  }
  body.append(heading, controls, noteSlot); card.append(body); return card;
}

function reviewItemStatus(context, batch, item) {
  const disposition = operationsState.roomDrafts.get(reviewDraftKey(context, batch, item))?.disposition || null;
  return ({
    ACCEPT: { className: "is-accepted", label: "Accepted" },
    QUICK_EDIT: { className: "is-quick-edit", label: "Quick Edit" },
    REJECT_REVISION: { className: "is-rejected", label: "Rejected" },
  })[disposition] || { className: "is-pending", label: "Not selected" };
}

function reviewThumbnailButton(context, batch, item, active, onSelect, options = {}) {
  const status = reviewItemStatus(context, batch, item);
  const selectable = Boolean(options.selectable);
  const selected = Boolean(options.selected);
  const button = element("button", `review-thumbnail${active ? " is-active" : ""}${selected ? " is-selected" : ""}`); button.type = "button";
  button.dataset.reviewThumbnailItemId = item.reviewItemId;
  button.setAttribute("aria-label", `Photo ${item.ordinal}. ${status.label}.${selectable ? (selected ? " Selected." : " Select photo.") : ""}`);
  if (selectable) button.setAttribute("aria-pressed", String(selected));
  if (active) button.setAttribute("aria-current", "true");
  if (item.previewAvailable) {
    const image = document.createElement("img"); image.className = "review-thumbnail-image";
    image.loading = "lazy"; image.decoding = "async"; image.fetchPriority = active ? "high" : "low";
    image.alt = ""; image.src = reviewMediaUrl(context, batch.reviewBatchId, item.reviewItemId, "REVIEW_PREVIEW");
    button.append(image);
  } else {
    button.append(element("span", "review-thumbnail-fallback", `Photo ${item.ordinal}`));
  }
  const light = element("span", `review-status-light ${status.className}`);
  light.setAttribute("aria-hidden", "true"); button.append(light);
  if (selectable) {
    const selection = element("span", "review-selection-mark", selected ? "✓" : "");
    selection.setAttribute("aria-hidden", "true"); button.append(selection);
  }
  button.addEventListener("click", () => onSelect(item));
  return button;
}

function reviewViewToggle(onChange) {
  const toggle = element("div", "review-view-toggle"); toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Review photo view");
  [["grid", "Grid"], ["single", "Single photo"]].forEach(([view, label]) => {
    const button = element("button", "button button-secondary button-compact", label); button.type = "button";
    button.setAttribute("aria-pressed", String(operationsState.reviewView === view));
    button.addEventListener("click", () => onChange(view)); toggle.append(button);
  });
  return toggle;
}

function reviewThumbnailGrid(context, batch, items, callbacks) {
  const workspace = element("section", "review-grid-workspace");
  const toolbar = element("div", "review-grid-toolbar");
  if (!operationsState.reviewGridSelectMode) {
    const select = element("button", "button button-secondary button-compact", "Select photos"); select.type = "button";
    select.addEventListener("click", () => callbacks.onModeChange(true)); toolbar.append(select);
  } else {
    toolbar.append(element("strong", "review-grid-selection-count", `${operationsState.reviewGridSelection.size} selected`));
    const allSelected = items.length > 0 && items.every((item) => operationsState.reviewGridSelection.has(item.reviewItemId));
    const toggleAll = element("button", "button button-secondary button-compact", allSelected ? "Deselect all" : "Select all");
    toggleAll.type = "button"; toggleAll.addEventListener("click", () => callbacks.onToggleAll(!allSelected));
    const decisions = element("div", "review-grid-bulk-actions"); decisions.setAttribute("role", "group");
    decisions.setAttribute("aria-label", "Apply decision to selected photos");
    [["ACCEPT", "Accept"], ["REJECT_REVISION", "Reject"], ["QUICK_EDIT", "Quick Edit"]].forEach(([disposition, label]) => {
      const button = element("button", `button button-compact review-grid-decision is-${disposition.toLowerCase().replaceAll("_", "-")}`, label);
      button.type = "button"; button.disabled = operationsState.reviewGridSelection.size === 0;
      button.addEventListener("click", () => {
        if (disposition === "ACCEPT") { callbacks.onBulkStage(disposition, ""); return; }
        const note = reviewTextarea("Batch note (optional)", "batchNote",
          disposition === "QUICK_EDIT" ? "Describe the Quick Edit for these photos, if useful." : "Describe why these revisions were rejected, if useful.", "", 2000);
        note.querySelector("textarea").autofocus = true;
        openOperationsDialog(`${label} ${operationsState.reviewGridSelection.size} selected photo${operationsState.reviewGridSelection.size === 1 ? "" : "s"}?`,
          note, `Apply ${label}`, () => callbacks.onBulkStage(disposition, note.querySelector("textarea").value));
      }); decisions.append(button);
    });
    const clear = element("button", "button button-secondary button-compact", "Clear"); clear.type = "button";
    clear.disabled = operationsState.reviewGridSelection.size === 0;
    clear.addEventListener("click", callbacks.onClearSelection);
    const done = element("button", "button button-secondary button-compact", "Done"); done.type = "button";
    done.addEventListener("click", () => callbacks.onModeChange(false));
    toolbar.append(toggleAll, decisions, clear, done);
  }
  const grid = element("div", "review-thumbnail-grid"); grid.setAttribute("aria-label", "Review photo overview");
  items.forEach((item) => grid.append(reviewThumbnailButton(context, batch, item, false,
    operationsState.reviewGridSelectMode ? callbacks.onToggleSelection : callbacks.onOpen,
    { selectable: operationsState.reviewGridSelectMode, selected: operationsState.reviewGridSelection.has(item.reviewItemId) })));
  workspace.append(toolbar, grid); return workspace;
}

function reviewFilmstrip(context, batch, items, activeItem, onSelect) {
  const strip = element("nav", "review-filmstrip"); strip.setAttribute("aria-label", "Choose a review photo");
  items.forEach((item) => strip.append(reviewThumbnailButton(context, batch, item,
    item.reviewItemId === activeItem.reviewItemId, (selectedItem) => {
      operationsState.reviewFilmstripPosition = { reviewBatchId: batch.reviewBatchId, scrollLeft: strip.scrollLeft };
      onSelect(selectedItem);
    })));
  window.requestAnimationFrame(() => {
    const active = strip.querySelector('[aria-current="true"]');
    if (!active) return;
    const saved = operationsState.reviewFilmstripPosition?.reviewBatchId === batch.reviewBatchId
      ? operationsState.reviewFilmstripPosition : null;
    if (saved) strip.scrollLeft = saved.scrollLeft;
    const centeredLeft = active.offsetLeft - ((strip.clientWidth - active.offsetWidth) / 2);
    strip.scrollTo({
      left: Math.max(0, centeredLeft),
      behavior: saved && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto",
    });
    operationsState.reviewFilmstripPosition = { reviewBatchId: batch.reviewBatchId, scrollLeft: Math.max(0, centeredLeft) };
  });
  return strip;
}

function completedReviewHistory(workspace) {
  if (!Array.isArray(workspace?.completedHistory) || !workspace.completedHistory.length) return null;
  const section = element("section", "completed-review-history");
  section.append(element("h3", "", "Completed review history"));
  workspace.completedHistory.forEach((review) => {
    const details = element("details", "completed-review-cycle");
    const completed = new Date(review.completedAt);
    const dateLabel = Number.isNaN(completed.valueOf()) ? "Completed" : completed.toLocaleString();
    const summary = element("summary", "", `${String(review.lane).toLowerCase()} · cycle ${review.reviewCycleNumber} · ${dateLabel}`);
    const totals = element("div", "completed-review-totals");
    totals.append(summaryField("Photos", String(review.itemCount)), summaryField("Final sources", String(review.finalSourceCount)),
      summaryField("Revisions", String(review.revisionRoutedCount)), summaryField("Quick Edits", String(review.quickEditRoutedCount)));
    const decisions = element("ol", "completed-review-decisions");
    review.decisions.forEach((decision, index) => {
      const row = element("li", "");
      row.append(element("strong", "", `Photo ${index + 1} · ${decision.disposition.toLowerCase().replaceAll("_", " ")}`));
      if (decision.reason) row.append(element("p", "production-muted", `Note: ${decision.reason}`));
      if (decision.instructions) row.append(element("p", "production-muted", `Note: ${decision.instructions}`));
      decisions.append(row);
    });
    details.append(summary, totals, decisions); section.append(details);
  });
  return section;
}

async function submitEditorReview(context, batch, decisions, button) {
  markBusy(button, true, "Submitting…"); byId("operations-error").hidden = true; clearOperationsSuccess();
  try {
    button.dataset.idempotencyKey ||= newIdempotencyKey();
    await fetchJson(`/api/operations/orders/${encodeURIComponent(context.orderId)}/reviews/${encodeURIComponent(batch.reviewBatchId)}/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: button.dataset.idempotencyKey,
        expectedGeneration: batch.lifecycleGeneration, decisions }),
    });
    await refreshAfterContextualMutation(context, { workspace: "review", reviewBatchId: batch.reviewBatchId }, "Editor review submitted.");
  } catch (error) { operationsError(error instanceof Error ? error.message : "The editor review could not be submitted."); }
  finally { markBusy(button, false, "Submitting…"); }
}

async function startEditorReview(context, action, button) {
  markBusy(button, true, "Starting…"); byId("operations-error").hidden = true; clearOperationsSuccess();
  try {
    button.dataset.idempotencyKey ||= newIdempotencyKey();
    const receipt = await fetchJson(`/api/operations/orders/${encodeURIComponent(context.orderId)}/reviews/start`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: button.dataset.idempotencyKey, lane: action.lane }),
    });
    const batch = receipt.workspace?.activeReview;
    await refreshAfterContextualMutation(context, { workspace: "review", reviewBatchId: batch?.reviewBatchId || null },
      "Editor review started.");
  } catch (error) { operationsError(error instanceof Error ? error.message : "The editor review could not be started."); }
  finally { markBusy(button, false, "Starting…"); }
}

function renderReviewWorkspace(context, workspace, pane, focusedItemId = null, shouldFocus = false) {
  const batch = workspace?.activeReview;
  const roomKey = `review:${context.orderId}:${batch?.reviewBatchId || "no-active-batch"}`;
  if (operationsState.roomKey !== roomKey) {
    operationsState.reviewView = "single";
    operationsState.reviewGridSelectMode = false;
    operationsState.reviewGridSelection.clear();
  }
  setContextualRoomMode(true, roomKey); clearNode(pane); operationsState.roomNavigationGuard = null;
  pane.append(contextualRoomHeader(context, "Review Edits"));
  if (!workspace) {
    pane.append(detailSection("Review Edits unavailable", operationsState.reviewWorkspaceError || "Review status could not be loaded.")); return;
  }
  if (batch) {
    pane.append(contextualContextStrip(context));
    const items = Array.isArray(batch.items) ? batch.items : [];
    initializeReviewDrafts(context, batch, items);
    const progressSection = element("section", "review-progress");
    const progressCopy = element("div", "review-progress-copy");
    const progress = document.createElement("progress"); progress.max = Math.max(items.length, 1);
    progress.setAttribute("aria-label", "Editor review staged choice progress");
    const submitHost = element("div", "review-submit-host");
    const renderSelectedView = (reviewItemId, focus = false) => {
      writeOperationsRoute({ queue: operationsState.queue, orderId: context.orderId, workspace: "review",
        reviewBatchId: batch.reviewBatchId, reviewItemId }, "replace");
      renderReviewWorkspace(context, workspace, pane, reviewItemId, focus);
    };
    const changeView = (view) => {
      operationsState.reviewView = view;
      if (view !== "grid") {
        operationsState.reviewGridSelectMode = false;
        operationsState.reviewGridSelection.clear();
      }
      renderReviewWorkspace(context, workspace, pane, focusedItemId, false);
    };
    const updateProgress = () => {
      const decisions = stagedReviewDecisions(context, batch, items);
      clearNode(progressCopy); progressCopy.append(element("strong", "", `${decisions.length} of ${items.length} selected`));
      progress.value = decisions.length; clearNode(submitHost);
      if (decisions.length !== items.length || !items.length) return;
      const gate = element("section", "review-submit-gate");
      const submit = element("button", "button button-primary", "Submit Review"); submit.type = "button";
      submit.addEventListener("click", () => submitEditorReview(context, batch,
        stagedReviewDecisions(context, batch, items), submit)); gate.append(submit); submitHost.append(gate);
    };
    updateProgress(); progressSection.append(reviewViewToggle(changeView), progressCopy, progress); pane.append(progressSection);
    if (items.length) {
      const stageDraft = (stagedItem, disposition, noteOverride) => {
        const key = reviewDraftKey(context, batch, stagedItem);
        const previous = operationsState.roomDrafts.get(key);
        const keepNote = ["REJECT_REVISION", "QUICK_EDIT"].includes(disposition)
          ? (noteOverride === undefined ? previous?.note || "" : String(noteOverride || "").trim()) : "";
        operationsState.roomDrafts.set(key, { disposition, note: keepNote });
      };
      const selectItem = (item) => {
        const currentStrip = pane.querySelector(".review-filmstrip");
        if (!currentStrip) operationsState.reviewFilmstripPosition = null;
        operationsState.reviewView = "single";
        operationsState.reviewGridSelectMode = false;
        operationsState.reviewGridSelection.clear();
        renderSelectedView(item.reviewItemId, true);
      };
      if (operationsState.reviewView === "grid") {
        const rerenderGrid = () => renderReviewWorkspace(context, workspace, pane, focusedItemId, false);
        pane.append(reviewThumbnailGrid(context, batch, items, {
          onOpen: selectItem,
          onModeChange: (active) => {
            operationsState.reviewGridSelectMode = active;
            if (!active) operationsState.reviewGridSelection.clear();
            rerenderGrid();
          },
          onToggleSelection: (selectedItem) => {
            if (operationsState.reviewGridSelection.has(selectedItem.reviewItemId)) {
              operationsState.reviewGridSelection.delete(selectedItem.reviewItemId);
            } else {
              operationsState.reviewGridSelection.add(selectedItem.reviewItemId);
            }
            rerenderGrid();
          },
          onClearSelection: () => { operationsState.reviewGridSelection.clear(); rerenderGrid(); },
          onToggleAll: (selected) => {
            operationsState.reviewGridSelection.clear();
            if (selected) items.forEach((candidate) => operationsState.reviewGridSelection.add(candidate.reviewItemId));
            rerenderGrid();
          },
          onBulkStage: (disposition, batchNote) => {
            items.filter((candidate) => operationsState.reviewGridSelection.has(candidate.reviewItemId))
              .forEach((candidate) => stageDraft(candidate, disposition, batchNote));
            operationsState.reviewGridSelection.clear(); rerenderGrid();
          },
        }), submitHost);
      } else {
        const index = roomItemIndex(items, focusedItemId, "reviewItemId", true);
        const item = items[index];
        preloadAdjacentRoomMedia(context, items, index, "REVIEW_PREVIEW", batch.reviewBatchId);
        const onSingleStage = (stagedItem, disposition) => {
          stageDraft(stagedItem, disposition);
          if (disposition === "ACCEPT" && items[index + 1]) {
            renderSelectedView(items[index + 1].reviewItemId, true); return;
          }
          renderReviewWorkspace(context, workspace, pane, stagedItem.reviewItemId, false);
          window.requestAnimationFrame(() => {
            const target = ["REJECT_REVISION", "QUICK_EDIT"].includes(disposition)
              ? pane.querySelector(`[data-review-item-id="${stagedItem.reviewItemId}"] .review-note-slot textarea`)
              : pane.querySelector(`[data-review-item-id="${stagedItem.reviewItemId}"] [data-disposition="${disposition}"]`);
            target?.focus();
          });
        };
        const card = reviewDecisionCard(context, batch, item, onSingleStage);
        const move = (delta) => {
          const next = items[index + delta]; if (next) renderSelectedView(next.reviewItemId, true);
        };
        const stage = element("section", "contextual-room-stage review-single-stage");
        const filmstrip = reviewFilmstrip(context, batch, items, item, selectItem);
        card.querySelector(".review-media-figure")?.after(filmstrip);
        stage.append(card); pane.append(stage, submitHost);
        bindRoomCardNavigation(card, move); bindContextualRoomKeyboard(pane, move);
        writeOperationsRoute({ queue: operationsState.queue, orderId: context.orderId, workspace: "review",
          reviewBatchId: batch.reviewBatchId, reviewItemId: item.reviewItemId }, "replace");
        focusContextualCard(card, `Review photo ${index + 1} of ${items.length}`, shouldFocus);
      }
    } else {
      pane.append(detailSection("No returned photos", "This review batch does not contain a photo to review."));
    }
  } else {
    const readyAction = workspace.actions?.find((action) => action.code === "EDITOR_REVIEW_READY");
    const revisionAction = workspace.actions?.find((action) => action.code === "EDITOR_REVISION_REQUIRED");
    if (readyAction) {
      const ready = detailSection("Returned photos ready", "Start a bounded editor review before recording any decisions.");
      const start = element("button", "button button-primary", "Start editor review"); start.type = "button";
      start.addEventListener("click", () => startEditorReview(context, readyAction, start)); ready.append(start); pane.append(ready);
    } else if (revisionAction) {
      const pending = detailSection("Editor revision requested",
        "This listing stays in Needs attention until the revised photo returns; completed review history is below.");
      pending.classList.add("editor-revision-pending"); pane.append(pending);
    } else {
      pane.append(detailSection("No active editor review", "There are no returned photos awaiting a decision for this property."));
    }
  }
  const history = completedReviewHistory(workspace); if (history) pane.append(history);
}

function quickEditFileType(file) {
  if (["image/jpeg", "image/png"].includes(file.type)) return file.type;
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.png$/i.test(file.name)) return "image/png";
  return null;
}

function validQuickEditFile(file) {
  const filename = typeof file?.name === "string" ? file.name : "";
  return Boolean(file && quickEditFileType(file) && file.size > 0 && file.size <= MAXIMUM_QUICK_EDIT_BYTES &&
    filename.length > 0 && filename.length <= 255 && filename === filename.trim() && !/[\\/\u0000-\u001f\u007f]/u.test(filename));
}

async function uploadQuickEditRevision(context, item, input, button, message) {
  const files = input.files ? [...input.files] : [];
  const file = files.length === 1 ? files[0] : null;
  const mediaType = file ? quickEditFileType(file) : null;
  if (!file || !mediaType || !validQuickEditFile(file)) {
    input.setAttribute("aria-invalid", "true"); button.focus();
    message.textContent = "Choose one JPEG or PNG revision up to 25 MB from Camera Roll."; return;
  }
  input.removeAttribute("aria-invalid"); markBusy(button, true, "Uploading…");
  byId("operations-error").hidden = true; clearOperationsSuccess();
  try {
    button.dataset.idempotencyKey ||= newIdempotencyKey();
    const path = `/api/operations/orders/${encodeURIComponent(context.orderId)}/quick-edit/${encodeURIComponent(item.quickEditRequestId)}` +
      `/revision?idempotencyKey=${encodeURIComponent(button.dataset.idempotencyKey)}&filename=${encodeURIComponent(file.name)}`;
    await fetchJson(path, { method: "POST", headers: { "content-type": mediaType }, body: file });
    await refreshAfterContextualMutation(context,
      { workspace: "quick-edit", quickEditRequestId: item.quickEditRequestId },
      "Quick Edit revision uploaded and finalized.");
  } catch (error) { operationsError(error instanceof Error ? error.message : "The Quick Edit revision could not be uploaded."); }
  finally { markBusy(button, false, "Uploading…"); }
}

function quickEditCard(context, item, index) {
  const card = element("article", "quick-edit-card"); card.dataset.quickEditRequestId = item.quickEditRequestId; card.tabIndex = 0;
  card.append(reviewMediaFigure(context, item.reviewBatchId, item.reviewItemId, item.sourceVersion,
    "QUICK_EDIT_DOWNLOAD", item.downloadAvailable));
  const body = element("div", "quick-edit-body");
  const download = element("a", "button button-secondary quick-edit-download", "Download");
  download.href = reviewMediaUrl(context, item.reviewBatchId, item.reviewItemId, "QUICK_EDIT_DOWNLOAD");
  download.download = text(item.sourceVersion?.observedFilename, `quick-edit-${index + 1}.jpg`);
  if (!item.downloadAvailable) { download.removeAttribute("href"); download.setAttribute("aria-disabled", "true"); }
  const inputId = `quick-edit-file-${index}`;
  const input = document.createElement("input"); input.id = inputId; input.type = "file";
  input.accept = "image/jpeg,image/png,.jpg,.jpeg,.png"; input.multiple = false; input.hidden = true;
  const button = element("button", "button button-primary quick-edit-upload-button", "Upload Revision"); button.type = "button";
  const message = element("p", "quick-edit-upload-message", "");
  message.setAttribute("aria-live", "polite"); message.tabIndex = -1;
  let uploading = false;
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const files = input.files ? [...input.files] : [];
    const valid = files.length === 1 && validQuickEditFile(files[0]);
    delete button.dataset.idempotencyKey;
    if (!valid) {
      input.setAttribute("aria-invalid", "true");
      message.textContent = "Choose one JPEG or PNG revision up to 25 MB."; button.focus(); return;
    }
    input.removeAttribute("aria-invalid"); message.textContent = `${files[0].name} selected. Uploading now…`;
    uploading = true;
    try { await uploadQuickEditRevision(context, item, input, button, message); }
    finally { uploading = false; }
  });
  const actions = element("div", "quick-edit-actions"); actions.append(download, button, input);
  body.append(actions, message); card.append(body);
  const navigationBlocked = (options = {}) => {
    if (!uploading && !input.files?.length) return false;
    const warning = uploading ? "Wait for the revision upload to finish before moving to another Quick Edit." :
      "Choose a valid replacement with Upload Revision before moving to another Quick Edit.";
    message.textContent = warning; announceContextualRoom(warning);
    if (options.focus !== false) message.focus();
    return true;
  };
  return { card, navigationBlocked };
}

function renderQuickEditWorkspace(context, workspace, pane, focusedRequestId = null, shouldFocus = false) {
  const items = Array.isArray(workspace?.quickEdits) ? workspace.quickEdits : [];
  const roomKey = `quick-edit:${context.orderId}:${items.map((item) => item.quickEditRequestId).join(",") || "none"}`;
  setContextualRoomMode(true, roomKey); clearNode(pane); operationsState.roomNavigationGuard = null;
  pane.append(contextualRoomHeader(context, "Quick Edits"));
  if (!workspace) {
    pane.append(detailSection("Quick Edit unavailable", operationsState.reviewWorkspaceError || "Quick Edit status could not be loaded.")); return;
  }
  if (items.length) {
    pane.append(contextualContextStrip(context));
    const index = roomItemIndex(items, focusedRequestId, "quickEditRequestId");
    const item = items[index];
    preloadAdjacentRoomMedia(context, items, index, "QUICK_EDIT_DOWNLOAD");
    const rendered = quickEditCard(context, item, index);
    operationsState.roomNavigationGuard = rendered.navigationBlocked;
    const move = (delta) => {
      if (rendered.navigationBlocked()) return;
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= items.length) return;
      const next = items[nextIndex];
      writeOperationsRoute({ queue: operationsState.queue, orderId: context.orderId, workspace: "quick-edit",
        quickEditRequestId: next.quickEditRequestId }, "replace");
      renderQuickEditWorkspace(context, workspace, pane, next.quickEditRequestId, true);
    };
    const stage = element("section", "contextual-room-stage");
    stage.append(contextualRoomPager("Quick Edit", index, items.length, move), rendered.card); pane.append(stage);
    bindRoomCardNavigation(rendered.card, move); bindContextualRoomKeyboard(pane, move);
    writeOperationsRoute({ queue: operationsState.queue, orderId: context.orderId, workspace: "quick-edit",
      quickEditRequestId: item.quickEditRequestId }, "replace");
    focusContextualCard(rendered.card, `Quick Edit ${index + 1} of ${items.length}`, shouldFocus);
  } else {
    pane.append(detailSection("No outstanding Quick Edits", "There are no Quick Edit revisions awaiting upload for this property."));
  }
}

async function openOperationsDetail(orderId, options = {}) {
  if (!UUID_PATTERN.test(orderId || "")) return;
  const requestNumber = ++operationsState.detailRequest;
  const route = {
    workspace: CONTEXTUAL_WORKSPACES.includes(options.workspace) ? options.workspace : operationsState.selectedWorkspace,
    reviewBatchId: options.reviewBatchId || null,
    reviewItemId: options.reviewItemId || null,
    quickEditRequestId: options.quickEditRequestId || null,
  };
  operationsState.selectedOrderId = orderId; operationsState.selectedWorkspace = route.workspace; renderOperationsQueue();
  if (options.history) writeOperationsRoute({ queue: operationsState.queue, orderId, ...route }, options.history);
  const contextual = ["review", "quick-edit"].includes(route.workspace);
  if (contextual) {
    renderContextualRoomLoading(route.workspace);
    try {
      const workspace = await fetchJson(`/api/operations/orders/${encodeURIComponent(orderId)}/review-workspace`);
      if (requestNumber !== operationsState.detailRequest) return;
      operationsState.reviewWorkspace = workspace; operationsState.reviewWorkspaceError = null;
      const pane = ensureContextualRoom();
      if (route.workspace === "review") {
        renderReviewWorkspace(workspace.context, workspace, pane, route.reviewItemId, options.focus === true);
      } else {
        renderQuickEditWorkspace(workspace.context, workspace, pane, route.quickEditRequestId, options.focus === true);
      }
    } catch (error) {
      if (requestNumber !== operationsState.detailRequest) return;
      const message = error instanceof Error ? error.message : "The contextual task room could not be loaded.";
      operationsState.reviewWorkspace = null; operationsState.reviewWorkspaceError = message;
      renderContextualRoomUnavailable(orderId, route.workspace, message); operationsError(message);
    }
    return;
  }
  setContextualRoomMode(false);
  try {
    const context = await fetchJson(`/api/operations/orders/${encodeURIComponent(orderId)}`);
    if (requestNumber !== operationsState.detailRequest) return;
    let productionWorkspace = null;
    if (context.propertyHubId && context.scheduling && context.job) {
      const [candidates, productionResult] = await Promise.all([
        fetchJson(`/api/operations/assignment-candidates?organizationId=${encodeURIComponent(context.organizationId)}`),
        fetchJson(`/api/operations/orders/${encodeURIComponent(orderId)}/production`).catch(() => null),
      ]);
      if (requestNumber !== operationsState.detailRequest) return;
      operationsState.candidates = candidates.candidates || [];
      productionWorkspace = productionResult;
    }
    const detail = byId("operations-detail"); clearNode(detail);
  const header = element("div", "detail-header"); const heading = element("div", "detail-header-copy");
  heading.append(element("p", "eyebrow", "Selected property"), element("h3", "", operationsAddress(context)));
  const directions = element("a", "button button-primary", "Get Directions"); directions.href = directionsUrl(context);
    directions.target = "_blank"; directions.rel = "noopener noreferrer"; header.append(heading, directions);
    detail.append(header, missionControlSummary(context));
    if (!context.propertyHubId || !context.scheduling || !context.job) {
      const setup = detailSection("Start operational context", "Create the canonical Property Hub, Scheduling Request, Job, and one Workstream per ordered service as a single replay-safe action.");
      const button = actionButton("Start Mission Control"); button.addEventListener("click", () => runOperation(`/api/operations/orders/${context.orderId}/initialize`, {}, button)); setup.append(button); detail.append(setup); return;
    }
    const workspacePane = element("div", "mission-plan-pane production-workspace-pane");
    detail.append(productionWorkspaceSwitcher(context, workspacePane, route, productionWorkspace), workspacePane);
    if (options.focus) focusOperationsWorkspace(workspacePane, route.workspace, route);
  } catch (error) { operationsError(error instanceof Error ? error.message : "Operational context could not be loaded."); }
}

async function loadOperationsHome(showStatus = true) {
  const status = byId("operations-status"); if (showStatus) status.hidden = false;
  try {
    const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(from); to.setDate(to.getDate() + 60);
    const [home, reviewResult] = await Promise.all([
      fetchJson(`/api/operations?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      fetchJson("/api/operations/review-attention")
        .then((attention) => ({ attention, error: null }))
        .catch((error) => ({ attention: { items: [] }, error })),
    ]);
    operationsState.home = home; indexReviewAttention(reviewResult.attention);
    renderOperationsQueue(); status.hidden = true;
    if (reviewResult.error) operationsError(reviewResult.error instanceof Error ? reviewResult.error.message : "Review attention could not be loaded.");
  } catch (error) { status.hidden = true; operationsError(error instanceof Error ? error.message : "The operations queue could not be loaded."); }
}

async function initializeOperationsPage() {
  document.title = "Mission Control · MediaLab";
  document.body.classList.add("operations-mode");
  const route = readOperationsRoute();
  const activeDestination = route.section;
  operationsState.section = activeDestination;
  operationsState.queue = route.queue;
  operationsState.selectedWorkspace = route.workspace;
  document.querySelectorAll("[data-workspace-destination]").forEach((destination) => {
    if (destination.dataset.workspaceDestination === activeDestination) destination.setAttribute("aria-current", "page");
    else destination.removeAttribute("aria-current");
  });
  document.querySelector(".header-copy h1").textContent = "MISSION CONTROL";
  document.querySelector(".header-copy .eyebrow").hidden = true;
  document.querySelector(".header-copy .lede").hidden = true;
  document.querySelector(".boundary-notice").hidden = true;
  document.querySelector(".skip-link").href = "#operations-main"; document.querySelector(".skip-link").textContent = "Skip to Mission Control";
  document.querySelector(".progress-shell").hidden = true; byId("console-main").hidden = true; byId("operations-main").hidden = false;
  try {
    setQueuePressedState(); writeOperationsRoute(route, "replace");
    await fetchJson("/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    await loadOperationsHome();
    if (route.orderId) await openOperationsDetail(route.orderId, { ...route, history: null, focus: false });
  } catch (error) { operationsError(error instanceof Error ? error.message : "The local operator session is unavailable."); }
}

function clearOperationsDetail() {
  operationsState.detailRequest += 1;
  operationsState.selectedOrderId = null; operationsState.selectedWorkspace = "mission-plan";
  setContextualRoomMode(false);
  clearNode(byId("operations-detail"));
  byId("operations-detail").append(element("div", "empty-detail", "Select an order in this view to open its details."));
}

async function applyOperationsRouteFromHistory() {
  const route = readOperationsRoute(); operationsState.queue = route.queue; setQueuePressedState();
  operationsState.section = route.section;
  document.querySelectorAll("[data-workspace-destination]").forEach((destination) => {
    if (destination.dataset.workspaceDestination === route.section) destination.setAttribute("aria-current", "page");
    else destination.removeAttribute("aria-current");
  });
  if (!route.orderId) { clearOperationsDetail(); renderOperationsQueue(); return; }
  await openOperationsDetail(route.orderId, { ...route, history: null, focus: true });
}

if (typeof window !== "undefined" && typeof document !== "undefined" && window.location.pathname === "/operations") {
  document.querySelectorAll("[data-queue]").forEach((button) => button.addEventListener("click", () => {
    operationsState.queue = button.dataset.queue; setQueuePressedState();
    if (operationsState.selectedOrderId && !queueItems().some((item) => item.orderId === operationsState.selectedOrderId)) {
      clearOperationsDetail();
    }
    const current = readOperationsRoute();
    writeOperationsRoute({ ...current, queue: operationsState.queue, orderId: operationsState.selectedOrderId,
      workspace: operationsState.selectedOrderId ? operationsState.selectedWorkspace : "mission-plan" }, "push");
    renderOperationsQueue();
  }));
  byId("operations-list").addEventListener("click", (event) => {
    const contextual = event.target.closest("[data-context-workspace]");
    if (contextual) {
      openOperationsDetail(contextual.dataset.orderId, { workspace: contextual.dataset.contextWorkspace,
        history: "push", focus: true }); return;
    }
    const card = event.target.closest("[data-order-id]");
    if (card) openOperationsDetail(card.dataset.orderId, { workspace: "mission-plan", history: "push", focus: true });
  });
  byId("refresh-operations").addEventListener("click", () => loadOperationsHome());
  window.addEventListener("beforeunload", (event) => {
    if (!operationsState.roomNavigationGuard?.({ focus: false })) return;
    event.preventDefault(); event.returnValue = "";
  });
  window.addEventListener("popstate", () => {
    if (operationsState.restoringRoomHistory) { operationsState.restoringRoomHistory = false; return; }
    if (operationsState.roomNavigationGuard?.()) {
      operationsState.restoringRoomHistory = true; window.history.forward(); return;
    }
    applyOperationsRouteFromHistory().catch((error) =>
      operationsError(error instanceof Error ? error.message : "The requested Mission Control view could not be restored."));
  });
  initializeOperationsPage();
} else if (typeof window !== "undefined" && typeof document !== "undefined") {
  bindEvents(); initialize();
}
