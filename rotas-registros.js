// src/routes/registros.js — novo registro, simulação e cancelamento
const express = require('express');
const router  = express.Router();
const { db }  = require('./db');
const A = require('./auth');
const { auditar, isoValida, r2, hoje, statusParcela } = require('./util');
const { simular } = require('./calculo');
const agendador = require('./agendador');

router.use(A.autenticar, A.somenteAdmin);

router.post('/simular', A.exigir('registros'), (req, res) => {
  try { res.json(simular(req.body || {})); }
  catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
});

router.post('/', A.exigir('registros'), (req, res) => {
  const b = req.body || {};
  const cliente = db.prepare('SELECT id, nome FROM clients WHERE id = ? AND admin_id = ?').get(Number(b.client_id), req.user.id);
  if (!cliente) return res.status(400).json({ erro: 'Escolha o cliente.' });
  const descricao = String(b.descricao || '').trim();
  if (!descricao) return res.status(400).json({ erro: 'Informe a descrição.' });

  const lim = req.user.limite_registros;
  if (lim != null && db.prepare(`SELECT COUNT(*) n FROM records WHERE admin_id = ? AND status <> 'cancelado'`).get(req.user.id).n >= lim)
    return res.status(403).json({ erro: 'Você atingiu o limite de ' + lim + ' registros do seu plano.' });

  let sim;
  try { sim = simular(b); } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }

  // Parcelas ajustadas manualmente na tela (opcional)
  let parcelas = sim.parcelas;
  if (Array.isArray(b.parcelas) && b.parcelas.length) {
    parcelas = b.parcelas.map((p, i) => ({ numero: i + 1, vencimento: String(p.vencimento || ''), valor: r2(p.valor) }));
    if (parcelas.length > 1000) return res.status(400).json({ erro: 'Máximo de 1000 parcelas.' });
    const ruim = parcelas.find(p => !isoValida(p.vencimento) || !(p.valor > 0));
    if (ruim) return res.status(400).json({ erro: 'Confira a parcela ' + ruim.numero + ': data e valor são obrigatórios.' });
  }
  const total = r2(parcelas.reduce((s, p) => s + p.valor, 0));
  const acrescimo = r2(total - sim.valor_principal);

  const criar = db.transaction(() => {
    const r = db.prepare(`INSERT INTO records (admin_id, client_id, descricao, valor_principal, percentual, acrescimo, total, frequencia, config, qtd_parcelas, observacoes, criado_por)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, cliente.id, descricao, sim.valor_principal, sim.percentual, acrescimo, total, sim.frequencia,
           JSON.stringify(sim.config), parcelas.length, String(b.observacoes || '').trim() || null, req.user.id);
    const ins = db.prepare(`INSERT INTO installments (admin_id, record_id, client_id, numero, vencimento, valor) VALUES (?, ?, ?, ?, ?, ?)`);
    parcelas.forEach(p => ins.run(req.user.id, r.lastInsertRowid, cliente.id, p.numero, p.vencimento, p.valor));
    return r.lastInsertRowid;
  });
  const id = criar();
  auditar(req, 'registro_criado', 'records', id, {
    cliente: cliente.nome, descricao, valor_principal: sim.valor_principal, percentual: sim.percentual, total,
    frequencia: sim.frequencia, parcelas: parcelas.length, ajustado_manual: parcelas !== sim.parcelas,
  });
  try { agendador.gerarLembretes(req.user.id); } catch (e) {}
  res.json({ id, total, parcelas: parcelas.length });
});

router.get('/:id', (req, res) => {
  const r = db.prepare(`SELECT r.*, c.nome AS cliente, c.whatsapp, c.telefone FROM records r JOIN clients c ON c.id = r.client_id
                        WHERE r.id = ? AND r.admin_id = ?`).get(Number(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ erro: 'Registro não encontrado.' });
  const h = hoje();
  const parcelas = db.prepare('SELECT * FROM installments WHERE record_id = ? ORDER BY numero').all(r.id).map(p => ({ ...p, situacao: statusParcela(p, h) }));
  const historico = db.prepare(`SELECT acao, user_nome, detalhes, criado_em FROM audit_logs
                                WHERE admin_id = ? AND ((entidade = 'records' AND entidade_id = ?) OR (entidade IN ('installments','payments') AND detalhes LIKE ?))
                                ORDER BY id DESC LIMIT 100`).all(req.user.id, r.id, '%"registro":' + r.id + ',%');
  res.json({ ...r, config: JSON.parse(r.config || '{}'), parcelas, historico });
});

router.put('/:id', A.exigir('registros'), (req, res) => {
  const r = db.prepare('SELECT * FROM records WHERE id = ? AND admin_id = ?').get(Number(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ erro: 'Registro não encontrado.' });
  const descricao = String(req.body.descricao || '').trim();
  if (!descricao) return res.status(400).json({ erro: 'Informe a descrição.' });
  const obs = String(req.body.observacoes || '').trim() || null;
  db.prepare('UPDATE records SET descricao = ?, observacoes = ?, atualizado_em = ? WHERE id = ?').run(descricao, obs, new Date().toISOString(), r.id);
  auditar(req, 'registro_editado', 'records', r.id, { descricao: { de: r.descricao, para: descricao } });
  res.json({ ok: true });
});

router.post('/:id/cancelar', A.exigir('registros'), (req, res) => {
  const r = db.prepare('SELECT * FROM records WHERE id = ? AND admin_id = ?').get(Number(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ erro: 'Registro não encontrado.' });
  if (r.status === 'cancelado') return res.status(400).json({ erro: 'Este registro já está cancelado.' });
  const motivo = String(req.body.motivo || '').trim();
  if (!motivo) return res.status(400).json({ erro: 'Informe o motivo do cancelamento.' });
  db.transaction(() => {
    db.prepare(`UPDATE records SET status = 'cancelado', atualizado_em = ? WHERE id = ?`).run(new Date().toISOString(), r.id);
    db.prepare(`UPDATE installments SET status = 'cancelado', atualizado_em = ? WHERE record_id = ? AND status IN ('pendente','parcial')`).run(new Date().toISOString(), r.id);
    db.prepare(`UPDATE reminders SET status = 'ignorado', erro = 'Registro cancelado' WHERE status = 'pendente'
                AND installment_id IN (SELECT id FROM installments WHERE record_id = ?)`).run(r.id);
  })();
  auditar(req, 'registro_cancelado', 'records', r.id, { motivo, descricao: r.descricao, total: r.total });
  res.json({ ok: true });
});

module.exports = router;
