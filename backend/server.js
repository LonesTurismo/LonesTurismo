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

// ==================== CONFIGURAÇÕES ====================
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

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database", "banco.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ==================== RATE LIMIT ====================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
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

// ==================== HELPERS ====================
const nowIso = () => new Date().toISOString();
const id8 = () => crypto.randomBytes(4).toString("hex");
const id12 = () => crypto.randomBytes(6).toString("hex");
const pin4 = () => String(Math.floor(1000 + Math.random() * 9000));

const onlyDigits = (value = "") => String(value).replace(/\D/g, "");

const sanitizeName = (name = "") =>
  String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .trim() || "arquivo";

function normalizePhone(phone = "") {
  const digits = onlyDigits(phone);
  return digits || null;
}

function formatCpfForExport(cpf = "") {
  const d = onlyDigits(cpf).slice(0, 11);
  if (d.length !== 11) return cpf || "";
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function formatPhoneForExport(phone = "") {
  const d = onlyDigits(phone).slice(0, 11);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return phone || "";
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ==================== BANCO ====================
const db = await open({
  filename: DB_PATH,
  driver: sqlite3.Database,
});

await db.exec("PRAGMA foreign_keys = ON;");

await db.exec(`
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
    UNIQUE (trip_id, cpf),
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    passenger_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    url TEXT NOT NULL,
    public_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (passenger_id) REFERENCES passengers(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_passengers_trip_id ON passengers(trip_id);
  CREATE INDEX IF NOT EXISTS idx_documents_passenger_id ON documents(passenger_id);
`);

// ==================== SCHEMAS ====================
const createTripSchema = z.object({
  destination: z.string().trim().min(3, "Destino deve ter pelo menos 3 caracteres"),
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)"),
  responsible: z.string().trim().min(3, "Responsável deve ter pelo menos 3 caracteres"),
});

const verifyPinSchema = z.object({
  pin: z.string().trim().min(4, "PIN inválido"),
});

const addPassengerSchema = z.object({
  pin: z.string().trim().min(4, "PIN é obrigatório"),
  name: z.string().trim().min(3, "Nome deve ter pelo menos 3 caracteres"),
  cpf: z.string().transform((v) => onlyDigits(v)).refine((v) => v.length === 11, {
    message: "CPF deve ter exatamente 11 dígitos",
  }),
  phone: z.string().optional().nullable(),
});

const updatePassengerSchema = z.object({
  pin: z.string().trim().min(4, "PIN é obrigatório"),
  name: z.string().trim().min(3, "Nome deve ter pelo menos 3 caracteres"),
  cpf: z.string().transform((v) => onlyDigits(v)).refine((v) => v.length === 11, {
    message: "CPF deve ter exatamente 11 dígitos",
  }),
  phone: z.string().optional().nullable(),
});

const deletePassengerSchema = z.object({
  pin: z.string().trim().min(4, "PIN é obrigatório"),
});

const adminLoginSchema = z.object({
  user: z.string().min(1, "Usuário é obrigatório"),
  pass: z.string().min(1, "Senha é obrigatória"),
});

// ==================== AUTH ====================
function authAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token ausente" });

    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }

    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}

async function getTripOr404(tripId, res) {
  const trip = await db.get(
    `SELECT id, destination, date_iso, responsible, pin_hash, created_at
     FROM trips
     WHERE id = ?`,
    [tripId]
  );

  if (!trip) {
    res.status(404).json({ error: "Viagem não encontrada" });
    return null;
  }

  return trip;
}

async function verifyTripPinOrThrow(tripId, pin) {
  const trip = await db.get(`SELECT id, pin_hash FROM trips WHERE id = ?`, [tripId]);
  if (!trip) {
    const err = new Error("Viagem não encontrada");
    err.status = 404;
    throw err;
  }

  const ok = await bcrypt.compare(String(pin || "").trim(), trip.pin_hash);
  if (!ok) {
    const err = new Error("PIN inválido");
    err.status = 401;
    throw err;
  }

  return trip;
}

async function getPassengersWithDocuments(tripId) {
  const passengers = await db.all(
    `SELECT id, name, cpf, phone, created_at
     FROM passengers
     WHERE trip_id = ?
     ORDER BY created_at ASC`,
    [tripId]
  );

  for (const p of passengers) {
    p.documents = await db.all(
      `SELECT id, filename, url, public_id, created_at
       FROM documents
       WHERE passenger_id = ?
       ORDER BY created_at ASC`,
      [p.id]
    );
  }

  return passengers;
}

async function removePassengerDocumentsFromCloudinary(passengerId) {
  const docs = await db.all(
    `SELECT id, public_id FROM documents WHERE passenger_id = ?`,
    [passengerId]
  );

  for (const d of docs) {
    if (!d.public_id) continue;
    try {
      await cloudinary.uploader.destroy(d.public_id, { resource_type: "auto" });
    } catch (err) {
      console.error("Erro ao remover arquivo do Cloudinary:", err);
    }
  }
}

// ==================== HEALTH ====================
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ==================== ADMIN LOGIN ====================
app.post("/api/admin/login", asyncHandler(async (req, res) => {
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
}));

// ==================== CRIAR VIAGEM ====================
app.post("/api/trips", asyncHandler(async (req, res) => {
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
    `SELECT id, destination, date_iso, responsible, created_at
     FROM trips
     WHERE id = ?`,
    [tripId]
  );

  res.json({ trip, pin });
}));

// ==================== VERIFY PIN ====================
app.post("/api/trips/:id/verify-pin", asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const { pin } = verifyPinSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, pin);
  res.json({ ok: true });
}));

// ==================== CARREGAR VIAGEM POR PIN ====================
// rota usada pelo frontend novo
app.post("/api/trips/:id/load", asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const { pin } = verifyPinSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, pin);

  const trip = await db.get(
    `SELECT id, destination, date_iso, responsible, created_at
     FROM trips
     WHERE id = ?`,
    [tripId]
  );

  const passengers = await getPassengersWithDocuments(tripId);
  res.json({ trip, passengers });
}));

// rota pública simples, útil para debug/consulta
app.get("/api/trips/:id", asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const { pin_hash, ...safeTrip } = trip;
  const passengers = await getPassengersWithDocuments(tripId);
  res.json({ trip: safeTrip, passengers });
}));

// ==================== ADICIONAR PASSAGEIRO ====================
app.post("/api/trips/:id/passengers", asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const data = addPassengerSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, data.pin);

  const passengerId = id12();

  try {
    await db.run(
      `INSERT INTO passengers (id, trip_id, name, cpf, phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        passengerId,
        tripId,
        data.name,
        data.cpf,
        normalizePhone(data.phone),
        nowIso(),
      ]
    );
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "Já existe um passageiro com esse CPF nesta viagem" });
    }
    throw err;
  }

  res.json({ ok: true, passengerId });
}));

// ==================== ATUALIZAR PASSAGEIRO ====================
app.put("/api/trips/:tripId/passengers/:passengerId", asyncHandler(async (req, res) => {
  const tripId = String(req.params.tripId);
  const passengerId = String(req.params.passengerId);
  const data = updatePassengerSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, data.pin);

  const passenger = await db.get(
    `SELECT id FROM passengers WHERE id = ? AND trip_id = ?`,
    [passengerId, tripId]
  );

  if (!passenger) {
    return res.status(404).json({ error: "Passageiro não encontrado" });
  }

  try {
    await db.run(
      `UPDATE passengers
       SET name = ?, cpf = ?, phone = ?
       WHERE id = ? AND trip_id = ?`,
      [
        data.name,
        data.cpf,
        normalizePhone(data.phone),
        passengerId,
        tripId,
      ]
    );
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "Já existe um passageiro com esse CPF nesta viagem" });
    }
    throw err;
  }

  res.json({ ok: true });
}));

// ==================== EXCLUIR PASSAGEIRO ====================
app.delete("/api/trips/:tripId/passengers/:passengerId", asyncHandler(async (req, res) => {
  const tripId = String(req.params.tripId);
  const passengerId = String(req.params.passengerId);
  const data = deletePassengerSchema.parse(req.body || {});

  await verifyTripPinOrThrow(tripId, data.pin);

  const passenger = await db.get(
    `SELECT id FROM passengers WHERE id = ? AND trip_id = ?`,
    [passengerId, tripId]
  );

  if (!passenger) {
    return res.status(404).json({ error: "Passageiro não encontrado" });
  }

  await removePassengerDocumentsFromCloudinary(passengerId);
  await db.run(`DELETE FROM passengers WHERE id = ? AND trip_id = ?`, [passengerId, tripId]);

  res.json({ ok: true });
}));

// ==================== UPLOAD DOCUMENTOS ====================
app.post(
  "/api/trips/:tripId/passengers/:passengerId/documents",
  upload.array("files", 4),
  asyncHandler(async (req, res) => {
    const tripId = String(req.params.tripId);
    const passengerId = String(req.params.passengerId);
    const pin = String(req.body?.pin ?? "").trim();

    if (!pin) {
      return res.status(400).json({ error: "PIN é obrigatório" });
    }

    await verifyTripPinOrThrow(tripId, pin);

    const passenger = await db.get(
      `SELECT id FROM passengers WHERE id = ? AND trip_id = ?`,
      [passengerId, tripId]
    );

    if (!passenger) {
      return res.status(404).json({ error: "Passageiro não encontrado" });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const currentCount = await db.get(
      `SELECT COUNT(*) AS total FROM documents WHERE passenger_id = ?`,
      [passengerId]
    );

    if ((currentCount?.total || 0) + files.length > 4) {
      return res.status(400).json({ error: "Máximo 4 arquivos por passageiro" });
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
        filename: f.originalname || "documento",
        url: result.secure_url,
      });
    }

    res.json({ ok: true, uploaded });
  })
);

// ==================== LISTAR VIAGENS ADMIN ====================
// aceita GET e POST para evitar 405 se o frontend estiver usando um ou outro
async function listAdminTrips(req, res) {
  const trips = await db.all(
    `SELECT id, destination, date_iso, responsible, created_at
     FROM trips
     ORDER BY created_at DESC`
  );

  res.json({ trips });
}

app.get("/api/admin/trips", authAdmin, asyncHandler(listAdminTrips));
app.post("/api/admin/trips", authAdmin, asyncHandler(listAdminTrips));

// ==================== LISTAR PASSAGEIROS DE UMA VIAGEM (ADMIN) ====================
// rota usada pelo frontend do painel
app.post("/api/admin/trips/:id/passengers", authAdmin, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);

  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const passengers = await getPassengersWithDocuments(tripId);
  const { pin_hash, ...safeTrip } = trip;

  res.json({ trip: safeTrip, passengers });
}));

app.get("/api/admin/trips/:id/passengers", authAdmin, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);

  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const passengers = await getPassengersWithDocuments(tripId);
  const { pin_hash, ...safeTrip } = trip;

  res.json({ trip: safeTrip, passengers });
}));

// ==================== EXCLUIR VIAGEM (ADMIN) ====================
async function deleteAdminTrip(req, res) {
  const tripId = String(req.params.id);

  const trip = await db.get(`SELECT id FROM trips WHERE id = ?`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

  const passengers = await db.all(
    `SELECT id FROM passengers WHERE trip_id = ?`,
    [tripId]
  );

  for (const p of passengers) {
    await removePassengerDocumentsFromCloudinary(p.id);
  }

  await db.run(`DELETE FROM trips WHERE id = ?`, [tripId]);

  res.json({ ok: true });
}

app.delete("/api/admin/trips/:id", authAdmin, asyncHandler(deleteAdminTrip));
// alias para frontend antigo
app.delete("/api/admin/trips/:id/purge", authAdmin, asyncHandler(deleteAdminTrip));

// ==================== EXPORTAR XLSX ====================
app.get("/api/admin/trips/:id/export/xlsx", authAdmin, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);

  const trip = await db.get(`SELECT * FROM trips WHERE id = ?`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

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
    { header: "#", key: "index", width: 8 },
    { header: "Nome", key: "name", width: 35 },
    { header: "CPF", key: "cpf", width: 20 },
    { header: "Telefone", key: "phone", width: 20 },
    { header: "Criado em", key: "created_at", width: 28 },
  ];

  passengers.forEach((p, i) => {
    worksheet.addRow({
      index: i + 1,
      name: p.name,
      cpf: formatCpfForExport(p.cpf),
      phone: formatPhoneForExport(p.phone || ""),
      created_at: p.created_at,
    });
  });

  const filename = `${sanitizeName(trip.destination)}-${trip.id}.xlsx`;

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
}));

// ==================== EXPORTAR DOCX ====================
app.get("/api/admin/trips/:id/export/docx", authAdmin, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);

  const trip = await db.get(`SELECT * FROM trips WHERE id = ?`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

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
        new TableCell({ children: [new Paragraph("#")] }),
        new TableCell({ children: [new Paragraph("Nome")] }),
        new TableCell({ children: [new Paragraph("CPF")] }),
        new TableCell({ children: [new Paragraph("Telefone")] }),
        new TableCell({ children: [new Paragraph("Criado em")] }),
      ],
    }),
    ...passengers.map(
      (p, i) =>
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(String(i + 1))] }),
            new TableCell({ children: [new Paragraph(String(p.name || ""))] }),
            new TableCell({ children: [new Paragraph(String(formatCpfForExport(p.cpf || "")))] }),
            new TableCell({ children: [new Paragraph(String(formatPhoneForExport(p.phone || "")))] }),
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
}));

// ==================== EXPORTAR ZIP DOCUMENTOS ====================
async function exportDocumentsZip(req, res) {
  const tripId = String(req.params.id);

  const trip = await db.get(`SELECT * FROM trips WHERE id = ?`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

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
      `SELECT filename, url FROM documents WHERE passenger_id = ? ORDER BY created_at ASC`,
      [passenger.id]
    );

    for (const d of docs) {
      if (!d.url) continue;

      try {
        const response = await fetch(d.url);
        if (!response.ok) continue;

        const buffer = Buffer.from(await response.arrayBuffer());
        const folderName = sanitizeName(passenger.name || "passageiro");
        const fileName = sanitizeName(d.filename || "arquivo");
        archive.append(buffer, { name: `${folderName}/${fileName}` });
      } catch (err) {
        console.error("Erro ao baixar documento do Cloudinary:", err);
      }
    }
  }

  await archive.finalize();
}

app.get("/api/admin/trips/:id/export/documents.zip", authAdmin, asyncHandler(exportDocumentsZip));
// alias para frontend antigo
app.get("/api/exports/:id/zip", authAdmin, asyncHandler(exportDocumentsZip));

// ==================== 405 PADRÃO PARA ROTAS API EXISTENTES ====================
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

// ==================== TRATAMENTO DE ERROS ====================
app.use((err, req, res, next) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      error: err.errors?.[0]?.message || "Dados inválidos",
    });
  }

  const status = Number(err.status || 500);
  console.error(err);
  res.status(status).json({
    error: err.message || "Erro interno",
  });
});

// ==================== INICIAR SERVIDOR ====================
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
  console.log(`DB_PATH = ${DB_PATH}`);
});