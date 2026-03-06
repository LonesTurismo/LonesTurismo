// ==================== app.js - ÚNICO ARQUIVO PARA TODO O SITE ====================
// Cadastro • Editar • Admin Login • Painel Admin
// Totalmente otimizado, sem duplicação, rápido e fácil de manter

const API = "";

// ==================== HELPERS COMPARTILHADOS ====================
const $ = (sel) => document.querySelector(sel);
const getQS = (name) => new URLSearchParams(location.search).get(name);

const onlyDigits = (str) => (str || "").replace(/\D/g, "");
const formatCPF = (val) => {
  let cpf = onlyDigits(val).slice(0, 11);
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
            .replace(/(\d{3})(\d{3})(\d{1,3})/, "$1.$2.$3")
            .replace(/(\d{3})(\d{1,3})/, "$1.$2");
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
  return { tripId: sessionStorage.getItem("tripId"), tripPin: sessionStorage.getItem("tripPin") };
}

// Upload de documentos (reutilizado em vários lugares)
async function uploadDocs(tripId, passengerId, pin, files) {
  if (!files?.length) return;
  if (files.length > 4) throw new Error("Máximo 4 arquivos");

  const fd = new FormData();
  fd.append("pin", pin);
  [...files].forEach(f => fd.append("files", f));

  const res = await fetch(`${API}/api/trips/${tripId}/passengers/${passengerId}/documents`, { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Erro no upload");
}
function setLoading(btn, isLoading, originalText = "") {
  if (isLoading) {
    originalText = btn.textContent;
    btn.dataset.originalText = originalText;
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Processando...`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || originalText;
  }
}

// ==================== API CLIENT ====================
const api = {
  async request(endpoint, method = "POST", body = null, isAdmin = false) {
    const headers = { "Content-Type": "application/json" };
    if (isAdmin) {
      const token = localStorage.getItem("adminToken");
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });

    if (!res.ok) {
      if (res.status === 401 && isAdmin) {
        localStorage.removeItem("adminToken");
        location.href = "admin";
        return;
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro ${res.status}`);
    }
    return res.json();
  },
  post: (ep, body, admin = false) => api.request(ep, "POST", body, admin),
  put:  (ep, body, admin = false) => api.request(ep, "PUT",  body, admin),
  del:  (ep, body, admin = false) => api.request(ep, "DELETE", body, admin)
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

// ==================== CADASTRO + EDITAR (páginas públicas) ====================
if ($("#btnCreateTrip") || $("#editTripId")) {  // cadastro ou editar

  // === CADASTRO ===
  async function createTrip() {
    const destination = $("#destination").value.trim();
    const dateIso = $("#dateIso").value.trim();
    const responsible = $("#responsible").value.trim();

    if (!destination || !dateIso || !responsible) return alert("Preencha todos os campos");

    try {
      const data = await api.post("/api/trips", { destination, dateIso, responsible });
      setTripSession(data.trip.id, data.pin);

      $("#tripInfo").innerHTML = `Viagem criada: <b>${data.trip.id}</b> • PIN: <b>${data.pin}</b><br>
                                  ${data.trip.destination} • ${data.trip.date_iso} • Resp: ${data.trip.responsible}`;
      alert(`✅ Viagem criada!\nID: ${data.trip.id}\nPIN: ${data.pin}`);
    } catch (e) { alert(e.message); }
  }

  async function addPassenger(tripId, pin, name, cpf, phone, files) {
    if (!name) throw new Error("Informe o nome");
    if (cpf.length !== 11) throw new Error("CPF deve ter 11 dígitos");

    const data = await api.post(`/api/trips/${tripId}/passengers`, { pin, name, cpf, phone });
    await uploadDocs(tripId, data.passengerId, pin, files);
  }

  // === EDITAR ===
  async function loadTripForEdit() {
    const tripId = $("#editTripId").value.trim();
    const pin = $("#editPin").value.trim();
    const err = $("#editError");

    if (!tripId || !pin) return err.textContent = "Informe ID e PIN";

    try {
      await api.post(`/api/trips/${tripId}/verify-pin`, { pin });
      const data = await api.post(`/api/trips/${tripId}/load`, { pin });

      setTripSession(tripId, pin);
      $("#editArea").style.display = "block";
      $("#tripHeader").textContent = `🆔 ${data.trip.id} • ${data.trip.destination} • ${data.trip.date_iso}`;
      $("#tripHint").textContent = `Responsável: ${data.trip.responsible}`;

      renderPassengers(tripId, pin, data.passengers);
    } catch (e) { err.textContent = e.message; }
  }

  function renderPassengers(tripId, pin, passengers) {
    const container = $("#passList");
    container.innerHTML = "";

    const frag = document.createDocumentFragment();
    passengers.forEach(p => {
      const div = document.createElement("div");
      div.className = "pass-card";
      div.dataset.id = p.id;
      div.innerHTML = `
        <div class="pass-grid">
          <div><label>Nome</label><input data-f="name" value="${p.name}" maxlength="100"></div>
          <div><label>CPF</label><input data-f="cpf" value="${formatCPF(p.cpf)}" maxlength="14"></div>
          <div><label>Telefone</label><input data-f="phone" value="${p.phone || ""}" maxlength="13"></div>
          <div><label>Docs (até 4)</label><input data-f="docs" type="file" multiple accept=".jpg,.jpeg,.png">
            <div class="small">Atuais: ${(p.documents || []).length}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn primary" data-action="save">Salvar</button>
          <button class="btn danger" data-action="del">Excluir</button>
        </div>
      `;
      frag.appendChild(div);
    });
    container.appendChild(frag);
  }

  // ==================== EVENTOS PÚBLICOS ====================
  document.addEventListener("DOMContentLoaded", () => {
    // Auto-fill ID
    const qid = getQS("id");
    if (qid && $("#editTripId")) $("#editTripId").value = qid;

    // Máscara CPF
    document.addEventListener("input", e => {
      if (e.target.placeholder?.includes("000.000.000-00")) e.target.value = formatCPF(e.target.value);
    });

    // Cadastro
    $("#btnCreateTrip")?.addEventListener("click", createTrip);
    $("#btnAddPassenger")?.addEventListener("click", async () => {
      const { tripId, tripPin } = getTripSession();
      if (!tripId) return alert("Crie a viagem primeiro");
      try {
        await addPassenger(tripId, tripPin, $("#pName").value.trim(), onlyDigits($("#pCpf").value), $("#pPhone").value.slice(0,13), $("#pDocs").files);
        alert("✅ Passageiro adicionado!");
      } catch (e) { alert(e.message); }
    });

    // Editar
    $("#btnLoadTrip")?.addEventListener("click", loadTripForEdit);
    $("#btnCreatePassenger")?.addEventListener("click", async () => {
      const { tripId, tripPin } = getTripSession();
      if (!tripId) return alert("Carregue a viagem");
      try {
        await addPassenger(tripId, tripPin, $("#newName").value.trim(), onlyDigits($("#newCpf").value), $("#newPhone").value.slice(0,13), $("#newDocs").files);
        alert("✅ Passageiro adicionado!");
        await loadTripForEdit();
      } catch (e) { alert(e.message); }
    });

    // Delegation salvar/excluir passageiros
    $("#passList")?.addEventListener("click", async e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const card = btn.closest(".pass-card");
      const { tripId, tripPin } = getTripSession();
      const pid = card.dataset.id;

      if (btn.dataset.action === "save") {
        const name = card.querySelector('[data-f="name"]').value.trim();
        const cpf = onlyDigits(card.querySelector('[data-f="cpf"]').value);
        const phone = card.querySelector('[data-f="phone"]').value.slice(0,13);
        const files = card.querySelector('[data-f="docs"]').files;

        try {
          await api.put(`/api/trips/${tripId}/passengers/${pid}`, { pin: tripPin, name, cpf, phone });
          await uploadDocs(tripId, pid, tripPin, files);
          alert("✅ Salvo!");
          await loadTripForEdit();
        } catch (err) { alert(err.message); }
      }

      if (btn.dataset.action === "del") {
        if (!confirm("Excluir passageiro?")) return;
        try {
          await api.del(`/api/trips/${tripId}/passengers/${pid}`, { pin: tripPin });
          alert("✅ Excluído!");
          await loadTripForEdit();
        } catch (err) { alert(err.message); }
      }
    });
  });
}

// ==================== PAINEL ADMIN ====================
if ($("#tabs") || $("#btnAdminLogin")) {

  const els = {
    tabs: $("#tabs"),
    tbody: $("#tbody"),
    titulo: $("#viagemTitulo"),
    info: $("#viagemInfo"),
    btnZip: $("#btnZip"),
    btnApagar: $("#btnApagar"),
    btnLogout: $("#btnLogout"),
    admError: $("#admError")
  };

  const state = { trips: [], selectedTripId: null, isLoading: false };

  function renderPassengers(passengers) {
    els.tbody.innerHTML = passengers?.length
      ? passengers.map(p => `<tr><td>${sanitize(p.name)}</td><td>${sanitize(p.cpf)}</td><td>${sanitize(p.phone || "-")}</td></tr>`).join("")
      : `<tr><td colspan="3" class="muted">Nenhum passageiro cadastrado.</td></tr>`;
  }

  function renderTabs(trips) {
    state.trips = trips || [];
    els.tabs.innerHTML = "";

    if (!state.trips.length) {
      els.titulo.textContent = "Nenhuma viagem cadastrada";
      renderPassengers([]);
      return;
    }

    const frag = document.createDocumentFragment();
    state.trips.forEach(t => {
      const b = document.createElement("button");
      b.className = "tab";
      b.textContent = `${sanitize(t.destination)} (${t.id})`;
      b.dataset.id = t.id;
      frag.appendChild(b);
    });
    els.tabs.appendChild(frag);

    // Seleciona primeira aba
    selectTrip(state.trips[0].id);
  }

  async function selectTrip(tripId) {
    if (state.isLoading) return;
    state.isLoading = true;
    state.selectedTripId = tripId;

    try {
      const trip = state.trips.find(t => t.id === tripId);
      els.titulo.textContent = sanitize(trip.destination);
      els.info.textContent = `ID: ${trip.id} • Saída: ${trip.date_iso} • Resp: ${sanitize(trip.responsible)}`;

      const data = await api.post(`/api/admin/trips/${tripId}/passengers`, null, true);
      renderPassengers(data.passengers || []);
    } catch (e) {
      els.titulo.textContent = "Erro ao carregar";
    } finally {
      state.isLoading = false;
    }
  }

  // ==================== ADMIN LOGIN ====================
  $("#btnAdminLogin")?.addEventListener("click", async () => {
    const user = $("#admUser").value.trim();
    const pass = $("#admPass").value.trim();

    try {
      const data = await api.post("/api/admin/login", { user, pass });
      localStorage.setItem("adminToken", data.token);
      location.href = "painel";
    } catch (e) {
      els.admError && (els.admError.textContent = e.message);
    }
  });

  // ==================== PAINEL EVENTOS ====================
  document.addEventListener("DOMContentLoaded", async () => {
    if ($("#tabs")) {  // Página painel
      // Acorda servidor
      fetch(`${API}/health`).catch(() => {});

      try {
        const data = await api.post("/api/admin/trips", null, true);
        renderTabs(data.trips || []);
      } catch (e) {
        els.titulo.textContent = "Erro de conexão";
      }

      // Delegation das abas
      els.tabs?.addEventListener("click", e => {
        const btn = e.target.closest(".tab");
        if (!btn) return;
        document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectTrip(btn.dataset.id);
      });

      // Botões ZIP e Apagar
      els.btnZip?.addEventListener("click", async () => {
        if (!state.selectedTripId) return;
        try { await downloadWithAuth(`${API}/api/exports/${state.selectedTripId}/zip`); }
        catch (e) { alert(e.message); }
      });

      els.btnApagar?.addEventListener("click", async () => {
        if (!state.selectedTripId || !confirm("APAGAR viagem e todos os dados?")) return;
        try {
          await api.del(`/api/admin/trips/${state.selectedTripId}/purge`, null, true);
          alert("✅ Viagem apagada!");
          location.reload();
        } catch (e) { alert(e.message); }
      });

      els.btnLogout?.addEventListener("click", () => {
        localStorage.removeItem("adminToken");
        location.href = "admin";
      });
    }
  });
}

// ==================== TOAST SYSTEM (substitui alert) ====================
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-xl shadow-2xl text-white flex items-center gap-3 z-50 transition-all duration-300 ${
    type === "success" ? "bg-emerald-600" : type === "error" ? "bg-red-600" : "bg-amber-600"
  }`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" class="ml-4 text-white/70 hover:text-white">✕</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Agora substitua todos os alert() por:
showToast("Viagem criada com sucesso!", "success");
showToast("Erro ao salvar passageiro", "error");

function setLoading(btn, isLoading, originalText = "") {
  if (isLoading) {
    originalText = btn.textContent;
    btn.dataset.originalText = originalText;
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Processando...`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || originalText;
  }
}