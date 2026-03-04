// frontend/js/painel-admin.js
// Painel Admin (abas por viagem) - usa adminToken salvo no localStorage

const API = "https://lonesturismo.onrender.com"; 
// Para testar LOCAL, troque para:  const API = "http://localhost:3001";

let viagemSelecionada = null;

const tabsEl = document.getElementById("tabs");
const tbodyEl = document.getElementById("tbody");
const tituloEl = document.getElementById("viagemTitulo");
const infoEl = document.getElementById("viagemInfo");

const btnZip = document.getElementById("btnZip");
const btnApagar = document.getElementById("btnApagar");

function getAdminToken() {
  return localStorage.getItem("adminToken");
}

function getAuthHeaders() {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...getAuthHeaders(),
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Erro HTTP ${res.status}`);
  }
  return res.json();
}

// Download com Authorization (porque window.open não envia headers)
async function downloadZipComToken(url, fallbackFilename = "viagem.zip") {
  const token = getAdminToken();
  if (!token) {
    alert("Você não está logado. Faça login em Admin.");
    window.location.href = "admin.html";
    return;
  }

  const res = await fetch(url, {
    method: "GET",
    headers: { ...getAuthHeaders() },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Falha no download (HTTP ${res.status})`);
  }

  // tenta pegar nome do arquivo pelo header
  let filename = fallbackFilename;
  const cd = res.headers.get("content-disposition");
  if (cd) {
    const match = cd.match(/filename="([^"]+)"/i);
    if (match && match[1]) filename = match[1];
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

function setButtons(enabled) {
  btnZip.disabled = !enabled;
  btnApagar.disabled = !enabled;
}

function renderPassageiros(passageiros) {
  if (!passageiros.length) {
    tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">Nenhum passageiro cadastrado.</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = passageiros
    .map(
      (p) => `
      <tr>
        <td>${p.nome ?? ""}</td>
        <td>${p.documento ?? ""}</td>
        <td>${p.telefone ?? ""}</td>
      </tr>
    `
    )
    .join("");
}

async function carregarPassageiros(viagem) {
  viagemSelecionada = viagem;
  setButtons(true);

  const titulo = viagem.titulo || `Viagem #${viagem.id}`;
  tituloEl.textContent = titulo;

  const data = viagem.data_saida ? ` • Saída: ${viagem.data_saida}` : "";
  const status = viagem.status ? ` • ${viagem.status}` : "";
  infoEl.textContent = `ID: ${viagem.id}${data}${status}`;

  const passageiros = await fetchJSON(`${API}/api/viagens/${viagem.id}/passageiros`);
  renderPassageiros(passageiros);
}

function renderTabs(viagens) {
  tabsEl.innerHTML = "";

  if (!viagens.length) {
    tituloEl.textContent = "Nenhuma viagem cadastrada";
    infoEl.textContent = "";
    setButtons(false);
    tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">Cadastre uma viagem para começar.</td></tr>`;
    return;
  }

  viagens.forEach((v, idx) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (idx === 0 ? " active" : "");
    btn.textContent = v.titulo || `Viagem ${v.id}`;

    btn.onclick = async () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      try {
        await carregarPassageiros(v);
      } catch (e) {
        console.error(e);
        tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">Erro ao carregar passageiros.</td></tr>`;
      }
    };

    tabsEl.appendChild(btn);
  });

  carregarPassageiros(viagens[0]).catch((e) => {
    console.error(e);
    tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">Erro ao carregar dados.</td></tr>`;
  });
}

btnZip.onclick = async () => {
  if (!viagemSelecionada) return;

  try {
    await downloadZipComToken(
      `${API}/api/viagens/${viagemSelecionada.id}/export/zip`,
      `viagem_${viagemSelecionada.id}.zip`
    );
  } catch (e) {
    console.error(e);
    alert(`Falha ao exportar ZIP: ${e.message}`);
  }
};

btnApagar.onclick = async () => {
  if (!viagemSelecionada) return;

  const ok = confirm("Confirmar: apagar passageiros e documentos do banco após exportar?");
  if (!ok) return;

  try {
    await fetchJSON(`${API}/api/viagens/${viagemSelecionada.id}/passageiros`, {
      method: "DELETE",
    });

    renderPassageiros([]);
    alert("Apagado com sucesso.");
  } catch (e) {
    console.error(e);
    alert("Falha ao apagar. Verifique login/token.");
  }
};

(async function init() {
  // precisa estar logado
  if (!getAdminToken()) {
    window.location.href = "admin.html";
    return;
  }

  try {
    setButtons(false);
    const viagens = await fetchJSON(`${API}/api/viagens`);
    renderTabs(viagens);
  } catch (e) {
    console.error(e);
    tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">Erro ao carregar viagens (verifique login/token).</td></tr>`;
  }
})();