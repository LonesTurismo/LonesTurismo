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
import fs from "fs";
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

app.set("trust proxy", 1);

app.use(express.json({ limit: "10mb" }));
app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);

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
  message: { error: "Muitas tentativas de login. Tente novamente em 1 hora." },
});

app.use("/api/admin/login", loginLimiter);
app.use("/api/", generalLimiter);

// ==================== MULTER ====================
const upload = multer({ storage: multer.memoryStorage() });

// ==================== CONSTANTES ====================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "database", "banco.db");

// garante que a pasta do banco exista antes de abrir o sqlite
const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

console.log("DB_PATH =", DB_PATH);

// ==================== BANCO ====================
const db = await open({
  filename: DB_PATH,
  driver: sqlite3.Database,
});

await db.exec("PRAGMA foreign_keys = ON;");

// ==================== ZOD SCHEMAS ====================
const createTripSchema = z.object({
  destination: z.string().min(3, "Destino deve ter pelo menos 3 caracteres"),
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)"),
  responsible: z.string().min(3, "Responsável deve ter pelo menos 3 caracteres"),
});

const addPassengerSchema = z.object({
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  cpf: z.string().length(11, "CPF deve ter exatamente 11 dígitos"),
  phone: z.string().optional(),
});

const adminLoginSchema = z.object({
  user: z.string().min(1, "Usuário é obrigatório"),
  pass: z.string().min(1, "Senha é obrigatória"),
});

// ==================== HELPERS ====================
const nowIso = () => new Date().toISOString();
const id8 = () => crypto.randomBytes(4).toString("hex");
const id12 = () => crypto.randomBytes(6).toString("hex");
const pin4 = () => String(Math.floor(1000 + Math.random() * 9000));

const sanitizeName = (name = "") =>
  String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "")
    .trim();

// ==================== AUTH ADMIN ====================
function authAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token ausente" });

    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }

    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}

// ==================== ROTAS ====================
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ==================== ADMIN LOGIN ====================
app.post("/api/admin/login", async (req, res) => {
  try {
    const data = adminLoginSchema.parse(req.body);

    if (
      data.user !== process.env.ADMIN_USER ||
      data.pass !== process.env.ADMIN_PASS
    ) {
      return res.status(401).json({ error: "Usuário ou senha incorretos" });
    }

    const token = jwt.sign(
      { user: data.user, role: "admin" },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ success: true, token });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
    }
    console.error(err);
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

    const trip = await db.get(
      `SELECT id, destination, date_iso, responsible FROM trips WHERE id = ?`,
      [tripId]
    );

    res.json({ trip, pin });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors?.[0]?.message || "Dados inválidos" });
    }
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
    console.error(err);
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
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors?.[0]?.message || "Dados inválidos" });
    }
    console.error(err);
    res.status(500).json({ error: "Erro ao adicionar passageiro" });
  }
});

// ==================== UPLOAD DOCUMENTOS ====================
app.post(
  "/api/trips/:tripId/passengers/:passengerId/documents",
  upload.array("files", 4),
  async (req, res) => {
    try {
      const tripId = String(req.params.tripId);
      const passengerId = String(req.params.passengerId);
      const pin = String(req.body?.pin ?? "").trim();

      if (!pin) return res.status(400).json({ error: "PIN é obrigatório" });

      const trip = await db.get(`SELECT pin_hash FROM trips WHERE id = ?`, [tripId]);
      if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

      const ok = await bcrypt.compare(pin, trip.pin_hash);
      if (!ok) return res.status(401).json({ error: "PIN inválido" });

      const pass = await db.get(
        `SELECT id FROM passengers WHERE id = ? AND trip_id = ?`,
        [passengerId, tripId]
      );
      if (!pass) return res.status(404).json({ error: "Passageiro não encontrado" });

      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

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
          [
            docId,
            passengerId,
            f.originalname || "documento",
            result.secure_url,
            result.public_id,
            nowIso(),
          ]
        );

        uploaded.push({
          id: docId,
          filename: f.originalname,
          url: result.secure_url,
        });
      }

      res.json({ ok: true, uploaded });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Erro ao enviar documentos" });
    }
  }
);

// ==================== LISTAR VIAGEM ====================
app.get("/api/trips/:id", async (req, res) => {
  try {
    const tripId = String(req.params.id);

    const trip = await db.get(
      `SELECT id, destination, date_iso, responsible, created_at
       FROM trips
       WHERE id = ?`,
      [tripId]
    );

    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const passengers = await db.all(
      `SELECT id, name, cpf, phone, created_at
       FROM passengers
       WHERE trip_id = ?
       ORDER BY created_at DESC`,
      [tripId]
    );

    for (const p of passengers) {
      p.documents = await db.all(
        `SELECT id, filename, url, created_at
         FROM documents
         WHERE passenger_id = ?
         ORDER BY created_at DESC`,
        [p.id]
      );
    }

    res.json({ trip, passengers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar viagem" });
  }
});

// ==================== LISTAR TODAS AS VIAGENS (ADMIN) ====================
app.get("/api/admin/trips", authAdmin, async (req, res) => {
  try {
    const trips = await db.all(
      `SELECT id, destination, date_iso, responsible, created_at
       FROM trips
       ORDER BY created_at DESC`
    );

    res.json({ trips });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar viagens" });
  }
});

// ==================== EXCLUIR VIAGEM (ADMIN) ====================
app.delete("/api/admin/trips/:id", authAdmin, async (req, res) => {
  try {
    const tripId = String(req.params.id);

    const passengers = await db.all(
      `SELECT id FROM passengers WHERE trip_id = ?`,
      [tripId]
    );

    for (const p of passengers) {
      const docs = await db.all(
        `SELECT public_id FROM documents WHERE passenger_id = ?`,
        [p.id]
      );

      for (const d of docs) {
        if (d.public_id) {
          try {
            await cloudinary.uploader.destroy(d.public_id, { resource_type: "auto" });
          } catch (e) {
            console.error("Erro ao remover arquivo do Cloudinary:", e);
          }
        }
      }
    }

    await db.run(`DELETE FROM trips WHERE id = ?`, [tripId]);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir viagem" });
  }
});

// ==================== EXPORTAR XLSX ====================
app.get("/api/admin/trips/:id/export/xlsx", authAdmin, async (req, res) => {
  try {
    const tripId = String(req.params.id);

    const trip = await db.get(`SELECT * FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const passengers = await db.all(
      `SELECT id, name, cpf, phone, created_at
       FROM passengers
       WHERE trip_id = ?
       ORDER BY created_at ASC`,
      [tripId]
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Passageiros");

    worksheet.columns = [
      { header: "Nome", key: "name", width: 30 },
      { header: "CPF", key: "cpf", width: 20 },
      { header: "Telefone", key: "phone", width: 20 },
      { header: "Criado em", key: "created_at", width: 28 },
    ];

    for (const p of passengers) {
      worksheet.addRow({
        name: p.name,
        cpf: p.cpf,
        phone: p.phone || "",
        created_at: p.created_at,
      });
    }

    const filename = `${sanitizeName(trip.destination)}-${trip.id}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao exportar XLSX" });
  }
});

// ==================== EXPORTAR DOCX ====================
app.get("/api/admin/trips/:id/export/docx", authAdmin, async (req, res) => {
  try {
    const tripId = String(req.params.id);

    const trip = await db.get(`SELECT * FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const passengers = await db.all(
      `SELECT name, cpf, phone, created_at
       FROM passengers
       WHERE trip_id = ?
       ORDER BY created_at ASC`,
      [tripId]
    );

    const rows = [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("Nome")] }),
          new TableCell({ children: [new Paragraph("CPF")] }),
          new TableCell({ children: [new Paragraph("Telefone")] }),
          new TableCell({ children: [new Paragraph("Criado em")] }),
        ],
      }),
      ...passengers.map(
        (p) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(String(p.name || ""))] }),
              new TableCell({ children: [new Paragraph(String(p.cpf || ""))] }),
              new TableCell({ children: [new Paragraph(String(p.phone || ""))] }),
              new TableCell({ children: [new Paragraph(String(p.created_at || ""))] }),
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
                new TextRun({
                  text: `Lista de passageiros - ${trip.destination}`,
                  bold: true,
                  size: 28,
                }),
              ],
            }),
            new Paragraph(`Responsável: ${trip.responsible}`),
            new Paragraph(`Data: ${trip.date_iso}`),
            new Paragraph(""),
            new Table({ rows }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${sanitizeName(trip.destination)}-${trip.id}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao exportar DOCX" });
  }
});

// ==================== EXPORTAR ZIP DOCUMENTOS ====================
app.get("/api/admin/trips/:id/export/documents.zip", authAdmin, async (req, res) => {
  try {
    const tripId = String(req.params.id);

    const trip = await db.get(`SELECT * FROM trips WHERE id = ?`, [tripId]);
    if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

    const passengers = await db.all(
      `SELECT id, name FROM passengers WHERE trip_id = ? ORDER BY created_at ASC`,
      [tripId]
    );

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizeName(trip.destination)}-${trip.id}-documentos.zip"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(res);

    for (const passenger of passengers) {
      const docs = await db.all(
        `SELECT filename, url FROM documents WHERE passenger_id = ?`,
        [passenger.id]
      );

      for (const d of docs) {
        if (!d.url) continue;

        const response = await fetch(d.url);
        if (!response.ok) continue;

        const buffer = Buffer.from(await response.arrayBuffer());
        const folderName = sanitizeName(passenger.name || "passageiro");
        const fileName = sanitizeName(d.filename || "arquivo");
        archive.append(buffer, { name: `${folderName}/${fileName}` });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao exportar ZIP" });
  }
});

// ==================== INICIAR SERVIDOR ====================
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});