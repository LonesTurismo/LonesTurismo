// frontend/js/painel-admin.js
const API = "https://lonesturismo.onrender.com"; // ajuste se necessário

let viagemSelecionada = null;

const tabsEl = document.getElementById("tabs");
const tbodyEl = document.getElementById("tbody");
const tituloEl = document.getElementById("viagemTitulo");
const infoEl = document.getElementById("viagemInfo");

const btnZip = document.getElementById("btnZip");
const btnApagar = document.getElementById("btnApagar");

function getAuthHeaders() {
  const token = localStorage.getItem("token"); // ajuste se o nome do token for outro
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

  // mostra destino e/ou id (como você pediu)
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

btnZip.onclick = () => {
  if (!viagemSelecionada) return;
  window.location.href = `${API}/api/viagens/${viagemSelecionada.id}/export/zip`;
};

btnApagar.onclick = async () => {
  if (!viagemSelecionada) return;

  const ok = confirm(
    "Confirmar: apagar TODOS os passageiros e documentos do banco após exportar?\n\nClique em Exportar ZIP antes."
  );
  if (!ok) return;

  try {
    await fetchJSON(`${API}/api/viagens/${viagemSelecionada.id}/passageiros`, { method: "DELETE" });
    renderPassageiros([]);
    alert("Apagado com sucesso.");
  } catch (e) {
    console.error(e);
    alert("Falha ao apagar. Verifique login/token.");
  }
};

(async function init() {
  try {
    setButtons(false);
    const viagens = await fetchJSON(`${API}/api/viagens`);
    renderTabs(viagens);
  } catch (e) {
    console.error(e);
    tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">Erro ao carregar viagens (verifique login/token).</td></tr>`;
  }
})();