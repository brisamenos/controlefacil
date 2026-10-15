/* core.js — acesso à API, formatação e componentes básicos */
'use strict';

const Sessao = {
  get token() { return localStorage.getItem('cf_token') || sessionStorage.getItem('cf_token'); },
  get usuario() { try { return JSON.parse(localStorage.getItem('cf_usuario') || sessionStorage.getItem('cf_usuario')); } catch (e) { return null; } },
  salvar(token, usuario, lembrar) {
    this.limpar();
    const s = lembrar ? localStorage : sessionStorage;
    s.setItem('cf_token', token);
    s.setItem('cf_usuario', JSON.stringify(usuario));
  },
  atualizarUsuario(u) {
    const s = localStorage.getItem('cf_token') ? localStorage : sessionStorage;
    s.setItem('cf_usuario', JSON.stringify(u));
  },
  limpar() { ['cf_token', 'cf_usuario'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); },
};

async function api(caminho, opcoes = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (Sessao.token) headers.Authorization = 'Bearer ' + Sessao.token;
  let res;
  try {
    res = await fetch('/api' + caminho, { method: opcoes.method || 'GET', headers, body: opcoes.body ? JSON.stringify(opcoes.body) : undefined });
  } catch (e) {
    throw new Error('Sem conexão com o servidor. Verifique a internet.');
  }
  let dados = {};
  try { dados = await res.json(); } catch (e) {}
  if (res.status === 401 && dados.auth) {
    Sessao.limpar();
    toast(dados.erro || 'Entre novamente.', 'erro');
    setTimeout(() => { location.hash = ''; location.reload(); }, 600);
    throw new Error(dados.erro || 'Sessão encerrada.');
  }
  if (!res.ok) throw new Error(dados.erro || 'Erro ' + res.status);
  return dados;
}
const GET = c => api(c);
const POST = (c, b) => api(c, { method: 'POST', body: b || {} });
const PUT = (c, b) => api(c, { method: 'PUT', body: b || {} });
const DEL = (c, b) => api(c, { method: 'DELETE', body: b || {} });

/* ── Formatação ─────────────────────────────────────────── */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moeda = n => 'R$ ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moedaCurta = n => { n = Number(n) || 0; return n >= 10000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : moeda(n); };
const dataBR = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d + '/' + m + '/' + y; };
const dataCurta = iso => { if (!iso) return ''; const [, m, d] = String(iso).slice(0, 10).split('-'); return d + '/' + m; };
const dataHora = s => { if (!s) return '—'; const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
function hojeISO() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); }
function somaDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function lerMoeda(v) {
  let s = String(v == null ? '' : v).trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return Math.round((parseFloat(s) || 0) * 100) / 100;
}
function lerNumero(v) { return parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')) || 0; }
const pct = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
const FREQ = { diario: 'Diário', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', personalizado: 'Personalizado' };
const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function selo(sit) {
  if (!sit) return '';
  const t = sit.codigo === 'atrasado' ? sit.texto + ' · ' + sit.dias_atraso + (sit.dias_atraso === 1 ? ' dia' : ' dias') : sit.texto;
  return '<span class="selo s-' + sit.codigo + '">' + esc(t) + '</span>';
}

/* ── Ícones (traço simples) ─────────────────────────────── */
const I = {
  inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  cobrar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>',
  clientes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/></svg>',
  mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  fin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 9h-6a3 3 0 0 0 0 6h6z"/><circle cx="15.5" cy="12" r=".6" fill="currentColor"/></svg>',
  rel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  voltar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  admins: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  sino: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};

/* ── Avisos rápidos ─────────────────────────────────────── */
function toast(texto, tipo) {
  const el = document.createElement('div');
  el.className = 'toast' + (tipo ? ' ' + tipo : '');
  el.textContent = texto;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 5000 : 3000);
}
function falha(e) { toast(e && e.message ? e.message : String(e), 'erro'); }

/* ── Janela modal ───────────────────────────────────────── */
function abrirModal({ titulo, subtitulo, corpo, rodape, largo, aoAbrir }) {
  fecharModal();
  const f = document.createElement('div');
  f.className = 'fundo-modal';
  f.id = 'modal-atual';
  f.innerHTML = '<div class="modal' + (largo ? ' largo' : '') + '" role="dialog" aria-modal="true">' +
    '<div class="modal-cab"><div><h2>' + esc(titulo) + '</h2>' + (subtitulo ? '<p>' + subtitulo + '</p>' : '') + '</div>' +
    '<button class="modal-fechar" aria-label="Fechar" data-fechar>×</button></div>' +
    '<div class="modal-corpo">' + (corpo || '') + '</div>' +
    (rodape ? '<div class="modal-rodape">' + rodape + '</div>' : '') + '</div>';
  f.addEventListener('mousedown', e => { if (e.target === f) fecharModal(); });
  f.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fecharModal));
  document.body.appendChild(f);
  document.body.style.overflow = 'hidden';
  const primeiro = f.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea, select');
  if (primeiro && window.innerWidth > 640) setTimeout(() => primeiro.focus(), 50);
  if (aoAbrir) aoAbrir(f);
  return f;
}
function fecharModal() {
  const m = document.getElementById('modal-atual');
  if (m) m.remove();
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

function confirmar(titulo, texto, botao = 'Confirmar', perigo) {
  return new Promise(resolve => {
    const m = abrirModal({
      titulo, corpo: '<p style="margin:0">' + texto + '</p>',
      rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn ' + (perigo ? 'btn-perigo' : '') + '" id="conf-ok">' + esc(botao) + '</button>',
    });
    let ok = false;
    m.querySelector('#conf-ok').onclick = () => { ok = true; fecharModal(); resolve(true); };
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!ok) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

function pedirTexto(titulo, rotulo, botao = 'Confirmar', perigo) {
  return new Promise(resolve => {
    const m = abrirModal({
      titulo, corpo: '<div class="campo"><label>' + esc(rotulo) + '</label><input class="entrada" id="pt-v"></div>',
      rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn ' + (perigo ? 'btn-perigo' : '') + '" id="pt-ok">' + esc(botao) + '</button>',
    });
    let feito = false;
    const ir = () => { const v = m.querySelector('#pt-v').value.trim(); if (!v) { toast('Preencha o campo.', 'erro'); return; } feito = true; fecharModal(); resolve(v); };
    m.querySelector('#pt-ok').onclick = ir;
    m.querySelector('#pt-v').addEventListener('keydown', e => { if (e.key === 'Enter') ir(); });
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!feito) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}

function formDados(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach(i => { o[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
  return o;
}

function carregando(el) { el.innerHTML = '<div class="carregando">Carregando…</div>'; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function parametros() { const q = location.hash.split('?')[1] || ''; return Object.fromEntries(new URLSearchParams(q)); }
