import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";

const db = await open({
  filename: "E:/LonesTur/database/banco.db",
  driver: sqlite3.Database
});

// criar viagem
const viagem = await db.run(`
INSERT INTO viagens (titulo, data_saida)
VALUES ('Aparecida do Norte', '2026-08-10')
`);

const viagemId = viagem.lastID;

// passageiros
await db.run(`
INSERT INTO passageiros (viagem_id,nome,documento,telefone)
VALUES
(${viagemId},'Carlos Silva','12345678900','66999999999'),
(${viagemId},'Ana Souza','98765432100','66988888888'),
(${viagemId},'Bruno Lima','45678912300','66977777777')
`);

console.log("Viagem teste criada");

await db.close();