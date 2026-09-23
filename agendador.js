// src/services/agendador.js — camada de AGENDAMENTO
// Decide QUAIS lembretes precisam sair e QUANDO. A montagem do texto fica em
// mensagens.js e o envio em whatsapp/. Assim cada parte pode mudar sozinha.
const { db } = require('./db');
const { hoje, diffDias, addDias, getConfig, agoraISO, TZ } = require('./util');
const msg = require('./mensagens');
const whatsapp = require('./whatsapp');

function ligado(v) { return String(v) === '1' || v === true; }

function gerarLembretes(adminId, ref = hoje()) {
  const cfg = getConfig(adminId);
  const ins = db.prepare(`INSERT OR IGNORE INTO reminders
    (admin_id, installment_id, client_id, tipo, regra, data_envio, mensagem, telefone, status, erro)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const parcelas = db.prepare(`
    SELECT i.*, r.descricao, r.qtd_parcelas, r.frequencia, c.nome, c.whatsapp, c.telefone AS fone_cli
    FROM installments i
    JOIN records r ON r.id = i.record_id AND r.status = 'ativo'
    JOIN clients c ON c.id = i.client_id
    WHERE i.admin_id = ? AND i.status IN ('pendente','parcial') AND i.vencimento <= ?
    ORDER BY i.record_id, i.vencimento`).all(adminId, addDias(ref, 7));

  const extra = { empresa: cfg.empresa_nome, pix: cfg.pix_chave };
  const criar = (p, tipo, regra) => {
    const texto = msg.montar(msg.obterModelo(adminId, tipo), { ...p, ...extra }, ref);
    const fone = whatsapp.normalizarFone(p.whatsapp || p.fone_cli);
    ins.run(adminId, p.id, p.client_id, tipo, regra, ref, texto, fone || null,
            fone ? 'pendente' : 'ignorado', fone ? null : 'Cliente sem WhatsApp');
  };

  const atrasoFeito = new Set();
  const intervalo = Math.max(1, Number(cfg.lembrete_atraso_intervalo) || 1);
  const maximo = Math.max(1, Number(cfg.lembrete_atraso_max) || 30);

  db.transaction(() => {
    for (const p of parcelas) {
      const faltam = diffDias(ref, p.vencimento);
      const diario = p.frequencia === 'diario';

      if (faltam > 0) {
        if (diario) continue; // parcelas diárias: só no dia e em atraso
        if (faltam === 7 && ligado(cfg.lembrete_7d)) criar(p, 'antecipado', 'antes_7');
        if (faltam === 3 && ligado(cfg.lembrete_3d)) criar(p, 'antecipado', 'antes_3');
        if (faltam === 1 && ligado(cfg.lembrete_1d)) criar(p, 'antecipado', 'antes_1');
      } else if (faltam === 0) {
        if (diario ? ligado(cfg.lembrete_diario) : ligado(cfg.lembrete_hoje)) criar(p, 'hoje', 'no_dia');
      } else if (ligado(cfg.lembrete_atraso) && !atrasoFeito.has(p.record_id)) {
        // um lembrete de atraso por registro: sempre da parcela mais antiga em aberto
        atrasoFeito.add(p.record_id);
        const dias = -faltam;
        if (dias <= maximo && (dias - 1) % intervalo === 0) criar(p, 'atraso', 'atraso');
      }
    }
    // Limpeza: parcelas já pagas/canceladas e lembretes manuais antigos não enviados
    db.prepare(`UPDATE reminders SET status = 'ignorado', erro = 'Parcela quitada ou cancelada'
                WHERE admin_id = ? AND status = 'pendente'
                  AND installment_id IN (SELECT id FROM installments WHERE status IN ('pago','cancelado'))`).run(adminId);
    db.prepare(`UPDATE reminders SET status = 'ignorado', erro = 'Não enviado no dia'
                WHERE admin_id = ? AND status = 'pendente' AND data_envio < ?`).run(adminId, addDias(ref, -2));
  })();
}

function horaBR() {
  return Number(new Date().toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).slice(0, 2));
}

async function enviarPendentes(adminId, ref = hoje()) {
  const { provedor } = whatsapp.provedorDoAdmin(adminId);
  if (!provedor.automatico) return 0;
  const h = horaBR();
  if (h < 8 || h >= 20) return 0; // envio automático só em horário comercial
  const lista = db.prepare(`SELECT * FROM reminders WHERE admin_id = ? AND status = 'pendente' AND data_envio <= ? LIMIT 200`).all(adminId, ref);
  let enviados = 0;
  for (const r of lista) {
    const res = await whatsapp.enviar(adminId, r.telefone, r.mensagem);
    if (res.manual) break;
    db.prepare(`UPDATE reminders SET status = ?, provedor = ?, erro = ?, enviado_em = ? WHERE id = ?`)
      .run(res.ok ? 'enviado' : 'falhou', res.provedor, res.ok ? null : res.erro, agoraISO(), r.id);
    if (res.ok) enviados++;
  }
  return enviados;
}

let rodando = false;
async function ciclo() {
  if (rodando) return;
  rodando = true;
  try {
    const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND ativo = 1`).all();
    for (const a of admins) {
      gerarLembretes(a.id);
      await enviarPendentes(a.id);
    }
  } catch (e) { console.error('agendador:', e.message); }
  finally { rodando = false; }
}

function iniciar() {
  setTimeout(ciclo, 5000);
  setInterval(ciclo, 15 * 60 * 1000);
}

module.exports = { gerarLembretes, enviarPendentes, ciclo, iniciar };
