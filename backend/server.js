import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import cloudinary from "./cloudinary.js";
import { initDB } from "./database.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

let db;

async function start() {

  db = await initDB();

  app.listen(process.env.PORT, () => {
    console.log("Servidor rodando na porta", process.env.PORT);
  });

}

start();


// CRIAR VIAGEM

app.post("/trip", async (req,res)=>{

  const { destino, data, responsavel } = req.body;

  const pin = Math.floor(1000 + Math.random() * 9000).toString();

  const result = await db.run(
    `INSERT INTO viagens(destino,data,responsavel,pin) VALUES(?,?,?,?)`,
    [destino,data,responsavel,pin]
  );

  res.json({
    viagem_id: result.lastID,
    pin
  });

});


// ADICIONAR PASSAGEIRO

app.post("/trip/:id/passageiro", async (req,res)=>{

  const { nome, cpf, telefone } = req.body;

  await db.run(
    `INSERT INTO passageiros(viagem_id,nome,cpf,telefone)
     VALUES(?,?,?,?)`,
    [req.params.id,nome,cpf,telefone]
  );

  res.json({status:"ok"});

});


// UPLOAD DOCUMENTOS

app.post("/upload/:passageiro", upload.single("file"), async (req,res)=>{

  const result = await cloudinary.uploader.upload(req.file.path,{
    folder:"lonestur"
  });

  await db.run(
    `INSERT INTO documentos(passageiro_id,url,public_id)
     VALUES(?,?,?)`,
    [req.params.passageiro,result.secure_url,result.public_id]
  );

  res.json({url:result.secure_url});

});


// LISTAR VIAGENS

app.get("/admin/viagens", async (req,res)=>{

  const viagens = await db.all(`SELECT * FROM viagens`);

  res.json(viagens);

});


// APAGAR DOCUMENTOS ONLINE

app.delete("/admin/documentos/:viagem", async (req,res)=>{

  const docs = await db.all(`
  SELECT public_id FROM documentos
  JOIN passageiros
  ON passageiros.id = documentos.passageiro_id
  WHERE passageiros.viagem_id = ?
  `,[req.params.viagem]);

  for(const doc of docs){
    await cloudinary.uploader.destroy(doc.public_id);
  }

  await db.run(`
  DELETE FROM documentos
  WHERE passageiro_id IN (
    SELECT id FROM passageiros WHERE viagem_id = ?
  )
  `,[req.params.viagem]);

  res.json({status:"apagado"});

});