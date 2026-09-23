// src/services/whatsapp/index.js — camada de ENVIO
// Para trocar de provedor, basta criar um arquivo novo nesta pasta com a
// função enviar({ telefone, mensagem, config }) e registrá-lo em PROVEDORES.
const manual  = require('./whatsapp-manual');
const webhook = require('./whatsapp-webhook');
const { getConfig } = require('./util');

const PROVEDORES = { manual, webhook };

function normalizarFone(fone) {
  let d = String(fone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 ? d : '';
}

function link(fone, texto) {
  const n = normalizarFone(fone);
  const t = encodeURIComponent(texto || '');
  return n ? 'https://wa.me/' + n + '?text=' + t : 'https://wa.me/?text=' + t;
}

function provedorDoAdmin(adminId) {
  const cfg = getConfig(adminId);
  const nome = PROVEDORES[cfg.whatsapp_provedor] ? cfg.whatsapp_provedor : 'manual';
  return { nome, provedor: PROVEDORES[nome], cfg };
}

async function enviar(adminId, telefone, mensagem) {
  const { nome, provedor, cfg } = provedorDoAdmin(adminId);
  const numero = normalizarFone(telefone);
  if (!numero) return { ok: false, provedor: nome, erro: 'Cliente sem WhatsApp válido' };
  try {
    const r = await provedor.enviar({ telefone: numero, mensagem, config: cfg });
    return { provedor: nome, ...r };
  } catch (e) {
    return { ok: false, provedor: nome, erro: e.message };
  }
}

module.exports = { enviar, link, normalizarFone, provedorDoAdmin, PROVEDORES };
