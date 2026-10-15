// src/db.js — banco SQLite e estrutura das tabelas
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'controle.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  role             TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('superadmin','admin')),
  nome             TEXT NOT NULL,
  email            TEXT UNIQUE,
  usuario          TEXT UNIQUE,
  telefone         TEXT,
  senha_hash       TEXT NOT NULL,
  ativo            INTEGER NOT NULL DEFAULT 1,
  permissoes       TEXT NOT NULL DEFAULT '{}',
  limite_clientes  INTEGER DEFAULT NULL,
  limite_registros INTEGER DEFAULT NULL,
  observacoes      TEXT,
  ultimo_acesso    TEXT,
  criado_em        TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expira_em   TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  ip          TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  documento    TEXT,
  telefone     TEXT,
  whatsapp     TEXT,
  endereco     TEXT,
  cidade       TEXT,
  observacoes  TEXT,
  criado_por   INTEGER,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_admin ON clients(admin_id, nome);

CREATE TABLE IF NOT EXISTS records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  descricao      TEXT NOT NULL,
  valor_principal REAL NOT NULL,
  percentual     REAL NOT NULL DEFAULT 0,
  acrescimo      REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL,
  frequencia     TEXT NOT NULL CHECK(frequencia IN ('diario','semanal','quinzenal','mensal','personalizado')),
  config         TEXT NOT NULL DEFAULT '{}',
  qtd_parcelas   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','quitado','cancelado')),
  observacoes    TEXT,
  criado_por     INTEGER,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_admin ON records(admin_id, status);
CREATE INDEX IF NOT EXISTS idx_records_client ON records(client_id);

CREATE TABLE IF NOT EXISTS installments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id    INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  numero       INTEGER NOT NULL,
  vencimento   TEXT NOT NULL,
  valor        REAL NOT NULL,
  valor_pago   REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','parcial','pago','cancelado')),
  pago_em      TEXT,
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_inst_admin_venc ON installments(admin_id, vencimento, status);
CREATE INDEX IF NOT EXISTS idx_inst_record ON installments(record_id);

CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installment_id  INTEGER NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
  record_id       INTEGER NOT NULL,
  client_id       INTEGER NOT NULL,
  valor           REAL NOT NULL,
  data_pagamento  TEXT NOT NULL,
  forma           TEXT NOT NULL DEFAULT 'Dinheiro',
  observacao      TEXT,
  registrado_por  INTEGER,
  registrado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_admin ON payments(admin_id, data_pagamento);

CREATE TABLE IF NOT EXISTS message_templates (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL CHECK(tipo IN ('antecipado','hoje','atraso','confirmacao')),
  titulo    TEXT NOT NULL,
  texto     TEXT NOT NULL,
  UNIQUE(admin_id, tipo)
);

CREATE TABLE IF NOT EXISTS reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installment_id  INTEGER NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
  client_id       INTEGER NOT NULL,
  tipo            TEXT NOT NULL,
  regra           TEXT NOT NULL,
  data_envio      TEXT NOT NULL,
  mensagem        TEXT NOT NULL,
  telefone        TEXT,
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','enviado','falhou','ignorado')),
  provedor        TEXT,
  erro            TEXT,
  enviado_em      TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(installment_id, regra, data_envio)
);
CREATE INDEX IF NOT EXISTS idx_rem_admin ON reminders(admin_id, data_envio, status);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  para_super INTEGER NOT NULL DEFAULT 0,
  titulo     TEXT NOT NULL,
  texto      TEXT,
  lida       INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  user_nome   TEXT,
  admin_id    INTEGER,
  acao        TEXT NOT NULL,
  entidade    TEXT,
  entidade_id INTEGER,
  detalhes    TEXT,
  ip          TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_id, criado_em);

CREATE TABLE IF NOT EXISTS lancamentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK(tipo IN ('investimento','extra','despesa')),
  descricao   TEXT NOT NULL,
  categoria   TEXT,
  valor       REAL NOT NULL,
  data        TEXT NOT NULL,
  forma       TEXT,
  criado_por  INTEGER,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_lanc_admin ON lancamentos(admin_id, data, tipo);

CREATE TABLE IF NOT EXISTS settings (
  admin_id  INTEGER NOT NULL DEFAULT 0,
  chave     TEXT NOT NULL,
  valor     TEXT,
  PRIMARY KEY (admin_id, chave)
);
`;
db.exec(ESQUEMA);


// ── Super Admin inicial ─────────────────────────────────────────────────────
if (!db.prepare(`SELECT 1 FROM users WHERE role='superadmin' LIMIT 1`).get()) {
  const senha = process.env.SUPERADMIN_SENHA || 'admin123';
  db.prepare(`INSERT INTO users (role, nome, email, usuario, senha_hash) VALUES ('superadmin', 'Super Admin', ?, 'admin', ?)`)
    .run(process.env.SUPERADMIN_EMAIL || 'admin@controlefacil.com', bcrypt.hashSync(senha, 10));
  console.log('Super Admin criado — usuário: admin  senha: ' + senha);
}

// Recria tabelas que faltarem (usado depois de importar um backup)
function garantirEsquema() { db.exec(ESQUEMA); }

module.exports = { db, DB_PATH, garantirEsquema };
