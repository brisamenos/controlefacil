// src/routes/painel.js — dashboard, calendário, relatórios, lembretes e configurações do admin
const express = require('express');
const router  = express.Router();
const { db }  = require('./db');
const A = require('./auth');
const { hoje, addDias, isoValida, r2, statusParcela, getConfig, setConfig, auditar, diffDias } = require('./util');
const msg = require('./mensagens');
const agendador = require('./agendador');
const whatsapp = require('./whatsapp');

router.use(A.autenticar, A.somenteAdmin);

const ABERTAS = `i.status IN ('pendente','parcial') AND r.status = 'ativo'`;

function soma(adminId, where, params) {
  return db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(i.valor - i.valor_pago),0) v FROM installments i JOIN records r ON r.id = i.record_id
                     WHERE i.admin_id = ? AND ${ABERTAS} ${where}`).get(adminId, ...params);
}

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const id = req.user.id, h = hoje();
  try { agendador.gerarLembretes(id, h); } catch (e) { console.error(e.message); }
  const lista = (where, params, ordem, lim) => db.prepare(`
    SELECT i.*, r.descricao, r.qtd_parcelas, c.nome AS cliente, c.whatsapp, c.telefone
    FROM installments i JOIN records r ON r.id = i.record_id JOIN clients c ON c.id = i.client_id
    WHERE i.admin_id = ? AND ${ABERTAS} ${where} ORDER BY ${ordem} LIMIT ${lim}`).all(id, ...params)
    .map(p => ({ ...p, restante: r2(p.valor - p.valor_pago), situacao: statusParcela(p, h) }));

  const lembretes = db.prepare(`
    SELECT m.id, m.tipo, m.regra, m.mensagem, m.telefone, m.status, m.data_envio, m.installment_id,
           c.nome AS cliente, i.valor, i.valor_pago, i.vencimento, r.descricao
    FROM reminders m JOIN installments i ON i.id = m.installment_id JOIN clients c ON c.id = m.client_id JOIN records r ON r.id = i.record_id
    WHERE m.admin_id = ? AND m.status = 'pendente' AND m.data_envio <= ? ORDER BY m.data_envio DESC, c.nome LIMIT 50`).all(id, h)
    .map(l => ({ ...l, link: whatsapp.link(l.telefone, l.mensagem) }));

  const hojeS = soma(id, 'AND i.vencimento = ?', [h]);
  const amanhaS = soma(id, 'AND i.vencimento = ?', [addDias(h, 1)]);
  const proxS = soma(id, 'AND i.vencimento > ? AND i.vencimento <= ?', [h, addDias(h, 7)]);
  const atrS = soma(id, 'AND i.vencimento < ?', [h]);
  const aRec = soma(id, '', []);

  res.json({
    hoje: h,
    cards: {
      clientes: db.prepare('SELECT COUNT(*) n FROM clients WHERE admin_id = ?').get(id).n,
      total_registrado: db.prepare(`SELECT COALESCE(SUM(total),0) v FROM records WHERE admin_id = ? AND status <> 'cancelado'`).get(id).v,
      total_a_receber: aRec.v,
      total_recebido: db.prepare('SELECT COALESCE(SUM(valor),0) v FROM payments WHERE admin_id = ?').get(id).v,
      total_atrasado: atrS.v, qtd_atrasadas: atrS.n,
      vence_hoje: hojeS.v, qtd_hoje: hojeS.n,
      vence_amanha: amanhaS.v, qtd_amanha: amanhaS.n,
      proximos_7: proxS.v, qtd_proximos_7: proxS.n,
      recebido_hoje: db.prepare('SELECT COALESCE(SUM(valor),0) v FROM payments WHERE admin_id = ? AND data_pagamento = ?').get(id, h).v,
    },
    proximas: lista('AND i.vencimento >= ?', [h], 'i.vencimento, c.nome', 6),
    atrasadas: lista('AND i.vencimento < ?', [h], 'i.vencimento', 6),
    lembretes,
  });
});

// ── Lembretes ───────────────────────────────────────────────────────────────
router.post('/lembretes/:id/enviado', A.exigir('whatsapp'), (req, res) => {
  const r = db.prepare(`UPDATE reminders SET status = 'enviado', provedor = 'manual', enviado_em = ? WHERE id = ? AND admin_id = ?`)
    .run(new Date().toISOString(), Number(req.params.id), req.user.id);
  res.json({ ok: !!r.changes });
});
router.post('/lembretes/:id/ignorar', A.exigir('whatsapp'), (req, res) => {
  const r = db.prepare(`UPDATE reminders SET status = 'ignorado', erro = 'Dispensado pelo administrador' WHERE id = ? AND admin_id = ?`)
    .run(Number(req.params.id), req.user.id);
  res.json({ ok: !!r.changes });
});
router.get('/lembretes', A.exigir('whatsapp'), (req, res) => {
  const de = isoValida(req.query.de) ? req.query.de : addDias(hoje(), -30);
  res.json(db.prepare(`SELECT m.*, c.nome AS cliente FROM reminders m JOIN clients c ON c.id = m.client_id
                       WHERE m.admin_id = ? AND m.data_envio >= ? ORDER BY m.data_envio DESC, m.id DESC LIMIT 300`).all(req.user.id, de));
});

// ── Calendário ──────────────────────────────────────────────────────────────
router.get('/calendario', (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoje().slice(0, 7);
  const ini = mes + '-01';
  const [a, m] = mes.split('-').map(Number);
  const fim = mes + '-' + String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0');
  const h = hoje();
  const dias = db.prepare(`
    SELECT i.vencimento AS dia,
           COUNT(*) AS qtd,
           SUM(CASE WHEN i.status = 'pago' THEN 1 ELSE 0 END) AS pagas,
           SUM(CASE WHEN i.status IN ('pendente','parcial') AND i.vencimento < ? THEN 1 ELSE 0 END) AS atrasadas,
           COALESCE(SUM(CASE WHEN i.status IN ('pendente','parcial') THEN i.valor - i.valor_pago ELSE 0 END),0) AS a_receber,
           COALESCE(SUM(i.valor),0) AS total
    FROM installments i JOIN records r ON r.id = i.record_id
    WHERE i.admin_id = ? AND r.status <> 'cancelado' AND i.status <> 'cancelado' AND i.vencimento BETWEEN ? AND ?
    GROUP BY i.vencimento`).all(h, req.user.id, ini, fim);
  res.json({ mes, hoje: h, dias });
});

// ── Relatórios ──────────────────────────────────────────────────────────────
router.get('/relatorios', A.exigir('relatorios'), (req, res) => {
  const id = req.user.id, h = hoje();
  const de = isoValida(req.query.de) ? req.query.de : h.slice(0, 7) + '-01';
  const ate = isoValida(req.query.ate) ? req.query.ate : h;
  const um = (sql, ...p) => db.prepare(sql).get(...p);

  const registrado = um(`SELECT COUNT(*) n, COALESCE(SUM(total),0) v, COALESCE(SUM(acrescimo),0) acr, COALESCE(SUM(valor_principal),0) princ
                         FROM records WHERE admin_id = ? AND status <> 'cancelado' AND date(criado_em) BETWEEN ? AND ?`, id, de, ate);
  const recebido = um(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) v FROM payments WHERE admin_id = ? AND data_pagamento BETWEEN ? AND ?`, id, de, ate);
  const pendente = um(`SELECT COUNT(*) n, COALESCE(SUM(i.valor - i.valor_pago),0) v FROM installments i JOIN records r ON r.id = i.record_id
                       WHERE i.admin_id = ? AND ${ABERTAS} AND i.vencimento BETWEEN ? AND ?`, id, de, ate);
  const atrasado = um(`SELECT COUNT(*) n, COALESCE(SUM(i.valor - i.valor_pago),0) v FROM installments i JOIN records r ON r.id = i.record_id
                       WHERE i.admin_id = ? AND ${ABERTAS} AND i.vencimento < ?`, id, h);
  const previsto = um(`SELECT COALESCE(SUM(i.valor),0) v FROM installments i JOIN records r ON r.id = i.record_id
                       WHERE i.admin_id = ? AND r.status <> 'cancelado' AND i.status <> 'cancelado' AND i.vencimento BETWEEN ? AND ?`, id, de, ate);
  const acrescimosAtivos = um(`SELECT COALESCE(SUM(acrescimo),0) v FROM records WHERE admin_id = ? AND status = 'ativo'`, id);

  const dias = diffDias(de, ate);
  const fmtPeriodo = dias > 62 ? "strftime('%Y-%m', X)" : 'X';
  const porPeriodo = db.prepare(`
    SELECT periodo, SUM(recebido) recebido, SUM(previsto) previsto FROM (
      SELECT ${fmtPeriodo.replace('X', 'data_pagamento')} periodo, valor recebido, 0 previsto FROM payments WHERE admin_id = ? AND data_pagamento BETWEEN ? AND ?
      UNION ALL
      SELECT ${fmtPeriodo.replace('X', 'i.vencimento')} periodo, 0, i.valor FROM installments i JOIN records r ON r.id = i.record_id
        WHERE i.admin_id = ? AND r.status <> 'cancelado' AND i.status <> 'cancelado' AND i.vencimento BETWEEN ? AND ?
    ) GROUP BY periodo ORDER BY periodo`).all(id, de, ate, id, de, ate);

  const porCliente = db.prepare(`
    SELECT c.id, c.nome,
      COALESCE((SELECT SUM(p.valor) FROM payments p WHERE p.client_id = c.id AND p.data_pagamento BETWEEN ? AND ?),0) recebido,
      COALESCE((SELECT SUM(i.valor - i.valor_pago) FROM installments i JOIN records r ON r.id = i.record_id WHERE i.client_id = c.id AND ${ABERTAS}),0) pendente,
      COALESCE((SELECT SUM(i.valor - i.valor_pago) FROM installments i JOIN records r ON r.id = i.record_id WHERE i.client_id = c.id AND ${ABERTAS} AND i.vencimento < ?),0) atrasado
    FROM clients c WHERE c.admin_id = ? ORDER BY pendente DESC, recebido DESC LIMIT 50`).all(de, ate, h, id)
    .filter(c => c.recebido || c.pendente);

  const agrupar = campo => db.prepare(`
    SELECT ${campo} chave, COUNT(*) registros, COALESCE(SUM(total),0) total, COALESCE(SUM(acrescimo),0) acrescimo,
      COALESCE((SELECT SUM(p.valor) FROM payments p JOIN records r2 ON r2.id = p.record_id WHERE r2.${campo} = records.${campo} AND r2.admin_id = ? AND p.data_pagamento BETWEEN ? AND ?),0) recebido
    FROM records WHERE admin_id = ? AND status <> 'cancelado' GROUP BY ${campo} ORDER BY total DESC LIMIT 30`).all(id, de, ate, id);

  const porForma = db.prepare(`SELECT forma chave, COUNT(*) n, COALESCE(SUM(valor),0) v FROM payments WHERE admin_id = ? AND data_pagamento BETWEEN ? AND ? GROUP BY forma ORDER BY v DESC`).all(id, de, ate);

  res.json({ de, ate, registrado, recebido, pendente, atrasado, previsto, acrescimos_ativos: acrescimosAtivos.v,
             por_periodo: porPeriodo, por_cliente: porCliente, por_descricao: agrupar('descricao'), por_frequencia: agrupar('frequencia'), por_forma: porForma });
});

// ── Configurações ───────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const c = getConfig(req.user.id);
  const sis = getConfig(0);
  res.json({ ...c, sistema_nome: sis.sistema_nome, suporte_contato: sis.suporte_contato,
             whatsapp_webhook_token: c.whatsapp_webhook_token ? '••••••' : '' });
});

router.put('/config', A.exigir('configuracoes'), (req, res) => {
  const b = { ...(req.body || {}) };
  delete b.sistema_nome; delete b.suporte_contato;
  if (b.whatsapp_webhook_token === '••••••') delete b.whatsapp_webhook_token;
  if ('dias_cobranca_padrao' in b) {
    let d = [];
    try { d = typeof b.dias_cobranca_padrao === 'string' ? JSON.parse(b.dias_cobranca_padrao) : b.dias_cobranca_padrao; } catch (e) {}
    d = [...new Set((Array.isArray(d) ? d : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    if (!d.length) return res.status(400).json({ erro: 'Marque pelo menos um dia da semana para cobrar.' });
    b.dias_cobranca_padrao = JSON.stringify(d);
  }
  for (const k of ['percentuais_padrao', 'formas_pagamento', 'descricoes_padrao']) {
    if (k in b) {
      try { const arr = typeof b[k] === 'string' ? JSON.parse(b[k]) : b[k]; if (!Array.isArray(arr)) throw 0; b[k] = JSON.stringify(arr.slice(0, 30)); }
      catch (e) { return res.status(400).json({ erro: 'Lista inválida em ' + k + '.' }); }
    }
  }
  setConfig(req.user.id, b);
  auditar(req, 'config_alterada', 'settings', null, Object.keys(b));
  res.json({ ok: true });
});

router.get('/modelos', (req, res) => {
  msg.garantirModelos(req.user.id);
  res.json({ modelos: db.prepare('SELECT tipo, titulo, texto FROM message_templates WHERE admin_id = ? ORDER BY id').all(req.user.id), variaveis: msg.VARIAVEIS });
});

router.put('/modelos/:tipo', A.exigir('configuracoes'), (req, res) => {
  const tipo = req.params.tipo;
  if (!msg.MODELOS_PADRAO[tipo]) return res.status(404).json({ erro: 'Modelo não encontrado.' });
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'O texto da mensagem não pode ficar vazio.' });
  msg.garantirModelos(req.user.id);
  db.prepare('UPDATE message_templates SET texto = ? WHERE admin_id = ? AND tipo = ?').run(texto.slice(0, 2000), req.user.id, tipo);
  auditar(req, 'modelo_alterado', 'message_templates', null, { tipo });
  res.json({ ok: true });
});

router.post('/modelos/:tipo/restaurar', A.exigir('configuracoes'), (req, res) => {
  const m = msg.MODELOS_PADRAO[req.params.tipo];
  if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });
  msg.garantirModelos(req.user.id);
  db.prepare('UPDATE message_templates SET texto = ? WHERE admin_id = ? AND tipo = ?').run(m.texto, req.user.id, req.params.tipo);
  res.json({ ok: true, texto: m.texto });
});

router.post('/modelos/previa', (req, res) => {
  const h = hoje();
  const exemplo = { nome: 'João da Silva', descricao: 'Compra de eletrodoméstico', numero: 2, qtd_parcelas: 4, valor: 280, valor_pago: 0,
                    ultimo_pagamento: 280, vencimento: req.body.tipo === 'atraso' ? addDias(h, -5) : req.body.tipo === 'antecipado' ? addDias(h, 1) : h,
                    empresa: getConfig(req.user.id).empresa_nome, pix: getConfig(req.user.id).pix_chave };
  res.json({ texto: msg.montar(String(req.body.texto || ''), exemplo, h) });
});

router.post('/whatsapp/teste', A.exigir('configuracoes'), async (req, res) => {
  const r = await whatsapp.enviar(req.user.id, req.body.telefone, 'Teste do Controle Fácil: envio automático funcionando.');
  if (r.manual) return res.json({ ok: false, erro: 'O modo atual é manual. Escolha um provedor automático para testar.' });
  res.json(r);
});

module.exports = router;
