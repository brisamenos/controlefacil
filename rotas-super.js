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
  res.json({ sistema_nome: c.sistema_nome, suporte_contato: c.suporte_contato, backups: backup.listar() });
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

module.exports = router;
