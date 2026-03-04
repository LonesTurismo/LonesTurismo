const API = "";

function getAdminToken() {
  return localStorage.getItem("adminToken");
}

function authHeaders() {
  const t = getAdminToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

async function downloadWithAuth(url, fallbackName = "viagem.zip") {
  const res = await fetch(url, { headers: { ...authHeaders() } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }

  let filename = fallbackName;
  const cd = res.headers.get("content-disposition");
  if (cd) {
    const m = cd.match(/filename="([^"]+)"/i);
    if (m?.[1]) filename = m[1];
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(blobUrl);
}

const tabsEl = document.getElementById("tabs");
const tbodyEl = document.getElementById("tbody");
const tituloEl = document.getElementById("viagemTitulo");
const infoEl = document.getElementById("viagemInfo");
const btnZip = document.getElementById("btnZip");
const btnApagar = document.getElementById("btnApagar");

let selectedTripId = null;

function renderPassengers(list) {
  if (!list.length) {
    tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">Nenhum passageiro cadastrado.</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = list
    .map(
      (p) => `
      <tr>
        <td>${p.name ?? ""}</td>
        <td>${p.cpf ?? ""}</td>
        <td>${p.phone ?? ""}</td>
      </tr>
    `
    )
    .join("");
}

async function selectTrip(trip) {
  selectedTripId = trip.id;

  tituloEl.textContent = `${trip.destination}`;
  infoEl.textContent = `ID: ${trip.id} • Saída: ${trip.date_iso} • Resp: ${trip.responsible}`;

  const data = await fetchJSON(`${API}/api/admin/trips/${trip.id}/passengers`);
  renderPassengers(data.passengers || []);

  btnZip.disabled = false;
  btnApagar.disabled = false;
}

function renderTabs(trips) {
  tabsEl.innerHTML = "";

  if (!trips.length) {
    tituloEl.textContent = "Nenhuma viagem cadastrada";
    infoEl.textContent = "";
    renderPassengers([]);
    btnZip.disabled = true;
    btnApagar.disabled = true;
    return;
  }

  trips.forEach((t, idx) => {
    const b = document.createElement("button");
    b.className = "tab" + (idx === 0 ? " active" : "");
    b.textContent = `${t.destination} (${t.id})`;
    b.onclick = async () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      await selectTrip(t);
    };
    tabsEl.appendChild(b);
  });

  selectTrip(trips[0]).catch(console.error);
}

btnZip.onclick = async () => {
  if (!selectedTripId) return;
  try {
    await downloadWithAuth(`${API}/api/exports/${selectedTripId}/zip`, `viagem_${selectedTripId}.zip`);
  } catch (e) {
    alert("Falha ao baixar ZIP: " + e.message);
  }
};

btnApagar.onclick = async () => {
  if (!selectedTripId) return;
  const ok = confirm("Isso vai APAGAR a viagem e todos os passageiros/documentos. Confirma?");
  if (!ok) return;

  try {
    await fetchJSON(`${API}/api/admin/trips/${selectedTripId}/purge`, { method: "DELETE" });
    alert("Apagado com sucesso. Recarregue a página.");
    window.location.reload();
  } catch (e) {
    alert("Falha ao apagar: " + e.message);
  }
};

(async function init() {
  const token = getAdminToken();
  if (!token) {
    window.location.href = "admin.html";
    return;
  }

  try {
    const data = await fetchJSON(`${API}/api/admin/trips`);
    renderTabs(data.trips || []);
  } catch (e) {
    console.error(e);
    alert("Erro ao carregar painel: " + e.message);
  }
})();