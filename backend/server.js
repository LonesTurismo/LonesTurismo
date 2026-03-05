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
import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";

import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from "docx";
import cloudinary from "./cloudinary.js";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

import { z } from "zod";
import rateLimit from "express-rate-limit";

dotenv.config();

// ==================== CONFIGURAÇÕES INICIAIS ====================
const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: "10mb" }));
app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL || "*", 
  credentials: true
}));

// ==================== RATE LIMIT ====================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Muitas requisições. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Muitas tentativas de login. Tente novamente em 1 hora." }
});

app.use("/api/admin/login", loginLimiter);
app.use("/api/", generalLimiter);

// ==================== MULTER ====================
const upload = multer({ storage: multer.memoryStorage() });

// ==================== CONSTANTES ====================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database", "banco.db");

// ==================== BANCO ====================
const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
await db.exec("PRAGMA foreign_keys = ON;");

// ==================== ZOD SCHEMAS ====================
const createTripSchema = z.object({
  destination: z.string().min(3, "Destino deve ter pelo menos 3 caracteres"),
  dateIso:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)"),
  responsible: z.string().min(3, "Responsável deve ter pelo menos 3 caracteres")
});

const addPassengerSchema = z.object({
  name:  z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  cpf:   z.string().length(11, "CPF deve ter exatamente 11 dígitos"),
  phone: z.string().optional()
});

const adminLoginSchema = z.object({
  user: z.string().min(1, "Usuário é obrigatório"),
  pass: z.string().min(1, "Senha é obrigatória")
});

// ==================== HELPERS ====================
const nowIso = () => new Date().toISOString();
const id8 = () => crypto.randomBytes(4).toString("hex");
const id12 = () => crypto.randomBytes(6).toString("hex");
const pin4 = () => String(Math.floor(1000 + Math.random() * 9000));

const sanitizeName = (name = "") =>
  String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[<>:"/\\|?*]/g, "").trim();

// ==================== AUTH ADMIN ====================
function authAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token ausente" });
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") return res.status(403).json({ error: "Sem permissão" });
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}

// ==================== ROTAS ====================

app.get("/health", (req, res) => res.json({ ok: true }));

// ==================== ADMIN LOGIN ====================
app.post("/api/admin/login", async (req, res) => {
  try {
    const data = adminLoginSchema.parse(req.body);

    if (data.user !== process.env.ADMIN_USER || data.pass !== process.env.ADMIN_PASS) {
      return res.status(401).json({ error: "Usuário ou senha incorretos" });
    }

    const token = jwt.sign({ user: data.user, role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
    res.json({ success: true, token });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
    res.status(500).json({ error: "Erro interno" });
  }
});

// ==================== CRIAR VIAGEM ====================
app.post("/api/trips", async (req, res) => {
  try {
    const data = createTripSchema.parse(req.body);

    const tripId = id8();
    const pin = pin4();
    const pinHash = await bcrypt.hash(pin, 10);

    await db.run(
      `INSERT INTO trips (id, destination, date_iso, responsible, pin_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tripId, data.destination, data.dateIso, data.responsible, pinHash, nowIso()]
    );

    const trip = await db.get(`SELECT id, destination, date_iso, responsible FROM trips WHERE id = ?`, [tripId]);
    res.json({ trip, pin });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    console.error(err);
    res.status(500).json({ error: "Erro ao criar viagem" });
  }
});

// ==================== VERIFY PIN ====================
app.post("/api/trips/:id/verify-pin", async (req, res) => {
  try {
    const tripId = String(req.params.id);
    const pin = String(req.body?.pin ?? "").trim();

    const trip = await db.get(`SELECT pin_hash FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const ok = await bcrypt.compare(pin, trip.pin_hash);
    if (!ok) return res.status(401).json({ error: "PIN inválido" });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao verificar PIN" });
  }
});

// ==================== ADICIONAR PASSAGEIRO ====================
app.post("/api/trips/:id/passengers", async (req, res) => {
  try {
    const data = addPassengerSchema.parse(req.body);
    const tripId = String(req.params.id);
    const pin = String(req.body?.pin ?? "").trim();

    const trip = await db.get(`SELECT pin_hash FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const ok = await bcrypt.compare(pin, trip.pin_hash);
    if (!ok) return res.status(401).json({ error: "PIN inválido" });

    const passengerId = id12();
    await db.run(
      `INSERT INTO passengers (id, trip_id, name, cpf, phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [passengerId, tripId, data.name, data.cpf, data.phone || null, nowIso()]
    );

    res.json({ ok: true, passengerId });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    console.error(err);
    res.status(500).json({ error: "Erro ao adicionar passageiro" });
  }
});

// ==================== UPLOAD DOCUMENTOS ====================
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
      await db.run(
        `INSERT INTO documents (id, passenger_id, filename, url, public_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [docId, passengerId, f.originalname || "documento", result.secure_url, result.public_id, nowIso()]
      );

      uploaded.push({ id: docId, filename: f.originalname, url: result.secure_url });
    }

    res.json({ ok: true, uploaded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro no upload" });
  }
});

// ==================== ADMIN LISTAGENS ====================
app.get("/api/admin/trips", authAdmin, async (req, res) => {
  const trips = await db.all(`SELECT t.id, t.destination, t.date_iso, t.responsible,
    (SELECT COUNT(*) FROM passengers WHERE trip_id = t.id) as passenger_count,
    (SELECT COUNT(*) FROM documents d JOIN passengers p ON p.id = d.passenger_id WHERE p.trip_id = t.id) as docs_count
    FROM trips t ORDER BY t.created_at DESC`);
  res.json({ trips });
});

app.get("/api/admin/trips/:id/passengers", authAdmin, async (req, res) => {
  const passengers = await db.all(`SELECT id, name, cpf, phone FROM passengers WHERE trip_id = ? ORDER BY name`, [req.params.id]);
  res.json({ passengers });
});

// ==================== EXPORTS (agora COMPLETOS e otimizados) ====================

// ==================== EXCEL ====================
app.get("/api/exports/:tripId/excel", authAdmin, async (req, res) => {
  try {
    const tripId = req.params.tripId;
    const passengers = await db.all(
      "SELECT name, cpf, phone FROM passengers WHERE trip_id = ? ORDER BY name COLLATE NOCASE",
      [tripId]
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Passageiros");

    sheet.columns = [
      { header: "Nome", key: "name", width: 40 },
      { header: "CPF", key: "cpf", width: 18 },
      { header: "Telefone", key: "phone", width: 15 }
    ];

    sheet.addRows(passengers);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=viagem_${tripId}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao gerar Excel" });
  }
});

// ==================== WORD ====================
app.get("/api/exports/:tripId/word", authAdmin, async (req, res) => {
  try {
    const tripId = req.params.tripId;
    const passengers = await db.all(
      "SELECT name, cpf FROM passengers WHERE trip_id = ? ORDER BY name COLLATE NOCASE",
      [tripId]
    );

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: `Viagem ID: ${tripId}`, bold: true, size: 24 }),
          new Paragraph({ text: "" }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Nome", bold: true })] }),
                  new TableCell({ children: [new Paragraph({ text: "CPF", bold: true })] })
                ]
              }),
              ...passengers.map(p => new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph(p.name || "")] }),
                  new TableCell({ children: [new Paragraph(p.cpf || "")] })
                ]
              }))
            ]
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename=lista_${tripId}.docx`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao gerar Word" });
  }
});

// ==================== ZIP (completo e otimizado) ====================
app.get("/api/exports/:tripId/zip", authAdmin, async (req, res) => {
  try {
    const tripId = req.params.tripId;

    const trip = await db.get("SELECT id, destination, date_iso FROM trips WHERE id = ?", [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const passengers = await db.all(
      "SELECT id, name, cpf, phone FROM passengers WHERE trip_id = ? ORDER BY name COLLATE NOCASE",
      [tripId]
    );

    const docs = await db.all(
      `SELECT d.passenger_id, d.filename, d.url 
       FROM documents d 
       JOIN passengers p ON p.id = d.passenger_id 
       WHERE p.trip_id = ?`,
      [tripId]
    );

    const docsByPassenger = new Map();
    docs.forEach(d => {
      if (!docsByPassenger.has(d.passenger_id)) docsByPassenger.set(d.passenger_id, []);
      docsByPassenger.get(d.passenger_id).push(d);
    });

    const baseName = sanitizeName(trip.destination) || `viagem_${tripId}`;
    const zipFilename = `${baseName}_ID_${tripId}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    // CSV
    const csvHeader = "Nome;CPF;Telefone\n";
    const csvBody = passengers.map(p => `"${p.name}";"${p.cpf}";"${p.phone || ""}"`).join("\n");
    archive.append(csvHeader + csvBody, { name: `01_passageiros_${baseName}.csv` });

    // Word (lista simples)
    // (pode manter o Word que já está acima ou remover se quiser)

    // Documentos organizados por passageiro
    for (const p of passengers) {
      const folder = sanitizeName(p.name) || `passageiro_${p.id}`;
      const passengerDocs = docsByPassenger.get(p.id) || [];

      for (const doc of passengerDocs) {
        const resp = await fetch(doc.url);
        if (!resp.ok) continue;
        const ext = path.extname(doc.filename) || ".jpg";
        archive.append(resp.body, { name: `02_documentos/${folder}/${doc.filename}${ext}` });
      }
    }

    await archive.finalize();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Erro ao gerar ZIP" });
  }
});

// ==================== PURGE (apagar viagem) ====================
app.delete("/api/admin/trips/:tripId/purge", authAdmin, async (req, res) => {
  try {
    const tripId = req.params.tripId;

    // Apagar arquivos no Cloudinary
    const docs = await db.all(
      `SELECT public_id FROM documents d 
       JOIN passengers p ON p.id = d.passenger_id 
       WHERE p.trip_id = ?`,
      [tripId]
    );

    for (const doc of docs) {
      try {
        await cloudinary.uploader.destroy(doc.public_id, { resource_type: "auto" });
      } catch {}
    }

    // Apagar no banco (ON DELETE CASCADE cuida do resto)
    const result = await db.run("DELETE FROM trips WHERE id = ?", [tripId]);

    res.json({ ok: true, deleted: result.changes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao apagar viagem" });
  }
});

// ==================== INICIAR ====================
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));