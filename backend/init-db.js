import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database", "banco.db");

const schemaPath = path.join(__dirname, "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf-8");

const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
await db.exec(schema);

console.log("✅ Banco SQLite inicializado com sucesso!");
console.log("📍 Caminho:", DB_PATH);
await db.close();