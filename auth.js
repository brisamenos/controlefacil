// src/auth.js — login, sessões, perfis e permissões
const crypto = require('crypto');
const { db } = require('./db');
const { ipDe } = require('./util');

const PERMISSOES = ['clientes', 'registros', 'pagamentos', 'financeiro', 'relatorios', 'whatsapp', 'configuracoes'];
const PERMISSOES_PADRAO = Object.fromEntries(PERMISSOES.map(p => [p, true]));

function lerPermissoes(txt) {
  let p = {};
  try { p = JSON.parse(txt || '{}'); } catch (e) {}
  return Object.fromEntries(PERMISSOES.map(k => [k, p[k] === undefined ? true : !!p[k]]));
}

// ── Proteção contra tentativa de senha em massa ─────────────────────────────
const tentativas = new Map();
function bloqueado(chave) {
  const t = tentativas.get(chave);
  return t && t.ate && t.ate > Date.now() ? Math.ceil((t.ate - Date.now()) / 60000) : 0;
}
function falhou(chave) {
  const t = tentativas.get(chave) || { n: 0 };
  t.n++;
  if (t.n >= 5) { t.ate = Date.now() + 10 * 60 * 1000; t.n = 0; }
  tentativas.set(chave, t);
}
function acertou(chave) { tentativas.delete(chave); }

function criarSessao(userId, lembrar, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const horas = lembrar ? 24 * 30 : 12;
  const expira = new Date(Date.now() + horas * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expira_em, ip) VALUES (?, ?, ?, ?)').run(token, userId, expira, ipDe(req));
  db.prepare(`DELETE FROM sessions WHERE expira_em < ?`).run(new Date().toISOString());
  return { token, expira_em: expira };
}

function encerrarSessoes(userId) { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }

function negar(res, status, msg) { return res.status(status).json({ erro: msg, auth: status === 401 }); }

function autenticar(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return negar(res, 401, 'Faça login para continuar.');
  const s = db.prepare(`SELECT s.expira_em, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!s) return negar(res, 401, 'Sessão encerrada. Entre novamente.');
  if (s.expira_em < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return negar(res, 401, 'Sessão expirada. Entre novamente.');
  }
  if (!s.ativo) { encerrarSessoes(s.id); return negar(res, 401, 'Seu acesso está bloqueado. Fale com o administrador do sistema.'); }
  const { senha_hash, expira_em, ...u } = s;
  u.permissoes = lerPermissoes(u.permissoes);
  req.user = u;
  req.token = token;
  next();
}

const somenteSuper = (req, res, next) => req.user.role === 'superadmin' ? next() : negar(res, 403, 'Acesso restrito ao Super Admin.');
const somenteAdmin = (req, res, next) => req.user.role === 'admin' ? next() : negar(res, 403, 'Esta área é do painel administrativo.');
const exigir = perm => (req, res, next) => (req.user.permissoes && req.user.permissoes[perm]) ? next()
  : negar(res, 403, 'Você não tem permissão para esta função.');

module.exports = { PERMISSOES, PERMISSOES_PADRAO, lerPermissoes, bloqueado, falhou, acertou, criarSessao, encerrarSessoes,
                   autenticar, somenteSuper, somenteAdmin, exigir };
