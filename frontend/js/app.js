// URL do backend no Render
const API = "https://lonesturismo.onrender.com";

// ===============================
// CRIAR NOVA VIAGEM
// ===============================
async function criarViagem() {
  const destino = document.getElementById("destino").value;
  const data = document.getElementById("data").value;
  const responsavel = document.getElementById("responsavel").value;

  if (!destino || !data || !responsavel) {
    alert("Preencha todos os campos.");
    return;
  }

  const resposta = await fetch(`${API}/trip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      destino,
      data,
      responsavel
    })
  });

  const dados = await resposta.json();

  if (dados.id) {
    alert("Viagem criada com sucesso!");
    window.location.href = `cadastro.html?id=${dados.id}`;
  } else {
    alert("Erro ao criar viagem");
  }
}

// ===============================
// CADASTRAR PASSAGEIRO
// ===============================
async function cadastrarPassageiro() {
  const params = new URLSearchParams(window.location.search);
  const viagem_id = params.get("id");

  const nome = document.getElementById("nome").value;
  const cpf = document.getElementById("cpf").value;
  const telefone = document.getElementById("telefone").value;
  const arquivo = document.getElementById("documento").files[0];

  if (!nome || !cpf || !telefone) {
    alert("Preencha todos os campos.");
    return;
  }

  const formData = new FormData();

  formData.append("viagem_id", viagem_id);
  formData.append("nome", nome);
  formData.append("cpf", cpf);
  formData.append("telefone", telefone);

  if (arquivo) {
    formData.append("documento", arquivo);
  }

  const resposta = await fetch(`${API}/passenger`, {
    method: "POST",
    body: formData
  });

  const dados = await resposta.json();

  if (dados.success) {
    alert("Passageiro cadastrado!");
    location.reload();
  } else {
    alert("Erro ao cadastrar passageiro");
  }
}

// ===============================
// CARREGAR PASSAGEIROS DA VIAGEM
// ===============================
async function carregarPassageiros() {
  const params = new URLSearchParams(window.location.search);
  const viagem_id = params.get("id");

  if (!viagem_id) return;

  const resposta = await fetch(`${API}/trip/${viagem_id}`);
  const passageiros = await resposta.json();

  const tabela = document.getElementById("listaPassageiros");
  tabela.innerHTML = "";

  passageiros.forEach(p => {
    const linha = `
      <tr>
        <td>${p.nome}</td>
        <td>${p.cpf}</td>
        <td>${p.telefone}</td>
      </tr>
    `;
    tabela.innerHTML += linha;
  });
}

// ===============================
// LOGIN ADMIN
// ===============================
async function loginAdmin() {
  const user = document.getElementById("user").value;
  const senha = document.getElementById("senha").value;

  const resposta = await fetch(`${API}/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      user,
      senha
    })
  });

  const dados = await resposta.json();

  if (dados.success) {
    window.location.href = "painel.html";
  } else {
    alert("Usuário ou senha inválidos");
  }
}

// ===============================
// CARREGAR VIAGENS NO PAINEL
// ===============================
async function carregarViagens() {
  const resposta = await fetch(`${API}/admin/viagens`);
  const viagens = await resposta.json();

  const tabela = document.getElementById("tabelaViagens");
  if (!tabela) return;

  tabela.innerHTML = "";

  viagens.forEach(v => {
    const linha = `
      <tr>
        <td>${v.destino}</td>
        <td>${v.data}</td>
        <td>${v.responsavel}</td>
        <td>
          <a href="editar.html?id=${v.id}">Ver passageiros</a>
        </td>
      </tr>
    `;

    tabela.innerHTML += linha;
  });
}

// ===============================
// EXPORTAR EXCEL
// ===============================
function exportarExcel(id) {
  window.open(`${API}/admin/export/excel/${id}`);
}

// ===============================
// EXPORTAR WORD
// ===============================
function exportarWord(id) {
  window.open(`${API}/admin/export/word/${id}`);
}

// ===============================
// EXPORTAR ZIP
// ===============================
function exportarZip(id) {
  window.open(`${API}/admin/export/zip/${id}`);
}

// ===============================
// AUTO LOAD
// ===============================
window.onload = () => {
  carregarPassageiros();
  carregarViagens();
};