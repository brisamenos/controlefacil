// src/routes/parcelas.js — painel de cobranças, pagamentos e mensagens
const express = require('express');
const router  = express.Router();
const { db }  = require('./db');
const A = require('./auth');
const { auditar, hoje, addDias, isoValida, r2, statusParcela, moeda, getConfig } = require('./util');
const msg = require('./mensagens');
const whatsapp = require('./whatsapp');

router.use(A.autenticar, A.somenteAdmin);

const BASE = `
  SELECT i.*, r.descricao, r.qtd_parcelas, r.frequencia, r.status AS registro_status,
         c.nome AS cliente, c.whatsapp, c.telefone
  FROM installments i
  JOIN records r ON r.id = i.record_id
  JOIN clients c ON c.id = i.client_id
  WHERE i.admin_id = ?`;

// GET /api/parcelas?aba=todas|hoje|amanha|proximas|atrasadas|pagas&q=&cliente_id=&de=&ate=&status=&descricao=&forma=
router.get('/', (req, res) => {
  const q = req.query, h = hoje();
  let sql = BASE, p = [req.user.id];
  const abertas = ` AND r.status = 'ativo' AND i.status IN ('pendente','parcial')`;
  switch (q.aba) {
    case 'hoje':      sql += abertas + ' AND i.vencimento = ?'; p.push(h); break;
    case 'amanha':    sql += abertas + ' AND i.vencimento = ?'; p.push(addDias(h, 1)); break;
    case 'proximas':  sql += abertas + ' AND i.vencimento > ? AND i.vencimento <= ?'; p.push(h, addDias(h, 30)); break;
    case 'atrasadas': sql += abertas + ' AND i.vencimento < ?'; p.push(h); break;
    case 'pagas':     sql += ` AND i.status = 'pago'`; break;
    default: break;
  }
  if (q.cliente_id) { sql += ' AND i.client_id = ?'; p.push(Number(q.cliente_id)); }
  if (q.q) { sql += ' AND (c.nome LIKE ? OR r.descricao LIKE ? OR c.whatsapp LIKE ? OR c.telefone LIKE ?)'; const t = '%' + q.q + '%'; p.push(t, t, t, t); }
  if (q.descricao) { sql += ' AND r.descricao LIKE ?'; p.push('%' + q.descricao + '%'); }
  if (isoValida(q.de)) { sql += ' AND i.vencimento >= ?'; p.push(q.de); }
  if (isoValida(q.ate)) { sql += ' AND i.vencimento <= ?'; p.push(q.ate); }
  if (q.forma) { sql += ' AND EXISTS (SELECT 1 FROM payments pg WHERE pg.installment_id = i.id AND pg.forma = ?)'; p.push(q.forma); }
  if (q.status === 'pago' || q.status === 'cancelado') { sql += ' AND i.status = ?'; p.push(q.status); }
  if (q.status === 'parcial') { sql += ` AND i.status = 'parcial'`; }
  if (q.status === 'atrasado') { sql += ` AND i.status IN ('pendente','parcial') AND i.vencimento < ?`; p.push(h); }
  if (q.status === 'hoje') { sql += ` AND i.status IN ('pendente','parcial') AND i.vencimento = ?`; p.push(h); }
  if (q.status === 'futuro') { sql += ` AND i.status IN ('pendente','parcial') AND i.vencimento > ?`; p.push(h); }
  sql += q.aba === 'pagas' ? ' ORDER BY i.pago_em DESC' : q.aba === 'atrasadas' ? ' ORDER BY i.vencimento ASC' : ' ORDER BY i.vencimento ASC, c.nome';
  sql += ' LIMIT 500';

  const linhas = db.prepare(sql).all(...p).map(x => ({ ...x, restante: r2(x.valor - x.valor_pago), situacao: statusParcela(x, h) }));
  const soma = r2(linhas.reduce((s, x) => s + (x.status === 'pago' ? x.valor : x.valor - x.valor_pago), 0));
  res.json({ parcelas: linhas, total: soma, quantidade: linhas.length });
});

function parcelaDoAdmin(req, id) {
  return db.prepare(BASE + ' AND i.id = ?').get(req.user.id, Number(id));
}

function atualizarStatusRegistro(recordId) {
  const abertas = db.prepare(`SELECT COUNT(*) n FROM installments WHERE record_id = ? AND status IN ('pendente','parcial')`).get(recordId).n;
  const r = db.prepare('SELECT status FROM records WHERE id = ?').get(recordId);
  if (r.status === 'cancelado') return;
  const novo = abertas ? 'ativo' : 'quitado';
  if (novo !== r.status) db.prepare('UPDATE records SET status = ?, atualizado_em = ? WHERE id = ?').run(novo, new Date().toISOString(), recordId);
}

// Ajuste manual de uma parcela (valor e/ou vencimento)
router.put('/:id', A.exigir('registros'), (req, res) => {
  const p = parcelaDoAdmin(req, req.params.id);
  if (!p) return res.status(404).json({ erro: 'Parcela não encontrada.' });
  if (p.status === 'pago' || p.status === 'cancelado') return res.status(400).json({ erro: 'Parcela paga ou cancelada não pode ser alterada.' });
  const valor = r2(req.body.valor);
  const venc = String(req.body.vencimento || '');
  if (!(valor > 0)) return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
  if (valor < p.valor_pago) return res.status(400).json({ erro: 'O valor não pode ser menor que o já pago (' + moeda(p.valor_pago) + ').' });
  if (!isoValida(venc)) return res.status(400).json({ erro: 'Data de vencimento inválida.' });
  db.transaction(() => {
    const status = p.valor_pago >= valor - 0.004 ? 'pago' : p.valor_pago > 0 ? 'parcial' : 'pendente';
    db.prepare('UPDATE installments SET valor = ?, vencimento = ?, status = ?, pago_em = CASE WHEN ? = \'pago\' THEN ? ELSE pago_em END, atualizado_em = ? WHERE id = ?')
      .run(valor, venc, status, status, new Date().toISOString(), new Date().toISOString(), p.id);
    const total = db.prepare('SELECT COALESCE(SUM(valor),0) t FROM installments WHERE record_id = ? AND status <> \'cancelado\'').get(p.record_id).t;
    db.prepare('UPDATE records SET total = ?, acrescimo = ? - valor_principal, atualizado_em = ? WHERE id = ?').run(r2(total), r2(total), new Date().toISOString(), p.record_id);
    db.prepare(`UPDATE reminders SET status = 'ignorado', erro = 'Parcela alterada' WHERE installment_id = ? AND status = 'pendente'`).run(p.id);
    atualizarStatusRegistro(p.record_id);
  })();
  auditar(req, 'parcela_ajustada', 'installments', p.id, { registro: p.record_id, parcela: p.numero, cliente: p.cliente,
    valor: { de: p.valor, para: valor }, vencimento: { de: p.vencimento, para: venc } });
  res.json({ ok: true });
});

// Registrar pagamento
router.post('/:id/pagar', A.exigir('pagamentos'), (req, res) => {
  const p = parcelaDoAdmin(req, req.params.id);
  if (!p) return res.status(404).json({ erro: 'Parcela não encontrada.' });
  if (p.registro_status === 'cancelado' || p.status === 'cancelado') return res.status(400).json({ erro: 'Esta parcela está cancelada.' });
  if (p.status === 'pago') return res.status(400).json({ erro: 'Esta parcela já está paga.' });
  const restante = r2(p.valor - p.valor_pago);
  const valor = r2(req.body.valor);
  if (!(valor > 0)) return res.status(400).json({ erro: 'Informe o valor pago.' });
  if (valor > restante + 0.004) return res.status(400).json({ erro: 'O valor é maior que o restante da parcela (' + moeda(restante) + ').' });
  const data = isoValida(req.body.data) ? req.body.data : hoje();
  const forma = String(req.body.forma || 'Dinheiro').trim().slice(0, 40);
  const obs = String(req.body.observacao || '').trim().slice(0, 500) || null;

  let pagId;
  db.transaction(() => {
    pagId = db.prepare(`INSERT INTO payments (admin_id, installment_id, record_id, client_id, valor, data_pagamento, forma, observacao, registrado_por)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, p.id, p.record_id, p.client_id, valor, data, forma, obs, req.user.id).lastInsertRowid;
    const pago = r2(p.valor_pago + valor);
    const status = pago >= p.valor - 0.004 ? 'pago' : 'parcial';
    db.prepare('UPDATE installments SET valor_pago = ?, status = ?, pago_em = ?, atualizado_em = ? WHERE id = ?')
      .run(pago, status, status === 'pago' ? new Date().toISOString() : null, new Date().toISOString(), p.id);
    atualizarStatusRegistro(p.record_id);
  })();
  auditar(req, 'pagamento_registrado', 'payments', pagId, { registro: p.record_id, parcela: p.numero, cliente: p.cliente, valor, forma, data });

  // Mensagem de confirmação pronta para enviar
  const d = msg.dadosDaParcela(p.id, req.user.id);
  const texto = msg.montar(msg.obterModelo(req.user.id, 'confirmacao'), { ...d, ultimo_pagamento: valor });
  res.json({ ok: true, pagamento_id: pagId, quitada: r2(p.valor_pago + valor) >= p.valor - 0.004,
             confirmacao: { texto, link: whatsapp.link(d.fone, texto) } });
});

router.get('/:id/pagamentos', (req, res) => {
  const p = parcelaDoAdmin(req, req.params.id);
  if (!p) return res.status(404).json({ erro: 'Parcela não encontrada.' });
  res.json(db.prepare(`SELECT pg.*, u.nome AS registrado_por_nome FROM payments pg LEFT JOIN users u ON u.id = pg.registrado_por
                       WHERE pg.installment_id = ? ORDER BY pg.id DESC`).all(p.id));
});

// Estornar (desfazer) um pagamento
router.delete('/pagamentos/:pid', A.exigir('pagamentos'), (req, res) => {
  const pg = db.prepare('SELECT * FROM payments WHERE id = ? AND admin_id = ?').get(Number(req.params.pid), req.user.id);
  if (!pg) return res.status(404).json({ erro: 'Pagamento não encontrado.' });
  const motivo = String((req.body || {}).motivo || '').trim();
  if (!motivo) return res.status(400).json({ erro: 'Informe o motivo do estorno.' });
  const p = db.prepare('SELECT * FROM installments WHERE id = ?').get(pg.installment_id);
  db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(pg.id);
    const pago = r2(Math.max(0, p.valor_pago - pg.valor));
    const status = p.status === 'cancelado' ? 'cancelado' : pago >= p.valor - 0.004 ? 'pago' : pago > 0 ? 'parcial' : 'pendente';
    db.prepare('UPDATE installments SET valor_pago = ?, status = ?, pago_em = CASE WHEN ? = \'pago\' THEN pago_em ELSE NULL END, atualizado_em = ? WHERE id = ?')
      .run(pago, status, status, new Date().toISOString(), p.id);
    atualizarStatusRegistro(p.record_id);
  })();
  auditar(req, 'pagamento_estornado', 'payments', pg.id, { registro: pg.record_id, parcela: p.numero, valor: pg.valor, forma: pg.forma, data: pg.data_pagamento, motivo });
  res.json({ ok: true });
});

// Mensagem pronta para WhatsApp: GET /api/parcelas/:id/mensagem?tipo=antecipado|hoje|atraso|confirmacao
router.get('/:id/mensagem', A.exigir('whatsapp'), (req, res) => {
  const d = msg.dadosDaParcela(req.params.id, req.user.id);
  if (!d) return res.status(404).json({ erro: 'Parcela não encontrada.' });
  const tipo = msg.MODELOS_PADRAO[req.query.tipo] ? req.query.tipo : msg.tipoPorData(d.vencimento);
  const texto = msg.montar(msg.obterModelo(req.user.id, tipo), d);
  res.json({ tipo, texto, telefone: whatsapp.normalizarFone(d.fone), link: whatsapp.link(d.fone, texto) });
});

// Registrar que a mensagem foi enviada manualmente
router.post('/:id/lembrete-enviado', A.exigir('whatsapp'), (req, res) => {
  const p = parcelaDoAdmin(req, req.params.id);
  if (!p) return res.status(404).json({ erro: 'Parcela não encontrada.' });
  const h = hoje();
  const tipo = msg.MODELOS_PADRAO[req.body.tipo] ? req.body.tipo : msg.tipoPorData(p.vencimento);
  db.prepare(`INSERT INTO reminders (admin_id, installment_id, client_id, tipo, regra, data_envio, mensagem, telefone, status, provedor, enviado_em)
              VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, 'enviado', 'manual', ?)
              ON CONFLICT(installment_id, regra, data_envio) DO UPDATE SET status = 'enviado', enviado_em = excluded.enviado_em, mensagem = excluded.mensagem`)
    .run(req.user.id, p.id, p.client_id, tipo, h, String(req.body.texto || ''), whatsapp.normalizarFone(p.whatsapp || p.telefone), new Date().toISOString());
  db.prepare(`UPDATE reminders SET status = 'enviado', enviado_em = ?, provedor = 'manual' WHERE installment_id = ? AND data_envio = ? AND status = 'pendente'`)
    .run(new Date().toISOString(), p.id, h);
  res.json({ ok: true });
});

module.exports = router;
