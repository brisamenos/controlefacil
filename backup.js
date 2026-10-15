// backup.js — cópias de segurança do banco: criar, listar, exportar compactado e importar
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { db, DB_PATH, garantirEsquema } = require('./db');

const DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const MANTER = Number(process.env.BACKUP_MANTER || 14);
const NOME_OK = /^controle-[\dT-]+(-antes-importar)?\.db$/;

function listar() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => NOME_OK.test(f)).sort().reverse()
    .map(f => { const st = fs.statSync(path.join(DIR, f)); return { arquivo: f, tamanho: st.size, criado_em: st.mtime.toISOString() }; });
}

function caminho(nome) {
  if (!NOME_OK.test(String(nome || ''))) return null;
  return path.join(DIR, nome);
}

function carimbo() { return new Date().toISOString().slice(0, 19).replace(/:/g, '-'); }

async function criar(sufixo = '') {
  fs.mkdirSync(DIR, { recursive: true });
  const destino = path.join(DIR, 'controle-' + carimbo() + sufixo + '.db');
  await db.backup(destino);
  // Mantém só os mais recentes (os de segurança antes de importar ficam fora da contagem)
  listar().filter(b => !b.arquivo.includes('antes-importar')).slice(MANTER)
    .forEach(b => { try { fs.unlinkSync(path.join(DIR, b.arquivo)); } catch (e) {} });
  return destino;
}

// Backup compactado (.db.gz), usado no download e no envio pelo Telegram
async function criarCompactado() {
  const arq = await criar();
  const dados = zlib.gzipSync(fs.readFileSync(arq), { level: 9 });
  return { nome: path.basename(arq) + '.gz', dados, original: path.basename(arq) };
}

function resumo(banco) {
  const n = t => { try { return banco.prepare('SELECT COUNT(*) c FROM ' + t).get().c; } catch (e) { return 0; } };
  return { administradores: n("users WHERE role = 'admin'"), clientes: n('clients'), registros: n('records'), pagamentos: n('payments') };
}
function resumoAtual() { return resumo(db); }

// Confere se o arquivo enviado é mesmo um backup deste sistema
function validar(buffer) {
  let dados = buffer;
  if (dados[0] === 0x1f && dados[1] === 0x8b) {
    try { dados = zlib.gunzipSync(dados); } catch (e) { throw new Error('Arquivo .gz corrompido.'); }
  }
  if (dados.slice(0, 16).toString('latin1') !== 'SQLite format 3\u0000')
    throw new Error('Este arquivo não é um backup do Controle Fácil (.db ou .db.gz).');
  const tmp = path.join(DIR, '.importar-' + Date.now() + '.db');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(tmp, dados);
  let banco;
  try {
    banco = new Database(tmp, { readonly: true, fileMustExist: true });
    const ok = banco.prepare('PRAGMA integrity_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('O backup está danificado.');
    const tabelas = banco.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(t => t.name);
    for (const t of ['users', 'clients', 'records', 'installments', 'payments'])
      if (!tabelas.includes(t)) throw new Error('Este arquivo não é um backup do Controle Fácil (falta a tabela ' + t + ').');
    if (!banco.prepare(`SELECT 1 FROM users WHERE role = 'superadmin' AND ativo = 1`).get())
      throw new Error('O backup não tem nenhum Super Admin ativo. Importação cancelada para você não perder o acesso.');
    const info = resumo(banco);
    banco.close();
    return { tmp, info };
  } catch (e) {
    try { banco && banco.close(); } catch (x) {}
    try { fs.unlinkSync(tmp); } catch (x) {}
    throw e;
  }
}

// Substitui o banco atual pelo backup (faz antes uma cópia de segurança do atual)
async function importar(buffer) {
  const { tmp, info } = validar(buffer);
  try {
    const seguranca = await criar('-antes-importar');
    // Mantém a configuração atual do Telegram (o backup pode ser antigo)
    const tg = db.prepare(`SELECT chave, valor FROM settings WHERE admin_id = 0 AND chave LIKE 'telegram_%'`).all();
    const origem = new Database(tmp, { readonly: true });
    try { await origem.backup(DB_PATH); } finally { origem.close(); }
    db.pragma('wal_checkpoint(TRUNCATE)');
    garantirEsquema();
    const salvar = db.prepare(`INSERT INTO settings (admin_id, chave, valor) VALUES (0, ?, ?) ON CONFLICT(admin_id, chave) DO UPDATE SET valor = excluded.valor`);
    db.transaction(() => tg.forEach(r => salvar.run(r.chave, r.valor)))();
    return { info: resumoAtual(), esperado: info, seguranca: path.basename(seguranca) };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function iniciar() {
  const umDia = 24 * 3600 * 1000;
  const verificar = () => {
    const ultimo = listar().find(b => !b.arquivo.includes('antes-importar'));
    const idade = ultimo ? Date.now() - new Date(ultimo.criado_em).getTime() : Infinity;
    if (idade > umDia) criar().catch(e => console.error('backup:', e.message));
  };
  setTimeout(verificar, 60 * 1000);
  setInterval(verificar, 3600 * 1000);
}

module.exports = { listar, caminho, criar, criarCompactado, validar, importar, resumoAtual, iniciar, DIR };
