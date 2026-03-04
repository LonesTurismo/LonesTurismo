-- backend/schema.sql

PRAGMA foreign_keys = ON;

-- Viagens
CREATE TABLE IF NOT EXISTS viagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  data_saida TEXT,
  status TEXT DEFAULT 'Ativa'
);

-- Passageiros
CREATE TABLE IF NOT EXISTS passageiros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viagem_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  documento TEXT NOT NULL,
  telefone TEXT,
  FOREIGN KEY (viagem_id) REFERENCES viagens(id) ON DELETE CASCADE
);

-- Documentos do passageiro (Cloudinary)
CREATE TABLE IF NOT EXISTS passageiro_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passageiro_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE
);

-- Índices para performance/ordenação
CREATE INDEX IF NOT EXISTS idx_passageiros_viagem_id ON passageiros(viagem_id);
CREATE INDEX IF NOT EXISTS idx_passageiros_nome ON passageiros(nome);
CREATE INDEX IF NOT EXISTS idx_docs_passageiro_id ON passageiro_documentos(passageiro_id);