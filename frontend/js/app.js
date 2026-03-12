// ==================== app.js ====================
// Cadastro • Editar • Admin Login • Painel Admin

const getApiBaseUrl = () => {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (isLocalhost) return "http://localhost:3001";
  return "https://lonesturismo.onrender.com";
};

const API = getApiBaseUrl();
const MAX_PASSENGERS = 70;
const INITIAL_PASSENGERS = 46;
const PASSENGER_STEP = 5;

const ADMIN_SESSION_KEY = "adminSessionStartedAt";
const ADMIN_SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hora

// ==================== HELPERS ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const getQS = (name) => new URLSearchParams(window.location.search).get(name);

const onlyDigits = (str) => (str || "").replace(/\D/g, "");

const formatCPF = (val) => {
  const cpf = onlyDigits(val).slice(0, 11);
  if (cpf.length <= 3) return cpf;
  if (cpf.length <= 6) return cpf.replace(/(\d{3})(\d+)/, "$1.$2");
  if (cpf.length <= 9) return cpf.replace(/(\d{3})(\d{3})(\d+)/, "$1.$2.$3");
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, "$1.$2.$3-$4");
};

const formatPhone = (val) => {
  const phone = onlyDigits(val).slice(0, 11);
  if (phone.length <= 2) return phone;
  if (phone.length <= 6) return phone.replace(/(\d{2})(\d+)/, "($1) $2");
  if (phone.length <= 10) return phone.replace(/(\d{2})(\d{4})(\d+)/, "($1) $2-$3");
  return phone.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
};

const sanitize = (str) => {
  if (str == null) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
};

function setTripSession(id, pin) {
  sessionStorage.setItem("tripId", id);
  sessionStorage.setItem("tripPin", pin);
}

function getTripSession() {
  return {
    tripId: sessionStorage.getItem("tripId"),
    tripPin: sessionStorage.getItem("tripPin")
  };
}

function clearTripSession() {
  sessionStorage.removeItem("tripId");
  sessionStorage.removeItem("tripPin");
}

function showEl(el, display = "block") {
  if (el) el.style.display = display;
}

function hideEl(el) {
  if (el) el.style.display = "none";
}

function setLoading(btn, isLoading, loadingText = "Processando...") {
  if (!btn) return;

  if (isLoading) {
    if (!btn.dataset.originalText) btn.dataset.originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingText;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

function setButtonEnabled(btn, enabled) {
  if (!btn) return;
  btn.disabled = !enabled;

  if (enabled) {
    btn.classList.remove("opacity-50", "cursor-not-allowed");
    btn.removeAttribute("aria-disabled");
  } else {
    btn.classList.add("opacity-50", "cursor-not-allowed");
    btn.setAttribute("aria-disabled", "true");
  }
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.right = "20px";
  toast.style.bottom = "20px";
  toast.style.zIndex = "9999";
  toast.style.padding = "12px 16px";
  toast.style.borderRadius = "12px";
  toast.style.color = "#fff";
  toast.style.boxShadow = "0 10px 25px rgba(0,0,0,0.18)";
  toast.style.maxWidth = "320px";
  toast.style.fontSize = "14px";
  toast.style.lineHeight = "1.4";
  toast.style.background =
    type === "error" ? "#b91c1c" :
    type === "warning" ? "#b45309" :
    "#047857";

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function getSelectedFileNames(files) {
  if (!files?.length) return [];
  return [...files].map((file) => file.name);
}

function updateFileInputUI(input) {
  if (!input) return;

  const wrapper = input.closest(".file-upload");
  if (!wrapper) return;

  const buttonText = wrapper.querySelector(".file-upload-text");
  const names = getSelectedFileNames(input.files);

  if (!buttonText) return;

  if (!names.length) {
    buttonText.textContent = "Escolher arquivos";
    buttonText.title = "";
    return;
  }

  const fullText = names.join(", ");
  buttonText.textContent = fullText;
  buttonText.title = fullText;
}

function clearFileInputUI(input) {
  if (!input) return;
  input.value = "";
  updateFileInputUI(input);
}

// ==================== PERSISTÊNCIA DE LINHAS ====================
function getTripRowsStorageKey(tripId) {
  return `tripVisibleRows:${tripId}`;
}

function saveTripVisibleRows(tripId, rows) {
  if (!tripId) return;
  const safeRows = Math.max(
    INITIAL_PASSENGERS,
    Math.min(MAX_PASSENGERS, Number(rows) || INITIAL_PASSENGERS)
  );
  localStorage.setItem(getTripRowsStorageKey(tripId), String(safeRows));
}

function getTripVisibleRows(tripId) {
  if (!tripId) return null;
  const saved = Number(localStorage.getItem(getTripRowsStorageKey(tripId)));
  if (!saved) return null;
  return Math.max(INITIAL_PASSENGERS, Math.min(MAX_PASSENGERS, saved));
}

function clearTripVisibleRows(tripId) {
  if (!tripId) return;
  localStorage.removeItem(getTripRowsStorageKey(tripId));
}

// ==================== SESSÃO ADMIN ====================
function getAdminToken() {
  return localStorage.getItem("adminToken");
}

function setAdminSession(token) {
  localStorage.setItem("adminToken", token);
  localStorage.setItem(ADMIN_SESSION_KEY, String(Date.now()));
}

function clearAdminSession() {
  localStorage.removeItem("adminToken");
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

function isAdminSessionExpired() {
  const startedAt = Number(localStorage.getItem(ADMIN_SESSION_KEY) || 0);
  if (!startedAt) return true;
  return Date.now() - startedAt >= ADMIN_SESSION_DURATION_MS;
}

function touchAdminSession() {
  if (getAdminToken()) {
    localStorage.setItem(ADMIN_SESSION_KEY, String(Date.now()));
  }
}

function scheduleAdminAutoLogout() {
  const token = getAdminToken();
  const startedAt = Number(localStorage.getItem(ADMIN_SESSION_KEY) || 0);

  if (!token || !startedAt) return;

  const remaining = ADMIN_SESSION_DURATION_MS - (Date.now() - startedAt);

  if (remaining <= 0) {
    clearAdminSession();
    showToast("Sessão expirada. Faça login novamente.", "warning");
    if (window.location.pathname !== "/admin") {
      window.location.href = "/admin";
    }
    return;
  }

  setTimeout(() => {
    clearAdminSession();
    showToast("Sessão expirada. Faça login novamente.", "warning");
    if (window.location.pathname !== "/admin") {
      window.location.href = "/admin";
    }
  }, remaining);
}

// ==================== API ====================
const api = {
  async request(ep, method = "GET", body = null, admin = false) {
    const headers = {};

    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    if (admin) {
      const token = getAdminToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API}${ep}`, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body != null
          ? JSON.stringify(body)
          : undefined
    });

    if (res.status === 401 && admin) {
      clearAdminSession();
      if (window.location.pathname !== "/admin") {
        window.location.href = "/admin";
      }
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json();
    }

    return null;
  },

  get: (ep, admin = false) => api.request(ep, "GET", null, admin),
  post: (ep, body, admin = false) => api.request(ep, "POST", body, admin),
  put: (ep, body, admin = false) => api.request(ep, "PUT", body, admin),
  del: (ep, body, admin = false) => api.request(ep, "DELETE", body, admin)
};

// ==================== DOWNLOAD ADMIN ====================
const downloadWithAuth = async (url, fallbackName = "arquivo.zip") => {
  const token = getAdminToken();

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (res.status === 401) {
    clearAdminSession();
    window.location.href = "/admin";
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const cd = res.headers.get("content-disposition");
  const filename = cd?.match(/filename="([^"]+)"/i)?.[1] || fallbackName;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
};

// ==================== UPLOAD DOCUMENTOS ====================
async function uploadDocs(tripId, passengerId, pin, files) {
  if (!files?.length) return;
  if (files.length > 4) throw new Error("Máximo de 4 arquivos por passageiro.");

  const fd = new FormData();
  fd.append("pin", pin);
  [...files].forEach((f) => fd.append("docs", f)); // server.js espera "docs"

  const res = await fetch(`${API}/api/trips/${tripId}/passengers/${passengerId}/documents`, {
    method: "POST",
    body: fd
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Erro no upload dos documentos");
}

// ==================== ESTADO ====================
const publicState = {
  currentTrip: null,
  currentPassengers: [],
  visibleRows: INITIAL_PASSENGERS,
  autosaveBusy: false
};

// ==================== TELA PÚBLICA ====================
function getTripEditor() {
  return $("#tripEditor") || $("#editArea");
}

function showTripEditor() {
  const cadastroEditor = $("#tripEditor");
  const editArea = $("#editArea");

  if (cadastroEditor) {
    cadastroEditor.classList.remove("hidden-block");
    cadastroEditor.style.display = "block";
  }

  if (editArea) {
    editArea.classList.remove("hidden-block");
    editArea.style.display = "block";
  }
}

function hideTripEditor() {
  const cadastroEditor = $("#tripEditor");
  const editArea = $("#editArea");

  if (cadastroEditor) {
    cadastroEditor.classList.add("hidden-block");
    cadastroEditor.style.display = "none";
  }

  if (editArea) {
    editArea.classList.add("hidden-block");
    editArea.style.display = "none";
  }
}

function resetCadastroPage() {
  clearTripSession();
  publicState.currentTrip = null;
  publicState.currentPassengers = [];
  publicState.visibleRows = INITIAL_PASSENGERS;

  const form = $("#createTripForm");
  if (form) form.reset();

  const tripInfo = $("#tripInfo");
  if (tripInfo) {
    tripInfo.classList.add("empty");
    tripInfo.innerHTML = "Nenhuma lista criada ainda.";
  }

  const tripHeader = $("#tripHeader");
  if (tripHeader) tripHeader.textContent = "Passageiros";

  const tripHint = $("#tripHint");
  if (tripHint) tripHint.textContent = "";

  const tbody = $("#passengerRows");
  if (tbody) tbody.innerHTML = "";

  const count = $("#filledCount");
  if (count) count.textContent = `0 / ${INITIAL_PASSENGERS}`;

  hideTripEditor();
  updateAddMoreRowsButton();
}

function updateFilledCount() {
  const rows = $$("#passengerRows tr");
  const filledCount = $("#filledCount");
  if (!filledCount) return;

  let filled = 0;

  rows.forEach((row) => {
    const name = row.querySelector(".row-name")?.value.trim() || "";
    const cpf = onlyDigits(row.querySelector(".row-cpf")?.value || "");
    const phone = onlyDigits(row.querySelector(".row-phone")?.value || "");
    if (name || cpf || phone) filled++;
  });

  filledCount.textContent = `${filled} / ${publicState.visibleRows}`;
}

function updateAddMoreRowsButton() {
  const btn = $("#btnAddMoreRows");
  if (!btn) return;

  const reachedLimit = publicState.visibleRows >= MAX_PASSENGERS;
  btn.disabled = reachedLimit;

  if (reachedLimit) {
    btn.textContent = "Limite máximo atingido";
    btn.classList.add("opacity-50", "cursor-not-allowed");
  } else {
    btn.textContent = "Adicionar +5 passageiros";
    btn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}

function getRowsToRender(existingPassengers = [], tripId = null, tripVisibleRows = null) {
  const existingCount = Array.isArray(existingPassengers) ? existingPassengers.length : 0;
  const savedRows = getTripVisibleRows(tripId) || 0;
  const backendRows = Number(tripVisibleRows) || 0;
  const currentCount = Number(publicState.visibleRows) || INITIAL_PASSENGERS;

  return Math.min(
    MAX_PASSENGERS,
    Math.max(INITIAL_PASSENGERS, currentCount, existingCount, savedRows, backendRows)
  );
}

function buildPassengerRow(index, passenger = {}) {
  return `
    <tr data-index="${index}" data-passenger-id="${sanitize(passenger.id || "")}">
      <td>${index + 1}</td>
      <td>
        <input
          type="text"
          class="row-name"
          maxlength="100"
          placeholder="Nome completo"
          value="${sanitize(passenger.name || "")}"
        >
      </td>
      <td>
        <input
          type="text"
          class="row-cpf"
          maxlength="14"
          placeholder="000.000.000-00"
          value="${sanitize(passenger.cpf ? formatCPF(passenger.cpf) : "")}"
        >
      </td>
      <td>
        <input
          type="text"
          class="row-phone"
          maxlength="15"
          placeholder="(99) 99999-9999"
          value="${sanitize(passenger.phone ? formatPhone(passenger.phone) : "")}"
        >
      </td>
      <td>
        <div class="file-upload">
          <label class="file-upload-btn">
            <span class="file-upload-text">Escolher arquivos</span>
            <input
              type="file"
              class="row-file"
              accept=".jpg,.jpeg,.png,.pdf"
              multiple
            >
          </label>
        </div>
      </td>
      <td>
        <button type="button" class="btn danger btn-remove-local-file">Remover</button>
      </td>
    </tr>
  `;
}

function renderPassengerRows(existingPassengers = [], tripId = null, tripVisibleRows = null) {
  const tbody = $("#passengerRows");
  if (!tbody) return;

  publicState.visibleRows = getRowsToRender(existingPassengers, tripId, tripVisibleRows);
  tbody.innerHTML = "";

  for (let i = 0; i < publicState.visibleRows; i++) {
    tbody.insertAdjacentHTML("beforeend", buildPassengerRow(i, existingPassengers[i] || {}));
  }

  if (tripId) {
    saveTripVisibleRows(tripId, publicState.visibleRows);
  }

  updateFilledCount();
  updateAddMoreRowsButton();
}

async function persistVisibleRows() {
  const { tripId, tripPin } = getTripSession();
  if (!tripId || !tripPin) return;

  await api.put(`/api/trips/${tripId}/visible-rows`, {
    pin: tripPin,
    visibleRows: publicState.visibleRows
  });
  saveTripVisibleRows(tripId, publicState.visibleRows);
}

async function addMorePassengerRows() {
  const tbody = $("#passengerRows");
  if (!tbody) return;

  if (publicState.visibleRows >= MAX_PASSENGERS) {
    updateAddMoreRowsButton();
    return;
  }

  const nextTotal = Math.min(MAX_PASSENGERS, publicState.visibleRows + PASSENGER_STEP);

  for (let i = publicState.visibleRows; i < nextTotal; i++) {
    tbody.insertAdjacentHTML("beforeend", buildPassengerRow(i));
  }

  publicState.visibleRows = nextTotal;

  try {
    await persistVisibleRows();
  } catch (e) {
    showToast(e.message || "Erro ao atualizar quantidade de linhas", "error");
  }

  updateFilledCount();
  updateAddMoreRowsButton();
}

function setTripInfo(trip, pin = "") {
  const tripInfo = $("#tripInfo");
  if (tripInfo && trip?.id) {
    tripInfo.classList.remove("empty");
    tripInfo.innerHTML = `
      Viagem criada/carregada: <b>${sanitize(trip.id)}</b>
      ${pin ? ` • PIN: <b>${sanitize(pin)}</b>` : ""}
      <br>
      ${sanitize(trip.destination || "")} • ${sanitize(trip.dateIso || trip.date_iso || "")}
      • Resp: ${sanitize(trip.responsible || "")}
    `;
  }

  const tripHeader = $("#tripHeader");
  if (tripHeader) {
    if ($("#editArea")) {
      tripHeader.textContent = `🆔 ${sanitize(trip.id)} • ${sanitize(trip.destination)} • ${sanitize(trip.dateIso || trip.date_iso || "")}`;
    } else {
      tripHeader.textContent = "Passageiros";
    }
  }

  const tripHint = $("#tripHint");
  if (tripHint && trip?.id) {
    tripHint.textContent = `ID: ${trip.id} • ${trip.destination || ""} • ${trip.dateIso || trip.date_iso || ""}`;
  }
}

function getRowData(row) {
  return {
    row,
    passengerId: row.dataset.passengerId || "",
    name: row.querySelector(".row-name")?.value.trim() || "",
    cpf: onlyDigits(row.querySelector(".row-cpf")?.value || ""),
    phone: onlyDigits(row.querySelector(".row-phone")?.value || ""),
    files: row.querySelector(".row-file")?.files || []
  };
}

function isRowEmpty(rowData) {
  return !rowData.name && !rowData.cpf && !rowData.phone && !rowData.files?.length;
}

async function addPassenger(tripId, pin, name, cpf, phone, files) {
  const data = await api.post(`/api/trips/${tripId}/passengers`, {
    pin,
    name,
    cpf,
    phone
  });

  const passengerId = data?.passenger?.id || "";

  if (files?.length && passengerId) {
    await uploadDocs(tripId, passengerId, pin, files);
  }

  return data;
}

async function saveSingleRow(row, options = {}) {
  const { silent = false, trigger = "manual" } = options;
  const { tripId, tripPin } = getTripSession();

  if (!tripId || !tripPin) {
    if (!silent) showToast("Crie ou carregue uma lista primeiro", "error");
    return false;
  }

  const rowData = getRowData(row);
  const fileInput = row.querySelector(".row-file");

  if (isRowEmpty(rowData)) {
    if (rowData.passengerId) {
      await api.del(`/api/trips/${tripId}/passengers/${rowData.passengerId}`, { pin: tripPin });
      row.dataset.passengerId = "";
      clearFileInputUI(fileInput);
      if (!silent) showToast("Linha removida da lista", "success");
    }
    updateFilledCount();
    return true;
  }

  if (!rowData.name) {
    if (!silent) showToast("Preencha o nome antes de salvar o CPF", "warning");
    return false;
  }

  if (rowData.cpf.length !== 11) {
    if (!silent) showToast("CPF inválido", "error");
    return false;
  }

  if (rowData.passengerId) {
    await api.put(`/api/trips/${tripId}/passengers/${rowData.passengerId}`, {
      pin: tripPin,
      name: rowData.name,
      cpf: rowData.cpf,
      phone: rowData.phone
    });

    if (rowData.files?.length) {
      await uploadDocs(tripId, rowData.passengerId, tripPin, rowData.files);
      clearFileInputUI(fileInput);
    }

    if (!silent) {
      showToast(
        trigger === "autosave"
          ? `Passageiro ${rowData.name} salvo automaticamente`
          : `Passageiro ${rowData.name} salvo`,
        "success"
      );
    }

    updateFilledCount();
    return true;
  }

  const created = await addPassenger(
    tripId,
    tripPin,
    rowData.name,
    rowData.cpf,
    rowData.phone,
    rowData.files
  );

  const createdPassengerId = created?.passenger?.id || "";
  if (createdPassengerId) {
    row.dataset.passengerId = createdPassengerId;
  }

  if (rowData.files?.length) {
    clearFileInputUI(fileInput);
  }

  if (!silent) {
    showToast(
      trigger === "autosave"
        ? `Passageiro ${rowData.name} salvo automaticamente`
        : `Passageiro ${rowData.name} salvo`,
      "success"
    );
  }

  updateFilledCount();
  return true;
}

async function createTrip() {
  const btn = $("#btnCreateTrip");
  const destination = $("#destination")?.value.trim();
  const dateIso = $("#dateIso")?.value.trim();
  const responsible = $("#responsible")?.value.trim();

  if (!destination || !dateIso || !responsible) {
    showToast("Preencha todos os campos", "error");
    return;
  }

  try {
    setLoading(btn, true, "Criando...");
    const data = await api.post("/api/trips", { destination, dateIso, responsible });

    const trip = data?.trip;
    if (!trip?.id || !trip?.pin) {
      throw new Error("Resposta inválida ao criar a viagem");
    }

    setTripSession(trip.id, trip.pin);
    saveTripVisibleRows(trip.id, trip.visibleRows || INITIAL_PASSENGERS);

    publicState.currentTrip = trip;
    publicState.currentPassengers = [];
    publicState.visibleRows = trip.visibleRows || INITIAL_PASSENGERS;

    setTripInfo(trip, trip.pin);
    renderPassengerRows([], trip.id, trip.visibleRows);
    showTripEditor();

    const editor = $("#tripEditor");
    if (editor) {
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (window.__enablePublicActionButtons) {
      window.__enablePublicActionButtons();
    }

    showToast(`Viagem criada! ID: ${trip.id} | PIN: ${trip.pin}`, "success");
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function loadTripData(tripId, pin) {
  await api.post(`/api/trips/${tripId}/verify-pin`, { pin });

  const data = await api.get(`/api/trips/${tripId}?pin=${encodeURIComponent(pin)}`);
  const trip = data?.trip;

  if (!trip?.id) {
    throw new Error("Não foi possível carregar a lista");
  }

  setTripSession(tripId, pin);
  publicState.currentTrip = { ...trip, pin };
  publicState.currentPassengers = data.passengers || [];
  publicState.visibleRows = getRowsToRender(data.passengers || [], tripId, trip.visibleRows);

  setTripInfo(trip, pin);
  renderPassengerRows(publicState.currentPassengers, tripId, trip.visibleRows);
  showTripEditor();

  if (window.__enablePublicActionButtons) {
    window.__enablePublicActionButtons();
  }
}

async function loadTripForEdit() {
  const btn = $("#btnLoadTrip");
  const tripId = $("#editTripId")?.value.trim();
  const pin = $("#editPin")?.value.trim();
  const err = $("#editError");

  if (err) err.textContent = "";

  if (!tripId || !pin) {
    if (err) err.textContent = "Informe ID e PIN";
    else showToast("Informe ID e PIN", "error");
    return;
  }

  try {
    setLoading(btn, true, "Entrando...");
    await loadTripData(tripId, pin);
    showToast("Lista carregada com sucesso!", "success");
  } catch (e) {
    if (err) err.textContent = e.message;
    else showToast(e.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function savePassengerRows() {
  const btn = $("#btnSaveRows");
  const { tripId, tripPin } = getTripSession();

  if (!tripId || !tripPin) {
    showToast("Crie ou carregue uma lista primeiro", "error");
    return;
  }

  const rows = [...$$("#passengerRows tr")];

  try {
    setLoading(btn, true, "Salvando...");

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowData = getRowData(row);

      if (isRowEmpty(rowData)) {
        if (rowData.passengerId) {
          await api.del(`/api/trips/${tripId}/passengers/${rowData.passengerId}`, { pin: tripPin });
          row.dataset.passengerId = "";
          clearFileInputUI(row.querySelector(".row-file"));
        }
        continue;
      }

      if (!rowData.name) {
        throw new Error(`A linha ${index + 1} precisa ter nome`);
      }

      if (rowData.cpf.length !== 11) {
        throw new Error(`CPF inválido na linha ${index + 1}`);
      }

      await saveSingleRow(row, { silent: true, trigger: "manual" });
    }

    await persistVisibleRows();
    await loadTripData(tripId, tripPin);
    showToast("Lista salva com sucesso!", "success");
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

// ==================== EVENTOS PÚBLICOS ====================
function initPublicPages() {
  const hasPublicPage =
    $("#btnCreateTrip") ||
    $("#btnLoadTrip") ||
    $("#btnSaveRows") ||
    $("#passengerRows");

  if (!hasPublicPage) return;

  hideTripEditor();

  const btnCopy = $("#btnCopyTrip");
  const btnWhats = $("#btnWhatsapp");
  const btnSave = $("#btnSaveRows");
  const btnGoEdit = $("#btnGoEdit");

  function disableActionButtons() {
    [btnCopy, btnWhats, btnSave].forEach((btn) => setButtonEnabled(btn, false));
    if (btnGoEdit) setButtonEnabled(btnGoEdit, true);
  }

  function enableActionButtons() {
    [btnCopy, btnWhats, btnSave, btnGoEdit].forEach((btn) => setButtonEnabled(btn, true));
  }

  window.__enablePublicActionButtons = enableActionButtons;

  const isCadastroPage = !!$("#btnCreateTrip") && !$("#btnLoadTrip");
  const isEditPage = !!$("#btnLoadTrip");

  const qid = getQS("id");
  const qpin = getQS("pin");

  if (qid && $("#editTripId")) $("#editTripId").value = qid;
  if (qpin && $("#editPin")) $("#editPin").value = qpin;

  if (isCadastroPage) {
    resetCadastroPage();
    disableActionButtons();
  }

  if (isEditPage) {
    disableActionButtons();

    const { tripId, tripPin } = getTripSession();
    const prefTripId = qid || tripId;
    const prefPin = qpin || tripPin;

    if (prefTripId && prefPin) {
      loadTripData(prefTripId, prefPin)
        .then(() => {
          if ($("#editTripId")) $("#editTripId").value = prefTripId;
          if ($("#editPin")) $("#editPin").value = prefPin;
          enableActionButtons();
        })
        .catch(() => {
          clearTripSession();
          hideTripEditor();
          disableActionButtons();
        });
    }
  }

  function validateCreateForm() {
    const dest = $("#destination")?.value.trim() || "";
    const date = $("#dateIso")?.value.trim() || "";
    const resp = $("#responsible")?.value.trim() || "";
    const btn = $("#btnCreateTrip");

    const isValid = dest.length >= 3 && date.length > 0 && resp.length >= 3;
    setButtonEnabled(btn, isValid);
    return isValid;
  }

  validateCreateForm();

  document.addEventListener("input", (e) => {
    if (e.target.classList.contains("row-cpf")) {
      e.target.value = formatCPF(e.target.value);
    }

    if (e.target.classList.contains("row-phone")) {
      e.target.value = formatPhone(e.target.value);
    }

    if (
      e.target.classList.contains("row-name") ||
      e.target.classList.contains("row-cpf") ||
      e.target.classList.contains("row-phone")
    ) {
      updateFilledCount();
    }

    if (
      e.target.id === "destination" ||
      e.target.id === "dateIso" ||
      e.target.id === "responsible"
    ) {
      validateCreateForm();
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.classList.contains("row-file")) {
      updateFileInputUI(e.target);
    }
  });

  document.addEventListener("blur", async (e) => {
    if (!e.target.classList.contains("row-cpf")) return;

    const row = e.target.closest("tr");
    if (!row) return;

    const rowData = getRowData(row);

    if (!rowData.cpf) {
      updateFilledCount();
      return;
    }

    if (!rowData.name) {
      showToast("Preencha o nome antes do CPF para salvar automaticamente", "warning");
      return;
    }

    if (rowData.cpf.length !== 11) {
      showToast("CPF inválido para salvar automaticamente", "error");
      return;
    }

    if (publicState.autosaveBusy) return;

    try {
      publicState.autosaveBusy = true;
      await saveSingleRow(row, { silent: false, trigger: "autosave" });
    } catch (e2) {
      showToast(e2.message, "error");
    } finally {
      publicState.autosaveBusy = false;
    }
  }, true);

  document.addEventListener("keydown", async (e) => {
    if (!e.target.classList.contains("row-cpf")) return;
    if (e.key !== "Enter") return;

    e.preventDefault();

    const row = e.target.closest("tr");
    if (!row) return;

    const rowData = getRowData(row);

    if (!rowData.cpf || !rowData.name || rowData.cpf.length !== 11) return;
    if (publicState.autosaveBusy) return;

    try {
      publicState.autosaveBusy = true;
      await saveSingleRow(row, { silent: false, trigger: "autosave" });
    } catch (e2) {
      showToast(e2.message, "error");
    } finally {
      publicState.autosaveBusy = false;
    }
  });

  $("#btnCreateTrip")?.addEventListener("click", createTrip);
  $("#btnLoadTrip")?.addEventListener("click", loadTripForEdit);
  $("#btnSaveRows")?.addEventListener("click", savePassengerRows);
  $("#btnAddMoreRows")?.addEventListener("click", addMorePassengerRows);

  $("#btnCopyTrip")?.addEventListener("click", async () => {
    const { tripId, tripPin } = getTripSession();
    if (!tripId || !tripPin) {
      showToast("Nenhuma lista criada/carregada ainda", "warning");
      return;
    }

    const text = `ID: ${tripId} | PIN: ${tripPin}`;

    try {
      await navigator.clipboard.writeText(text);
      showToast("ID + PIN copiados!", "success");
    } catch {
      showToast(text, "warning");
    }
  });

  $("#btnWhatsapp")?.addEventListener("click", () => {
    const { tripId, tripPin } = getTripSession();
    if (!tripId || !tripPin) {
      showToast("Crie ou carregue uma lista primeiro", "warning");
      return;
    }

    const trip = publicState.currentTrip || {};
    const dateText = trip.dateIso || trip.date_iso || "";

    const text = [
      "🚌 Excursão Lones Turismo",
      "",
      trip.destination ? `Destino: ${trip.destination}` : null,
      dateText ? `Data: ${dateText}` : null,
      trip.responsible ? `Responsável: ${trip.responsible}` : null,
      "",
      `ID: ${tripId}`,
      `PIN: ${tripPin}`,
      "",
      `Acesse: ${window.location.origin}/editar?id=${encodeURIComponent(tripId)}&pin=${encodeURIComponent(tripPin)}`
    ].filter(Boolean).join("\n");

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  });

  $("#btnGoEdit")?.addEventListener("click", (e) => {
    e.preventDefault();
    const { tripId, tripPin } = getTripSession();
    if (tripId && tripPin) {
      window.location.href = `/editar?id=${encodeURIComponent(tripId)}&pin=${encodeURIComponent(tripPin)}`;
      return;
    }
    window.location.href = "/editar";
  });

  $("#passengerRows")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-remove-local-file");
    if (!btn) return;

    const row = btn.closest("tr");
    const fileInput = row?.querySelector(".row-file");
    clearFileInputUI(fileInput);
    showToast("Anexo local removido da linha", "success");
  });
}

// ==================== LOGIN ADMIN ====================
function initAdminPage() {
  const btnLogin = $("#btnAdminLogin");
  if (!btnLogin) return;

  clearAdminSession();

  const handleLogin = async () => {
    const btn = $("#btnAdminLogin");
    const user = $("#admUser")?.value.trim();
    const pass = $("#admPass")?.value.trim();
    const err = $("#admError");

    if (err) err.textContent = "";

    if (!user || !pass) {
      if (err) err.textContent = "Informe usuário e senha";
      else showToast("Informe usuário e senha", "error");
      return;
    }

    try {
      setLoading(btn, true, "Entrando...");
      const data = await api.post("/api/admin/login", { user, pass });

      if (!data?.token) {
        throw new Error("Token não recebido");
      }

      setAdminSession(data.token);
      showToast("Login realizado com sucesso!", "success");
      window.location.href = "/painel";
    } catch (e) {
      if (err) err.textContent = e.message;
      else showToast(e.message, "error");
    } finally {
      setLoading(btn, false);
    }
  };

  btnLogin.addEventListener("click", handleLogin);

  ["#admUser", "#admPass"].forEach((sel) => {
    $(sel)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleLogin();
      }
    });
  });
}

// ==================== PAINEL ADMIN ====================
function initPainelPage() {
  if (!$("#tabs")) return;

  const token = getAdminToken();
  if (!token || isAdminSessionExpired()) {
    clearAdminSession();
    window.location.href = "/admin";
    return;
  }

  touchAdminSession();
  scheduleAdminAutoLogout();

  const painelContent = $("#painelContent");
  if (painelContent) painelContent.style.display = "block";

  const els = {
    tabs: $("#tabs"),
    tbody: $("#tbody"),
    titulo: $("#viagemTitulo"),
    info: $("#viagemInfo"),
    btnEditar: $("#btnEditar"),
    btnZip: $("#btnZip"),
    btnApagar: $("#btnApagar")
  };

  const state = {
    trips: [],
    selectedTrip: null,
    isLoading: false
  };

  function setPainelButtonsEnabled(enabled) {
    setButtonEnabled(els.btnEditar, enabled);
    setButtonEnabled(els.btnZip, enabled);
    setButtonEnabled(els.btnApagar, enabled);
  }

  function renderAdminPassengers(passengers) {
    if (!els.tbody) return;

    els.tbody.innerHTML = passengers?.length
      ? passengers.map((p) => `
          <tr>
            <td>${sanitize(p.name || "")}</td>
            <td>${sanitize(formatCPF(p.cpf || ""))}</td>
            <td>${sanitize(formatPhone(p.phone || ""))}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="3" class="muted">Nenhum passageiro cadastrado.</td></tr>`;
  }

  function renderTabs() {
    if (!els.tabs) return;

    if (!state.trips.length) {
      els.tabs.innerHTML = `<div class="small">Nenhuma viagem cadastrada.</div>`;
      return;
    }

    els.tabs.innerHTML = state.trips.map((trip) => {
      const isActive = state.selectedTrip?.id === trip.id;
      return `
        <div class="trip-tab ${isActive ? "active" : ""}">
          <button
            type="button"
            class="trip-tab-main"
            data-trip-select="${sanitize(trip.id)}"
            title="${sanitize(trip.destination)} • ${sanitize(trip.dateIso || "")}"
          >
            ${sanitize(trip.destination)} • ${sanitize(trip.dateIso || "")}
          </button>
          <button
            type="button"
            class="trip-tab-delete"
            data-trip-delete="${sanitize(trip.id)}"
            title="Apagar lista"
            aria-label="Apagar lista"
          >
            ×
          </button>
        </div>
      `;
    }).join("");
  }

  async function loadTrips() {
    touchAdminSession();
    const data = await api.get("/api/admin/trips", true);
    state.trips = data?.trips || [];
    renderTabs();

    if (!state.trips.length) {
      state.selectedTrip = null;
      if (els.titulo) els.titulo.textContent = "Selecione uma viagem";
      if (els.info) els.info.textContent = "";
      renderAdminPassengers([]);
      setPainelButtonsEnabled(false);
      return;
    }

    const stillExists = state.selectedTrip
      ? state.trips.find((t) => t.id === state.selectedTrip.id)
      : null;

    const tripToSelect = stillExists || state.trips[0];
    await selectTrip(tripToSelect.id);
  }

  async function selectTrip(tripId) {
    if (state.isLoading) return;

    state.isLoading = true;
    setPainelButtonsEnabled(false);

    try {
      touchAdminSession();

      const data = await api.get(`/api/admin/trips/${tripId}`, true);
      const trip = data?.trip;

      if (!trip?.id) {
        throw new Error("Viagem não encontrada");
      }

      state.selectedTrip = trip;
      renderTabs();

      if (els.titulo) {
        els.titulo.textContent = trip.destination || "Viagem";
      }

      if (els.info) {
        els.info.textContent =
          `ID: ${trip.id} • PIN: ${trip.pinPlain || "-"} • Saída: ${trip.dateIso || "-"} • Resp: ${trip.responsible || "-"}`;
      }

      renderAdminPassengers(trip.passengers || []);
      setPainelButtonsEnabled(true);
    } catch (e) {
      state.selectedTrip = null;
      renderTabs();
      renderAdminPassengers([]);
      setPainelButtonsEnabled(false);

      if (els.titulo) els.titulo.textContent = "Erro ao carregar";
      if (els.info) els.info.textContent = "";
      showToast(e.message, "error");
    } finally {
      state.isLoading = false;
    }
  }

  els.tabs?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest("[data-trip-delete]");
    if (deleteBtn) {
      const tripId = deleteBtn.dataset.tripDelete;
      if (!tripId) return;

      const confirmed = window.confirm("Tem certeza que deseja apagar esta viagem?");
      if (!confirmed) return;

      try {
        touchAdminSession();
        clearTripVisibleRows(tripId);
        await api.del(`/api/admin/trips/${tripId}`, null, true);
        showToast("Viagem apagada com sucesso!", "success");

        if (state.selectedTrip?.id === tripId) {
          state.selectedTrip = null;
        }

        await loadTrips();
      } catch (e2) {
        showToast(e2.message, "error");
      }
      return;
    }

    const selectBtn = e.target.closest("[data-trip-select]");
    if (selectBtn) {
      const tripId = selectBtn.dataset.tripSelect;
      if (tripId) {
        await selectTrip(tripId);
      }
    }
  });

  els.btnEditar?.addEventListener("click", () => {
    const trip = state.selectedTrip;
    if (!trip?.id || !trip?.pinPlain) return;

    setTripSession(trip.id, trip.pinPlain);
    window.location.href = `/editar?id=${encodeURIComponent(trip.id)}&pin=${encodeURIComponent(trip.pinPlain)}`;
  });

  els.btnZip?.addEventListener("click", async () => {
    const trip = state.selectedTrip;
    if (!trip?.id) return;

    try {
      touchAdminSession();
      await downloadWithAuth(`${API}/api/admin/trips/${encodeURIComponent(trip.id)}/export/zip`, "viagem.zip");
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  els.btnApagar?.addEventListener("click", async () => {
    const trip = state.selectedTrip;
    if (!trip?.id) return;

    const confirmed = window.confirm("Tem certeza que deseja apagar esta viagem?");
    if (!confirmed) return;

    try {
      touchAdminSession();
      clearTripVisibleRows(trip.id);
      await api.del(`/api/admin/trips/${trip.id}`, null, true);
      showToast("Viagem apagada com sucesso!", "success");
      state.selectedTrip = null;
      await loadTrips();
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  setPainelButtonsEnabled(false);
  loadTrips().catch((e) => {
    showToast(e.message, "error");
  });
}

// ==================== INIT GERAL ====================
document.addEventListener("DOMContentLoaded", () => {
  fetch(`${API}/health`).catch(() => {});

  initPublicPages();
  initAdminPage();
  initPainelPage();
});