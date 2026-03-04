import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDB() {

  const db = await open({
    filename: "../database/banco.db",
    driver: sqlite3.Database
  });

  await db.exec(`
  
  CREATE TABLE IF NOT EXISTS viagens(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destino TEXT,
    data TEXT,
    responsavel TEXT,
    pin TEXT
  );

  CREATE TABLE IF NOT EXISTS passageiros(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    viagem_id INTEGER,
    nome TEXT,
    cpf TEXT,
    telefone TEXT
  );

  CREATE TABLE IF NOT EXISTS documentos(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passageiro_id INTEGER,
    url TEXT,
    public_id TEXT
  );

  `);

  return db;

}