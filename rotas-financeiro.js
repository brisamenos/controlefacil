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
  const cfg = getConfig(adminId), auto = cfg.financeiro_investimento_auto === '1', corte = cfg.financeiro_zerado_em || '';
  const um = (sql, ...p) => db.prepare(sql).get(...p);
  const recebido = um(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) v FROM payments WHERE admin_id = ? AND data_pagamento BETWEEN ? AND ?`, adminId, de, ate);
  const regs = auto ? um(`SELECT COUNT(*) n, COALESCE(SUM(valor_principal),0) v FROM records
                         WHERE admin_id = ? AND status <> 'cancelado' AND ${DATA_LOCAL('criado_em')} BETWEEN ? AND ?`, adminId, de, ate) : { n: 0, v: 0 };
  const man = {};
  for (const t of TIPOS) man[t] = um(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) v FROM lancamentos WHERE admin_id = ? AND tipo = ? AND data BETWEEN ? AND ? AND (tipo <> 'extra' OR criado_em >= ?)`, adminId, t, de, ate, corte); // Extra zerado: só conta o lançado depois
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

// Saldo em caixa: tudo o que entrou menos tudo o que saiu, desde o começo
function saldoCaixa(adminId) {
  const t = totais(adminId, '0000-01-01', '9999-12-31');
  return { saldo: t.saldo, entradas: t.entradas, saidas: t.saidas, automatico: t.investimento.automatico };
}

// Saldo de hoje: cada dia começa do zero (o que entrou hoje − o que saiu hoje)
function saldoHoje(adminId) {
  const h = hoje(), t = totais(adminId, h, h);
  return { data: h, saldo: t.saldo, entradas: t.entradas, saidas: t.saidas, automatico: t.investimento.automatico };
}

// GET /api/financeiro/caixa — usado na tela de novo registro
router.get('/caixa', (req, res) => res.json(saldoCaixa(req.user.id)));

// Todas as movimentações de dinheiro, desde o começo (base do livro-caixa)
function movimentosTodos(adminId, auto) {
  const mov = [];
  db.prepare(`SELECT p.id, p.record_id, p.valor, p.data_pagamento AS data, p.forma, p.registrado_em, c.nome AS cliente, r.descricao, i.numero, r.qtd_parcelas,
                     c.id AS client_id, r.total AS r_total, r.acrescimo AS r_acr
              FROM payments p JOIN clients c ON c.id = p.client_id JOIN records r ON r.id = p.record_id JOIN installments i ON i.id = p.installment_id
              WHERE p.admin_id = ?`).all(adminId)
    .forEach(p => {
      mov.push({ origem: 'pagamento', tipo: 'recebido', id: p.id, data: p.data, valor: p.valor, ordem: p.registrado_em, forma: p.forma || 'Outro',
        record_id: p.record_id, r_total: p.r_total, r_acr: p.r_acr, titulo: p.cliente, client_id: p.client_id,
        detalhe: p.descricao + ' · parcela ' + p.numero + '/' + p.qtd_parcelas + (p.forma ? ' · ' + p.forma : '') });
    });
  // Lucro (juros) de cada pagamento, acumulado por registro: a soma fecha no centavo com o acréscimo total
  const porReg = {};
  mov.filter(m => m.origem === 'pagamento').sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.ordem).localeCompare(String(b.ordem)) || a.id - b.id)
    .forEach(m => {
      const acum = porReg[m.record_id] || { pago: 0, juros: 0 };
      const fr = m.r_total > 0 && m.r_acr > 0 ? m.r_acr / m.r_total : 0;
      const pagoC = Math.round(acum.pago * 100) + Math.round(m.valor * 100);
      const jurosAcum = Math.round(pagoC * fr);
      m.juros = (jurosAcum - Math.round(acum.juros * 100)) / 100;
      m.capital = r2(m.valor - m.juros);
      porReg[m.record_id] = { pago: pagoC / 100, juros: jurosAcum / 100 };
      delete m.r_total; delete m.r_acr;
    });
  if (auto) {
    db.prepare(`SELECT r.id, r.valor_principal, ${DATA_LOCAL('r.criado_em')} AS data, r.criado_em, r.descricao, r.percentual, c.nome AS cliente, c.id AS client_id
                FROM records r JOIN clients c ON c.id = r.client_id WHERE r.admin_id = ? AND r.status <> 'cancelado'`).all(adminId)
      .forEach(r => mov.push({ origem: 'registro', tipo: 'investimento', id: r.id, data: r.data, valor: r.valor_principal, ordem: r.criado_em,
        titulo: r.cliente, client_id: r.client_id, detalhe: 'Novo registro · ' + r.descricao + (r.percentual ? ' · ' + String(r.percentual).replace('.', ',') + '%' : '') }));
  }
  db.prepare(`SELECT * FROM lancamentos WHERE admin_id = ?`).all(adminId)
    .forEach(l => mov.push({ origem: 'lancamento', tipo: l.tipo, id: l.id, data: l.data, valor: l.valor, ordem: l.criado_em,
      titulo: l.descricao, detalhe: [l.categoria, l.forma].filter(Boolean).join(' · '), categoria: l.categoria, forma: l.forma, descricao: l.descricao }));
  // Extra zerado: os Extras lançados antes disso não entram mais nas contas (empréstimos e pagamentos continuam contando)
  const corte = getConfig(adminId).financeiro_zerado_em || '';
  if (corte) for (let i = mov.length - 1; i >= 0; i--) if (mov[i].origem === 'lancamento' && mov[i].tipo === 'extra' && String(mov[i].ordem) < corte) mov.splice(i, 1);
  // ordem do livro-caixa: data, depois a hora em que foi lançado
  const PRI = { extra: 0, investimento: 1, despesa: 2, recebido: 3 }; // desempate no mesmo segundo
  mov.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.ordem).localeCompare(String(b.ordem)) || (PRI[a.tipo] - PRI[b.tipo]) || (a.id - b.id));
  let saldo = 0;
  mov.forEach(m => { saldo = r2(saldo + (m.tipo === 'recebido' || m.tipo === 'extra' ? m.valor : -m.valor)); m.saldo_apos = saldo; });
  return mov;
}

// Quanto ainda vai entrar (parcelas em aberto de registros ativos)
function aReceber(adminId) {
  const h = hoje();
  const dia = n => { const d = new Date(h + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const base = `FROM installments i JOIN records r ON r.id = i.record_id
                WHERE i.admin_id = ? AND r.status = 'ativo' AND i.status IN ('pendente','parcial')`;
  const soma = (cond, ...p) => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(i.valor - i.valor_pago),0) v,
      COALESCE(SUM(CASE WHEN r.total > 0 THEN (i.valor - i.valor_pago) * r.acrescimo / r.total ELSE 0 END),0) juros ${base} ${cond}`).get(adminId, ...p);
  const f = x => ({ total: r2(x.v), qtd: x.n, juros: r2(x.juros) });
  const agenda = db.prepare(`SELECT i.vencimento AS dia, COUNT(*) qtd, COALESCE(SUM(i.valor - i.valor_pago),0) total ${base}
                             AND i.vencimento BETWEEN ? AND ? GROUP BY i.vencimento ORDER BY i.vencimento`).all(adminId, h, dia(30))
    .map(a => ({ ...a, total: r2(a.total) }));
  return {
    hoje: f(soma('AND i.vencimento = ?', h)), amanha: f(soma('AND i.vencimento = ?', dia(1))),
    dias7: f(soma('AND i.vencimento BETWEEN ? AND ?', h, dia(6))), dias30: f(soma('AND i.vencimento BETWEEN ? AND ?', h, dia(29))),
    atrasado: f(soma('AND i.vencimento < ?', h)), total: f(soma('')), agenda,
  };
}

// GET /api/financeiro?de=&ate=
router.get('/', (req, res) => {
  const { de, ate } = periodo(req.query);
  const id = req.user.id;
  const t = totais(id, de, ate);
  const todos = movimentosTodos(id, t.investimento.automatico);
  const doPeriodo = todos.filter(m => m.data >= de && m.data <= ate);
  // recebido dividido em capital (dinheiro voltando) e lucro (juros), e por forma
  const recs = doPeriodo.filter(m => m.tipo === 'recebido');
  t.recebido.juros = r2(recs.reduce((x, m) => x + m.juros, 0));
  t.recebido.capital = r2(t.recebido.total - t.recebido.juros);
  const formas = {};
  recs.forEach(m => { formas[m.forma] = formas[m.forma] || { forma: m.forma, total: 0, qtd: 0 }; formas[m.forma].total = r2(formas[m.forma].total + m.valor); formas[m.forma].qtd++; });
  const anterior = todos.filter(m => m.data < de);
  const saldoInicial = anterior.length ? anterior[anterior.length - 1].saldo_apos : 0;
  const ultimo = todos[todos.length - 1];
  // conferência: o saldo do livro-caixa tem que bater com a soma dos totais
  const caixa = saldoCaixa(id);
  const confere = Math.abs((ultimo ? ultimo.saldo_apos : 0) - caixa.saldo) < 0.01 &&
                  Math.abs(saldoInicial + t.saldo - (doPeriodo.length ? doPeriodo[doPeriodo.length - 1].saldo_apos : saldoInicial)) < 0.01;
  let cats = [];
  try { cats = JSON.parse(getConfig(id).categorias_despesa); } catch (e) {}
  res.json({
    de, ate, totais: t, caixa, hoje: saldoHoje(id), a_receber: aReceber(id),
    recebido_por_forma: Object.values(formas).sort((a, b) => b.total - a.total),
    saldo_inicial: saldoInicial, saldo_final: r2(saldoInicial + t.saldo), confere,
    movimentos: doPeriodo.reverse().slice(0, 1000), categorias: cats, zerado_em: getConfig(id).financeiro_zerado_em || '',
  });
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

// Zerar o Extra: os Extras lançados até agora deixam de contar (para lançar de novo o valor certo). Empréstimos e pagamentos continuam.
router.post('/zerar', A.exigir('configuracoes'), (req, res) => {
  const { setConfig } = require('./util');
  const agora = db.prepare(`SELECT datetime('now') AS t`).get().t;
  const antes = saldoCaixa(req.user.id);
  setConfig(req.user.id, { financeiro_zerado_em: agora });
  auditar(req, 'financeiro_zerado', 'settings', null, { em: agora, saldo_antes: antes.saldo, entradas_antes: antes.entradas, saidas_antes: antes.saidas });
  res.json({ ok: true, zerado_em: agora });
});
router.post('/desfazer-zerar', A.exigir('configuracoes'), (req, res) => {
  const { setConfig } = require('./util');
  const era = getConfig(req.user.id).financeiro_zerado_em;
  setConfig(req.user.id, { financeiro_zerado_em: '' });
  auditar(req, 'financeiro_zerar_desfeito', 'settings', null, { era });
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
