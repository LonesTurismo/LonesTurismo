function salvarDestino(){
let cidade = document.getElementById("cidade").value;
let responsavel = document.getElementById("responsavel").value;

localStorage.setItem("cidade", cidade);
localStorage.setItem("responsavel", responsavel);

window.location.href="passageiro.html";
}

function mostrarIndividual(){
document.getElementById("individual").style.display="block";
document.getElementById("turma").style.display="none";
}

function mostrarTurma(){
document.getElementById("individual").style.display="none";
document.getElementById("turma").style.display="block";
}

function enviarIndividual(){
let nome = document.getElementById("nome").value;
let cpf = document.getElementById("cpf").value;
let cidade = localStorage.getItem("cidade");

if(cpf.length !== 10){
alert("CPF deve ter 10 caracteres");
return;
}

let solicitacoes = JSON.parse(localStorage.getItem("solicitacoes")) || [];

solicitacoes.push({
cidade,
nome,
cpf,
status:"Pendente",
data:new Date().toLocaleString()
});

localStorage.setItem("solicitacoes", JSON.stringify(solicitacoes));
alert("Solicitação enviada!");
window.location.href="index.html";
}

function adicionarPassageiro(){

let div = document.createElement("div");
div.classList.add("linha-passageiro");

div.innerHTML=`
<input type="text" placeholder="Nome" maxlength="100">
<input type="text" placeholder="CPF" maxlength="10">
<input type="text" placeholder="Telefone" maxlength="11">

<label class="upload-btn">
Selecionar Arquivo
<input type="file" accept=".jpg,.jpeg,.png" onchange="mostrarNomeArquivo(this)">
</label>

<span class="nome-arquivo">Nenhum arquivo</span>
`;

document.getElementById("listaPassageiros").appendChild(div);
}

function mostrarNomeArquivo(input){

let nomeSpan = input.closest(".linha-passageiro").querySelector(".nome-arquivo");

if(input.files.length > 0){
    nomeSpan.textContent = input.files[0].name;
}else{
    nomeSpan.textContent = "Nenhum arquivo";
}
}

function enviarTurma(){
alert("Função de envio da turma pode ser expandida.");
}

function login(){
let user = document.getElementById("user").value;
let senha = document.getElementById("senha").value;

if(user==="admin" && senha==="1234"){
window.location.href="painel.html";
}else{
document.getElementById("erro").innerText="Usuário ou senha incorretos";
}
}

function carregar(){

let solicitacoes = JSON.parse(localStorage.getItem("solicitacoes")) || [];
let tabela = document.getElementById("tabela");

if(!tabela) return;

tabela.innerHTML = "";

solicitacoes.forEach((s, i) => {

tabela.innerHTML += `
<tr>
<td>${s.cidade || "-"}</td>
<td>${s.responsavel || "-"}</td>
<td>${s.nome}</td>
<td>${s.cpf}</td>
<td>${s.status}</td>
<td>
<button onclick="aprovar(${i})">Aprovar</button>
<button onclick="excluir(${i})">Excluir</button>
</td>
</tr>
`;

});

}
function aprovar(i){
let solicitacoes = JSON.parse(localStorage.getItem("solicitacoes"));
solicitacoes[i].status="Aprovado";
localStorage.setItem("solicitacoes",JSON.stringify(solicitacoes));
carregar();
}

function excluir(i){
let solicitacoes = JSON.parse(localStorage.getItem("solicitacoes"));
solicitacoes.splice(i,1);
localStorage.setItem("solicitacoes",JSON.stringify(solicitacoes));
carregar();
}

function limpar(){
localStorage.removeItem("solicitacoes");
carregar();
}

function logout(){
window.location.href="admin.html";
}

window.onload=carregar;

document.addEventListener("input", function(e){

if(e.target.placeholder === "Telefone"){
    e.target.value = e.target.value.slice(0,13);
}

});