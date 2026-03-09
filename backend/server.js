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
import { PassThrough } from "stream";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from "docx";
import cloudinary from "./cloudinary.js";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import pg from "pg";

const { Pool } = pg;

dotenv.config();

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
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : false,
  max: Number(process.env.PG_MAX_CONNECTIONS || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

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

const tripAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: "Muitas tentativas de ID + PIN. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/admin/login", loginLimiter);
app.use("/api/", generalLimiter);

const upload = multer({ storage: multer.memoryStorage() });

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

async function q(text, params = []) {
  return pool.query(text, params);
}

async function one(text, params = []) {
  const result = await q(text, params);
  return result.rows[0] || null;
}

async function many(text, params = []) {
  const result = await q(text, params);
  return result.rows;
}

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

function verifyAdminToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: "Token ausente." });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

function authAdmin(req, res, next) {
  return verifyAdminToken(req, res, () => {
    if (req.admin?.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }
    next();
  });
}


async function getTripOr404(tripId, res) {
  const trip = await one(
    `SELECT id, destination, date_iso, responsible, pin_hash, pin_plain, created_at
     FROM trips
     WHERE id = $1`,
    [tripId]
  );

  if (!trip) {
    res.status(404).json({ error: "Viagem não encontrada" });
    return null;
  }

  return trip;
}

async function verifyTripPinOrThrow(tripId, pin) {
  const trip = await one(`SELECT id, pin_hash FROM trips WHERE id = $1`, [tripId]);
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
  const passengers = await many(
    `SELECT id, name, cpf, phone, created_at
     FROM passengers
     WHERE trip_id = $1
     ORDER BY created_at ASC`,
    [tripId]
  );

  for (const p of passengers) {
    p.documents = await many(
      `SELECT id, filename, url, public_id, created_at
       FROM documents
       WHERE passenger_id = $1
       ORDER BY created_at ASC`,
      [p.id]
    );
  }

  return passengers;
}

async function removePassengerDocumentsFromCloudinary(passengerId) {
  const docs = await many(
    `SELECT id, public_id FROM documents WHERE passenger_id = $1`,
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

async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      date_iso TEXT NOT NULL,
      responsible TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_plain TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS passengers (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cpf TEXT NOT NULL,
      phone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (trip_id, cpf)
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      passenger_id TEXT NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      public_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL,
      backup_url TEXT,
      public_id TEXT,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_passengers_trip_id ON passengers(trip_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_documents_passenger_id ON documents(passenger_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);`);
}

async function buildBackupSnapshot() {
  const trips = await many(
    `SELECT id, destination, date_iso, responsible, pin_plain, created_at
     FROM trips
     ORDER BY created_at DESC`
  );

  const passengers = await many(
    `SELECT id, trip_id, name, cpf, phone, created_at
     FROM passengers
     ORDER BY created_at ASC`
  );

  const documents = await many(
    `SELECT id, passenger_id, filename, url, public_id, created_at
     FROM documents
     ORDER BY created_at ASC`
  );

  return {
    generated_at: nowIso(),
    totals: {
      trips: trips.length,
      passengers: passengers.length,
      documents: documents.length,
    },
    trips,
    passengers,
    documents,
  };
}

function uploadBackupJson(snapshot, backupId) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(snapshot, null, 2);
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "lonestur/backups",
        resource_type: "raw",
        public_id: `backup-${backupId}`,
        overwrite: true,
        format: "json",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    const pass = new PassThrough();
    pass.end(Buffer.from(payload));
    pass.pipe(stream);
  });
}

async function createBackup(triggerType = "manual") {
  const backupId = id12();
  const snapshot = await buildBackupSnapshot();

  let backupUrl = null;
  let publicId = null;

  try {
    const uploaded = await uploadBackupJson(snapshot, backupId);
    backupUrl = uploaded?.secure_url || null;
    publicId = uploaded?.public_id || null;
  } catch (err) {
    console.error("Falha ao enviar backup para Cloudinary:", err);
  }

  await q(
    `INSERT INTO backups (id, trigger_type, backup_url, public_id, snapshot, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [backupId, triggerType, backupUrl, publicId, JSON.stringify(snapshot), nowIso()]
  );

  return { id: backupId, trigger_type: triggerType, backup_url: backupUrl, created_at: nowIso() };
}

let backupTimer = null;
let pendingTrigger = "auto";

function scheduleBackup(triggerType = "auto") {
  pendingTrigger = triggerType;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(async () => {
    backupTimer = null;
    try {
      await createBackup(pendingTrigger);
      console.log(`Backup automático criado: ${pendingTrigger}`);
    } catch (err) {
      console.error("Erro ao criar backup automático:", err);
    }
  }, 8000);
}

app.get("/health", asyncHandler(async (req, res) => {
  await q("SELECT 1");
  const lastBackup = await one(`SELECT id, created_at FROM backups ORDER BY created_at DESC LIMIT 1`);
  res.json({ ok: true, db: "postgres", lastBackupAt: lastBackup?.created_at || null });
}));

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

app.post("/trip/access", tripAccessLimiter, asyncHandler(async (req, res) => {
  const data = z.object({
    tripId: z.string().trim().min(1, "ID da viagem é obrigatório"),
    pin: z.string().trim().min(4, "PIN inválido"),
  }).parse(req.body);

  await verifyTripPinOrThrow(data.tripId, data.pin);

  const trip = await one(
    `SELECT id, destination, date_iso, responsible, pin_plain, created_at
     FROM trips
     WHERE id = $1`,
    [data.tripId]
  );

  const passengers = await getPassengersWithDocuments(data.tripId);
  res.json({ ok: true, trip, passengers });
}));

app.post("/api/trips", asyncHandler(async (req, res) => {
  const data = createTripSchema.parse(req.body);

  const tripId = id8();
  const pin = pin4();
  const pinHash = await bcrypt.hash(pin, 10);

  await q(
    `INSERT INTO trips (id, destination, date_iso, responsible, pin_hash, pin_plain, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tripId, data.destination, data.dateIso, data.responsible, pinHash, pin, nowIso()]
  );

  const trip = await one(
    `SELECT id, destination, date_iso, responsible, pin_plain, created_at
     FROM trips
     WHERE id = $1`,
    [tripId]
  );

  scheduleBackup("trip_created");
  res.json({ trip, pin });
}));

app.post("/api/trips/:id/verify-pin", tripAccessLimiter, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const { pin } = verifyPinSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, pin);
  res.json({ ok: true });
}));

app.post("/api/trips/:id/load", tripAccessLimiter, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const { pin } = verifyPinSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, pin);

  const trip = await one(
    `SELECT id, destination, date_iso, responsible, pin_plain, created_at
     FROM trips
     WHERE id = $1`,
    [tripId]
  );

  const passengers = await getPassengersWithDocuments(tripId);
  res.json({ trip, passengers });
}));

app.get("/api/trips/:id", asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const { pin_hash, ...safeTrip } = trip;
  const passengers = await getPassengersWithDocuments(tripId);
  res.json({ trip: safeTrip, passengers });
}));

app.post("/api/trips/:id/passengers", asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);
  const data = addPassengerSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, data.pin);

  const passengerId = id12();

  try {
    await q(
      `INSERT INTO passengers (id, trip_id, name, cpf, phone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
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
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Já existe um passageiro com esse CPF nesta viagem" });
    }
    throw err;
  }

  scheduleBackup("passenger_created");
  res.json({ ok: true, passengerId });
}));

app.put("/api/trips/:tripId/passengers/:passengerId", asyncHandler(async (req, res) => {
  const tripId = String(req.params.tripId);
  const passengerId = String(req.params.passengerId);
  const data = updatePassengerSchema.parse(req.body);

  await verifyTripPinOrThrow(tripId, data.pin);

  const passenger = await one(
    `SELECT id FROM passengers WHERE id = $1 AND trip_id = $2`,
    [passengerId, tripId]
  );

  if (!passenger) {
    return res.status(404).json({ error: "Passageiro não encontrado" });
  }

  try {
    await q(
      `UPDATE passengers
       SET name = $1, cpf = $2, phone = $3
       WHERE id = $4 AND trip_id = $5`,
      [
        data.name,
        data.cpf,
        normalizePhone(data.phone),
        passengerId,
        tripId,
      ]
    );
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Já existe um passageiro com esse CPF nesta viagem" });
    }
    throw err;
  }

  scheduleBackup("passenger_updated");
  res.json({ ok: true });
}));

app.delete("/api/trips/:tripId/passengers/:passengerId", asyncHandler(async (req, res) => {
  const tripId = String(req.params.tripId);
  const passengerId = String(req.params.passengerId);
  const data = deletePassengerSchema.parse(req.body || {});

  await verifyTripPinOrThrow(tripId, data.pin);

  const passenger = await one(
    `SELECT id FROM passengers WHERE id = $1 AND trip_id = $2`,
    [passengerId, tripId]
  );

  if (!passenger) {
    return res.status(404).json({ error: "Passageiro não encontrado" });
  }

  await removePassengerDocumentsFromCloudinary(passengerId);
  await q(`DELETE FROM passengers WHERE id = $1 AND trip_id = $2`, [passengerId, tripId]);

  scheduleBackup("passenger_deleted");
  res.json({ ok: true });
}));

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

    const passenger = await one(
      `SELECT id FROM passengers WHERE id = $1 AND trip_id = $2`,
      [passengerId, tripId]
    );

    if (!passenger) {
      return res.status(404).json({ error: "Passageiro não encontrado" });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const currentCount = await one(
      `SELECT COUNT(*)::int AS total FROM documents WHERE passenger_id = $1`,
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

      await q(
        `INSERT INTO documents (id, passenger_id, filename, url, public_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
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

    scheduleBackup("documents_uploaded");
    res.json({ ok: true, uploaded });
  })
);

async function listAdminTrips(req, res) {
  const trips = await many(
    `SELECT id, destination, date_iso, responsible, pin_plain, created_at
     FROM trips
     ORDER BY created_at DESC`
  );

  res.json({ trips });
}

app.get("/api/admin/trips", authAdmin, asyncHandler(listAdminTrips));
app.post("/api/admin/trips", authAdmin, asyncHandler(listAdminTrips));

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

async function deleteAdminTrip(req, res) {
  const tripId = String(req.params.id);

  const trip = await one(`SELECT id FROM trips WHERE id = $1`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

  const passengers = await many(
    `SELECT id FROM passengers WHERE trip_id = $1`,
    [tripId]
  );

  for (const p of passengers) {
    await removePassengerDocumentsFromCloudinary(p.id);
  }

  await q(`DELETE FROM trips WHERE id = $1`, [tripId]);

  scheduleBackup("trip_deleted");
  res.json({ ok: true });
}

app.delete("/api/admin/trips/:id", authAdmin, asyncHandler(deleteAdminTrip));
app.delete("/api/admin/trips/:id/purge", authAdmin, asyncHandler(deleteAdminTrip));

app.get("/api/admin/trips/:id/export/xlsx", authAdmin, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);

  const trip = await one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

  const passengers = await many(
    `SELECT id, name, cpf, phone, created_at
     FROM passengers
     WHERE trip_id = $1
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

app.get("/api/admin/trips/:id/export/docx", authAdmin, asyncHandler(async (req, res) => {
  const tripId = String(req.params.id);

  const trip = await one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

  const passengers = await many(
    `SELECT name, cpf, phone, created_at
     FROM passengers
     WHERE trip_id = $1
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
          new Paragraph(`PIN: ${trip.pin_plain || "-"}`),
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

async function exportDocumentsZip(req, res) {
  const tripId = String(req.params.id);

  const trip = await one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) {
    return res.status(404).json({ error: "Viagem não encontrada" });
  }

  const passengers = await many(
    `SELECT id, name, cpf, phone, created_at
     FROM passengers
     WHERE trip_id = $1
     ORDER BY created_at ASC`,
    [tripId]
  );

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sanitizeName(trip.destination)}-${trip.id}.zip"`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (err) => {
    throw err;
  });

  archive.pipe(res);

  // =========================
  // 1) GERAR XLSX EM MEMÓRIA
  // =========================
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
      name: p.name || "",
      cpf: formatCpfForExport(p.cpf || ""),
      phone: formatPhoneForExport(p.phone || ""),
      created_at: p.created_at || "",
    });
  });

  const xlsxBuffer = await workbook.xlsx.writeBuffer();
  archive.append(Buffer.from(xlsxBuffer), {
    name: `lista-passageiros-${sanitizeName(trip.destination)}-${trip.id}.xlsx`,
  });

  // =========================
  // 2) GERAR DOCX EM MEMÓRIA
  // =========================
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
            new TableCell({
              children: [new Paragraph(String(formatCpfForExport(p.cpf || "")))],
            }),
            new TableCell({
              children: [new Paragraph(String(formatPhoneForExport(p.phone || "")))],
            }),
            new TableCell({
              children: [new Paragraph(String(p.created_at || ""))],
            }),
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
          new Paragraph(`PIN: ${trip.pin_plain || "-"}`),
          new Paragraph(""),
          new Table({ rows }),
        ],
      },
    ],
  });

  const docxBuffer = await Packer.toBuffer(doc);
  archive.append(docxBuffer, {
    name: `lista-passageiros-${sanitizeName(trip.destination)}-${trip.id}.docx`,
  });

  // =======================================
  // 3) ADICIONAR DOCUMENTOS DOS PASSAGEIROS
  // =======================================
  for (const passenger of passengers) {
    const docs = await many(
      `SELECT filename, url
       FROM documents
       WHERE passenger_id = $1
       ORDER BY created_at ASC`,
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

        archive.append(buffer, {
          name: `documentos/${folderName}/${fileName}`,
        });
      } catch (err) {
        console.error("Erro ao baixar documento do Cloudinary:", err);
      }
    }
  }

  await archive.finalize();
}

app.get("/api/admin/trips/:id/export/documents.zip", authAdmin, asyncHandler(exportDocumentsZip));
app.get("/api/exports/:id/zip", authAdmin, asyncHandler(exportDocumentsZip));

app.get("/api/admin/backups", authAdmin, asyncHandler(async (req, res) => {
  const backups = await many(
    `SELECT id, trigger_type, backup_url, created_at,
            jsonb_extract_path_text(snapshot, 'totals', 'trips') AS trips_count,
            jsonb_extract_path_text(snapshot, 'totals', 'passengers') AS passengers_count,
            jsonb_extract_path_text(snapshot, 'totals', 'documents') AS documents_count
     FROM backups
     ORDER BY created_at DESC
     LIMIT 50`
  );

  res.json({ backups });
}));

app.post("/api/admin/backups/run", authAdmin, asyncHandler(async (req, res) => {
  const backup = await createBackup("manual_admin");
  res.json({ ok: true, backup });
}));

app.get("/api/admin/backups/:id/download", authAdmin, asyncHandler(async (req, res) => {
  const backupId = String(req.params.id);
  const backup = await one(
    `SELECT id, snapshot, created_at FROM backups WHERE id = $1`,
    [backupId]
  );

  if (!backup) {
    return res.status(404).json({ error: "Backup não encontrado" });
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="backup-${backupId}.json"`);
  res.send(JSON.stringify(backup.snapshot, null, 2));
}));

app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

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

async function start() {
  await initDb();
  try {
    const count = await one(`SELECT COUNT(*)::int AS total FROM backups`);
    if ((count?.total || 0) === 0) {
      await createBackup("bootstrap");
    }
  } catch (err) {
    console.error("Falha ao criar backup inicial:", err);
  }

  app.listen(PORT, () => {
    console.log(`Backend rodando na porta ${PORT}`);
    console.log("Banco: Neon/Postgres");
  });
}

start().catch((err) => {
  console.error("Falha ao iniciar backend:", err);
  process.exit(1);
});
