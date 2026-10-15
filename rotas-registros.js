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

// ── Editar registro (refaz o plano, preservando parcelas com pagamento) ─────
function lerManuais(lista) {
  if (!Array.isArray(lista) || !lista.length) return null;
  if (lista.length > 1000) { const e = new Error('Máximo de 1000 parcelas.'); e.status = 400; throw e; }
  const out = lista.map((p, i) => ({ vencimento: String(p.vencimento || ''), valor: r2(p.valor), _i: i + 1 }));
  const ruim = out.find(p => !isoValida(p.vencimento) || !(p.valor > 0));
  if (ruim) { const e = new Error('Confira a parcela ' + ruim._i + ': data e valor são obrigatórios.'); e.status = 400; throw e; }
  return out;
}

function planoEdicao(rec, b) {
  const erro = m => { const e = new Error(m); e.status = 400; return e; };
  if (rec.status === 'cancelado') throw erro('Registro cancelado não pode ser editado.');
  const sim = simular(b);
  const todas = db.prepare('SELECT * FROM installments WHERE record_id = ? ORDER BY numero').all(rec.id);
  const fixas = todas.filter(p => p.status === 'pago' || p.valor_pago > 0);
  const k = fixas.length;
  const valorFixo = r2(fixas.reduce((t, p) => t + p.valor, 0));
  let novas = lerManuais(b.parcelas);
  if (!novas) {
    if (!k) novas = sim.parcelas.map(p => ({ vencimento: p.vencimento, valor: p.valor }));
    else {
      if (sim.qtd_parcelas <= k)
        throw erro('Este registro já tem ' + k + ' parcela(s) com pagamento. A nova quantidade precisa ser maior que ' + k + '.');
      const restante = Math.round((sim.total - valorFixo) * 100);
      if (restante <= 0)
        throw erro('O novo total (' + sim.total.toFixed(2).replace('.', ',') + ') precisa ser maior que o das parcelas já pagas (' + valorFixo.toFixed(2).replace('.', ',') + ').');
      // As parcelas pagas ocupam o lugar delas no calendário; as novas ficam nas outras datas
      const datas = sim.parcelas.map(p => p.vencimento);
      fixas.forEach(f => { const i = datas.indexOf(f.vencimento); if (i >= 0) datas.splice(i, 1); });
      while (datas.length > sim.qtd_parcelas - k) datas.shift();
      const n = datas.length, base = Math.floor(restante / n);
      novas = datas.map((d, i) => ({ vencimento: d, valor: (i === n - 1 ? restante - base * (n - 1) : base) / 100 }));
    }
  }
  const lista = [
    ...fixas.map(p => ({ id: p.id, vencimento: p.vencimento, valor: p.valor, valor_pago: p.valor_pago, status: p.status, fixa: true })),
    ...novas.map(p => ({ vencimento: p.vencimento, valor: p.valor, valor_pago: 0, status: 'pendente', fixa: false })),
  ].sort((a, b) => a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : (b.fixa - a.fixa));
  lista.forEach((p, i) => { p.numero = i + 1; });
  const total = r2(lista.reduce((t, p) => t + p.valor, 0));
  return { sim, fixas, novas, lista, total, acrescimo: r2(total - sim.valor_principal), valor_fixo: valorFixo,
           ja_pago: r2(fixas.reduce((t, p) => t + p.valor_pago, 0)) };
}

function registroDoAdmin(req) {
  return db.prepare('SELECT * FROM records WHERE id = ? AND admin_id = ?').get(Number(req.params.id), req.user.id);
}

router.post('/:id/simular-edicao', A.exigir('registros'), (req, res) => {
  const rec = registroDoAdmin(req);
  if (!rec) return res.status(404).json({ erro: 'Registro não encontrado.' });
  try {
    const pl = planoEdicao(rec, req.body || {});
    res.json({ valor_principal: pl.sim.valor_principal, percentual: pl.sim.percentual, acrescimo: pl.acrescimo, total: pl.total,
               frequencia: pl.sim.frequencia, config: pl.sim.config, qtd_parcelas: pl.lista.length,
               parcelas: pl.lista, fixas_qtd: pl.fixas.length, valor_fixo: pl.valor_fixo, ja_pago: pl.ja_pago });
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
});

router.post('/:id/editar', A.exigir('registros'), (req, res) => {
  const rec = registroDoAdmin(req);
  if (!rec) return res.status(404).json({ erro: 'Registro não encontrado.' });
  const b = req.body || {};
  const descricao = String(b.descricao || '').trim();
  if (!descricao) return res.status(400).json({ erro: 'Informe a descrição.' });
  let pl;
  try { pl = planoEdicao(rec, b); } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
  const agora = new Date().toISOString();
  const antes = { descricao: rec.descricao, valor_principal: rec.valor_principal, percentual: rec.percentual, total: rec.total,
                  frequencia: rec.frequencia, parcelas: rec.qtd_parcelas };
  db.transaction(() => {
    const manter = new Set(pl.fixas.map(p => p.id));
    db.prepare('SELECT id FROM installments WHERE record_id = ?').all(rec.id)
      .forEach(p => { if (!manter.has(p.id)) db.prepare('DELETE FROM installments WHERE id = ?').run(p.id); });
    const ins = db.prepare(`INSERT INTO installments (admin_id, record_id, client_id, numero, vencimento, valor) VALUES (?, ?, ?, ?, ?, ?)`);
    const upd = db.prepare('UPDATE installments SET numero = ?, atualizado_em = ? WHERE id = ?');
    // renumera sem colidir: primeiro joga as fixas para números altos
    pl.fixas.forEach((p, i) => upd.run(100000 + i, agora, p.id));
    pl.lista.forEach(p => { if (p.fixa) upd.run(p.numero, agora, p.id); else ins.run(req.user.id, rec.id, rec.client_id, p.numero, p.vencimento, p.valor); });
    const abertas = pl.lista.some(p => p.status !== 'pago');
    db.prepare(`UPDATE records SET descricao = ?, valor_principal = ?, percentual = ?, acrescimo = ?, total = ?, frequencia = ?, config = ?,
                qtd_parcelas = ?, observacoes = ?, status = ?, atualizado_em = ? WHERE id = ?`)
      .run(descricao, pl.sim.valor_principal, pl.sim.percentual, pl.acrescimo, pl.total, pl.sim.frequencia, JSON.stringify(pl.sim.config),
           pl.lista.length, String(b.observacoes ?? rec.observacoes ?? '').trim() || null, abertas ? 'ativo' : 'quitado', agora, rec.id);
  })();
  auditar(req, 'registro_editado', 'records', rec.id, {
    antes, depois: { descricao, valor_principal: pl.sim.valor_principal, percentual: pl.sim.percentual, total: pl.total,
                     frequencia: pl.sim.frequencia, parcelas: pl.lista.length },
    parcelas_mantidas: pl.fixas.length, total: pl.total, parcelas: pl.lista.length,
  });
  try { agendador.gerarLembretes(req.user.id); } catch (e) {}
  res.json({ ok: true, total: pl.total, parcelas: pl.lista.length, mantidas: pl.fixas.length, client_id: rec.client_id });
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
  const motivo = String((req.body || {}).motivo || '').trim().slice(0, 300) || null; // opcional
  db.transaction(() => {
    db.prepare(`UPDATE records SET status = 'cancelado', atualizado_em = ? WHERE id = ?`).run(new Date().toISOString(), r.id);
    db.prepare(`UPDATE installments SET status = 'cancelado', atualizado_em = ? WHERE record_id = ? AND status IN ('pendente','parcial')`).run(new Date().toISOString(), r.id);
    db.prepare(`UPDATE reminders SET status = 'ignorado', erro = 'Registro cancelado' WHERE status = 'pendente'
                AND installment_id IN (SELECT id FROM installments WHERE record_id = ?)`).run(r.id);
  })();
  auditar(req, 'registro_cancelado', 'records', r.id, { motivo, descricao: r.descricao, total: r.total });
  res.json({ ok: true });
});


// ═══════════════════════════════════════════════════════════════════════════
// ABATER VALOR (pagamento antecipado / amortização) e RENEGOCIAR
// ═══════════════════════════════════════════════════════════════════════════
const msgs = require('./mensagens');
const whatsapp = require('./whatsapp');
const cent = v => Math.round((Number(v) || 0) * 100);
const erro400 = m => { const e = new Error(m); e.status = 400; return e; };
const moedaTxt = v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

function abertasDo(recId) {
  return db.prepare(`SELECT * FROM installments WHERE record_id = ? AND status IN ('pendente','parcial') ORDER BY vencimento, numero`).all(recId);
}

function fecharStatusRegistro(recId) {
  const n = db.prepare(`SELECT COUNT(*) n FROM installments WHERE record_id = ? AND status IN ('pendente','parcial')`).get(recId).n;
  db.prepare(`UPDATE records SET status = ?, atualizado_em = ? WHERE id = ? AND status <> 'cancelado'`).run(n ? 'ativo' : 'quitado', new Date().toISOString(), recId);
}

// Divide `total` (centavos) entre itens proporcionalmente a `pesos` (centavos), sem perder centavo
function dividir(total, pesos) {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (!soma) return pesos.map(() => 0);
  const out = pesos.map(w => Math.floor(total * w / soma));
  let resto = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; resto > 0; i = (i + 1) % out.length) { if (out[i] < pesos[i]) { out[i]++; resto--; } }
  return out;
}

function planoAbatimento(rec, b) {
  if (rec.status !== 'ativo') throw erro400('Só é possível abater em registros ativos.');
  const valor = cent(b.valor), desconto = cent(b.desconto);
  if (valor <= 0) throw erro400('Informe o valor recebido.');
  if (desconto < 0) throw erro400('Desconto inválido.');
  const abertas = abertasDo(rec.id);
  const rest = abertas.map(p => cent(p.valor) - cent(p.valor_pago));
  const saldo = rest.reduce((a, b) => a + b, 0);
  const credito = valor + desconto;
  if (!saldo) throw erro400('Este registro não tem saldo em aberto.');
  if (credito > saldo) throw erro400('O valor' + (desconto ? ' com o desconto' : '') + ' passa do saldo em aberto (' + moedaTxt(saldo / 100) + ').');
  const modo = ['proximas', 'ultimas', 'reduzir'].includes(b.modo) ? b.modo : 'proximas';
  let aplicar = abertas.map(() => 0);
  if (modo === 'reduzir') aplicar = dividir(credito, rest);
  else {
    let falta = credito;
    const ordem = abertas.map((_, i) => i);
    if (modo === 'ultimas') ordem.reverse();
    for (const i of ordem) { if (!falta) break; aplicar[i] = Math.min(rest[i], falta); falta -= aplicar[i]; }
  }
  const pagar = dividir(valor, aplicar);            // parte em dinheiro
  const itens = abertas.map((p, i) => ({
    id: p.id, numero: p.numero, vencimento: p.vencimento, valor_antes: p.valor, restante_antes: rest[i] / 100,
    pagar: pagar[i] / 100, desconto: (aplicar[i] - pagar[i]) / 100,
    novo_valor: (cent(p.valor) - (aplicar[i] - pagar[i])) / 100, restante_depois: (rest[i] - aplicar[i]) / 100,
    quitada: rest[i] - aplicar[i] === 0,
  }));
  return { modo, valor: valor / 100, desconto: desconto / 100, saldo: saldo / 100, saldo_depois: (saldo - credito) / 100,
           quitadas: itens.filter(x => x.quitada && (x.pagar || x.desconto)).length, itens };
}

router.post('/:id/simular-abatimento', A.exigir('pagamentos'), (req, res) => {
  const rec = registroDoAdmin(req);
  if (!rec) return res.status(404).json({ erro: 'Registro não encontrado.' });
  try { res.json(planoAbatimento(rec, req.body || {})); } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
});

router.post('/:id/abater', A.exigir('pagamentos'), (req, res) => {
  const rec = registroDoAdmin(req);
  if (!rec) return res.status(404).json({ erro: 'Registro não encontrado.' });
  const b = req.body || {};
  let pl;
  try { pl = planoAbatimento(rec, b); } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
  const data = isoValida(b.data) ? b.data : hoje();
  const forma = String(b.forma || 'Dinheiro').trim().slice(0, 40);
  const obs = ('Abatimento' + (pl.desconto ? ' com desconto de ' + moedaTxt(pl.desconto) : '') + (b.observacao ? ' · ' + String(b.observacao).trim() : '')).slice(0, 500);
  const agora = new Date().toISOString();
  db.transaction(() => {
    for (const it of pl.itens) {
      if (!it.pagar && !it.desconto) continue;
      const p = db.prepare('SELECT * FROM installments WHERE id = ?').get(it.id);
      const novoValor = r2(p.valor - it.desconto);
      const pago = r2(p.valor_pago + it.pagar);
      if (it.pagar) db.prepare(`INSERT INTO payments (admin_id, installment_id, record_id, client_id, valor, data_pagamento, forma, observacao, registrado_por)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, p.id, rec.id, rec.client_id, it.pagar, data, forma, obs, req.user.id);
      const st = pago >= novoValor - 0.004 ? 'pago' : pago > 0 ? 'parcial' : 'pendente';
      db.prepare(`UPDATE installments SET valor = ?, valor_pago = ?, status = ?, pago_em = CASE WHEN ? = 'pago' THEN ? ELSE pago_em END, atualizado_em = ? WHERE id = ?`)
        .run(novoValor, pago, st, st, agora, agora, p.id);
      db.prepare(`UPDATE reminders SET status = 'ignorado', erro = 'Parcela abatida' WHERE installment_id = ? AND status = 'pendente'`).run(p.id);
    }
    if (pl.desconto) db.prepare('UPDATE records SET total = ROUND(total - ?, 2), acrescimo = ROUND(acrescimo - ?, 2), atualizado_em = ? WHERE id = ?').run(pl.desconto, pl.desconto, agora, rec.id);
    fecharStatusRegistro(rec.id);
  })();
  auditar(req, 'registro_abatido', 'records', rec.id, { registro: rec.id, valor: pl.valor, desconto: pl.desconto, modo: pl.modo,
    saldo: { de: pl.saldo, para: pl.saldo_depois }, parcelas_quitadas: pl.quitadas, forma, data });
  try { agendador.gerarLembretes(req.user.id); } catch (e) {}
  const cli = db.prepare('SELECT nome, whatsapp, telefone FROM clients WHERE id = ?').get(rec.client_id);
  const primeiro = String(cli.nome || '').trim().split(/\s+/)[0];
  const texto = `Olá, ${primeiro}! Recebemos o seu pagamento de ${moedaTxt(pl.valor)} para abater ${rec.descricao}.` +
    (pl.desconto ? ` Você ganhou ${moedaTxt(pl.desconto)} de desconto.` : '') +
    (pl.saldo_depois > 0 ? `\n\nSaldo restante: ${moedaTxt(pl.saldo_depois)}.` : '\n\nSua dívida está quitada!') + '\n\nMuito obrigado!';
  res.json({ ok: true, saldo_depois: pl.saldo_depois, quitadas: pl.quitadas, quitado: pl.saldo_depois <= 0,
             confirmacao: { texto, link: whatsapp.link(cli.whatsapp || cli.telefone, texto) } });
});

function planoRenegociacao(rec, b) {
  if (rec.status !== 'ativo') throw erro400('Só é possível renegociar registros ativos.');
  const abertas = abertasDo(rec.id);
  const saldo = abertas.reduce((a, p) => a + cent(p.valor) - cent(p.valor_pago), 0);
  if (!saldo) throw erro400('Este registro não tem saldo em aberto.');
  const pct = Number(String(b.acrescimo_pct ?? 0).replace(',', '.')) || 0;
  if (pct < 0 || pct > 1000) throw erro400('Percentual inválido.');
  const acr = Math.round(saldo * pct / 100), desconto = cent(b.desconto);
  if (desconto < 0) throw erro400('Desconto inválido.');
  const novo = saldo + acr - desconto;
  if (novo <= 0) throw erro400('O desconto não pode ser maior que o saldo.');
  if (!isoValida(b.data_inicial)) throw erro400('Escolha a data do primeiro vencimento.');
  const d = new Date(b.data_inicial + 'T12:00:00Z');
  const sim = simular({ ...b, valor_principal: novo / 100, percentual: 0,
                        dia_mes: d.getUTCDate(), dia_semana: d.getUTCDay() });
  const hj = hoje();
  return { saldo: saldo / 100, atrasado: r2(abertas.filter(p => p.vencimento < hj).reduce((a, p) => a + p.valor - p.valor_pago, 0)),
           parcelas_abertas: abertas.length, acrescimo_pct: pct, acrescimo: acr / 100, desconto: desconto / 100, novo_total: novo / 100,
           frequencia: sim.frequencia, config: sim.config, qtd_parcelas: sim.qtd_parcelas, valor_parcela: sim.parcelas[0].valor, parcelas: sim.parcelas };
}

router.post('/:id/simular-renegociacao', A.exigir('registros'), (req, res) => {
  const rec = registroDoAdmin(req);
  if (!rec) return res.status(404).json({ erro: 'Registro não encontrado.' });
  try { res.json(planoRenegociacao(rec, req.body || {})); } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
});

router.post('/:id/renegociar', A.exigir('registros'), (req, res) => {
  const rec = registroDoAdmin(req);
  if (!rec) return res.status(404).json({ erro: 'Registro não encontrado.' });
  const b = req.body || {};
  let pl;
  try { pl = planoRenegociacao(rec, b); } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
  const agora = new Date().toISOString();
  const motivo = String(b.motivo || '').trim().slice(0, 300);
  db.transaction(() => {
    for (const p of abertasDo(rec.id)) {
      if (p.valor_pago > 0) // parte já paga fica registrada; o que faltava vai para o novo acordo
        db.prepare(`UPDATE installments SET valor = valor_pago, status = 'pago', pago_em = ?, atualizado_em = ? WHERE id = ?`).run(agora, agora, p.id);
      else db.prepare('DELETE FROM installments WHERE id = ?').run(p.id);
    }
    const ins = db.prepare(`INSERT INTO installments (admin_id, record_id, client_id, numero, vencimento, valor) VALUES (?, ?, ?, ?, ?, ?)`);
    pl.parcelas.forEach((p, i) => ins.run(req.user.id, rec.id, rec.client_id, 900000 + i, p.vencimento, p.valor));
    // renumera tudo em ordem de vencimento
    const todas = db.prepare('SELECT id FROM installments WHERE record_id = ? ORDER BY vencimento, numero').all(rec.id);
    const upd = db.prepare('UPDATE installments SET numero = ? WHERE id = ?');
    todas.forEach((p, i) => upd.run(-(i + 1), p.id));
    todas.forEach((p, i) => upd.run(i + 1, p.id));
    const total = db.prepare(`SELECT COALESCE(SUM(valor),0) t, COUNT(*) n FROM installments WHERE record_id = ? AND status <> 'cancelado'`).get(rec.id);
    const nota = 'Renegociado em ' + hoje().split('-').reverse().join('/') + ': saldo ' + moedaTxt(pl.saldo) +
      (pl.acrescimo ? ' + ' + String(pl.acrescimo_pct).replace('.', ',') + '%' : '') + (pl.desconto ? ' − desconto ' + moedaTxt(pl.desconto) : '') +
      ' = ' + moedaTxt(pl.novo_total) + ' em ' + pl.qtd_parcelas + 'x' + (motivo ? ' (' + motivo + ')' : '');
    db.prepare(`UPDATE records SET total = ?, acrescimo = ROUND(? - valor_principal, 2), qtd_parcelas = ?, frequencia = ?, config = ?, status = 'ativo',
                observacoes = TRIM(COALESCE(observacoes || char(10), '') || ?), atualizado_em = ? WHERE id = ?`)
      .run(r2(total.t), r2(total.t), total.n, pl.frequencia, JSON.stringify(pl.config), nota, agora, rec.id);
  })();
  auditar(req, 'registro_renegociado', 'records', rec.id, { registro: rec.id, saldo: pl.saldo, acrescimo_pct: pl.acrescimo_pct, acrescimo: pl.acrescimo,
    desconto: pl.desconto, total: pl.novo_total, parcelas: pl.qtd_parcelas, frequencia: pl.frequencia, motivo });
  try { agendador.gerarLembretes(req.user.id); } catch (e) {}
  const cli = db.prepare('SELECT nome, whatsapp, telefone FROM clients WHERE id = ?').get(rec.client_id);
  const primeiro = String(cli.nome || '').trim().split(/\s+/)[0];
  const texto = `Olá, ${primeiro}! Conforme combinamos, renegociamos ${rec.descricao}.\n\n` +
    `Novo acordo: ${pl.qtd_parcelas}x de ${moedaTxt(pl.valor_parcela)}, total ${moedaTxt(pl.novo_total)}.\n` +
    `Primeiro vencimento: ${pl.parcelas[0].vencimento.split('-').reverse().join('/')}.\n\nQualquer dúvida, estou à disposição.`;
  res.json({ ok: true, total: pl.novo_total, parcelas: pl.qtd_parcelas, confirmacao: { texto, link: whatsapp.link(cli.whatsapp || cli.telefone, texto) } });
});

module.exports = router;
