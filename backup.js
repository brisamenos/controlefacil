// src/services/backup.js — cópias de segurança do banco (diária + manual)
const fs   = require('fs');
const path = require('path');
const { db, DB_PATH } = require('./db');

const DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const MANTER = Number(process.env.BACKUP_MANTER || 14);

function listar() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => /^controle-.*\.db$/.test(f)).sort().reverse()
    .map(f => ({ arquivo: f, tamanho: fs.statSync(path.join(DIR, f)).size }));
}

function caminho(nome) {
  if (!/^controle-[\dT-]+\.db$/.test(nome)) return null;
  return path.join(DIR, nome);
}

async function criar() {
  fs.mkdirSync(DIR, { recursive: true });
  const nome = 'controle-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.db';
  const destino = path.join(DIR, nome);
  await db.backup(destino);
  listar().slice(MANTER).forEach(b => { try { fs.unlinkSync(path.join(DIR, b.arquivo)); } catch (e) {} });
  return destino;
}

function iniciar() {
  const umDia = 24 * 3600 * 1000;
  const verificar = () => {
    const ultimo = listar()[0];
    const idade = ultimo ? Date.now() - fs.statSync(path.join(DIR, ultimo.arquivo)).mtimeMs : Infinity;
    if (idade > umDia) criar().catch(e => console.error('backup:', e.message));
  };
  setTimeout(verificar, 60 * 1000);
  setInterval(verificar, 3600 * 1000);
}

module.exports = { listar, caminho, criar, iniciar, DIR };
