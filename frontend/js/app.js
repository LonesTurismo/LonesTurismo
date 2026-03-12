// ==================== app.js ====================
// Cadastro • Editar • Admin Login • Painel Admin

const getApiBaseUrl = () => {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (isLocalhost) return "http://localhost:3001";
  return "https://lonesturismo.onrender.com"
};

const API = getApiBaseUrl();
const MAX_PASSENGERS = 70;

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
  return phone.replace(/(\d{2})(\d{5})(\d+)/, "($1) $2-$3");
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
    btn.dataset.originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingText;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `fixed bottom-4 right-4 px-5 py-3 rounded-xl shadow-2xl text-white z-50 ${
    type === "success"
      ? "bg-emerald-600"
      : type === "error"
      ? "bg-red-600"
      : "bg-yellow-600"
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2500);
}

// ==================== API ====================
const api = {
  async request(ep, method = "GET", body = null, admin = false) {
    const headers = {};

    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    if (admin) {
      const token = localStorage.getItem("adminToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API}${ep}`, {
      method,
      headers,
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined
    });

    if (res.status === 401 && admin) {
      localStorage.removeItem("adminToken");
      location.href = "/admin";
      return;
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

  post: (ep, body, admin = false) => api.request(ep, "POST", body, admin),
  put: (ep, body, admin = false) => api.request(ep, "PUT", body, admin),
  del: (ep, body, admin = false) => api.request(ep, "DELETE", body, admin)
};

// ==================== DOWNLOAD ADMIN ====================
const downloadWithAuth = async (url, fallbackName = "viagem.zip") => {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const cd = res.headers.get("content-disposition");
  const filename = cd?.match(/filename="([^"]+)"/i)?.[1] || fallbackName;

  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ==================== UPLOAD DOCUMENTOS ====================
async function uploadDocs(tripId, passengerId, pin, files) {
  if (!files?.length) return;
  if (files.length > 4) throw new Error("Máximo 4 arquivos");

  const fd = new FormData();
  fd.append("pin", pin);
  [...files].forEach((f) => fd.append("files", f));

  const res = await fetch(`${API}/api/trips/${tripId}/passengers/${passengerId}/documents`, {
    method: "POST",
    body: fd
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Erro no upload");
}

// ==================== ESTADO ====================
const publicState = {
  currentTrip: null,
  currentPassengers: []
};

// ==================== TELA PÚBLICA ====================
function getTripEditor() {
  return $("#tripEditor") || $("#editArea");
}

function showTripEditor() {
  const cadastroEditor = $("#tripEditor");
  const editArea = $("#editArea");
  if (cadastroEditor) showEl(cadastroEditor, "block");
  if (editArea) showEl(editArea, "block");
}

function hideTripEditor() {
  hideEl($("#tripEditor"));
  hideEl($("#editArea"));
}

function updateFilledCount() {
  const rows = $$("#passengerRows tr");
  const filledCount = $("#filledCount");
  if (!filledCount) return;

  let filled = 0;

  rows.forEach((row) => {
    const name = row.querySelector(".row-name")?.value.trim();
    const cpf = onlyDigits(row.querySelector(".row-cpf")?.value || "");
    const phone = onlyDigits(row.querySelector(".row-phone")?.value || "");
    if (name || cpf || phone) filled++;
  });

  filledCount.textContent = `${filled} / ${MAX_PASSENGERS}`;
}

function renderPassengerRows(existingPassengers = []) {
  const tbody = $("#passengerRows");
  if (!tbody) return;

  tbody.innerHTML = "";

  for (let i = 0; i < MAX_PASSENGERS; i++) {
    const p = existingPassengers[i] || {};
    const docsCount = Array.isArray(p.documents) ? p.documents.length : 0;

    const tr = document.createElement("tr");
    tr.dataset.index = String(i);
    tr.dataset.passengerId = p.id || "";

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>
        <input
          type="text"
          class="row-name"
          maxlength="100"
          placeholder="Nome completo"
          value="${sanitize(p.name || "")}"
        >
      </td>
      <td>
        <input
          type="text"
          class="row-cpf"
          maxlength="14"
          placeholder="000.000.000-00"
          value="${sanitize(p.cpf ? formatCPF(p.cpf) : "")}"
        >
      </td>
      <td>
        <input
          type="text"
          class="row-phone"
          maxlength="15"
          placeholder="(99) 99999-9999"
          value="${sanitize(p.phone ? formatPhone(p.phone) : "")}"
        >
      </td>
      <td>
        <input
          type="file"
          class="row-file"
          accept=".jpg,.jpeg,.png,.pdf"
          multiple
        >
      </td>
      <td class="small row-current-files">
        ${docsCount ? `${docsCount} anexo(s)` : "-"}
      </td>
      <td>
        <button type="button" class="btn danger btn-remove-local-file">Remover</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  updateFilledCount();
}

function setTripInfo(trip, pin = "") {
  const tripInfo = $("#tripInfo");
  if (tripInfo && trip?.id) {
    tripInfo.innerHTML = `
      Viagem criada/carregada: <b>${sanitize(trip.id)}</b>
      ${pin ? ` • PIN: <b>${sanitize(pin)}</b>` : ""}
      <br>
      ${sanitize(trip.destination || "")} • ${sanitize(trip.date_iso || trip.dateIso || "")}
      • Resp: ${sanitize(trip.responsible || "")}
    `;
  }

  const tripHeader = $("#tripHeader");
  if (tripHeader) {
    if ($("#editArea")) {
      tripHeader.textContent = `🆔 ${trip.id} • ${trip.destination} • ${trip.date_iso || trip.dateIso || ""}`;
    } else {
      tripHeader.textContent = "Passageiros";
    }
  }

  const tripHint = $("#tripHint");
  if (tripHint && trip?.id) {
    tripHint.textContent = `ID: ${trip.id} • ${trip.destination || ""} • ${trip.date_iso || trip.dateIso || ""}`;
  }
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

    setTripSession(data.trip.id, data.pin);
    publicState.currentTrip = data.trip;
    publicState.currentPassengers = [];

    setTripInfo(data.trip, data.pin);
    renderPassengerRows([]);
    showTripEditor();

    if (window.__enableActionButtons) {
      window.__enableActionButtons();
    }

    showToast(`Viagem criada! ID: ${data.trip.id} | PIN: ${data.pin}`, "success");
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function loadTripData(tripId, pin) {
  await api.post(`/api/trips/${tripId}/verify-pin`, { pin });
  const data = await api.post(`/api/trips/${tripId}/load`, { pin });

  setTripSession(tripId, pin);
  publicState.currentTrip = data.trip;
  publicState.currentPassengers = data.passengers || [];

  setTripInfo(data.trip, pin);
  renderPassengerRows(publicState.currentPassengers);
  showTripEditor();

  if (window.__enableActionButtons) {
    window.__enableActionButtons();
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

function getRowData(row) {
  return {
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

  if (files?.length) {
    await uploadDocs(tripId, data.passengerId, pin, files);
  }

  return data;
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

    const preparedRows = rows.map((row, index) => {
      const rowData = getRowData(row);
      const hasExistingPassenger = !!rowData.passengerId;
      return { row, rowData, hasExistingPassenger, index: index + 1 };
    });

    for (const item of preparedRows) {
      const { rowData, index } = item;

      if (isRowEmpty(rowData)) continue;

      if (!rowData.name) {
        throw new Error(`A linha ${index} precisa ter nome`);
      }

      if (rowData.cpf.length !== 11) {
        throw new Error(`CPF inválido na linha ${index} (${rowData.name})`);
      }
    }

    for (const item of preparedRows) {
      const { row, rowData, hasExistingPassenger } = item;

      if (isRowEmpty(rowData)) {
        if (hasExistingPassenger) {
          await api.del(`/api/trips/${tripId}/passengers/${rowData.passengerId}`, { pin: tripPin });
        }
        continue;
      }

      if (hasExistingPassenger) {
        await api.put(`/api/trips/${tripId}/passengers/${rowData.passengerId}`, {
          pin: tripPin,
          name: rowData.name,
          cpf: rowData.cpf,
          phone: rowData.phone
        });

        if (rowData.files?.length) {
          await uploadDocs(tripId, rowData.passengerId, tripPin, rowData.files);
        }
      } else {
        const created = await addPassenger(
          tripId,
          tripPin,
          rowData.name,
          rowData.cpf,
          rowData.phone,
          rowData.files
        );

        if (created?.passengerId) {
          row.dataset.passengerId = created.passengerId;
        }
      }
    }

    await loadTripData(tripId, tripPin);
    showToast("Lista salva com sucesso!", "success");
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

// ==================== EVENTOS PÚBLICOS ====================
document.addEventListener("DOMContentLoaded", async () => {
  const hasPublicPage =
    $("#btnCreateTrip") ||
    $("#btnLoadTrip") ||
    $("#btnSaveRows") ||
    $("#passengerRows");

  if (hasPublicPage) {
    hideTripEditor();

    const btnCopy = $("#btnCopyTrip");
    const btnWhats = $("#btnWhatsapp");
    const btnSave = $("#btnSaveRows");
    const btnGoEdit = $("#btnGoEdit");

    function disableActionButtons() {
      [btnCopy, btnWhats, btnSave, btnGoEdit].forEach((btn) => {
        if (btn) {
          btn.disabled = true;
          btn.classList.add("opacity-50", "cursor-not-allowed");
          btn.setAttribute("aria-disabled", "true");
        }
      });
    }

    function enableActionButtons() {
      [btnCopy, btnWhats, btnSave, btnGoEdit].forEach((btn) => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("opacity-50", "cursor-not-allowed");
          btn.removeAttribute("aria-disabled");
        }
      });
    }

    window.__enableActionButtons = enableActionButtons;
    disableActionButtons();

    const qid = getQS("id");
    const qpin = getQS("pin");

    if (qid && $("#editTripId")) $("#editTripId").value = qid;
    if (qpin && $("#editPin")) $("#editPin").value = qpin;

    const { tripId, tripPin } = getTripSession();

    if (tripId && tripPin && $("#editTripId")) {
      try {
        await loadTripData(tripId, tripPin);
        enableActionButtons();
      } catch {
        clearTripSession();
        hideTripEditor();
      }
    }

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

      if (e.target.id === "destination" || e.target.id === "dateIso" || e.target.id === "responsible") {
        validateCreateForm();
      }
    });

    function validateCreateForm() {
      const dest = $("#destination")?.value.trim() || "";
      const date = $("#dateIso")?.value.trim() || "";
      const resp = $("#responsible")?.value.trim() || "";
      const btn = $("#btnCreateTrip");

      const isValid = dest.length >= 3 && date.length > 0 && resp.length >= 3;

      if (btn) {
        btn.disabled = !isValid;
        if (!isValid) {
          btn.classList.add("opacity-50", "cursor-not-allowed");
        } else {
          btn.classList.remove("opacity-50", "cursor-not-allowed");
        }
      }

      return isValid;
    }

    validateCreateForm();

    $("#btnCreateTrip")?.addEventListener("click", createTrip);
    $("#btnLoadTrip")?.addEventListener("click", loadTripForEdit);
    $("#btnSaveRows")?.addEventListener("click", savePassengerRows);

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
      const text = [
        "🚌 Excursão Lones Turismo",
        "",
        trip.destination ? `Destino: ${trip.destination}` : null,
        trip.date_iso || trip.dateIso ? `Data: ${trip.date_iso || trip.dateIso}` : null,
        trip.responsible ? `Responsável: ${trip.responsible}` : null,
        "",
        `ID: ${tripId}`,
        `PIN: ${tripPin}`,
        "",
        `Acesse: ${window.location.origin}/editar?id=${encodeURIComponent(tripId)}`
      ].filter(Boolean).join("\n");

      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    });

    $("#btnGoEdit")?.addEventListener("click", (e) => {
      const { tripId } = getTripSession();
      e.preventDefault();
      location.href = tripId ? `/editar?id=${encodeURIComponent(tripId)}` : "/editar";
    });

    $("#passengerRows")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-remove-local-file");
      if (!btn) return;

      const row = btn.closest("tr");
      const fileInput = row?.querySelector(".row-file");
      const currentFilesCell = row?.querySelector(".row-current-files");

      if (fileInput) fileInput.value = "";
      if (currentFilesCell && !row.dataset.passengerId) {
        currentFilesCell.textContent = "-";
      }

      showToast("Anexo local removido da linha", "success");
    });
  }

  // ==================== LOGIN ADMIN ====================
  $("#btnAdminLogin")?.addEventListener("click", async () => {
    const btn = $("#btnAdminLogin");
    const user = $("#admUser")?.value.trim();
    const pass = $("#admPass")?.value.trim();
    const err = $("#admError");

    if (err) err.textContent = "";

    try {
      setLoading(btn, true, "Entrando...");
      const data = await api.post("/api/admin/login", { user, pass });
      localStorage.setItem("adminToken", data.token);
      location.href = "/painel";
    } catch (e) {
      if (err) err.textContent = e.message;
      else showToast(e.message, "error");
    } finally {
      setLoading(btn, false);
    }
  });

  // ==================== PAINEL ADMIN ====================
  if ($("#tabs")) {
    const token = localStorage.getItem("adminToken");
    if (!token) {
      location.href = "/admin";
      return;
    }

    const painelContent = $("#painelContent");
    if (painelContent) painelContent.style.display = "block";

    const els = {
      tabs: $("#tabs"),
      tbody: $("#tbody"),
      titulo: $("#viagemTitulo"),
      info: $("#viagemInfo"),
      btnEditar: $("#btnEditar"),
      btnZip: $("#btnZip"),
      btnExcel: $("#btnExcel"),
      btnDocx: $("#btnDocx"),
      btnApagar: $("#btnApagar"),
      btnLogout: $("#btnLogout")
    };

    const state = {
      trips: [],
      selectedTripId: null,
      isLoading: false
    };

    function renderAdminPassengers(passengers) {
      if (!els.tbody) return;

      els.tbody.innerHTML = passengers?.length
        ? passengers.map((p) => `
            <tr>
              <td>${sanitize(p.name)}</td>
              <td>${sanitize(formatCPF(p.cpf || ""))}</td>
              <td>${sanitize(formatPhone(p.phone || "-"))}</td>
            </tr>
          `).join("")
        : `<tr><td colspan="3" class="muted">Nenhum passageiro cadastrado.</td></tr>`;
    }

    async function selectTrip(tripId) {
      if (state.isLoading) return;

      state.isLoading = true;
      state.selectedTripId = tripId;

      try {
        const trip = state.trips.find((t) => t.id === tripId);
        if (!trip) return;

        if (els.titulo) els.titulo.textContent = sanitize(trip.destination);
        if (els.info) {
          els.info.textContent = `ID: ${trip.id} • PIN: ${trip.pin_plain || "-"} • Saída: ${trip.date_iso} • Resp: ${trip.responsible}`;
        }

        const data = await api.post(`/api/admin/trips/${tripId}/passengers`, null, true);
        renderAdminPassengers(data.passengers || []);
      } catch (e) {
        if (els.titulo) els.titulo.textContent = "Erro ao carregar";
        showToast(e.message, "error");
      } finally {
        state.isLoading = false;
      }
    }

    function renderTabs(trips) {
      state.trips = trips || [];
      if (!els.tabs) return;

      els.tabs.innerHTML = "";

      const disabled = !state.trips.length;
      ["btnEditar", "btnZip", "btnExcel", "btnDocx", "btnApagar"].forEach((id) => {
        if (els[id]) els[id].disabled = disabled;
      });

      if (!state.trips.length) {
        if (els.titulo) els.titulo.textContent = "Nenhuma viagem cadastrada";
        renderAdminPassengers([]);
        return;
      }

      const frag = document.createDocumentFragment();

      state.trips.forEach((t, index) => {
        const b = document.createElement("button");
        b.className = `tab ${index === 0 ? "active" : ""}`;
        b.textContent = `${t.destination} (${t.id})`;
        b.dataset.id = t.id;
        frag.appendChild(b);
      });

      els.tabs.appendChild(frag);
      selectTrip(state.trips[0].id);
    }

    try {
      const data = await api.post("/api/admin/trips", null, true);
      renderTabs(data.trips || []);
    } catch (e) {
      if (els.titulo) els.titulo.textContent = "Erro de conexão";
    }

    els.tabs?.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;

      $$(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectTrip(btn.dataset.id);
    });

    els.btnEditar?.addEventListener("click", () => {
      if (!state.selectedTripId) return;

      const trip = state.trips.find((t) => t.id === state.selectedTripId);
      if (!trip) return;

      const url = trip.pin_plain
        ? `/editar?id=${encodeURIComponent(trip.id)}&pin=${encodeURIComponent(trip.pin_plain)}`
        : `/editar?id=${encodeURIComponent(trip.id)}`;

      location.href = url;
    });

    els.btnZip?.addEventListener("click", async () => {
      if (!state.selectedTripId) return;

      try {
        await downloadWithAuth(`${API}/api/exports/${state.selectedTripId}/zip`);
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    els.btnExcel?.addEventListener("click", async () => {
      if (!state.selectedTripId) return;

      try {
        await downloadWithAuth(`${API}/api/admin/trips/${state.selectedTripId}/export/xlsx`, `lista-${state.selectedTripId}.xlsx`);
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    els.btnDocx?.addEventListener("click", async () => {
      if (!state.selectedTripId) return;

      try {
        await downloadWithAuth(`${API}/api/admin/trips/${state.selectedTripId}/export/docx`, `lista-${state.selectedTripId}.docx`);
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    els.btnApagar?.addEventListener("click", async () => {
      if (!state.selectedTripId) return;
      if (!confirm("APAGAR viagem e todos os dados?")) return;

      try {
        await api.del(`/api/admin/trips/${state.selectedTripId}/purge`, null, true);
        showToast("Viagem apagada!", "success");
        location.reload();
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    els.btnLogout?.addEventListener("click", () => {
      localStorage.removeItem("adminToken");
      location.href = "/admin";
    });
  }
});