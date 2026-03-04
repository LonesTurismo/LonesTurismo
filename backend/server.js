import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import archiver from "archiver";
import fetch from "node-fetch";
import multer from "multer";
import crypto from "crypto";

import path from "path";
import { fileURLToPath } from "url";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

import cloudinary from "./cloudinary.js";

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
} from "docx";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());
app.use(helmet());

const upload = multer({ storage: multer.memoryStorage() });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

// Admin via env (recomendado)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

// DB
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database", "banco.db");
console.log("DB_PATH =", DB_PATH);

const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
await db.exec("PRAGMA foreign_keys = ON;");

// ---------- util ----------
const nowIso = () => new Date().toISOString();
const id8 = () => crypto.randomBytes(4).toString("hex"); // 8 chars
const id12 = () => crypto.randomBytes(6).toString("hex"); // 12 chars
const pin4 = () => String(Math.floor(1000 + Math.random() * 9000));

function sanitizeName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function toCsvCell(v = "") {
  const s = String(v ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}
function guessExtFromContentType(ct = "") {
  const v = (ct || "").toLowerCase();
  if (v.includes("pdf")) return ".pdf";
  if (v.includes("jpeg")) return ".jpg";
  if (v.includes("png")) return ".png";
  if (v.includes("webp")) return ".webp";
  return "";
}

// ---------- auth admin ----------
function authAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");
    if (type !== "Bearer" || !token) return res.status(401).json({ error: "Token ausente" });
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload?.role !== "admin") return res.status(403).json({ error: "Sem permissão" });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// ---------- health ----------
app.get("/health", (req, res) => res.json({ ok: true }));

// ---------- admin login ----------
app.post("/api/admin/login", (req, res) => {
  const user = String(req.body?.user ?? "").trim();
  const pass = String(req.body?.pass ?? "").trim();

  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    return res.status(401).json({ error: "Usuário ou senha incorretos" });
  }

  const token = jwt.sign({ user, role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
  return res.json({ success: true, token });
});

// ---------- trips (cadastro) ----------
app.post("/api/trips", async (req, res) => {
  try {
    const destination = String(req.body?.destination ?? "").trim();
    const dateIso = String(req.body?.dateIso ?? "").trim();
    const responsible = String(req.body?.responsible ?? "").trim();

    if (!destination || !dateIso || !responsible) {
      return res.status(400).json({ error: "destination, dateIso e responsible são obrigatórios" });
    }

    const tripId = id8(); // id curto
    const pin = pin4();
    const pinHash = await bcrypt.hash(pin, 10);

    await db.run(
      `INSERT INTO trips (id, destination, date_iso, responsible, pin_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tripId, destination, dateIso, responsible, pinHash, nowIso()]
    );

    const trip = await db.get(
      `SELECT id, destination, date_iso, responsible, created_at FROM trips WHERE id = ?`,
      [tripId]
    );

    return res.json({ trip, pin });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao criar viagem" });
  }
});

app.post("/api/trips/:id/verify-pin", async (req, res) => {
  try {
    const tripId = String(req.params.id);
    const pin = String(req.body?.pin ?? "").trim();

    const trip = await db.get(`SELECT id, pin_hash FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const ok = await bcrypt.compare(pin, trip.pin_hash);
    if (!ok) return res.status(401).json({ error: "PIN inválido" });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao verificar PIN" });
  }
});

// ---------- passengers ----------
app.post("/api/trips/:id/passengers", async (req, res) => {
  try {
    const tripId = String(req.params.id);
    const pin = String(req.body?.pin ?? "").trim();
    const name = String(req.body?.name ?? "").trim();
    const cpf = String(req.body?.cpf ?? "").replace(/\D/g, "");
    const phone = String(req.body?.phone ?? "").trim();

    if (!pin || !name || cpf.length !== 11) {
      return res.status(400).json({ error: "pin, name e cpf(11 dígitos) são obrigatórios" });
    }

    const trip = await db.get(`SELECT pin_hash FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const ok = await bcrypt.compare(pin, trip.pin_hash);
    if (!ok) return res.status(401).json({ error: "PIN inválido" });

    const passengerId = id12();
    await db.run(
      `INSERT INTO passengers (id, trip_id, name, cpf, phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [passengerId, tripId, name, cpf, phone, nowIso()]
    );

    return res.json({ ok: true, passengerId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao adicionar passageiro" });
  }
});

// ---------- upload documents (Cloudinary) ----------
app.post("/api/trips/:tripId/passengers/:passengerId/documents", upload.array("files", 4), async (req, res) => {
  try {
    const tripId = String(req.params.tripId);
    const passengerId = String(req.params.passengerId);
    const pin = String(req.body?.pin ?? "").trim();

    if (!pin) return res.status(400).json({ error: "PIN é obrigatório" });

    const trip = await db.get(`SELECT pin_hash FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const ok = await bcrypt.compare(pin, trip.pin_hash);
    if (!ok) return res.status(401).json({ error: "PIN inválido" });

    const pass = await db.get(`SELECT id FROM passengers WHERE id = ? AND trip_id = ?`, [passengerId, tripId]);
    if (!pass) return res.status(404).json({ error: "Passageiro não encontrado" });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const uploaded = [];

    for (const f of files) {
      const base64 = f.buffer.toString("base64");
      const dataUri = `data:${f.mimetype};base64,${base64}`;

      const result = await cloudinary.uploader.upload(dataUri, {
        folder: `lonestur/${tripId}/${passengerId}`,
        resource_type: "auto",
      });

      const docId = id12();
      const filename = f.originalname || "documento";

      await db.run(
        `INSERT INTO documents (id, passenger_id, filename, url, public_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [docId, passengerId, filename, result.secure_url, result.public_id, nowIso()]
      );

      uploaded.push({ id: docId, filename, url: result.secure_url });
    }

    return res.json({ ok: true, uploaded });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro no upload" });
  }
});

// ---------- admin: listar trips ----------
app.get("/api/admin/trips", authAdmin, async (req, res) => {
  try {
    const trips = await db.all(
      `SELECT
        t.id, t.destination, t.date_iso, t.responsible, t.created_at,
        (SELECT COUNT(*) FROM passengers p WHERE p.trip_id = t.id) AS passenger_count,
        (SELECT COUNT(*) FROM documents d
          JOIN passengers p2 ON p2.id = d.passenger_id
          WHERE p2.trip_id = t.id) AS docs_count
      FROM trips t
      ORDER BY t.created_at DESC`
    );

    return res.json({ trips });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao carregar viagens" });
  }
});

app.get("/api/admin/trips/:id/passengers", authAdmin, async (req, res) => {
  try {
    const tripId = String(req.params.id);
    const passengers = await db.all(
      `SELECT id, name, cpf, phone
       FROM passengers
       WHERE trip_id = ?
       ORDER BY name COLLATE NOCASE ASC`,
      [tripId]
    );
    return res.json({ passengers });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao carregar passageiros" });
  }
});

// ---------- export ZIP (admin) ----------
app.get("/api/exports/:tripId/zip", authAdmin, async (req, res) => {
  try {
    const tripId = String(req.params.tripId);

    const trip = await db.get(
      `SELECT id, destination, date_iso, responsible FROM trips WHERE id = ?`,
      [tripId]
    );
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const passengers = await db.all(
      `SELECT id, name, cpf, phone
       FROM passengers
       WHERE trip_id = ?
       ORDER BY name COLLATE NOCASE ASC`,
      [tripId]
    );

    // documentos
    const ids = passengers.map(p => p.id);
    let docs = [];
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      docs = await db.all(
        `SELECT passenger_id, filename, url
         FROM documents
         WHERE passenger_id IN (${placeholders})
         ORDER BY passenger_id ASC, filename COLLATE NOCASE ASC`,
        ids
      );
    }

    const docsByPassenger = new Map();
    for (const d of docs) {
      if (!docsByPassenger.has(d.passenger_id)) docsByPassenger.set(d.passenger_id, []);
      docsByPassenger.get(d.passenger_id).push(d);
    }

    const base = sanitizeName(trip.destination || `trip_${trip.id}`) || `trip_${trip.id}`;
    const zipFilename = `${base}_ID_${trip.id}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error(err);
      try { res.status(500).end("Erro ao gerar ZIP"); } catch {}
    });
    archive.pipe(res);

    // 1) CSV (nome, documento, telefone) em ordem alfabética
    const csvHeader = ["Nome", "Documento", "Telefone"].join(";");
    const csvBody = passengers
      .map((p) => [toCsvCell(p.name), toCsvCell(p.cpf), toCsvCell(p.phone)].join(";"))
      .join("\n");
    archive.append("\uFEFF" + csvHeader + "\n" + csvBody, {
      name: `01_passageiros_${base}.csv`,
    });

    // 2) Word (somente nome;cpf) em ordem alfabética
    const rows = [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Nome", bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "CPF", bold: true })] })] }),
        ],
      }),
      ...passengers.map((p) =>
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(p.name || "")] }),
            new TableCell({ children: [new Paragraph(p.cpf || "")] }),
          ],
        })
      ),
    ];

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `Viagem: ${trip.destination} (ID ${trip.id})`, bold: true }),
              ],
            }),
            new Paragraph(""),
            new Table({ rows }),
          ],
        },
      ],
    });

    const docxBuffer = await Packer.toBuffer(doc);
    archive.append(docxBuffer, { name: `02_lista_nome_cpf_${base}.docx` });

    // 3) Pasta com subpastas por passageiro + arquivos
    for (const p of passengers) {
      const folder = sanitizeName(p.name || `passageiro_${p.id}`) || `passageiro_${p.id}`;
      const passengerDocs = docsByPassenger.get(p.id) || [];

      for (const file of passengerDocs) {
        const url = file.url;
        if (!url) continue;

        const resp = await fetch(url);
        if (!resp.ok) continue;

        const ct = resp.headers.get("content-type") || "";
        const rawName = sanitizeName(file.filename || "documento") || "documento";
        const hasExt = path.extname(rawName).length > 0;
        const ext = hasExt ? "" : guessExtFromContentType(ct);

        const zipPath = path.posix.join("03_documentos", folder, rawName + ext);
        archive.append(resp.body, { name: zipPath });
      }
    }

    await archive.finalize();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao exportar ZIP" });
  }
});

// ---------- admin: apagar tudo após baixar (padrão do seu painel) ----------
app.delete("/api/admin/trips/:tripId/purge", authAdmin, async (req, res) => {
  try {
    const tripId = String(req.params.tripId);

    // buscar public_id no cloudinary pra apagar
    const docs = await db.all(
      `SELECT d.public_id
       FROM documents d
       JOIN passengers p ON p.id = d.passenger_id
       WHERE p.trip_id = ?`,
      [tripId]
    );

    // apaga cloudinary (melhor esforço)
    for (const d of docs) {
      try {
        await cloudinary.uploader.destroy(d.public_id, { resource_type: "auto" });
      } catch {}
    }

    // apagar no banco (cascade)
    const r = await db.run(`DELETE FROM trips WHERE id = ?`, [tripId]);
    return res.json({ ok: true, deletedTrips: r.changes });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao apagar viagem" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});