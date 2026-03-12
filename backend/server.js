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

// ===================
// CONFIGURATION
// ===================
const app = express();
app.set("trust proxy", 1);

app.use(express.json({ limit: "10mb" }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";
const DATABASE_URL = process.env.DATABASE_URL;

const INITIAL_PASSENGERS = 46;
const MAX_PASSENGERS = 70;

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

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

// ===================
// RATE LIMITING
// ===================
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

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Muitas requisições de upload. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/admin/login", loginLimiter);
app.use("/admin/login", loginLimiter);
app.use("/api/admin/", uploadLimiter);
app.use("/api/", generalLimiter);

// ===================
// CORS CONFIGURATION
// ===================
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "https://lones-turismo.vercel.app",
      "http://localhost:3000",
      "http://localhost:5500",
      "http://127.0.0.1:5500"
    ].filter(Boolean);

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));

// ===================
// MIDDLEWARE & UTILS
// ===================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

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

// ===================
// DATABASE HELPERS
// ===================
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

// ===================
// ZOD SCHEMAS
// ===================
const createTripSchema = z.object({
  destination: z.string().trim().min(3, "Destino deve ter pelo menos 3 caracteres"),
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)"),
  responsible: z.string().trim().min(3, "Responsável deve ter pelo menos 3 caracteres"),
});

const verifyPinSchema = z.object({
  pin: z.string().trim().min(4, "PIN inválido"),
});

const updateVisibleRowsSchema = z.object({
  pin: z.string().trim().min(4, "PIN é obrigatório"),
  visibleRows: z.coerce.number().int().min(INITIAL_PASSENGERS).max(MAX_PASSENGERS),
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

// ===================
// ADMIN AUTHENTICATION
// ===================
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

function authAdmin(req, res, next) {
  return requireAdmin(req, res, () => {
    if (req.admin?.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }
    next();
  });
}

// ===================
// TRIP HELPERS
// ===================
async function getTripOr404(tripId, res) {
  const trip = await one(
    `SELECT id, destination, date_iso, responsible, visible_rows, pin_hash, pin_plain, created_at
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
  const trip = await one(
    `SELECT id, pin_hash FROM trips WHERE id = $1`,
    [tripId]
  );

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

// ===================
// DATABASE INIT
// ===================
async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      date_iso TEXT NOT NULL,
      responsible TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_plain TEXT NOT NULL,
      visible_rows INTEGER NOT NULL DEFAULT ${INITIAL_PASSENGERS},
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS passengers (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cpf TEXT NOT NULL,
      phone TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      passenger_id TEXT NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      public_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_passengers_trip_id ON passengers(trip_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_documents_passenger_id ON documents(passenger_id);`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_passengers_trip_cpf ON passengers(trip_id, cpf);`);
}

// ===================
// HEALTH
// ===================
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: nowIso() });
});

// ===================
// PUBLIC ROUTES
// ===================
app.post("/api/trips", asyncHandler(async (req, res) => {
  const parsed = createTripSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
  }

  const { destination, dateIso, responsible } = parsed.data;

  let tripId;
  let pinPlain;
  let pinHash;

  for (let i = 0; i < 10; i += 1) {
    tripId = id8();
    pinPlain = pin4();

    const exists = await one(`SELECT id FROM trips WHERE id = $1`, [tripId]);
    if (!exists) {
      pinHash = await bcrypt.hash(pinPlain, 10);
      break;
    }
  }

  if (!tripId || !pinPlain || !pinHash) {
    return res.status(500).json({ error: "Não foi possível gerar ID/PIN da viagem" });
  }

  await q(
    `INSERT INTO trips (id, destination, date_iso, responsible, pin_hash, pin_plain, visible_rows)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tripId, destination, dateIso, responsible, pinHash, pinPlain, INITIAL_PASSENGERS]
  );

  return res.status(201).json({
    trip: {
      id: tripId,
      destination,
      dateIso,
      responsible,
      pin: pinPlain,
      visibleRows: INITIAL_PASSENGERS
    }
  });
}));

app.post("/api/trips/:tripId/verify-pin", tripAccessLimiter, asyncHandler(async (req, res) => {
  const parsed = verifyPinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "PIN inválido" });
  }

  const tripId = req.params.tripId;
  const pin = parsed.data.pin;

  await verifyTripPinOrThrow(tripId, pin);
  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  return res.json({
    trip: {
      id: trip.id,
      destination: trip.destination,
      dateIso: trip.date_iso,
      responsible: trip.responsible,
      visibleRows: trip.visible_rows
    }
  });
}));

app.get("/api/trips/:tripId", asyncHandler(async (req, res) => {
  const tripId = req.params.tripId;
  const pin = String(req.query.pin || "").trim();

  if (!pin) {
    return res.status(400).json({ error: "PIN é obrigatório" });
  }

  await verifyTripPinOrThrow(tripId, pin);
  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const passengers = await many(
    `SELECT id, name, cpf, phone, created_at
     FROM passengers
     WHERE trip_id = $1
     ORDER BY created_at ASC`,
    [tripId]
  );

  return res.json({
    trip: {
      id: trip.id,
      destination: trip.destination,
      dateIso: trip.date_iso,
      responsible: trip.responsible,
      visibleRows: trip.visible_rows
    },
    passengers
  });
}));

app.put("/api/trips/:tripId/visible-rows", asyncHandler(async (req, res) => {
  const parsed = updateVisibleRowsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
  }

  const tripId = req.params.tripId;
  const { pin, visibleRows } = parsed.data;

  await verifyTripPinOrThrow(tripId, pin);

  await q(
    `UPDATE trips
     SET visible_rows = $2
     WHERE id = $1`,
    [tripId, visibleRows]
  );

  return res.json({ visibleRows });
}));

app.post("/api/trips/:tripId/passengers", asyncHandler(async (req, res) => {
  const parsed = addPassengerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
  }

  const tripId = req.params.tripId;
  const { pin, name, cpf, phone } = parsed.data;

  await verifyTripPinOrThrow(tripId, pin);

  const existing = await one(
    `SELECT id FROM passengers WHERE trip_id = $1 AND cpf = $2`,
    [tripId, cpf]
  );

  if (existing) {
    return res.status(409).json({ error: "Já existe um passageiro com esse CPF nesta lista." });
  }

  const passengerId = id12();

  await q(
    `INSERT INTO passengers (id, trip_id, name, cpf, phone)
     VALUES ($1, $2, $3, $4, $5)`,
    [passengerId, tripId, name, cpf, normalizePhone(phone)]
  );

  return res.status(201).json({
    passenger: {
      id: passengerId,
      name,
      cpf,
      phone: normalizePhone(phone)
    }
  });
}));

app.put("/api/trips/:tripId/passengers/:passengerId", asyncHandler(async (req, res) => {
  const parsed = updatePassengerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
  }

  const tripId = req.params.tripId;
  const passengerId = req.params.passengerId;
  const { pin, name, cpf, phone } = parsed.data;

  await verifyTripPinOrThrow(tripId, pin);

  const passenger = await one(
    `SELECT id FROM passengers WHERE id = $1 AND trip_id = $2`,
    [passengerId, tripId]
  );

  if (!passenger) {
    return res.status(404).json({ error: "Passageiro não encontrado" });
  }

  const duplicate = await one(
    `SELECT id FROM passengers WHERE trip_id = $1 AND cpf = $2 AND id <> $3`,
    [tripId, cpf, passengerId]
  );

  if (duplicate) {
    return res.status(409).json({ error: "Já existe outro passageiro com esse CPF nesta lista." });
  }

  await q(
    `UPDATE passengers
     SET name = $3, cpf = $4, phone = $5
     WHERE id = $1 AND trip_id = $2`,
    [passengerId, tripId, name, cpf, normalizePhone(phone)]
  );

  return res.json({
    passenger: {
      id: passengerId,
      name,
      cpf,
      phone: normalizePhone(phone)
    }
  });
}));

app.delete("/api/trips/:tripId/passengers/:passengerId", asyncHandler(async (req, res) => {
  const parsed = deletePassengerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "PIN inválido" });
  }

  const tripId = req.params.tripId;
  const passengerId = req.params.passengerId;
  const { pin } = parsed.data;

  await verifyTripPinOrThrow(tripId, pin);

  const docs = await many(
    `SELECT public_id FROM documents WHERE passenger_id = $1`,
    [passengerId]
  );

  for (const doc of docs) {
    try {
      await cloudinary.uploader.destroy(doc.public_id, { resource_type: "raw" });
    } catch {}
  }

  const result = await q(
    `DELETE FROM passengers WHERE id = $1 AND trip_id = $2`,
    [passengerId, tripId]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: "Passageiro não encontrado" });
  }

  return res.json({ ok: true });
}));

app.post("/api/trips/:tripId/passengers/:passengerId/documents", uploadLimiter, upload.array("docs", 10), asyncHandler(async (req, res) => {
  const tripId = req.params.tripId;
  const passengerId = req.params.passengerId;
  const pin = String(req.body.pin || "").trim();

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

  const uploaded = [];

  for (const file of files) {
    const safeFileName = sanitizeName(file.originalname);

    const stream = new PassThrough();
    stream.end(file.buffer);

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "raw",
          folder: "lones-turismo/docs",
          public_id: `${passengerId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          use_filename: true,
          filename_override: safeFileName
        },
        (error, resultUpload) => {
          if (error) reject(error);
          else resolve(resultUpload);
        }
      );
      stream.pipe(uploadStream);
    });

    const docId = id12();

    await q(
      `INSERT INTO documents (id, passenger_id, filename, url, public_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [docId, passengerId, safeFileName, result.secure_url, result.public_id]
    );

    uploaded.push({
      id: docId,
      filename: safeFileName,
      url: result.secure_url
    });
  }

  return res.status(201).json({ uploaded });
}));

// ===================
// ADMIN ROUTES
// ===================
app.post("/api/admin/login", asyncHandler(async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
  }

  const user = process.env.ADMIN_USER || "admin";
  const pass = process.env.ADMIN_PASS || "admin123";

  if (parsed.data.user !== user || parsed.data.pass !== pass) {
    return res.status(401).json({ error: "Usuário ou senha inválidos" });
  }

  const token = jwt.sign(
    { role: "admin", user },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  return res.json({ token });
}));

app.get("/api/admin/trips", authAdmin, asyncHandler(async (_req, res) => {
  const trips = await many(
    `SELECT id, destination, date_iso, responsible, pin_plain, created_at
     FROM trips
     ORDER BY date_iso DESC, created_at DESC`
  );

  return res.json({
    trips: trips.map((trip) => ({
      id: trip.id,
      destination: trip.destination,
      dateIso: trip.date_iso,
      responsible: trip.responsible,
      pinPlain: trip.pin_plain,
      createdAt: trip.created_at
    }))
  });
}));

app.get("/api/admin/trips/:tripId", authAdmin, asyncHandler(async (req, res) => {
  const tripId = req.params.tripId;
  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const passengers = await many(
    `SELECT id, name, cpf, phone, created_at
     FROM passengers
     WHERE trip_id = $1
     ORDER BY created_at ASC`,
    [tripId]
  );

  return res.json({
    trip: {
      id: trip.id,
      destination: trip.destination,
      dateIso: trip.date_iso,
      responsible: trip.responsible,
      pinPlain: trip.pin_plain,
      visibleRows: trip.visible_rows,
      passengers
    }
  });
}));

app.delete("/api/admin/trips/:tripId", authAdmin, asyncHandler(async (req, res) => {
  const tripId = req.params.tripId;

  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const passengers = await many(
    `SELECT id FROM passengers WHERE trip_id = $1`,
    [tripId]
  );

  for (const passenger of passengers) {
    const docs = await many(
      `SELECT public_id FROM documents WHERE passenger_id = $1`,
      [passenger.id]
    );

    for (const doc of docs) {
      try {
        await cloudinary.uploader.destroy(doc.public_id, { resource_type: "raw" });
      } catch {}
    }
  }

  await q(`DELETE FROM trips WHERE id = $1`, [tripId]);

  return res.json({ ok: true });
}));

function getAdminTokenFromReq(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  const tokenQuery = String(req.query.token || "").trim();
  if (tokenQuery) return tokenQuery;

  return null;
}

function verifyAdminTokenForDownload(req, res, next) {
  const token = getAdminTokenFromReq(req);

  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

async function buildExcelBuffer(trip, passengers) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Passageiros");

  sheet.columns = [
    { header: "Nome", key: "name", width: 35 },
    { header: "CPF", key: "cpf", width: 20 },
    { header: "Telefone", key: "phone", width: 20 }
  ];

  sheet.addRow([]);
  sheet.addRow(["Destino", trip.destination]);
  sheet.addRow(["Data", trip.date_iso]);
  sheet.addRow(["Responsável", trip.responsible]);
  sheet.addRow(["ID", trip.id]);
  sheet.addRow(["PIN", trip.pin_plain]);
  sheet.addRow([]);

  passengers.forEach((p) => {
    sheet.addRow({
      name: p.name,
      cpf: formatCpfForExport(p.cpf),
      phone: formatPhoneForExport(p.phone)
    });
  });

  return workbook.xlsx.writeBuffer();
}

async function buildDocxBuffer(trip, passengers) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph("Nome")] }),
        new TableCell({ children: [new Paragraph("CPF")] }),
        new TableCell({ children: [new Paragraph("Telefone")] }),
      ]
    }),
    ...passengers.map((p) => new TableRow({
      children: [
        new TableCell({ children: [new Paragraph(p.name || "")] }),
        new TableCell({ children: [new Paragraph(formatCpfForExport(p.cpf || ""))] }),
        new TableCell({ children: [new Paragraph(formatPhoneForExport(p.phone || ""))] }),
      ]
    }))
  ];

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [new TextRun({ text: "Lista de Passageiros", bold: true, size: 28 })]
        }),
        new Paragraph(`Destino: ${trip.destination}`),
        new Paragraph(`Data: ${trip.date_iso}`),
        new Paragraph(`Responsável: ${trip.responsible}`),
        new Paragraph(`ID: ${trip.id}`),
        new Paragraph(`PIN: ${trip.pin_plain}`),
        new Paragraph(""),
        new Table({ rows })
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

app.get("/api/admin/trips/:tripId/export/zip", verifyAdminTokenForDownload, asyncHandler(async (req, res) => {
  const tripId = req.params.tripId;
  const trip = await getTripOr404(tripId, res);
  if (!trip) return;

  const passengers = await getPassengersWithDocuments(tripId);

  const zipName = sanitizeName(`${trip.destination}-${trip.date_iso}-${trip.id}`) + ".zip";

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    throw err;
  });
  archive.pipe(res);

  const excelBuffer = await buildExcelBuffer(trip, passengers);
  archive.append(excelBuffer, { name: "lista-passageiros.xlsx" });

  const docxBuffer = await buildDocxBuffer(trip, passengers);
  archive.append(docxBuffer, { name: "lista-passageiros.docx" });

  const manifest = {
    trip: {
      id: trip.id,
      destination: trip.destination,
      dateIso: trip.date_iso,
      responsible: trip.responsible,
      pin: trip.pin_plain
    },
    exportedAt: nowIso(),
    passengers: passengers.map((p) => ({
      id: p.id,
      name: p.name,
      cpf: formatCpfForExport(p.cpf),
      phone: formatPhoneForExport(p.phone),
      documents: (p.documents || []).map((d) => ({
        id: d.id,
        filename: d.filename,
        url: d.url
      }))
    }))
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  for (const passenger of passengers) {
    const folder = sanitizeName(`${passenger.name}-${formatCpfForExport(passenger.cpf)}`);

    for (const doc of passenger.documents || []) {
      try {
        const fileResponse = await fetch(doc.url);
        if (!fileResponse.ok) continue;

        const arrayBuffer = await fileResponse.arrayBuffer();
        archive.append(Buffer.from(arrayBuffer), {
          name: `documentos/${folder}/${sanitizeName(doc.filename)}`
        });
      } catch {}
    }
  }

  await archive.finalize();
}));

// ===================
// ERROR HANDLER
// ===================
app.use((err, _req, res, _next) => {
  console.error(err);

  if (err?.name === "ZodError") {
    return res.status(400).json({ error: err.issues?.[0]?.message || "Dados inválidos" });
  }

  if (err?.status) {
    return res.status(err.status).json({ error: err.message || "Erro na requisição" });
  }

  return res.status(500).json({ error: "Erro interno do servidor" });
});

// ===================
// START
// ===================
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao iniciar banco/servidor:", err);
    process.exit(1);
  });