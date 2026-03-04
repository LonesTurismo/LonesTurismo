import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import archiver from "archiver";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun } from "docx";
import cloudinary from "./cloudinary.js";
import { openDb } from "./database.js";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.send("✅ Backend LonesTur online. Use /health ou /api");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "LonesTur API" });
});

const db = openDb();

// Render / Node 22: crypto.randomUUID disponível
const uuid = () => crypto.randomUUID();

const nowIso = () => new Date().toISOString();
const onlyDigits = (s = "") => String(s).replace(/\D/g, "");
const safeName = (s = "") =>
  String(s).trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").slice(0, 90);

function genTripId(destination, dateIso) {
  const base = safeName(destination).slice(0, 3).toUpperCase().replace(/\s/g, "") || "VIA";
  const seq = String(Math.floor(1 + Math.random() * 90)).padStart(2, "0");
  return `${base}-${dateIso.replaceAll("-", "")}-${seq}`;
}
function genPin4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function authAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token ausente" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload?.role !== "admin") return res.status(403).json({ error: "Sem permissão" });
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

app.get("/health", (req, res) => res.json({ ok: true }));

/* =========================
   ADMIN LOGIN
========================= */
app.post("/api/admin/login", (req, res) => {
  const { user, pass } = req.body || {};
  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: "Credenciais inválidas" });
  }
  const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token });
});

/* =========================
   OPÇÃO A: VIAGEM COM ID + PIN
========================= */
app.post("/api/trips", (req, res) => {
  const { destination, dateIso, responsible } = req.body || {};
  if (!destination || !dateIso || !responsible) {
    return res.status(400).json({ error: "Preencha destino, data e responsável" });
  }

  const id = genTripId(destination, dateIso);
  const pin = genPin4();
  const pin_hash = bcrypt.hashSync(pin, 10);

  db.prepare(`
    INSERT INTO trips (id, destination, date_iso, responsible, pin_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, destination.trim(), dateIso, responsible.trim(), pin_hash, nowIso());

  res.json({ trip: { id, destination, dateIso, responsible }, pin });
});

app.post("/api/trips/:id/verify-pin", (req, res) => {
  const { id } = req.params;
  const { pin } = req.body || {};
  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(id);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const ok = bcrypt.compareSync(String(pin || ""), trip.pin_hash);
  if (!ok) return res.status(401).json({ error: "PIN inválido" });

  res.json({ ok: true });
});

app.post("/api/trips/:id/load", (req, res) => {
  const { id } = req.params;
  const { pin } = req.body || {};
  const trip = db.prepare("SELECT id, destination, date_iso, responsible, created_at, pin_hash FROM trips WHERE id=?").get(id);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const ok = bcrypt.compareSync(String(pin || ""), trip.pin_hash);
  if (!ok) return res.status(401).json({ error: "PIN inválido" });

  const passengers = db.prepare(`
    SELECT id, name, cpf, phone, created_at
    FROM passengers
    WHERE trip_id=?
    ORDER BY name COLLATE NOCASE ASC
  `).all(id);

  const docs = db.prepare(`
    SELECT d.id, d.passenger_id, d.filename, d.url, d.public_id, d.created_at
    FROM documents d
    JOIN passengers p ON p.id = d.passenger_id
    WHERE p.trip_id=?
  `).all(id);

  const mapDocs = new Map();
  for (const d of docs) {
    if (!mapDocs.has(d.passenger_id)) mapDocs.set(d.passenger_id, []);
    mapDocs.get(d.passenger_id).push({ id: d.id, filename: d.filename, url: d.url });
  }

  res.json({
    trip: { id: trip.id, destination: trip.destination, dateIso: trip.date_iso, responsible: trip.responsible },
    passengers: passengers.map(p => ({ ...p, documents: mapDocs.get(p.id) || [] }))
  });
});

/* =========================
   PASSAGEIROS (CRUD) + docs
========================= */
app.post("/api/trips/:tripId/passengers", (req, res) => {
  const { tripId } = req.params;
  const { pin, name, cpf, phone } = req.body || {};

  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(tripId);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const ok = bcrypt.compareSync(String(pin || ""), trip.pin_hash);
  if (!ok) return res.status(401).json({ error: "PIN inválido" });

  const cpfDigits = onlyDigits(cpf);
  if (cpfDigits.length !== 11) return res.status(400).json({ error: "CPF deve ter 11 dígitos" });

  const id = uuid();
  db.prepare(`
    INSERT INTO passengers (id, trip_id, name, cpf, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, tripId, String(name || "").trim().slice(0, 100), cpfDigits, String(phone || "").slice(0, 13), nowIso());

  res.json({ passengerId: id });
});

app.put("/api/trips/:tripId/passengers/:passId", (req, res) => {
  const { tripId, passId } = req.params;
  const { pin, name, cpf, phone } = req.body || {};

  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(tripId);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const ok = bcrypt.compareSync(String(pin || ""), trip.pin_hash);
  if (!ok) return res.status(401).json({ error: "PIN inválido" });

  const cpfDigits = onlyDigits(cpf);
  if (cpfDigits.length !== 11) return res.status(400).json({ error: "CPF deve ter 11 dígitos" });

  const info = db.prepare(`
    UPDATE passengers
    SET name=?, cpf=?, phone=?
    WHERE id=? AND trip_id=?
  `).run(String(name || "").trim().slice(0, 100), cpfDigits, String(phone || "").slice(0, 13), passId, tripId);

  if (info.changes === 0) return res.status(404).json({ error: "Passageiro não encontrado" });
  res.json({ ok: true });
});

app.delete("/api/trips/:tripId/passengers/:passId", (req, res) => {
  const { tripId, passId } = req.params;
  const { pin } = req.body || {};

  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(tripId);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const ok = bcrypt.compareSync(String(pin || ""), trip.pin_hash);
  if (!ok) return res.status(401).json({ error: "PIN inválido" });

  const info = db.prepare("DELETE FROM passengers WHERE id=? AND trip_id=?").run(passId, tripId);
  if (info.changes === 0) return res.status(404).json({ error: "Passageiro não encontrado" });

  res.json({ ok: true });
});

// Upload para Cloudinary (até 4 arquivos por request)
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 4, fileSize: 6 * 1024 * 1024 } });

app.post("/api/trips/:tripId/passengers/:passId/documents", upload.array("files", 4), async (req, res) => {
  const { tripId, passId } = req.params;
  const { pin } = req.body || {};

  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(tripId);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const ok = bcrypt.compareSync(String(pin || ""), trip.pin_hash);
  if (!ok) return res.status(401).json({ error: "PIN inválido" });

  const passenger = db.prepare("SELECT * FROM passengers WHERE id=? AND trip_id=?").get(passId, tripId);
  if (!passenger) return res.status(404).json({ error: "Passageiro não encontrado" });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "Nenhum arquivo enviado" });

  const folder = `LonesTur/${safeName(tripId)}/${safeName(passenger.name)}`;

  const uploaded = [];
  for (const f of files) {
    const base64 = `data:${f.mimetype};base64,${f.buffer.toString("base64")}`;
    const result = await cloudinary.uploader.upload(base64, {
      folder,
      resource_type: "image" // para jpg/png
    });

    const docId = uuid();
    db.prepare(`
      INSERT INTO documents (id, passenger_id, filename, url, public_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(docId, passId, f.originalname, result.secure_url, result.public_id, nowIso());

    uploaded.push({ id: docId, filename: f.originalname, url: result.secure_url });
  }

  res.json({ ok: true, uploaded });
});

/* =========================
   ADMIN: LISTAR VIAGENS
========================= */
app.get("/api/admin/trips", authAdmin, (req, res) => {
  const trips = db.prepare(`
    SELECT
      t.id, t.destination, t.date_iso, t.responsible, t.created_at,
      (SELECT COUNT(*) FROM passengers p WHERE p.trip_id=t.id) AS passenger_count,
      (SELECT COUNT(*) FROM documents d JOIN passengers p2 ON p2.id=d.passenger_id WHERE p2.trip_id=t.id) AS docs_count
    FROM trips t
    ORDER BY t.created_at DESC
  `).all();

  res.json({ trips });
});

/* =========================
   EXPORTS: Excel / Word / ZIP
========================= */
app.get("/api/exports/:tripId/excel", authAdmin, async (req, res) => {
  const { tripId } = req.params;
  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(tripId);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const passengers = db.prepare(`
    SELECT * FROM passengers WHERE trip_id=?
    ORDER BY name COLLATE NOCASE ASC
  `).all(tripId);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Passageiros");

  ws.columns = [
    { header: "ID Viagem", key: "tripId", width: 20 },
    { header: "Destino", key: "destination", width: 24 },
    { header: "Data", key: "date_iso", width: 14 },
    { header: "Responsável", key: "responsible", width: 22 },
    { header: "Nome", key: "name", width: 32 },
    { header: "CPF", key: "cpf", width: 16 },
    { header: "Telefone", key: "phone", width: 16 }
  ];
  ws.getRow(1).font = { bold: true };

  for (const p of passengers) {
    ws.addRow({
      tripId: trip.id,
      destination: trip.destination,
      date_iso: trip.date_iso,
      responsible: trip.responsible,
      name: p.name,
      cpf: p.cpf,
      phone: p.phone || ""
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="LonesTur_${safeName(trip.id)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

app.get("/api/exports/:tripId/word", authAdmin, async (req, res) => {
  const { tripId } = req.params;
  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(tripId);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const passengers = db.prepare(`
    SELECT * FROM passengers WHERE trip_id=?
    ORDER BY name COLLATE NOCASE ASC
  `).all(tripId);

  const lines = passengers.map(p => `${p.name};${p.cpf};`);

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: `Viagem ${trip.id} - ${trip.destination} (${trip.date_iso})`, bold: true })] }),
        new Paragraph(""),
        ...lines.map(t => new Paragraph(t))
      ]
    }]
  });

  const buf = await Packer.toBuffer(doc);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="LonesTur_${safeName(trip.id)}_nome_cpf.docx"`);
  res.send(buf);
});

app.get("/api/exports/:tripId/zip", authAdmin, async (req, res) => {
  const { tripId } = req.params;
  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(tripId);
  if (!trip) return res.status(404).json({ error: "Viagem não encontrada" });

  const passengers = db.prepare(`
    SELECT * FROM passengers WHERE trip_id=?
    ORDER BY name COLLATE NOCASE ASC
  `).all(tripId);

  const docs = db.prepare(`
    SELECT d.*, p.name AS passenger_name
    FROM documents d
    JOIN passengers p ON p.id=d.passenger_id
    WHERE p.trip_id=?
    ORDER BY p.name COLLATE NOCASE ASC
  `).all(tripId);

  // map docs by passenger id
  const byPass = new Map();
  for (const d of docs) {
    if (!byPass.has(d.passenger_id)) byPass.set(d.passenger_id, []);
    byPass.get(d.passenger_id).push(d);
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="LonesTur_${safeName(trip.id)}_docs.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", () => res.status(500).end());
  archive.pipe(res);

  const root = `LonesTur_${safeName(trip.id)}_${safeName(trip.destination)}_${safeName(trip.date_iso)}`;

  for (const p of passengers) {
    const folder = `${root}/${safeName(p.name)}/`;
    archive.append(`Nome: ${p.name}\nCPF: ${p.cpf}\nTelefone: ${p.phone || ""}\n`, { name: folder + "dados.txt" });

    const pDocs = byPass.get(p.id) || [];
    for (const d of pDocs) {
      // Baixa pelo URL e adiciona no zip
      const resp = await fetch(d.url);
      if (!resp.ok) continue;
      const arr = await resp.arrayBuffer();
      archive.append(Buffer.from(arr), { name: folder + safeName(d.filename) });
    }
  }

  await archive.finalize();
});

/* =========================
   ADMIN: APAGAR ARQUIVOS ONLINE (MANUAL)
========================= */
app.delete("/api/admin/trips/:tripId/documents", authAdmin, async (req, res) => {
  const { tripId } = req.params;

  const docs = db.prepare(`
    SELECT d.id, d.public_id
    FROM documents d
    JOIN passengers p ON p.id=d.passenger_id
    WHERE p.trip_id=?
  `).all(tripId);

  for (const d of docs) {
    try {
      await cloudinary.uploader.destroy(d.public_id, { resource_type: "image" });
    } catch {
      // segue para não travar a limpeza inteira
    }
  }

  db.prepare(`
    DELETE FROM documents
    WHERE passenger_id IN (SELECT id FROM passengers WHERE trip_id=?)
  `).run(tripId);

  res.json({ ok: true, deleted: docs.length });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log("Servidor rodando na porta", port));