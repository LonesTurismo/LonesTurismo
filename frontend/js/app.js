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

// ==================== HELPERS ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const getQS = (name) => new URLSearchParams(location.search).get(name);

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
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
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
  const safeRows = Math.max(INITIAL_PASSENGERS, Math.min(MAX_PASSENGERS, Number(rows) || INITIAL_PASSENGERS));
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

const ADMIN_SESSION_KEY = "adminSessionStartedAt";
const ADMIN_SESSION_DURATION_MS = 60 * 60 * 1000;

function setAdminSession(token) {
  if (!token) return;
  localStorage.setItem("adminToken", token);
  localStorage.setItem(ADMIN_SESSION_KEY, String(Date.now()));
}

function getAdminToken() {
  const token = localStorage.getItem("adminToken");
  const startedAt = Number(localStorage.getItem(ADMIN_SESSION_KEY) || 0);

  if (!token || !startedAt) {
    clearAdminSession();
    return null;
  }

  const expired = Date.now() - startedAt > ADMIN_SESSION_DURATION_MS;
  if (expired) {
    clearAdminSession();
    return null;
  }

  return token;
}

function clearAdminSession() {
  localStorage.removeItem("adminToken");
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

function ensureAdminSessionAlive() {
  const token = getAdminToken();
  if (!token) {
    if (location.pathname.includes("/painel")) {
      showToast("Sua sessão expirou. Faça login novamente.", "warning");
      setTimeout(() => {
        location.href = "/admin";
      }, 500);
    }
    return false;
  }
  return true;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

function authHeaders(extra = {}) {
  const token = getAdminToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

document.addEventListener("DOMContentLoaded", () => {
  fetch(`${API}/health`).catch(() => {});

  initMasks();
  initFileInputs();
  initCadastroPage();
  initEditarPage();
  initAdminPage();
  initPainelPage();
});

// ==================== INPUT MASKS ====================
function initMasks() {
  document.addEventListener("input", (e) => {
    const target = e.target;
    if (!target) return;

    if (target.matches("[data-mask='cpf']")) {
      target.value = formatCPF(target.value);
    }

    if (target.matches("[data-mask='phone']")) {
      target.value = formatPhone(target.value);
    }
  });
}

// ==================== FILE INPUTS ====================
function initFileInputs() {
  $$("input[type='file']").forEach((input) => {
    updateFileInputUI(input);

    input.addEventListener("change", () => {
      updateFileInputUI(input);
    });
  });
}

// ==================== ESTADO GLOBAL PÚBLICO ====================
const publicState = {
  currentTrip: null,
  currentPassengers: [],
  visibleRows: INITIAL_PASSENGERS
};

// ==================== RENDER DE PASSAGEIROS ====================
function buildPassengerRow(passenger = null, index = 0, mode = "cadastro") {
  const passengerId = passenger?.id || "";
  const name = passenger?.name || "";
  const cpf = passenger?.cpf ? formatCPF(passenger.cpf) : "";
  const phone = passenger?.phone ? formatPhone(passenger.phone) : "";

  return `
    <tr class="passenger-row" data-passenger-id="${sanitize(passengerId)}">
      <td class="row-number">${index + 1}</td>
      <td>
        <input
          type="text"
          class="input passenger-name"
          placeholder="Nome completo"
          value="${sanitize(name)}"
          maxlength="120"
        />
      </td>
      <td>
        <input
          type="text"
          class="input passenger-cpf"
          data-mask="cpf"
          placeholder="000.000.000-00"
          value="${sanitize(cpf)}"
          maxlength="14"
        />
      </td>
      <td>
        <input
          type="text"
          class="input passenger-phone"
          data-mask="phone"
          placeholder="(00) 00000-0000"
          value="${sanitize(phone)}"
          maxlength="15"
        />
      </td>
      <td>
        <div class="file-upload">
          <label class="file-upload-btn">
            <span class="file-upload-text">Escolher arquivos</span>
            <input
              type="file"
              class="passenger-docs"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              multiple
            />
          </label>
        </div>
      </td>
      <td class="row-actions">
        ${
          mode === "editar" || passengerId
            ? `<button type="button" class="btn danger btn-delete-passenger">Excluir</button>`
            : `<span class="muted">—</span>`
        }
      </td>
    </tr>
  `;
}

function renderPassengerRows(tbody, passengers = [], visibleRows = INITIAL_PASSENGERS, mode = "cadastro") {
  if (!tbody) return;

  const rows = [];
  const safeVisibleRows = Math.max(INITIAL_PASSENGERS, Math.min(MAX_PASSENGERS, Number(visibleRows) || INITIAL_PASSENGERS));

  for (let i = 0; i < safeVisibleRows; i += 1) {
    rows.push(buildPassengerRow(passengers[i], i, mode));
  }

  tbody.innerHTML = rows.join("");
  initFileInputs();
  updateFilledCount();
}

function countFilledPassengersInDOM() {
  return [...$$(".passenger-row")].filter((row) => {
    const name = row.querySelector(".passenger-name")?.value?.trim();
    const cpf = onlyDigits(row.querySelector(".passenger-cpf")?.value);
    return Boolean(name && cpf.length === 11);
  }).length;
}

function updateFilledCount() {
  const filledCountEl = $("#filledCount");
  if (!filledCountEl) return;
  filledCountEl.textContent = String(countFilledPassengersInDOM());
}

function getPassengerPayloadFromRow(row) {
  const passengerId = row.dataset.passengerId || null;
  const name = row.querySelector(".passenger-name")?.value?.trim() || "";
  const cpf = onlyDigits(row.querySelector(".passenger-cpf")?.value || "");
  const phone = onlyDigits(row.querySelector(".passenger-phone")?.value || "");

  return {
    id: passengerId || null,
    name,
    cpf,
    phone
  };
}

function attachPassengerRowEvents(scope = document) {
  scope.addEventListener("blur", async (e) => {
    const target = e.target;
    if (!target) return;

    if (
      target.classList.contains("passenger-name") ||
      target.classList.contains("passenger-cpf") ||
      target.classList.contains("passenger-phone")
    ) {
      const row = target.closest(".passenger-row");
      if (!row) return;

      const pageIsCadastro = Boolean($("#createTripForm"));
      const trip = publicState.currentTrip;

      if (!trip?.id || !trip?.pin) return;

      const payload = getPassengerPayloadFromRow(row);
      updateFilledCount();

      if (!payload.name && !payload.cpf) {
        return;
      }

      if (!payload.name || payload.cpf.length !== 11) {
        return;
      }

      try {
        const endpoint = payload.id
          ? `${API}/api/trips/${trip.id}/passengers/${payload.id}`
          : `${API}/api/trips/${trip.id}/passengers`;

        const method = payload.id ? "PUT" : "POST";

        const { response, data } = await fetchJson(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            pin: trip.pin,
            name: payload.name,
            cpf: payload.cpf,
            phone: payload.phone || ""
          })
        });

        if (!response.ok) {
          throw new Error(data.error || "Não foi possível salvar o passageiro.");
        }

        const passenger = data.passenger;
        if (passenger?.id) {
          row.dataset.passengerId = passenger.id;
          const actionCell = row.querySelector(".row-actions");
          if (actionCell) {
            actionCell.innerHTML = `<button type="button" class="btn danger btn-delete-passenger">Excluir</button>`;
          }
        }

        if (pageIsCadastro || $("#editArea")) {
          publicState.currentPassengers = await fetchPassengers(trip.id, trip.pin);
        }
      } catch (err) {
        showToast(err.message || "Erro ao salvar passageiro.", "error");
      }
    }
  }, true);

  scope.addEventListener("change", async (e) => {
    const target = e.target;
    if (!target) return;

    if (target.classList.contains("passenger-docs")) {
      const row = target.closest(".passenger-row");
      const trip = publicState.currentTrip;

      if (!row || !trip?.id || !trip?.pin) return;

      const passengerId = row.dataset.passengerId;
      if (!passengerId) {
        showToast("Salve nome e CPF do passageiro antes de enviar documentos.", "warning");
        clearFileInputUI(target);
        return;
      }

      if (!target.files?.length) return;

      const formData = new FormData();
      formData.append("pin", trip.pin);

      [...target.files].forEach((file) => {
        formData.append("docs", file);
      });

      try {
        const { response, data } = await fetchJson(
          `${API}/api/trips/${trip.id}/passengers/${passengerId}/documents`,
          {
            method: "POST",
            body: formData
          }
        );

        if (!response.ok) {
          throw new Error(data.error || "Não foi possível enviar os documentos.");
        }

        showToast("Documentos enviados com sucesso.");
        clearFileInputUI(target);
      } catch (err) {
        showToast(err.message || "Erro ao enviar documentos.", "error");
      }
    }
  });

  scope.addEventListener("click", async (e) => {
    const target = e.target;
    if (!target) return;

    if (target.classList.contains("btn-delete-passenger")) {
      const row = target.closest(".passenger-row");
      const trip = publicState.currentTrip;
      const passengerId = row?.dataset.passengerId;

      if (!row || !trip?.id || !trip?.pin || !passengerId) return;

      const ok = window.confirm("Tem certeza que deseja excluir este passageiro?");
      if (!ok) return;

      try {
        const { response, data } = await fetchJson(
          `${API}/api/trips/${trip.id}/passengers/${passengerId}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ pin: trip.pin })
          }
        );

        if (!response.ok) {
          throw new Error(data.error || "Não foi possível excluir o passageiro.");
        }

        publicState.currentPassengers = await fetchPassengers(trip.id, trip.pin);
        const tbody = $("#passengerRows") || $("#editPassengerRows");
        const mode = $("#editArea") ? "editar" : "cadastro";
        renderPassengerRows(tbody, publicState.currentPassengers, publicState.visibleRows, mode);
        showToast("Passageiro excluído com sucesso.");
      } catch (err) {
        showToast(err.message || "Erro ao excluir passageiro.", "error");
      }
    }
  });
}

attachPassengerRowEvents(document);

// ==================== API PÚBLICA ====================
async function createTrip(payload) {
  const { response, data } = await fetchJson(`${API}/api/trips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível criar a lista.");
  }

  return data.trip;
}

async function verifyTripPin(tripId, pin) {
  const { response, data } = await fetchJson(`${API}/api/trips/${tripId}/verify-pin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ pin })
  });

  if (!response.ok) {
    throw new Error(data.error || "ID ou PIN inválido.");
  }

  return data.trip;
}

async function fetchPassengers(tripId, pin) {
  const { response, data } = await fetchJson(`${API}/api/trips/${tripId}?pin=${encodeURIComponent(pin)}`);

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível carregar os passageiros.");
  }

  return data.passengers || [];
}

async function updateVisibleRows(tripId, pin, visibleRows) {
  const { response, data } = await fetchJson(`${API}/api/trips/${tripId}/visible-rows`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ pin, visibleRows })
  });

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível atualizar a quantidade de linhas.");
  }

  return data.visibleRows;
}

// ==================== CADASTRO ====================
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
  if (count) count.textContent = "0";

  hideTripEditor();
}

function fillTripInfoBox(trip) {
  const tripInfo = $("#tripInfo");
  const tripHeader = $("#tripHeader");
  const tripHint = $("#tripHint");

  if (tripHeader) {
    tripHeader.textContent = `${trip.destination} • ${trip.dateIso}`;
  }

  if (tripInfo) {
    tripInfo.classList.remove("empty");
    tripInfo.innerHTML = `
      <div><strong>ID:</strong> ${sanitize(trip.id)}</div>
      <div><strong>PIN:</strong> ${sanitize(trip.pin)}</div>
      <div><strong>Responsável:</strong> ${sanitize(trip.responsible)}</div>
      <div><strong>Destino:</strong> ${sanitize(trip.destination)}</div>
      <div><strong>Data:</strong> ${sanitize(trip.dateIso)}</div>
    `;
  }

  if (tripHint) {
    tripHint.textContent = "Preencha nome e CPF para salvar automaticamente cada passageiro.";
  }
}

async function handleCreateTrip(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const btn = form.querySelector("button[type='submit']");
  const destination = $("#destination")?.value?.trim();
  const dateIso = $("#dateIso")?.value;
  const responsible = $("#responsible")?.value?.trim();

  try {
    setLoading(btn, true, "Criando lista...");

    const trip = await createTrip({ destination, dateIso, responsible });

    setTripSession(trip.id, trip.pin);
    publicState.currentTrip = trip;
    publicState.currentPassengers = [];
    publicState.visibleRows = trip.visibleRows || INITIAL_PASSENGERS;

    saveTripVisibleRows(trip.id, publicState.visibleRows);
    fillTripInfoBox(trip);
    showTripEditor();

    const tbody = $("#passengerRows");
    renderPassengerRows(tbody, [], publicState.visibleRows, "cadastro");

    showToast("Lista criada com sucesso.");
  } catch (err) {
    showToast(err.message || "Erro ao criar lista.", "error");
  } finally {
    setLoading(btn, false);
  }
}

async function handleAddRows() {
  const trip = publicState.currentTrip;
  if (!trip?.id || !trip?.pin) {
    showToast("Crie uma lista antes de adicionar mais passageiros.", "warning");
    return;
  }

  if (publicState.visibleRows >= MAX_PASSENGERS) {
    showToast(`O limite máximo é ${MAX_PASSENGERS} passageiros.`, "warning");
    return;
  }

  const nextRows = Math.min(publicState.visibleRows + PASSENGER_STEP, MAX_PASSENGERS);

  try {
    const savedRows = await updateVisibleRows(trip.id, trip.pin, nextRows);
    publicState.visibleRows = savedRows;
    saveTripVisibleRows(trip.id, savedRows);

    const tbody = $("#passengerRows") || $("#editPassengerRows");
    const mode = $("#editArea") ? "editar" : "cadastro";
    renderPassengerRows(tbody, publicState.currentPassengers, publicState.visibleRows, mode);

    showToast(`Agora a lista possui ${savedRows} linhas.`);
  } catch (err) {
    showToast(err.message || "Erro ao adicionar linhas.", "error");
  }
}

function initCadastroPage() {
  const form = $("#createTripForm");
  if (!form) return;

  resetCadastroPage();
  form.addEventListener("submit", handleCreateTrip);

  const btnAddRows = $("#btnAddRows");
  if (btnAddRows) {
    btnAddRows.addEventListener("click", handleAddRows);
  }

  const btnReset = $("#btnResetCadastro");
  if (btnReset) {
    btnReset.addEventListener("click", resetCadastroPage);
  }
}

// ==================== EDITAR ====================
function fillEditTripInfo(trip) {
  const tripInfo = $("#editTripInfo");
  const tripHeader = $("#editTripHeader");
  const tripHint = $("#editTripHint");

  if (tripHeader) {
    tripHeader.textContent = `${trip.destination} • ${trip.dateIso}`;
  }

  if (tripInfo) {
    tripInfo.classList.remove("empty");
    tripInfo.innerHTML = `
      <div><strong>ID:</strong> ${sanitize(trip.id)}</div>
      <div><strong>Responsável:</strong> ${sanitize(trip.responsible)}</div>
      <div><strong>Destino:</strong> ${sanitize(trip.destination)}</div>
      <div><strong>Data:</strong> ${sanitize(trip.dateIso)}</div>
    `;
  }

  if (tripHint) {
    tripHint.textContent = "A edição salva automaticamente ao preencher nome e CPF válidos.";
  }
}

async function handleOpenEditTrip(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const btn = form.querySelector("button[type='submit']");
  const tripId = $("#editTripId")?.value?.trim();
  const pin = $("#editTripPin")?.value?.trim();

  try {
    setLoading(btn, true, "Abrindo lista...");

    const trip = await verifyTripPin(tripId, pin);
    const savedRows = getTripVisibleRows(trip.id);

    setTripSession(trip.id, pin);
    publicState.currentTrip = { ...trip, pin };
    publicState.visibleRows = savedRows || trip.visibleRows || INITIAL_PASSENGERS;
    publicState.currentPassengers = await fetchPassengers(trip.id, pin);

    fillEditTripInfo(trip);
    showTripEditor();

    const tbody = $("#editPassengerRows");
    renderPassengerRows(tbody, publicState.currentPassengers, publicState.visibleRows, "editar");
    updateFilledCount();

    showToast("Lista carregada com sucesso.");
  } catch (err) {
    hideTripEditor();
    showToast(err.message || "Erro ao abrir lista.", "error");
  } finally {
    setLoading(btn, false);
  }
}

function initEditarPage() {
  const form = $("#editTripAccessForm");
  if (!form) return;

  hideTripEditor();
  form.addEventListener("submit", handleOpenEditTrip);

  const btnAddRows = $("#btnEditAddRows");
  if (btnAddRows) {
    btnAddRows.addEventListener("click", handleAddRows);
  }
}

// ==================== ADMIN LOGIN ====================
async function handleAdminLogin(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const btn = form.querySelector("button[type='submit']");
  const user = $("#adminUser")?.value?.trim();
  const pass = $("#adminPass")?.value?.trim();

  try {
    setLoading(btn, true, "Entrando...");

    const { response, data } = await fetchJson(`${API}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ user, pass })
    });

    if (!response.ok) {
      throw new Error(data.error || "Usuário ou senha inválidos.");
    }

    setAdminSession(data.token);
    showToast("Login realizado com sucesso.");
    setTimeout(() => {
      location.href = "/painel";
    }, 500);
  } catch (err) {
    showToast(err.message || "Erro ao fazer login.", "error");
  } finally {
    setLoading(btn, false);
  }
}

function initAdminPage() {
  const form = $("#adminLoginForm");
  if (!form) return;

  clearAdminSession();
  form.addEventListener("submit", handleAdminLogin);
}

// ==================== PAINEL ADMIN ====================
const painelState = {
  trips: [],
  selectedTrip: null
};

async function fetchAdminTrips() {
  const { response, data } = await fetchJson(`${API}/api/admin/trips`, {
    headers: authHeaders()
  });

  if (response.status === 401) {
    clearAdminSession();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível carregar as viagens.");
  }

  return data.trips || [];
}

async function fetchAdminTripDetails(tripId) {
  const { response, data } = await fetchJson(`${API}/api/admin/trips/${tripId}`, {
    headers: authHeaders()
  });

  if (response.status === 401) {
    clearAdminSession();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível carregar os detalhes da viagem.");
  }

  return data.trip;
}

async function deleteAdminTrip(tripId) {
  const { response, data } = await fetchJson(`${API}/api/admin/trips/${tripId}`, {
    method: "DELETE",
    headers: authHeaders()
  });

  if (response.status === 401) {
    clearAdminSession();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível apagar a lista.");
  }

  return data;
}

function renderPainelTabs() {
  const tabs = $("#tabs");
  if (!tabs) return;

  if (!painelState.trips.length) {
    tabs.innerHTML = `<div class="muted">Nenhuma viagem cadastrada ainda.</div>`;
    return;
  }

  tabs.innerHTML = painelState.trips.map((trip) => {
    const isActive = painelState.selectedTrip?.id === trip.id;

    return `
      <div class="trip-tab ${isActive ? "active" : ""}">
        <button
          type="button"
          class="trip-tab-main"
          data-trip-select="${sanitize(trip.id)}"
        >
          ${sanitize(trip.destination)} • ${sanitize(trip.dateIso)}
        </button>

        <button
          type="button"
          class="trip-tab-delete"
          data-trip-delete="${sanitize(trip.id)}"
          title="Excluir lista"
          aria-label="Excluir lista"
        >
          ×
        </button>
      </div>
    `;
  }).join("");
}

function renderPainelTable(passengers = []) {
  const tbody = $("#tbody");
  if (!tbody) return;

  if (!passengers.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Nenhum passageiro cadastrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = passengers.map((passenger) => `
    <tr>
      <td>${sanitize(passenger.name || "")}</td>
      <td>${sanitize(formatCPF(passenger.cpf || ""))}</td>
      <td>${sanitize(formatPhone(passenger.phone || ""))}</td>
    </tr>
  `).join("");
}

function updatePainelButtonsState(enabled) {
  const btnEditar = $("#btnEditar");
  const btnZip = $("#btnZip");
  const btnApagar = $("#btnApagar");

  if (btnEditar) btnEditar.disabled = !enabled;
  if (btnZip) btnZip.disabled = !enabled;
  if (btnApagar) btnApagar.disabled = !enabled;
}

function fillPainelHeader(trip = null) {
  const title = $("#viagemTitulo");
  const info = $("#viagemInfo");

  if (!trip) {
    if (title) title.textContent = "Selecione uma viagem";
    if (info) info.textContent = "";
    updatePainelButtonsState(false);
    renderPainelTable([]);
    return;
  }

  if (title) title.textContent = trip.destination;
  if (info) {
    info.textContent = `ID: ${trip.id} • PIN: ${trip.pinPlain || "••••"} • Saída: ${trip.dateIso} • Resp: ${trip.responsible}`;
  }

  updatePainelButtonsState(true);
  renderPainelTable(trip.passengers || []);
}

async function selectPainelTrip(tripId) {
  try {
    const trip = await fetchAdminTripDetails(tripId);
    painelState.selectedTrip = trip;
    renderPainelTabs();
    fillPainelHeader(trip);
  } catch (err) {
    showToast(err.message || "Erro ao carregar a viagem.", "error");

    if (/sessão expirada/i.test(err.message || "")) {
      setTimeout(() => {
        location.href = "/admin";
      }, 600);
    }
  }
}

async function handlePainelDeleteTrip(tripId) {
  const ok = window.confirm("Tem certeza que deseja excluir esta lista inteira?");
  if (!ok) return;

  try {
    await deleteAdminTrip(tripId);
    showToast("Lista excluída com sucesso.");

    painelState.trips = await fetchAdminTrips();

    if (painelState.selectedTrip?.id === tripId) {
      painelState.selectedTrip = null;
      fillPainelHeader(null);
    }

    renderPainelTabs();

    if (!painelState.selectedTrip && painelState.trips.length) {
      await selectPainelTrip(painelState.trips[0].id);
    }
  } catch (err) {
    showToast(err.message || "Erro ao excluir lista.", "error");

    if (/sessão expirada/i.test(err.message || "")) {
      setTimeout(() => {
        location.href = "/admin";
      }, 600);
    }
  }
}

function bindPainelEvents() {
  const tabs = $("#tabs");
  if (tabs) {
    tabs.addEventListener("click", async (e) => {
      const deleteBtn = e.target.closest("[data-trip-delete]");
      if (deleteBtn) {
        const tripId = deleteBtn.getAttribute("data-trip-delete");
        if (tripId) {
          await handlePainelDeleteTrip(tripId);
        }
        return;
      }

      const selectBtn = e.target.closest("[data-trip-select]");
      if (selectBtn) {
        const tripId = selectBtn.getAttribute("data-trip-select");
        if (tripId) {
          await selectPainelTrip(tripId);
        }
      }
    });
  }

  const btnEditar = $("#btnEditar");
  if (btnEditar) {
    btnEditar.addEventListener("click", () => {
      const trip = painelState.selectedTrip;
      if (!trip?.id || !trip?.pinPlain) {
        showToast("Não foi possível abrir a edição desta lista.", "error");
        return;
      }

      sessionStorage.setItem("tripId", trip.id);
      sessionStorage.setItem("tripPin", trip.pinPlain);
      location.href = `/editar?id=${encodeURIComponent(trip.id)}&pin=${encodeURIComponent(trip.pinPlain)}`;
    });
  }

  const btnZip = $("#btnZip");
  if (btnZip) {
    btnZip.addEventListener("click", () => {
      const trip = painelState.selectedTrip;
      if (!trip?.id) return;

      const token = getAdminToken();
      if (!token) {
        showToast("Sua sessão expirou. Faça login novamente.", "warning");
        setTimeout(() => {
          location.href = "/admin";
        }, 500);
        return;
      }

      window.open(`${API}/api/admin/trips/${encodeURIComponent(trip.id)}/export/zip?token=${encodeURIComponent(token)}`, "_blank");
    });
  }

  const btnApagar = $("#btnApagar");
  if (btnApagar) {
    btnApagar.addEventListener("click", async () => {
      const trip = painelState.selectedTrip;
      if (!trip?.id) return;
      await handlePainelDeleteTrip(trip.id);
    });
  }
}

function schedulePainelAutoLogout() {
  const startedAt = Number(localStorage.getItem(ADMIN_SESSION_KEY) || 0);
  if (!startedAt) return;

  const remaining = ADMIN_SESSION_DURATION_MS - (Date.now() - startedAt);
  if (remaining <= 0) {
    clearAdminSession();
    showToast("Sua sessão expirou. Faça login novamente.", "warning");
    setTimeout(() => {
      location.href = "/admin";
    }, 500);
    return;
  }

  setTimeout(() => {
    clearAdminSession();
    showToast("Sua sessão expirou. Faça login novamente.", "warning");
    setTimeout(() => {
      location.href = "/admin";
    }, 700);
  }, remaining);
}

async function initPainelPage() {
  const painelContent = $("#painelContent");
  if (!painelContent) return;

  if (!ensureAdminSessionAlive()) {
    location.href = "/admin";
    return;
  }

  try {
    const trips = await fetchAdminTrips();
    painelState.trips = trips;

    renderPainelTabs();
    bindPainelEvents();
    showEl(painelContent, "block");
    schedulePainelAutoLogout();

    if (trips.length) {
      await selectPainelTrip(trips[0].id);
    } else {
      fillPainelHeader(null);
    }
  } catch (err) {
    showToast(err.message || "Erro ao carregar o painel.", "error");
    setTimeout(() => {
      location.href = "/admin";
    }, 700);
  }
}

// ==================== AUTOLOAD EDIÇÃO VIA QUERY/SESSION ====================
document.addEventListener("DOMContentLoaded", async () => {
  const editForm = $("#editTripAccessForm");
  if (!editForm) return;

  const tripIdFromQuery = getQS("id");
  const pinFromQuery = getQS("pin");
  const tripSession = getTripSession();

  const tripId = tripIdFromQuery || tripSession.tripId;
  const pin = pinFromQuery || tripSession.tripPin;

  if (!tripId || !pin) return;

  const tripIdInput = $("#editTripId");
  const tripPinInput = $("#editTripPin");

  if (tripIdInput) tripIdInput.value = tripId;
  if (tripPinInput) tripPinInput.value = pin;

  try {
    const trip = await verifyTripPin(tripId, pin);
    const savedRows = getTripVisibleRows(trip.id);

    setTripSession(trip.id, pin);
    publicState.currentTrip = { ...trip, pin };
    publicState.visibleRows = savedRows || trip.visibleRows || INITIAL_PASSENGERS;
    publicState.currentPassengers = await fetchPassengers(trip.id, pin);

    fillEditTripInfo(trip);
    showTripEditor();

    const tbody = $("#editPassengerRows");
    renderPassengerRows(tbody, publicState.currentPassengers, publicState.visibleRows, "editar");
    updateFilledCount();
  } catch (err) {
    clearTripSession();
  }
});