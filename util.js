// src/util.js — datas no fuso do Brasil, dinheiro, auditoria e configurações
const { db } = require('./db');

const TZ = 'America/Sao_Paulo';

function hoje() { return new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); }
function agoraISO() { return new Date().toISOString(); }
function addDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDias(a, b) { // b - a, em dias
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}
function dataBR(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d + '/' + m + '/' + y;
}
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function moeda(n) {
  return 'R$ ' + r2(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function isoValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T12:00:00Z')); }

// Status exibido de uma parcela (calculado na hora, nunca fica desatualizado)
function statusParcela(p, ref = hoje()) {
  if (p.status === 'pago') return { codigo: 'pago', texto: 'Pago', dias_atraso: 0 };
  if (p.status === 'cancelado') return { codigo: 'cancelado', texto: 'Cancelado', dias_atraso: 0 };
  const atraso = diffDias(p.vencimento, ref);
  const parcial = p.status === 'parcial';
  if (atraso > 0) return { codigo: 'atrasado', texto: parcial ? 'Parcial e atrasado' : 'Atrasado', dias_atraso: atraso, parcial };
  if (atraso === 0) return { codigo: 'hoje', texto: parcial ? 'Parcial, vence hoje' : 'Vence hoje', dias_atraso: 0, parcial };
  return { codigo: parcial ? 'parcial' : 'futuro', texto: parcial ? 'Parcialmente pago' : 'Vencimento futuro', dias_atraso: 0, parcial };
}

function ipDe(req) {
  return ((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || req.ip || null;
}

function auditar(req, acao, entidade, entidadeId, detalhes, adminId) {
  try {
    const u = req.user || {};
    db.prepare(`INSERT INTO audit_logs (user_id, user_nome, admin_id, acao, entidade, entidade_id, detalhes, ip)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(u.id || null, u.nome || null,
           adminId !== undefined ? adminId : (u.role === 'admin' ? u.id : null),
           acao, entidade || null, entidadeId || null, detalhes ? JSON.stringify(detalhes) : null, ipDe(req));
  } catch (e) { console.error('auditoria:', e.message); }
}

// Configurações por administrador
const PADRAO = {
  percentuais_padrao: '[10,12,15,20]',
  formas_pagamento: '["Dinheiro","Pix","Transferência","Cartão","Outro"]',
  descricoes_padrao: '["Compra","Dívida","Produto","Eletrodoméstico","Serviço","Acordo","Outro"]',
  lembrete_7d: '0', lembrete_3d: '1', lembrete_1d: '1', lembrete_hoje: '1',
  lembrete_atraso: '1', lembrete_atraso_intervalo: '3', lembrete_atraso_max: '30',
  lembrete_diario: '1',
  whatsapp_provedor: 'manual', whatsapp_webhook_url: '', whatsapp_webhook_token: '',
  empresa_nome: '', empresa_documento: '', empresa_telefone: '', empresa_endereco: '',
  pix_chave: '',
  sistema_nome: 'Controle Fácil', suporte_contato: '',
};
function getConfig(adminId) {
  const out = { ...PADRAO };
  db.prepare('SELECT chave, valor FROM settings WHERE admin_id = ?').all(adminId).forEach(r => { out[r.chave] = r.valor; });
  return out;
}
function setConfig(adminId, obj) {
  const st = db.prepare(`INSERT INTO settings (admin_id, chave, valor) VALUES (?, ?, ?)
                         ON CONFLICT(admin_id, chave) DO UPDATE SET valor = excluded.valor`);
  db.transaction(() => { for (const k of Object.keys(obj)) if (k in PADRAO) st.run(adminId, k, String(obj[k] ?? '')); })();
}

module.exports = { hoje, agoraISO, addDias, diffDias, dataBR, r2, moeda, isoValida, statusParcela, auditar, ipDe, getConfig, setConfig, TZ };
