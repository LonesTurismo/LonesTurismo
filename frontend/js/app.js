// ✅ Render backend
const API = "https://lonesturismo.onrender.com";

// ---------- helpers ----------
function onlyDigits(s = "") { return String(s).replace(/\D/g, ""); }
function formatCPF(cpf) {
  const d = onlyDigits(cpf).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.replace(/(\d{3})(\d+)/, "$1.$2");
  if (d.length <= 9) return d.replace(/(\d{3})(\d{3})(\d+)/, "$1.$2.$3");
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}
function getQS(name) { return new URL(window.location.href).searchParams.get(name); }

function setTripSession(tripId, pin) {
  sessionStorage.setItem("tripId", tripId);
  sessionStorage.setItem("tripPin", pin);
}
function getTripSession() {
  return {
    tripId: sessionStorage.getItem("tripId"),
    tripPin: sessionStorage.getItem("tripPin")
  };
}

function getAdminToken() { return localStorage.getItem("adminToken"); }
function setAdminToken(t) { localStorage.setItem("adminToken", t); }
function clearAdminToken() { localStorage.removeItem("adminToken"); }

// ---------- cadastro (criar viagem) ----------
async function createTrip() {
  const destination = document.getElementById("destination").value.trim();
  const dateIso = document.getElementById("dateIso").value.trim();
  const responsible = document.getElementById("responsible").value.trim();
  const info = document.getElementById("tripInfo");

  if (!destination || !dateIso || !responsible) return alert("Preencha destino, data e responsável.");

  const r = await fetch(`${API}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination, dateIso, responsible })
  });
  const d = await r.json();
  if (!r.ok) return alert(d.error || "Erro ao criar viagem");

  setTripSession(d.trip.id, d.pin);

  info.innerHTML = `Viagem criada: <b>${d.trip.id}</b> • PIN: <b>${d.pin}</b> • ${d.trip.destination} • ${d.trip.dateIso} • Resp: ${d.trip.responsible}`;
  alert(`Viagem criada!\nID: ${d.trip.id}\nPIN: ${d.pin}\n\nGuarde o PIN para editar depois.`);
}

async function copyTrip() {
  const { tripId, tripPin } = getTripSession();
  if (!tripId || !tripPin) return alert("Crie a viagem primeiro.");
  await navigator.clipboard.writeText(`ID: ${tripId}\nPIN: ${tripPin}`);
  alert("ID + PIN copiados!");
}

async function addPassengerFromCadastro() {
  const { tripId, tripPin } = getTripSession();
  if (!tripId || !tripPin) return alert("Crie a viagem antes e guarde o PIN.");

  const name = document.getElementById("pName").value.trim();
  const cpf = onlyDigits(document.getElementById("pCpf").value);
  const phone = (document.getElementById("pPhone").value || "").slice(0, 13);
  const files = document.getElementById("pDocs").files;

  if (!name) return alert("Informe o nome.");
  if (cpf.length !== 11) return alert("CPF deve ter 11 dígitos.");

  const r = await fetch(`${API}/api/trips/${tripId}/passengers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: tripPin, name, cpf, phone })
  });
  const d = await r.json();
  if (!r.ok) return alert(d.error || "Erro ao adicionar passageiro");

  if (files && files.length) {
    if (files.length > 4) return alert("Máximo 4 arquivos.");
    const fd = new FormData();
    fd.append("pin", tripPin);
    for (const f of files) fd.append("files", f);

    const up = await fetch(`${API}/api/trips/${tripId}/passengers/${d.passengerId}/documents`, {
      method: "POST",
      body: fd
    });
    const ud = await up.json();
    if (!up.ok) return alert(ud.error || "Erro no upload");
  }

  alert("Passageiro adicionado!");

  document.getElementById("pName").value = "";
  document.getElementById("pCpf").value = "";
  document.getElementById("pPhone").value = "";
  document.getElementById("pDocs").value = "";
}

// ---------- editar ----------
async function loadTripForEdit() {
  const tripId = document.getElementById("editTripId").value.trim();
  const pin = document.getElementById("editPin").value.trim();
  const err = document.getElementById("editError");
  err.textContent = "";

  if (!tripId || !pin) { err.textContent = "Informe ID e PIN."; return; }

  // verify
  const v = await fetch(`${API}/api/trips/${tripId}/verify-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin })
  });
  const vd = await v.json();
  if (!v.ok) { err.textContent = vd.error || "PIN inválido"; return; }

  setTripSession(tripId, pin);

  const r = await fetch(`${API}/api/trips/${tripId}/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin })
  });
  const d = await r.json();
  if (!r.ok) { err.textContent = d.error || "Erro"; return; }

  document.getElementById("editArea").style.display = "block";
  document.getElementById("tripHeader").textContent = `🆔 ${d.trip.id} • ${d.trip.destination} • ${d.trip.dateIso}`;
  document.getElementById("tripHint").textContent = `Responsável: ${d.trip.responsible}`;

  renderPassengers(d.trip.id, pin, d.passengers);
}

function renderPassengers(tripId, pin, passengers) {
  const list = document.getElementById("passList");
  list.innerHTML = "";

  passengers.forEach(p => {
    const div = document.createElement("div");
    div.className = "pass-card";
    div.innerHTML = `
      <div class="pass-grid">
        <div>
          <label>Nome</label>
          <input data-f="name" value="${p.name}" maxlength="100">
        </div>
        <div>
          <label>CPF</label>
          <input data-f="cpf" value="${formatCPF(p.cpf)}" maxlength="14" placeholder="000.000.000-00">
        </div>
        <div>
          <label>Telefone (13)</label>
          <input data-f="phone" value="${p.phone || ""}" maxlength="13">
        </div>
        <div>
          <label>Docs (até 4)</label>
          <input data-f="docs" type="file" multiple accept=".jpg,.jpeg,.png">
          <div class="small">Atuais: ${(p.documents || []).length}</div>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" data-action="save">Salvar</button>
        <button class="btn danger" data-action="del">Excluir</button>
      </div>
    `;

    div.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const name = div.querySelector('[data-f="name"]').value.trim();
      const cpf = onlyDigits(div.querySelector('[data-f="cpf"]').value);
      const phone = div.querySelector('[data-f="phone"]').value.slice(0, 13);

      const r = await fetch(`${API}/api/trips/${tripId}/passengers/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, name, cpf, phone })
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error || "Erro ao salvar");

      const files = div.querySelector('[data-f="docs"]').files;
      if (files && files.length) {
        if (files.length > 4) return alert("Máximo 4 arquivos.");
        const fd = new FormData();
        fd.append("pin", pin);
        for (const f of files) fd.append("files", f);

        const up = await fetch(`${API}/api/trips/${tripId}/passengers/${p.id}/documents`, {
          method: "POST",
          body: fd
        });
        const ud = await up.json();
        if (!up.ok) return alert(ud.error || "Erro no upload");
      }

      alert("Salvo!");
      await loadTripForEdit(); // recarrega
    });

    div.querySelector('[data-action="del"]').addEventListener("click", async () => {
      if (!confirm("Excluir este passageiro?")) return;

      const r = await fetch(`${API}/api/trips/${tripId}/passengers/${p.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error || "Erro ao excluir");

      alert("Excluído!");
      await loadTripForEdit();
    });

    list.appendChild(div);
  });
}

async function addPassengerFromEdit() {
  const { tripId, tripPin } = getTripSession();
  if (!tripId || !tripPin) return alert("Carregue uma viagem primeiro.");

  const name = document.getElementById("newName").value.trim();
  const cpf = onlyDigits(document.getElementById("newCpf").value);
  const phone = (document.getElementById("newPhone").value || "").slice(0, 13);
  const files = document.getElementById("newDocs").files;

  if (!name) return alert("Informe o nome.");
  if (cpf.length !== 11) return alert("CPF deve ter 11 dígitos.");

  const r = await fetch(`${API}/api/trips/${tripId}/passengers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: tripPin, name, cpf, phone })
  });
  const d = await r.json();
  if (!r.ok) return alert(d.error || "Erro ao adicionar passageiro");

  if (files && files.length) {
    if (files.length > 4) return alert("Máximo 4 arquivos.");
    const fd = new FormData();
    fd.append("pin", tripPin);
    for (const f of files) fd.append("files", f);

    const up = await fetch(`${API}/api/trips/${tripId}/passengers/${d.passengerId}/documents`, {
      method: "POST",
      body: fd
    });
    const ud = await up.json();
    if (!up.ok) return alert(ud.error || "Erro no upload");
  }

  document.getElementById("newName").value = "";
  document.getElementById("newCpf").value = "";
  document.getElementById("newPhone").value = "";
  document.getElementById("newDocs").value = "";

  alert("Passageiro adicionado!");
  await loadTripForEdit();
}

async function copyLinkPin() {
  const id = document.getElementById("editTripId").value.trim();
  const pin = document.getElementById("editPin").value.trim();
  if (!id || !pin) return alert("Informe ID e PIN.");
  const link = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(id)}`;
  await navigator.clipboard.writeText(`Link: ${link}\nPIN: ${pin}`);
  alert("Link + PIN copiados!");
}

// ---------- admin ----------
async function adminLogin() {
  const user = document.getElementById("admUser").value.trim();
  const pass = document.getElementById("admPass").value.trim();
  const err = document.getElementById("admError");
  err.textContent = "";

  const r = await fetch(`${API}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, pass })
  });
  const d = await r.json();
  if (!r.ok) { err.textContent = d.error || "Erro"; return; }

  setAdminToken(d.token);
  window.location.href = "painel.html";
}

function adminLogout(e) {
  if (e) e.preventDefault();
  clearAdminToken();
  window.location.href = "admin.html";
}

async function loadTripsPanel() {
  const token = getAdminToken();
  if (!token) { window.location.href = "admin.html"; return; }

  const r = await fetch(`${API}/api/admin/trips`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const d = await r.json();
  if (!r.ok) return alert(d.error || "Erro ao carregar viagens");

  const cont = document.getElementById("tripsContainer");
  cont.innerHTML = "";

  d.trips.forEach(t => {
    const editLink = `${window.location.origin}/editar.html?id=${encodeURIComponent(t.id)}`;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div>
          <h3 style="margin:0;">${t.destination} • ${t.date_iso}</h3>
          <div class="hint">Responsável: <b>${t.responsible}</b></div>
          <div class="hint">ID: <b>${t.id}</b></div>
          <div class="small">Passageiros: ${t.passenger_count} • Docs online: ${t.docs_count}</div>
          <div class="small">Link edição: ${editLink}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;justify-content:flex-end;">
          <button class="btn" data-copy="${editLink}">Copiar link</button>
          <a class="btn primary" href="#" data-xls="${t.id}">Excel</a>
          <a class="btn primary" href="#" data-doc="${t.id}">Word</a>
          <a class="btn" href="#" data-zip="${t.id}">ZIP</a>
          <button class="btn danger" data-del="${t.id}">Apagar arquivos online</button>
        </div>
      </div>
    `;

    card.querySelector('[data-copy]').addEventListener("click", async (e) => {
      await navigator.clipboard.writeText(e.target.getAttribute("data-copy"));
      alert("Link copiado!");
    });

    card.querySelector('[data-xls]').addEventListener("click", (e) => {
      e.preventDefault();
      window.open(`${API}/api/exports/${t.id}/excel`, "_blank");
    });

    card.querySelector('[data-doc]').addEventListener("click", (e) => {
      e.preventDefault();
      window.open(`${API}/api/exports/${t.id}/word`, "_blank");
    });

    card.querySelector('[data-zip]').addEventListener("click", (e) => {
      e.preventDefault();
      window.open(`${API}/api/exports/${t.id}/zip`, "_blank");
    });

    card.querySelector('[data-del]').addEventListener("click", async () => {
      if (!confirm("Isso vai apagar os documentos do Cloudinary dessa viagem. Continuar?")) return;

      const rr = await fetch(`${API}/api/admin/trips/${t.id}/documents`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const dd = await rr.json();
      if (!rr.ok) return alert(dd.error || "Erro ao apagar");
      alert(`Arquivos apagados: ${dd.deleted}`);
      loadTripsPanel();
    });

    cont.appendChild(card);
  });
}

// ---------- masks ----------
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el && el.placeholder === "000.000.000-00") {
    el.value = formatCPF(el.value);
  }
});

// ---------- init ----------
document.addEventListener("DOMContentLoaded", () => {
  // auto preencher id via querystring
  const qid = getQS("id");
  if (qid && document.getElementById("editTripId")) document.getElementById("editTripId").value = qid;

  // cadastro
  if (document.getElementById("btnCreateTrip")) {
    document.getElementById("btnCreateTrip").addEventListener("click", createTrip);
    document.getElementById("btnCopyTrip").addEventListener("click", copyTrip);
    document.getElementById("btnAddPassenger").addEventListener("click", addPassengerFromCadastro);
  }

  // editar
  if (document.getElementById("btnLoadTrip")) {
    document.getElementById("btnLoadTrip").addEventListener("click", loadTripForEdit);
    document.getElementById("btnCopyLinkPin").addEventListener("click", copyLinkPin);
    document.getElementById("btnCreatePassenger").addEventListener("click", addPassengerFromEdit);
  }

  // admin
  if (document.getElementById("btnAdminLogin")) {
    document.getElementById("btnAdminLogin").addEventListener("click", adminLogin);
  }

  // painel
  if (document.getElementById("tripsContainer")) {
    document.getElementById("btnLogout").addEventListener("click", adminLogout);
    loadTripsPanel();
  }
});