// src/routes/clientes.js — cadastro de clientes (cada admin vê só os seus)
const express = require('express');
const router  = express.Router();
const { db }  = require('./db');
const A = require('./auth');
const { auditar, hoje, statusParcela, r2 } = require('./util');

router.use(A.autenticar, A.somenteAdmin);

const CAMPOS = ['nome', 'documento', 'telefone', 'whatsapp', 'endereco', 'cidade', 'observacoes'];
const limpar = b => Object.fromEntries(CAMPOS.map(k => [k, String((b || {})[k] ?? '').trim() || null]));

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const h = hoje();
  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM records r WHERE r.client_id = c.id AND r.status = 'ativo') AS registros_ativos,
      (SELECT COALESCE(SUM(i.valor - i.valor_pago),0) FROM installments i JOIN records r ON r.id = i.record_id AND r.status='ativo'
         WHERE i.client_id = c.id AND i.status IN ('pendente','parcial')) AS pendente,
      (SELECT COALESCE(SUM(i.valor - i.valor_pago),0) FROM installments i JOIN records r ON r.id = i.record_id AND r.status='ativo'
         WHERE i.client_id = c.id AND i.status IN ('pendente','parcial') AND i.vencimento < ?) AS atrasado
    FROM clients c WHERE c.admin_id = ?`;
  const p = [h, req.user.id];
  if (q) {
    sql += ` AND (c.nome LIKE ? OR c.documento LIKE ? OR c.telefone LIKE ? OR c.whatsapp LIKE ? OR c.cidade LIKE ?)`;
    const t = '%' + q + '%'; p.push(t, t, t, t, t);
  }
  sql += ' ORDER BY c.nome COLLATE NOCASE LIMIT 500';
  res.json(db.prepare(sql).all(...p));
});

router.post('/', A.exigir('clientes'), (req, res) => {
  const c = limpar(req.body);
  if (!c.nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  const lim = req.user.limite_clientes;
  if (lim != null && db.prepare('SELECT COUNT(*) n FROM clients WHERE admin_id = ?').get(req.user.id).n >= lim)
    return res.status(403).json({ erro: 'Você atingiu o limite de ' + lim + ' clientes do seu plano.' });
  const info = db.prepare(`INSERT INTO clients (admin_id, nome, documento, telefone, whatsapp, endereco, cidade, observacoes, criado_por)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, c.nome, c.documento, c.telefone, c.whatsapp || c.telefone, c.endereco, c.cidade, c.observacoes, req.user.id);
  auditar(req, 'cliente_criado', 'clients', info.lastInsertRowid, { nome: c.nome });
  res.json({ id: info.lastInsertRowid });
});

function doAdmin(req, id) {
  return db.prepare('SELECT * FROM clients WHERE id = ? AND admin_id = ?').get(Number(id), req.user.id);
}

router.get('/:id', (req, res) => {
  const c = doAdmin(req, req.params.id);
  if (!c) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const h = hoje();
  const registros = db.prepare('SELECT * FROM records WHERE client_id = ? AND admin_id = ? ORDER BY criado_em DESC').all(c.id, req.user.id);
  const parcelas = db.prepare('SELECT * FROM installments WHERE client_id = ? AND admin_id = ? ORDER BY vencimento, numero').all(c.id, req.user.id)
    .map(p => ({ ...p, situacao: statusParcela(p, h) }));
  const pagamentos = db.prepare(`SELECT p.*, r.descricao, i.numero FROM payments p JOIN records r ON r.id = p.record_id
                                 JOIN installments i ON i.id = p.installment_id
                                 WHERE p.client_id = ? AND p.admin_id = ? ORDER BY p.data_pagamento DESC, p.id DESC`).all(c.id, req.user.id);
  const porRegistro = {};
  parcelas.forEach(p => (porRegistro[p.record_id] = porRegistro[p.record_id] || []).push(p));
  const ativas = parcelas.filter(p => ['pendente', 'parcial'].includes(p.status) && registros.find(r => r.id === p.record_id && r.status === 'ativo'));
  res.json({
    cliente: c,
    resumo: {
      registros_ativos: registros.filter(r => r.status === 'ativo').length,
      parcelas_pagas: parcelas.filter(p => p.status === 'pago').length,
      parcelas_pendentes: ativas.length,
      parcelas_atrasadas: ativas.filter(p => p.situacao.codigo === 'atrasado').length,
      total_pago: r2(pagamentos.reduce((s, p) => s + p.valor, 0)),
      total_pendente: r2(ativas.reduce((s, p) => s + p.valor - p.valor_pago, 0)),
      total_atrasado: r2(ativas.filter(p => p.situacao.codigo === 'atrasado').reduce((s, p) => s + p.valor - p.valor_pago, 0)),
    },
    registros: registros.map(r => ({ ...r, config: JSON.parse(r.config || '{}'), parcelas: porRegistro[r.id] || [] })),
    pagamentos,
  });
});

router.put('/:id', A.exigir('clientes'), (req, res) => {
  const atual = doAdmin(req, req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const c = limpar(req.body);
  if (!c.nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  db.prepare(`UPDATE clients SET nome=?, documento=?, telefone=?, whatsapp=?, endereco=?, cidade=?, observacoes=?, atualizado_em=? WHERE id=? AND admin_id=?`)
    .run(c.nome, c.documento, c.telefone, c.whatsapp, c.endereco, c.cidade, c.observacoes, new Date().toISOString(), atual.id, req.user.id);
  const mud = {};
  CAMPOS.forEach(k => { if ((atual[k] || null) !== c[k]) mud[k] = { de: atual[k], para: c[k] }; });
  auditar(req, 'cliente_editado', 'clients', atual.id, mud);
  res.json({ ok: true });
});

router.delete('/:id', A.exigir('clientes'), (req, res) => {
  const c = doAdmin(req, req.params.id);
  if (!c) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const ativos = db.prepare(`SELECT COUNT(*) n FROM records WHERE client_id = ? AND status = 'ativo'`).get(c.id).n;
  if (ativos) return res.status(400).json({ erro: 'Este cliente tem ' + ativos + ' registro(s) ativo(s). Cancele ou quite antes de excluir.' });
  db.prepare('DELETE FROM clients WHERE id = ? AND admin_id = ?').run(c.id, req.user.id);
  auditar(req, 'cliente_excluido', 'clients', c.id, { nome: c.nome });
  res.json({ ok: true });
});

module.exports = router;
