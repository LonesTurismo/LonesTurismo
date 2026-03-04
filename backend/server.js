// backend/server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import archiver from "archiver";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import { loginAdmin } from "./admin-login.js";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

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

// __dirname no ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

// caminho do banco (ajuste se precisar)
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "database", "banco.db");

// abre sqlite (Promise API)
console.log("DB_PATH =", DB_PATH);
const db = await open({
  filename: DB_PATH,
  driver: sqlite3.Database,
});

app.post("/api/admin/login", loginAdmin);

// =====================
// AUTH ADMIN (JWT)
// =====================
function authAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");
    if (type !== "Bearer" || !token) {
      return res.status(401).json({ error: "Token ausente" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;

    // Se você tiver regra de admin, valide aqui:
    // if (!payload.isAdmin) return res.status(403).json({ error: "Sem permissão" });

    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// =====================
// HELPERS
// =====================
function sanitizeName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") // inválidos Windows
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

// =====================
// ROTAS
// =====================

// Listar viagens (abas)
app.get("/api/viagens", authAdmin, async (req, res) => {
  try {
    const viagens = await db.all(
      `SELECT id, titulo, data_saida, status
       FROM viagens
       ORDER BY data_saida DESC`
    );
    res.json(viagens);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao listar viagens" });
  }
});

// Listar passageiros da viagem (tabela)
app.get("/api/viagens/:id/passageiros", authAdmin, async (req, res) => {
  try {
    const viagemId = Number(req.params.id);

    const passageiros = await db.all(
      `SELECT id, nome, documento, telefone
       FROM passageiros
       WHERE viagem_id = ?
       ORDER BY nome COLLATE NOCASE ASC`,
      [viagemId]
    );

    res.json(passageiros);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao listar passageiros" });
  }
});

// Exportar ZIP (CSV + DOCX + docs do Cloudinary)
app.get("/api/viagens/:id/export/zip", authAdmin, async (req, res) => {
  try {
    const viagemId = Number(req.params.id);

    const viagem = await db.get(
      `SELECT id, titulo, data_saida
       FROM viagens
       WHERE id = ?`,
      [viagemId]
    );

    if (!viagem) return res.status(404).json({ error: "Viagem não encontrada" });

    // passageiros em ordem alfabética
    const passageiros = await db.all(
      `SELECT id, nome, documento, telefone
       FROM passageiros
       WHERE viagem_id = ?
       ORDER BY nome COLLATE NOCASE ASC`,
      [viagemId]
    );

    // documentos no banco (Cloudinary URL)
    const ids = passageiros.map((p) => p.id);
    let docs = [];
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      docs = await db.all(
        `SELECT passageiro_id, filename, url
         FROM passageiro_documentos
         WHERE passageiro_id IN (${placeholders})
         ORDER BY passageiro_id ASC, filename COLLATE NOCASE ASC`,
        ids
      );
    }

    const docsByPassageiro = new Map();
    for (const d of docs) {
      if (!docsByPassageiro.has(d.passageiro_id)) docsByPassageiro.set(d.passageiro_id, []);
      docsByPassageiro.get(d.passageiro_id).push(d);
    }

    const base = sanitizeName(viagem.titulo || `viagem_${viagem.id}`) || `viagem_${viagem.id}`;
    const zipFilename = `${base}_ID_${viagem.id}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      console.error(err);
      try { res.status(500).end("Erro ao gerar ZIP"); } catch {}
    });

    archive.pipe(res);

    // 1) CSV
    const csvHeader = ["Nome", "Documento", "Telefone"].join(";");
    const csvBody = passageiros
      .map((p) => [toCsvCell(p.nome), toCsvCell(p.documento), toCsvCell(p.telefone)].join(";"))
      .join("\n");

    archive.append("\uFEFF" + csvHeader + "\n" + csvBody, {
      name: `01_passageiros_${base}.csv`,
    });

    // 2) DOCX (Nome; CPF)
    const rows = [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Nome", bold: true })] })],
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "CPF", bold: true })] })],
          }),
        ],
      }),
      ...passageiros.map(
        (p) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(p.nome || "")] }),
              new TableCell({ children: [new Paragraph(p.documento || "")] }),
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
                  text: `Viagem: ${viagem.titulo || ""} (ID ${viagem.id})`,
                  bold: true,
                }),
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

    // 3) Pasta Documentos por passageiro (Cloudinary)
    // Estrutura: 03_documentos/<Nome Passageiro>/<arquivo>
    for (const p of passageiros) {
      const folder = sanitizeName(p.nome || `passageiro_${p.id}`) || `passageiro_${p.id}`;
      const passengerDocs = docsByPassageiro.get(p.id) || [];

      for (const file of passengerDocs) {
        const url = file.url;
        if (!url) continue;

        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn("Falha ao baixar doc:", resp.status, url);
          continue;
        }

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
    res.status(500).json({ error: "Erro ao exportar ZIP" });
  }
});

// Apagar após baixar (banco)
app.delete("/api/viagens/:id/passageiros", authAdmin, async (req, res) => {
  try {
    const viagemId = Number(req.params.id);

    // apaga registros de documentos do banco
    await db.run(
      `DELETE FROM passageiro_documentos
       WHERE passageiro_id IN (SELECT id FROM passageiros WHERE viagem_id = ?)`,
      [viagemId]
    );

    // apaga passageiros
    const result = await db.run(
      `DELETE FROM passageiros WHERE viagem_id = ?`,
      [viagemId]
    );

    res.json({ ok: true, deleted: result.changes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao apagar passageiros" });
  }
});

// start
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});