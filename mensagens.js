// src/services/mensagens.js — modelos de mensagem e montagem do texto
// Módulo isolado: só transforma dados em texto.
const { db } = require('./db');
const { dataBR, moeda, diffDias, hoje } = require('./util');

const MODELOS_PADRAO = {
  antecipado: {
    titulo: 'Lembrete antecipado',
    texto: 'Olá, {nome}! Tudo bem?\n\nPassando para lembrar que a parcela {parcela} de {descricao}, no valor de {valor}, vence {quando}, dia {vencimento}.\n\nCaso já tenha realizado o pagamento, desconsidere esta mensagem.\n\nObrigado!',
  },
  hoje: {
    titulo: 'Vencimento hoje',
    texto: 'Olá, {nome}! Tudo bem?\n\nLembrando que a parcela {parcela} de {descricao}, no valor de {valor}, vence hoje ({vencimento}).\n\nCaso já tenha realizado o pagamento, desconsidere esta mensagem.\n\nObrigado!',
  },
  atraso: {
    titulo: 'Cobrança em atraso',
    texto: 'Olá, {nome}! Tudo bem?\n\nIdentificamos que a parcela {parcela} de {descricao}, no valor de {valor}, venceu em {vencimento} e está em aberto há {dias_atraso} dia(s).\n\nPodemos combinar o pagamento? Caso já tenha pago, desconsidere esta mensagem.',
  },
  confirmacao: {
    titulo: 'Confirmação de pagamento',
    texto: 'Olá, {nome}! Recebemos o seu pagamento de {valor_pago} referente à parcela {parcela} de {descricao}.\n\nMuito obrigado!',
  },
};

const VARIAVEIS = ['{nome}', '{valor}', '{vencimento}', '{descricao}', '{parcela}', '{dias_atraso}', '{quando}', '{valor_pago}', '{restante}', '{empresa}', '{pix}'];

function garantirModelos(adminId) {
  const ins = db.prepare('INSERT OR IGNORE INTO message_templates (admin_id, tipo, titulo, texto) VALUES (?, ?, ?, ?)');
  for (const [tipo, m] of Object.entries(MODELOS_PADRAO)) ins.run(adminId, tipo, m.titulo, m.texto);
}

function obterModelo(adminId, tipo) {
  const m = db.prepare('SELECT texto FROM message_templates WHERE admin_id = ? AND tipo = ?').get(adminId, tipo);
  return m ? m.texto : MODELOS_PADRAO[tipo].texto;
}

function quando(venc, ref) {
  const d = diffDias(ref, venc);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d > 1) return 'em ' + d + ' dias';
  return 'há ' + Math.abs(d) + ' dias';
}

// dados: { nome, descricao, numero, qtd_parcelas, valor, valor_pago, vencimento, empresa, pix }
function montar(texto, dados, ref = hoje()) {
  const restante = Math.max(0, Number(dados.valor) - Number(dados.valor_pago || 0));
  const atraso = Math.max(0, diffDias(dados.vencimento, ref));
  const primeiroNome = String(dados.nome || '').trim().split(/\s+/)[0] || '';
  const mapa = {
    '{nome}': primeiroNome,
    '{valor}': moeda(dados.status === 'parcial' ? restante : dados.valor),
    '{vencimento}': dataBR(dados.vencimento),
    '{descricao}': dados.descricao || '',
    '{parcela}': dados.qtd_parcelas ? dados.numero + '/' + dados.qtd_parcelas : String(dados.numero || ''),
    '{dias_atraso}': String(atraso),
    '{quando}': quando(dados.vencimento, ref),
    '{valor_pago}': moeda(dados.ultimo_pagamento != null ? dados.ultimo_pagamento : dados.valor_pago),
    '{restante}': moeda(restante),
    '{empresa}': dados.empresa || '',
    '{pix}': dados.pix || '',
  };
  return String(texto).replace(/\{[a-z_]+\}/g, v => (v in mapa ? mapa[v] : v));
}

// Busca tudo que a mensagem precisa a partir da parcela
function dadosDaParcela(installmentId, adminId) {
  const { getConfig } = require('./util');
  const p = db.prepare(`
    SELECT i.*, r.descricao, r.qtd_parcelas, c.nome, c.whatsapp, c.telefone
    FROM installments i JOIN records r ON r.id = i.record_id JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND i.admin_id = ?`).get(installmentId, adminId);
  if (!p) return null;
  const cfg = getConfig(adminId);
  return { ...p, empresa: cfg.empresa_nome, pix: cfg.pix_chave, fone: p.whatsapp || p.telefone };
}

function tipoPorData(venc, ref = hoje()) {
  const d = diffDias(ref, venc);
  return d > 0 ? 'antecipado' : d === 0 ? 'hoje' : 'atraso';
}

module.exports = { MODELOS_PADRAO, VARIAVEIS, garantirModelos, obterModelo, montar, dadosDaParcela, tipoPorData };
