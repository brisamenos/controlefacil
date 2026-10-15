// src/routes/super.js — painel do Super Admin
const express = require('express');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const { db }  = require('./db');
const A = require('./auth');
const { auditar, hoje, getConfig, setConfig } = require('./util');
const { garantirModelos } = require('./mensagens');
const backup = require('./backup');
const telegram = require('./telegram');

router.use(A.autenticar, A.somenteSuper);

const intOuNull = v => (v === '' || v === null || v === undefined) ? null : Math.max(0, Math.floor(Number(v)) || 0);

function resumoAdmins() {
  return db.prepare(`
    SELECT u.id, u.nome, u.email, u.usuario, u.telefone, u.ativo, u.permissoes, u.limite_clientes, u.limite_registros,
           u.observacoes, u.ultimo_acesso, u.criado_em,
           (SELECT COUNT(*) FROM clients c WHERE c.admin_id = u.id) AS clientes,
           (SELECT COUNT(*) FROM records r WHERE r.admin_id = u.id AND r.status <> 'cancelado') AS registros,
           (SELECT COALESCE(SUM(total),0) FROM records r WHERE r.admin_id = u.id AND r.status <> 'cancelado') AS movimentado,
           (SELECT COALESCE(SUM(valor),0) FROM payments p WHERE p.admin_id = u.id) AS recebido
    FROM users u WHERE u.role = 'admin' ORDER BY u.nome`).all()
    .map(a => ({ ...a, permissoes: A.lerPermissoes(a.permissoes) }));
}

router.get('/dashboard', (req, res) => {
  const admins = resumoAdmins();
  const pend = db.prepare(`SELECT COALESCE(SUM(i.valor - i.valor_pago),0) v FROM installments i
                           JOIN records r ON r.id = i.record_id AND r.status = 'ativo'
                           WHERE i.status IN ('pendente','parcial')`).get().v;
  const atr = db.prepare(`SELECT COALESCE(SUM(i.valor - i.valor_pago),0) v FROM installments i
                          JOIN records r ON r.id = i.record_id AND r.status = 'ativo'
                          WHERE i.status IN ('pendente','parcial') AND i.vencimento < ?`).get(hoje()).v;
  const notif = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE para_super = 1 AND lida = 0`).get().c;
  res.json({
    total_admins: admins.length,
    admins_ativos: admins.filter(a => a.ativo).length,
    total_clientes: db.prepare('SELECT COUNT(*) c FROM clients').get().c,
    total_registros: db.prepare(`SELECT COUNT(*) c FROM records WHERE status <> 'cancelado'`).get().c,
    total_movimentado: db.prepare(`SELECT COALESCE(SUM(total),0) v FROM records WHERE status <> 'cancelado'`).get().v,
    total_recebido: db.prepare('SELECT COALESCE(SUM(valor),0) v FROM payments').get().v,
    total_pendente: pend, total_atrasado: atr,
    notificacoes: notif,
    admins,
  });
});

router.get('/admins', (req, res) => res.json(resumoAdmins()));

function validarAdmin(b, id) {
  const nome = String(b.nome || '').trim();
  const email = String(b.email || '').trim().toLowerCase() || null;
  const usuario = String(b.usuario || '').trim().toLowerCase() || null;
  if (!nome) return 'Informe o nome.';
  if (!email && !usuario) return 'Informe o e-mail ou o usuário.';
  if (usuario && !/^[a-z0-9._-]{3,40}$/.test(usuario)) return 'Usuário: use de 3 a 40 letras, números, ponto, hífen ou _.';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'E-mail inválido.';
  const dup = db.prepare(`SELECT id FROM users WHERE (lower(email) = ? OR lower(usuario) = ? OR lower(email) = ? OR lower(usuario) = ?) AND id <> ?`)
    .get(email || '#', email || '#', usuario || '#', usuario || '#', id || 0);
  if (dup) return 'Já existe um usuário com este e-mail ou nome de usuário.';
  return null;
}

router.post('/admins', (req, res) => {
  const b = req.body || {};
  const e = validarAdmin(b);
  if (e) return res.status(400).json({ erro: e });
  if (String(b.senha || '').length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  const info = db.prepare(`INSERT INTO users (role, nome, email, usuario, telefone, senha_hash, ativo, permissoes, limite_clientes, limite_registros, observacoes)
                           VALUES ('admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(b.nome).trim(), String(b.email || '').trim().toLowerCase() || null, String(b.usuario || '').trim().toLowerCase() || null,
         b.telefone || null, bcrypt.hashSync(String(b.senha), 10), b.ativo === false || b.ativo === 0 ? 0 : 1,
         JSON.stringify(A.lerPermissoes(JSON.stringify(b.permissoes || {}))),
         intOuNull(b.limite_clientes), intOuNull(b.limite_registros), b.observacoes || null);
  garantirModelos(info.lastInsertRowid);
  auditar(req, 'admin_criado', 'users', info.lastInsertRowid, { nome: b.nome, email: b.email, usuario: b.usuario }, info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

router.get('/admins/:id', (req, res) => {
  const a = resumoAdmins().find(x => x.id === Number(req.params.id));
  if (!a) return res.status(404).json({ erro: 'Administrador não encontrado.' });
  const movimentos = db.prepare(`
    SELECT p.id, p.valor, p.data_pagamento, p.forma, p.registrado_em, c.nome AS cliente, r.descricao, i.numero
    FROM payments p JOIN clients c ON c.id = p.client_id JOIN records r ON r.id = p.record_id JOIN installments i ON i.id = p.installment_id
    WHERE p.admin_id = ? ORDER BY p.registrado_em DESC LIMIT 30`).all(a.id);
  const registros = db.prepare(`
    SELECT r.id, r.descricao, r.total, r.status, r.criado_em, c.nome AS cliente
    FROM records r JOIN clients c ON c.id = r.client_id WHERE r.admin_id = ? ORDER BY r.criado_em DESC LIMIT 30`).all(a.id);
  const pendente = db.prepare(`SELECT COALESCE(SUM(i.valor - i.valor_pago),0) v FROM installments i JOIN records r ON r.id = i.record_id AND r.status='ativo'
                               WHERE i.admin_id = ? AND i.status IN ('pendente','parcial')`).get(a.id).v;
  res.json({ ...a, pendente, movimentos, registros });
});

router.put('/admins/:id', (req, res) => {
  const id = Number(req.params.id);
  const atual = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'admin'`).get(id);
  if (!atual) return res.status(404).json({ erro: 'Administrador não encontrado.' });
  const b = req.body || {};
  const e = validarAdmin(b, id);
  if (e) return res.status(400).json({ erro: e });
  const ativo = b.ativo === false || b.ativo === 0 ? 0 : 1;
  db.prepare(`UPDATE users SET nome=?, email=?, usuario=?, telefone=?, ativo=?, permissoes=?, limite_clientes=?, limite_registros=?, observacoes=?, atualizado_em=? WHERE id=?`)
    .run(String(b.nome).trim(), String(b.email || '').trim().toLowerCase() || null, String(b.usuario || '').trim().toLowerCase() || null,
         b.telefone || null, ativo, JSON.stringify(A.lerPermissoes(JSON.stringify(b.permissoes || {}))),
         intOuNull(b.limite_clientes), intOuNull(b.limite_registros), b.observacoes || null, new Date().toISOString(), id);
  if (!ativo) A.encerrarSessoes(id);
  auditar(req, 'admin_editado', 'users', id, { antes: { nome: atual.nome, ativo: atual.ativo }, depois: { nome: b.nome, ativo } }, id);
  res.json({ ok: true });
});

router.post('/admins/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const ativo = req.body.ativo ? 1 : 0;
  const r = db.prepare(`UPDATE users SET ativo = ?, atualizado_em = ? WHERE id = ? AND role = 'admin'`).run(ativo, new Date().toISOString(), id);
  if (!r.changes) return res.status(404).json({ erro: 'Administrador não encontrado.' });
  if (!ativo) A.encerrarSessoes(id);
  auditar(req, ativo ? 'admin_ativado' : 'admin_bloqueado', 'users', id, null, id);
  res.json({ ok: true });
});

router.post('/admins/:id/senha', (req, res) => {
  const id = Number(req.params.id);
  const senha = String(req.body.senha || '');
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  const r = db.prepare(`UPDATE users SET senha_hash = ?, atualizado_em = ? WHERE id = ? AND role = 'admin'`).run(bcrypt.hashSync(senha, 10), new Date().toISOString(), id);
  if (!r.changes) return res.status(404).json({ erro: 'Administrador não encontrado.' });
  A.encerrarSessoes(id);
  auditar(req, 'senha_redefinida', 'users', id, null, id);
  res.json({ ok: true });
});

router.delete('/admins/:id', (req, res) => {
  const id = Number(req.params.id);
  const a = db.prepare(`SELECT nome FROM users WHERE id = ? AND role = 'admin'`).get(id);
  if (!a) return res.status(404).json({ erro: 'Administrador não encontrado.' });
  if (String(req.body.confirmar || '') !== 'EXCLUIR') return res.status(400).json({ erro: 'Digite EXCLUIR para confirmar.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  auditar(req, 'admin_excluido', 'users', id, { nome: a.nome }, null);
  res.json({ ok: true });
});

router.get('/auditoria', (req, res) => {
  const { admin_id, acao, de, ate } = req.query;
  let sql = `SELECT l.*, a.nome AS admin_nome FROM audit_logs l LEFT JOIN users a ON a.id = l.admin_id WHERE 1=1`;
  const p = [];
  if (admin_id) { sql += ' AND l.admin_id = ?'; p.push(Number(admin_id)); }
  if (acao) { sql += ' AND l.acao = ?'; p.push(acao); }
  if (de) { sql += ' AND date(l.criado_em) >= ?'; p.push(de); }
  if (ate) { sql += ' AND date(l.criado_em) <= ?'; p.push(ate); }
  sql += ' ORDER BY l.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...p));
});

router.get('/notificacoes', (req, res) => {
  res.json(db.prepare(`SELECT * FROM notifications WHERE para_super = 1 ORDER BY id DESC LIMIT 100`).all());
});
router.post('/notificacoes/lidas', (req, res) => {
  db.prepare(`UPDATE notifications SET lida = 1 WHERE para_super = 1`).run();
  res.json({ ok: true });
});

router.get('/config', (req, res) => {
  const c = getConfig(0);
  const t = telegram.cfg();
  res.json({
    sistema_nome: c.sistema_nome, suporte_contato: c.suporte_contato, backups: backup.listar(), resumo: backup.resumoAtual(),
    telegram: {
      token_salvo: !!t.token, token_mascara: t.token ? t.token.split(':')[0] + ':••••••' + t.token.slice(-4) : '',
      chat_id: t.chat, ativo: t.ativo, frequencia: t.frequencia, hora: t.hora,
      ultimo_envio: t.ultimo || null, ultimo_status: t.status || '',
    },
  });
});
router.put('/config', (req, res) => {
  setConfig(0, { sistema_nome: req.body.sistema_nome || 'Controle Fácil', suporte_contato: req.body.suporte_contato || '' });
  auditar(req, 'config_sistema', 'settings', null, req.body, null);
  res.json({ ok: true });
});

router.post('/backup', async (req, res) => {
  try {
    const arq = await backup.criar();
    auditar(req, 'backup_criado', 'sistema', null, { arquivo: path.basename(arq) }, null);
    res.json({ ok: true, arquivo: path.basename(arq) });
  } catch (e) { res.status(500).json({ erro: 'Falha no backup: ' + e.message }); }
});
router.get('/backup/:arquivo', (req, res) => {
  const f = backup.caminho(req.params.arquivo);
  if (!f || !fs.existsSync(f)) return res.status(404).json({ erro: 'Backup não encontrado.' });
  auditar(req, 'backup_baixado', 'sistema', null, { arquivo: req.params.arquivo }, null);
  res.download(f);
});

// ── Backup pelo Telegram ────────────────────────────────────────────────────
const FREQS = ['diario', '12h', '6h', 'semanal'];
function tokenDe(b) { const t = String((b || {}).token || '').trim(); return t || telegram.cfg().token; }

router.put('/telegram', (req, res) => {
  const b = req.body || {};
  const novo = {};
  if (b.token !== undefined && String(b.token).trim()) {
    if (!/^\d+:[\w-]{20,}$/.test(String(b.token).trim())) return res.status(400).json({ erro: 'Token inválido. Copie exatamente o que o @BotFather enviou (ex.: 123456789:ABC...).' });
    novo.telegram_token = String(b.token).trim();
  }
  if (b.chat_id !== undefined) {
    const c = String(b.chat_id).trim();
    if (c && !/^-?\d{3,20}$/.test(c) && !/^@[\w]{4,}$/.test(c)) return res.status(400).json({ erro: 'ID do chat inválido. É um número, ex.: 123456789 ou -100123456789.' });
    novo.telegram_chat_id = c;
  }
  if (b.frequencia !== undefined) novo.telegram_frequencia = FREQS.includes(b.frequencia) ? b.frequencia : 'diario';
  if (b.hora !== undefined) novo.telegram_hora = String(Math.min(23, Math.max(0, Math.floor(Number(b.hora)) || 0)));
  if (b.ativo !== undefined) {
    const t = { ...telegram.cfg(), ...(novo.telegram_token ? { token: novo.telegram_token } : {}), ...('telegram_chat_id' in novo ? { chat: novo.telegram_chat_id } : {}) };
    if (b.ativo && (!t.token || !t.chat)) return res.status(400).json({ erro: 'Para ativar, informe o token do bot e o ID do chat.' });
    novo.telegram_ativo = b.ativo ? '1' : '0';
  }
  if (b.remover_token) { novo.telegram_token = ''; novo.telegram_ativo = '0'; }
  setConfig(0, novo);
  auditar(req, 'telegram_configurado', 'settings', null, { ativo: b.ativo, frequencia: b.frequencia, hora: b.hora, token_alterado: !!novo.telegram_token }, null);
  res.json({ ok: true });
});

router.post('/telegram/descobrir', async (req, res) => {
  try {
    const chats = await telegram.descobrir(tokenDe(req.body));
    res.json({ chats });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.post('/telegram/testar', async (req, res) => {
  try {
    const chat = String((req.body || {}).chat_id || '').trim() || telegram.cfg().chat;
    if (!chat) return res.status(400).json({ erro: 'Informe o ID do chat.' });
    res.json(await telegram.testar(tokenDe(req.body), chat));
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.post('/telegram/enviar', async (req, res) => {
  try {
    const r = await telegram.enviarBackup('manual');
    auditar(req, 'backup_telegram', 'sistema', null, { arquivo: r.arquivo }, null);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// ── Exportar agora (download direto, compactado) ────────────────────────────
router.get('/backup-exportar', async (req, res) => {
  try {
    const b = await backup.criarCompactado();
    auditar(req, 'backup_exportado', 'sistema', null, { arquivo: b.nome }, null);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + b.nome + '"');
    res.send(b.dados);
  } catch (e) { res.status(500).json({ erro: 'Falha ao exportar: ' + e.message }); }
});

// ── Importar backup (substitui todos os dados) ──────────────────────────────
function conferirSenha(req) {
  let senha = '';
  try { senha = Buffer.from(String(req.headers['x-senha'] || ''), 'base64').toString('utf8'); } catch (e) {}
  const u = db.prepare('SELECT senha_hash FROM users WHERE id = ?').get(req.user.id);
  return !!(u && senha && bcrypt.compareSync(senha, u.senha_hash));
}

router.post('/backup-validar', express.raw({ type: '*/*', limit: '300mb' }), (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ erro: 'Escolha o arquivo de backup.' });
    const { tmp, info } = backup.validar(req.body);
    try { fs.unlinkSync(tmp); } catch (e) {}
    res.json({ ok: true, backup: info, atual: backup.resumoAtual() });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.post('/backup-importar', express.raw({ type: '*/*', limit: '300mb' }), async (req, res) => {
  if (!conferirSenha(req)) return res.status(403).json({ erro: 'Senha incorreta. Importação não autorizada.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ erro: 'Escolha o arquivo de backup.' });
  const quem = { ...req.user };
  try {
    const r = await backup.importar(req.body);
    auditar({ ...req, user: quem }, 'backup_importado', 'sistema', null, { ...r.info, seguranca: r.seguranca }, null);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

module.exports = router;
