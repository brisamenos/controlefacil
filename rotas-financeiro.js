// rotas-financeiro.js — Financeiro: recebido, investimento, extra, despesa e saldo
const express = require('express');
const router  = express.Router();
const { db }  = require('./db');
const A = require('./auth');
const { auditar, hoje, isoValida, r2, getConfig } = require('./util');

router.use(A.autenticar, A.somenteAdmin, A.exigir('financeiro'));

const TIPOS = ['investimento', 'extra', 'despesa'];
// data local (Brasília) de um carimbo UTC gravado pelo SQLite
const DATA_LOCAL = c => `date(${c}, '-3 hours')`;

function periodo(q) {
  const h = hoje();
  const de = isoValida(q.de) ? q.de : h.slice(0, 7) + '-01';
  const ate = isoValida(q.ate) ? q.ate : h;
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

function totais(adminId, de, ate) {
  const auto = getConfig(adminId).financeiro_investimento_auto === '1';
  const um = (sql, ...p) => db.prepare(sql).get(...p);
  const recebido = um(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) v FROM payments WHERE admin_id = ? AND data_pagamento BETWEEN ? AND ?`, adminId, de, ate);
  const regs = auto ? um(`SELECT COUNT(*) n, COALESCE(SUM(valor_principal),0) v FROM records
                         WHERE admin_id = ? AND status <> 'cancelado' AND ${DATA_LOCAL('criado_em')} BETWEEN ? AND ?`, adminId, de, ate) : { n: 0, v: 0 };
  const man = {};
  for (const t of TIPOS) man[t] = um(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) v FROM lancamentos WHERE admin_id = ? AND tipo = ? AND data BETWEEN ? AND ?`, adminId, t, de, ate);
  const investimento = r2(regs.v + man.investimento.v);
  const saldo = r2(recebido.v + man.extra.v - investimento - man.despesa.v);
  return {
    recebido: { total: r2(recebido.v), qtd: recebido.n },
    investimento: { total: investimento, registros: r2(regs.v), qtd_registros: regs.n, manual: r2(man.investimento.v), qtd_manual: man.investimento.n, automatico: auto },
    extra: { total: r2(man.extra.v), qtd: man.extra.n },
    despesa: { total: r2(man.despesa.v), qtd: man.despesa.n },
    entradas: r2(recebido.v + man.extra.v), saidas: r2(investimento + man.despesa.v), saldo,
  };
}

// GET /api/financeiro?de=&ate=
router.get('/', (req, res) => {
  const { de, ate } = periodo(req.query);
  const id = req.user.id;
  const t = totais(id, de, ate);
  const mov = [];
  db.prepare(`SELECT p.id, p.valor, p.data_pagamento AS data, p.forma, p.registrado_em, c.nome AS cliente, r.descricao, i.numero, r.qtd_parcelas, c.id AS client_id
              FROM payments p JOIN clients c ON c.id = p.client_id JOIN records r ON r.id = p.record_id JOIN installments i ON i.id = p.installment_id
              WHERE p.admin_id = ? AND p.data_pagamento BETWEEN ? AND ? ORDER BY p.data_pagamento DESC, p.id DESC LIMIT 400`).all(id, de, ate)
    .forEach(p => mov.push({ origem: 'pagamento', tipo: 'recebido', id: p.id, data: p.data, valor: p.valor, ordem: p.registrado_em,
      titulo: p.cliente, detalhe: p.descricao + ' · parcela ' + p.numero + '/' + p.qtd_parcelas + (p.forma ? ' · ' + p.forma : ''), client_id: p.client_id }));
  if (t.investimento.automatico) {
    db.prepare(`SELECT r.id, r.valor_principal, ${DATA_LOCAL('r.criado_em')} AS data, r.criado_em, r.descricao, c.nome AS cliente, c.id AS client_id
                FROM records r JOIN clients c ON c.id = r.client_id
                WHERE r.admin_id = ? AND r.status <> 'cancelado' AND ${DATA_LOCAL('r.criado_em')} BETWEEN ? AND ? ORDER BY r.criado_em DESC LIMIT 400`).all(id, de, ate)
      .forEach(r => mov.push({ origem: 'registro', tipo: 'investimento', id: r.id, data: r.data, valor: r.valor_principal, ordem: r.criado_em,
        titulo: r.cliente, detalhe: 'Novo registro · ' + r.descricao, client_id: r.client_id }));
  }
  db.prepare(`SELECT l.*, u.nome AS autor FROM lancamentos l LEFT JOIN users u ON u.id = l.criado_por
              WHERE l.admin_id = ? AND l.data BETWEEN ? AND ? ORDER BY l.data DESC, l.id DESC LIMIT 400`).all(id, de, ate)
    .forEach(l => mov.push({ origem: 'lancamento', tipo: l.tipo, id: l.id, data: l.data, valor: l.valor, ordem: l.criado_em,
      titulo: l.descricao, detalhe: [l.categoria, l.forma].filter(Boolean).join(' · '), categoria: l.categoria, forma: l.forma, descricao: l.descricao }));
  mov.sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : String(b.ordem).localeCompare(String(a.ordem)));
  let cats = [];
  try { cats = JSON.parse(getConfig(id).categorias_despesa); } catch (e) {}
  res.json({ de, ate, totais: t, movimentos: mov, categorias: cats });
});

function validar(b) {
  const tipo = String(b.tipo || '');
  if (!TIPOS.includes(tipo)) return { erro: 'Escolha o tipo: investimento, extra ou despesa.' };
  const valor = r2(b.valor);
  if (!(valor > 0)) return { erro: 'Informe um valor maior que zero.' };
  if (valor > 100000000) return { erro: 'Valor muito alto. Confira o número.' };
  const descricao = String(b.descricao || '').trim().slice(0, 120);
  if (!descricao) return { erro: 'Informe a descrição.' };
  const data = isoValida(b.data) ? b.data : hoje();
  return { tipo, valor, descricao, data, categoria: String(b.categoria || '').trim().slice(0, 60) || null, forma: String(b.forma || '').trim().slice(0, 40) || null };
}

router.post('/lancamentos', (req, res) => {
  const v = validar(req.body || {});
  if (v.erro) return res.status(400).json(v);
  const info = db.prepare(`INSERT INTO lancamentos (admin_id, tipo, descricao, categoria, valor, data, forma, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, v.tipo, v.descricao, v.categoria, v.valor, v.data, v.forma, req.user.id);
  auditar(req, 'lancamento_criado', 'lancamentos', info.lastInsertRowid, v);
  res.json({ id: info.lastInsertRowid });
});

router.put('/lancamentos/:id', (req, res) => {
  const atual = db.prepare('SELECT * FROM lancamentos WHERE id = ? AND admin_id = ?').get(Number(req.params.id), req.user.id);
  if (!atual) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  const v = validar(req.body || {});
  if (v.erro) return res.status(400).json(v);
  db.prepare(`UPDATE lancamentos SET tipo = ?, descricao = ?, categoria = ?, valor = ?, data = ?, forma = ?, atualizado_em = ? WHERE id = ?`)
    .run(v.tipo, v.descricao, v.categoria, v.valor, v.data, v.forma, new Date().toISOString(), atual.id);
  auditar(req, 'lancamento_editado', 'lancamentos', atual.id, { antes: { tipo: atual.tipo, valor: atual.valor, descricao: atual.descricao, data: atual.data }, depois: v });
  res.json({ ok: true });
});

router.delete('/lancamentos/:id', (req, res) => {
  const atual = db.prepare('SELECT * FROM lancamentos WHERE id = ? AND admin_id = ?').get(Number(req.params.id), req.user.id);
  if (!atual) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  db.prepare('DELETE FROM lancamentos WHERE id = ?').run(atual.id);
  auditar(req, 'lancamento_excluido', 'lancamentos', atual.id, { tipo: atual.tipo, valor: atual.valor, descricao: atual.descricao, data: atual.data });
  res.json({ ok: true });
});

router.put('/config', A.exigir('configuracoes'), (req, res) => {
  const { setConfig } = require('./util');
  const b = req.body || {};
  const novo = {};
  if ('investimento_auto' in b) novo.financeiro_investimento_auto = b.investimento_auto ? '1' : '0';
  if (Array.isArray(b.categorias)) novo.categorias_despesa = JSON.stringify(b.categorias.map(c => String(c).trim().slice(0, 40)).filter(Boolean).slice(0, 30));
  setConfig(req.user.id, novo);
  auditar(req, 'config_alterada', 'settings', null, Object.keys(novo));
  res.json({ ok: true });
});

module.exports = router;
