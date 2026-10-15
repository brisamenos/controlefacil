// telegram.js — envio do backup para um bot do Telegram (manual e automático)
const { getConfig, setConfig, TZ } = require('./util');
const backup = require('./backup');

const API = process.env.TELEGRAM_API || 'https://api.telegram.org';

function cfg() {
  const c = getConfig(0);
  return { token: String(c.telegram_token || '').trim(), chat: String(c.telegram_chat_id || '').trim(),
           ativo: c.telegram_ativo === '1', frequencia: c.telegram_frequencia || 'diario',
           hora: Math.min(23, Math.max(0, Number(c.telegram_hora) || 0)),
           ultimo: c.telegram_ultimo_envio, status: c.telegram_ultimo_status };
}

async function chamar(token, metodo, corpo) {
  if (!/^\d+:[\w-]{20,}$/.test(token)) throw new Error('Token do bot inválido. Ele tem o formato 123456789:ABC...');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(API + '/bot' + token + '/' + metodo, { method: 'POST', body: corpo, signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'O Telegram demorou para responder.' : 'Não foi possível falar com o Telegram.');
  } finally { clearTimeout(t); }
  const j = await res.json().catch(() => ({}));
  if (!j.ok) {
    const d = String(j.description || '');
    if (res.status === 401) throw new Error('Token do bot incorreto.');
    if (/chat not found/i.test(d)) throw new Error('ID do chat não encontrado. Mande uma mensagem para o bot e use "Descobrir meu ID".');
    if (/bot was blocked/i.test(d)) throw new Error('O bot foi bloqueado nesse chat. Desbloqueie e tente de novo.');
    if (/too big/i.test(d)) throw new Error('O backup passou do limite de 50 MB do Telegram.');
    throw new Error('Telegram: ' + (d || 'erro ' + res.status));
  }
  return j.result;
}

const json = o => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.append(k, String(v))); return f; };

async function testar(token, chat) {
  const bot = await chamar(token, 'getMe', json({}));
  await chamar(token, 'sendMessage', json({ chat_id: chat, text: '✅ Controle Fácil conectado. Os backups serão enviados aqui.' }));
  return { bot: bot.username };
}

// Lista os chats que mandaram mensagem ao bot (para achar o ID sem complicação)
async function descobrir(token) {
  const upd = await chamar(token, 'getUpdates', json({ limit: 50 }));
  const chats = {};
  for (const u of upd) {
    const m = u.message || u.channel_post || u.my_chat_member || u.edited_message;
    const c = m && m.chat;
    if (c) chats[c.id] = { id: String(c.id), nome: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || 'Chat', tipo: c.type };
  }
  return Object.values(chats);
}

let enviando = false;
async function enviarBackup(origem = 'manual') {
  const c = cfg();
  if (!c.token || !c.chat) throw new Error('Configure o token do bot e o ID do chat primeiro.');
  if (enviando) throw new Error('Já existe um envio em andamento. Aguarde um instante.');
  enviando = true;
  try {
    const b = await backup.criarCompactado();
    const r = backup.resumoAtual();
    const quando = new Date().toLocaleString('pt-BR', { timeZone: TZ });
    const f = new FormData();
    f.append('chat_id', c.chat);
    f.append('caption', `🗄️ Backup ${origem === 'automatico' ? 'automático' : 'manual'} — Controle Fácil\n${quando}\n` +
      `${r.administradores} administrador(es) · ${r.clientes} cliente(s) · ${r.registros} registro(s) · ${r.pagamentos} pagamento(s)\n\n` +
      'Para restaurar: Sistema → Importar backup.');
    f.append('document', new Blob([b.dados], { type: 'application/gzip' }), b.nome);
    await chamar(c.token, 'sendDocument', f);
    setConfig(0, { telegram_ultimo_envio: new Date().toISOString(), telegram_ultimo_status: 'ok|' + origem + '|' + b.nome });
    return { arquivo: b.nome, tamanho: b.dados.length };
  } catch (e) {
    setConfig(0, { telegram_ultimo_status: 'erro|' + origem + '|' + e.message });
    throw e;
  } finally { enviando = false; }
}

function horaLocal() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { dia: p.year + '-' + p.month + '-' + p.day, hora: Number(p.hour) % 24 };
}

// Decide se está na hora do envio automático
function estaNaHora(c, agora = Date.now()) {
  const ultimo = c.ultimo ? new Date(c.ultimo).getTime() : 0;
  const horas = (agora - ultimo) / 3600000;
  if (c.frequencia === '6h') return horas >= 6;
  if (c.frequencia === '12h') return horas >= 12;
  const h = horaLocal();
  const ultimoDia = c.ultimo ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(c.ultimo)) : '';
  if (c.frequencia === 'semanal') return h.hora >= c.hora && horas >= 24 * 7 - 1;
  return h.hora >= c.hora && ultimoDia !== h.dia; // diário
}

let falhas = 0, esperarAte = 0;
async function verificar() {
  const c = cfg();
  if (!c.ativo || !c.token || !c.chat || Date.now() < esperarAte || !estaNaHora(c)) return;
  try {
    await enviarBackup('automatico');
    falhas = 0;
  } catch (e) {
    falhas++;
    esperarAte = Date.now() + Math.min(60, 10 * falhas) * 60000; // tenta de novo em 10, 20... até 60 min
    console.error('backup telegram:', e.message);
  }
}

function iniciar() {
  setTimeout(verificar, 90 * 1000);
  setInterval(verificar, 5 * 60 * 1000);
}

module.exports = { cfg, testar, descobrir, enviarBackup, estaNaHora, iniciar };
