import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function openDb() {
  // Em produção (Render com Disk), setar DB_PATH=/var/data/banco.db
  const dbPath = process.env.DB_PATH
    ? process.env.DB_PATH
    : path.resolve("../database/banco.db"); // para sua estrutura LonesTur/database

  // Se DB_PATH for relativo, resolve dentro do backend
  const finalPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath);

  ensureDir(path.dirname(finalPath));

  const db = new Database(finalPath);
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      date_iso TEXT NOT NULL,
      responsible TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passengers (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cpf TEXT NOT NULL,
      phone TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      passenger_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      public_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(passenger_id) REFERENCES passengers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_passengers_trip ON passengers(trip_id);
    CREATE INDEX IF NOT EXISTS idx_docs_pass ON documents(passenger_id);
  `);

  return db;
}