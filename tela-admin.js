/* admin.js — telas do administrador */
'use strict';

const Admin = {};
let CFG = null; // configurações do admin (percentuais, formas, descrições)

async function carregarConfig(forcar) {
  if (!CFG || forcar) {
    const c = await GET('/config');
    const lista = (v, pad) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : pad; } catch (e) { return pad; } };
    c.percentuais = lista(c.percentuais_padrao, [10, 12, 15, 20]);
    c.formas = lista(c.formas_pagamento, ['Dinheiro', 'Pix', 'Transferência', 'Cartão', 'Outro']);
    c.descricoes = lista(c.descricoes_padrao, ['Compra', 'Dívida', 'Produto', 'Serviço', 'Acordo', 'Outro']);
    c.dias_cobranca = lista(c.dias_cobranca_padrao, [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(n => n >= 0 && n <= 6);
    if (!c.dias_cobranca.length) c.dias_cobranca = [0, 1, 2, 3, 4, 5, 6];
    CFG = c;
  }
  return CFG;
}
const pode = p => { const u = Sessao.usuario; return !!(u && u.permissoes && u.permissoes[p]); };

/* ── Seletor de dias de cobrança (caixinhas) ────────────── */
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ATALHOS_DIAS = [
  { t: 'Todos os dias', d: [0, 1, 2, 3, 4, 5, 6] },
  { t: 'Sem domingo', d: [1, 2, 3, 4, 5, 6] },
  { t: 'Sem fim de semana', d: [1, 2, 3, 4, 5] },
];
function textoDias(dias, curto) {
  const k = [...dias].sort().join(',');
  const nomes = curto ? { '0,1,2,3,4,5,6': 'todos os dias', '1,2,3,4,5,6': 'segunda a sábado', '1,2,3,4,5': 'segunda a sexta' }
    : { '0,1,2,3,4,5,6': 'todos os dias', '1,2,3,4,5,6': 'de segunda a sábado (sem domingo)', '1,2,3,4,5': 'de segunda a sexta (sem fim de semana)' };
  if (nomes[k]) return nomes[k];
  if (!dias.length) return '';
  const lista = [...dias].sort().map(d => DIAS_CURTOS[d].toLowerCase());
  return lista.length === 1 ? 'só às ' + lista[0] : lista.slice(0, -1).join(', ') + ' e ' + lista.at(-1);
}
function seletorDias(box, diasIniciais, aoMudar) {
  let dias = [...new Set(diasIniciais)].sort();
  const desenhar = () => {
    const k = dias.join(',');
    box.innerHTML = `<div class="dias-atalhos">${ATALHOS_DIAS.map((a, i) => `<button type="button" data-at="${i}" class="${a.d.join(',') === k ? 'sel' : ''}">${a.t}</button>`).join('')}</div>
      <div class="dias-semana" role="group" aria-label="Dias de cobrança">${DIAS_CURTOS.map((n, i) => `<label class="dia-sem ${dias.includes(i) ? 'on' : ''} ${i === 0 || i === 6 ? 'fds' : ''}">
        <input type="checkbox" data-dia="${i}" ${dias.includes(i) ? 'checked' : ''}><span class="marca-dia">${I.ok}</span>${n}</label>`).join('')}</div>
      <div class="dias-resumo">${dias.length ? 'Cobra <b>' + textoDias(dias) + '</b>.' : '<span style="color:var(--margem)">Marque pelo menos um dia.</span>'}</div>`;
    box.querySelectorAll('[data-at]').forEach(b => b.onclick = () => { dias = [...ATALHOS_DIAS[b.dataset.at].d]; desenhar(); aoMudar && aoMudar(dias); });
    box.querySelectorAll('[data-dia]').forEach(c => c.onchange = () => {
      const d = Number(c.dataset.dia);
      dias = c.checked ? [...dias, d].sort() : dias.filter(x => x !== d);
      desenhar(); aoMudar && aoMudar(dias);
    });
  };
  desenhar();
  return { valor: () => [...dias] };
}

/* ── Linha de cobrança reutilizável ─────────────────────── */
function linhaCobranca(p, opc = {}) {
  const aberta = p.status === 'pendente' || p.status === 'parcial';
  const ativa = !p.registro_status || p.registro_status === 'ativo';
  const valor = p.status === 'parcial' ? p.valor - p.valor_pago : p.valor;
  return `<div class="item">
    <div style="min-width:0">
      <div class="item-titulo"><a href="#/cliente/${p.client_id}" style="color:inherit;text-decoration:none">${esc(p.cliente)}</a></div>
      <div class="item-sub"><span>${esc(p.descricao)} · ${p.numero}/${p.qtd_parcelas}</span><span>${dataBR(p.vencimento)}</span>${selo(p.situacao)}</div>
    </div>
    <div class="item-valor">${moeda(valor)}${p.status === 'parcial' ? `<div class="muted" style="font-size:12px;font-family:var(--f-texto);font-weight:500">de ${moeda(p.valor)}</div>` : ''}</div>
    ${aberta && ativa && !opc.semAcoes ? `<div class="item-acoes">
      ${pode('pagamentos') ? `<button class="btn btn-p btn-verde" onclick="receber(${p.id}, ${p.valor - p.valor_pago})">${I.ok} Receber</button>` : ''}
      ${pode('whatsapp') ? `<button class="btn btn-p btn-zap" onclick="abrirZap(${p.id})">${I.zap} ${p.situacao.codigo === 'atrasado' ? 'Cobrar' : 'Lembrete'}</button>` : ''}
    </div>` : ''}
    ${p.status === 'pago' && opc.mostrarPago ? `<div class="item-acoes"><button class="btn btn-p btn-claro" onclick="verPagamentos(${p.id})">Ver pagamento</button></div>` : ''}
  </div>`;
}

/* ── Registrar pagamento ─────────────────────────────────── */
async function receber(id, restante) {
  await carregarConfig();
  const formas = CFG.formas;
  const m = abrirModal({
    titulo: 'Registrar pagamento',
    subtitulo: 'Restante desta parcela: <b>' + moeda(restante) + '</b>',
    corpo: `
      <div class="campo"><label for="pg-valor">Valor pago</label><input class="entrada entrada-grande num" id="pg-valor" inputmode="decimal" value="${String(restante.toFixed(2)).replace('.', ',')}"></div>
      <div class="campo"><label for="pg-data">Data do pagamento</label><input class="entrada" id="pg-data" type="date" value="${hojeISO()}"></div>
      <div class="campo"><span class="rotulo">Forma de pagamento</span><div class="chips" id="pg-formas">${formas.map((f, i) => `<button type="button" class="chip${i === 0 ? ' sel' : ''}" data-v="${esc(f)}">${esc(f)}</button>`).join('')}</div></div>
      <div class="campo"><label for="pg-obs">Observação (opcional)</label><input class="entrada" id="pg-obs" placeholder="Ex.: pagou no balcão"></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn btn-verde" id="pg-ok">' + I.ok + ' Confirmar pagamento</button>',
  });
  m.querySelectorAll('#pg-formas .chip').forEach(c => c.onclick = () => { m.querySelectorAll('#pg-formas .chip').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); });
  m.querySelector('#pg-ok').onclick = async () => {
    const btn = m.querySelector('#pg-ok'); btn.disabled = true;
    try {
      const r = await POST('/parcelas/' + id + '/pagar', {
        valor: lerMoeda(m.querySelector('#pg-valor').value), data: m.querySelector('#pg-data').value,
        forma: (m.querySelector('#pg-formas .sel') || {}).dataset?.v || 'Dinheiro', observacao: m.querySelector('#pg-obs').value,
      });
      abrirModal({
        titulo: r.quitada ? 'Parcela paga' : 'Pagamento parcial registrado',
        corpo: `<p style="margin-top:0">${r.quitada ? 'A parcela foi marcada como paga.' : 'O valor foi abatido. A parcela continua em aberto com o restante.'}</p>
                ${pode('whatsapp') ? '<p class="rotulo">Confirmação para o cliente</p><div class="previa">' + esc(r.confirmacao.texto) + '</div>' : ''}`,
        rodape: '<button class="btn btn-claro" data-fechar>Fechar</button>' +
          (pode('whatsapp') ? `<a class="btn btn-zap" href="${esc(r.confirmacao.link)}" target="_blank" rel="noopener" onclick="setTimeout(fecharModal,300)">${I.zap} Enviar confirmação</a>` : ''),
      });
      toast('Pagamento registrado.', 'ok');
      App.recarregar();
    } catch (e) { falha(e); btn.disabled = false; }
  };
}

/* ── WhatsApp com mensagem pronta ───────────────────────── */
async function abrirZap(id, tipo) {
  let r;
  try { r = await GET('/parcelas/' + id + '/mensagem' + (tipo ? '?tipo=' + tipo : '')); } catch (e) { return falha(e); }
  const tipos = { antecipado: 'Antecipado', hoje: 'Vence hoje', atraso: 'Em atraso', confirmacao: 'Pagamento' };
  const m = abrirModal({
    titulo: 'Mensagem de WhatsApp',
    subtitulo: r.telefone ? 'Para +' + esc(r.telefone) : 'Cliente sem WhatsApp cadastrado: você vai escolher o contato no WhatsApp.',
    corpo: `<div class="segmentos" id="zt">${Object.entries(tipos).map(([k, v]) => `<button type="button" data-t="${k}" class="${k === r.tipo ? 'sel' : ''}">${v}</button>`).join('')}</div>
            <div class="campo mt"><label for="zt-txt">Texto (pode editar antes de enviar)</label><textarea class="entrada" id="zt-txt" rows="8">${esc(r.texto)}</textarea></div>`,
    rodape: `<button class="btn btn-claro" data-fechar>Voltar</button><a class="btn btn-zap" id="zt-ir" href="${esc(r.link)}" target="_blank" rel="noopener">${I.zap} Abrir WhatsApp</a>`,
  });
  const txt = m.querySelector('#zt-txt'), ir = m.querySelector('#zt-ir');
  let tipoAtual = r.tipo;
  const atualizar = () => { ir.href = 'https://wa.me/' + (r.telefone || '') + '?text=' + encodeURIComponent(txt.value); };
  txt.addEventListener('input', atualizar);
  m.querySelectorAll('#zt button').forEach(b => b.onclick = async () => {
    try {
      const n = await GET('/parcelas/' + id + '/mensagem?tipo=' + b.dataset.t);
      tipoAtual = n.tipo; txt.value = n.texto; atualizar();
      m.querySelectorAll('#zt button').forEach(x => x.classList.toggle('sel', x === b));
    } catch (e) { falha(e); }
  });
  ir.addEventListener('click', () => {
    POST('/parcelas/' + id + '/lembrete-enviado', { tipo: tipoAtual, texto: txt.value }).catch(() => {});
    setTimeout(() => { fecharModal(); App.recarregar(); }, 400);
  });
}

/* ── Ajustar parcela / ver pagamentos ───────────────────── */
function ajustarParcela(p) {
  const m = abrirModal({
    titulo: 'Ajustar parcela ' + p.numero,
    corpo: `<div class="linha-campos">
      <div class="campo"><label>Valor</label><input class="entrada num" id="aj-v" inputmode="decimal" value="${String(Number(p.valor).toFixed(2)).replace('.', ',')}"></div>
      <div class="campo"><label>Vencimento</label><input class="entrada" id="aj-d" type="date" value="${p.vencimento}"></div></div>
      ${p.valor_pago > 0 ? '<div class="aviso info">Já foi pago ' + moeda(p.valor_pago) + ' desta parcela.</div>' : ''}
      <small class="muted">O total do registro é recalculado com o novo valor.</small>`,
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn" id="aj-ok">Salvar ajuste</button>',
  });
  m.querySelector('#aj-ok').onclick = async () => {
    try {
      await PUT('/parcelas/' + p.id, { valor: lerMoeda(m.querySelector('#aj-v').value), vencimento: m.querySelector('#aj-d').value });
      fecharModal(); toast('Parcela ajustada.', 'ok'); App.recarregar();
    } catch (e) { falha(e); }
  };
}

async function verPagamentos(id) {
  let lista;
  try { lista = await GET('/parcelas/' + id + '/pagamentos'); } catch (e) { return falha(e); }
  const m = abrirModal({
    titulo: 'Pagamentos da parcela',
    corpo: lista.length ? '<div class="lista">' + lista.map(pg => `<div class="item">
        <div><div class="item-titulo">${moeda(pg.valor)} · ${esc(pg.forma)}</div>
        <div class="item-sub">Pago em ${dataBR(pg.data_pagamento)} · registrado ${dataHora(pg.registrado_em)} por ${esc(pg.registrado_por_nome || '—')}</div>
        ${pg.observacao ? '<div class="item-sub">' + esc(pg.observacao) + '</div>' : ''}</div>
        ${pode('pagamentos') ? `<div><button class="btn btn-p btn-perigo" data-estornar="${pg.id}">Estornar</button></div>` : ''}</div>`).join('') + '</div>'
      : '<div class="vazio">Nenhum pagamento nesta parcela.</div>',
    rodape: '<button class="btn btn-claro" data-fechar>Fechar</button>',
  });
  m.querySelectorAll('[data-estornar]').forEach(b => b.onclick = async () => {
    const motivo = await pedirTexto('Estornar pagamento', 'Motivo do estorno', 'Estornar', true);
    if (!motivo) return;
    try { await DEL('/parcelas/pagamentos/' + b.dataset.estornar, { motivo }); toast('Pagamento estornado.', 'ok'); App.recarregar(); }
    catch (e) { falha(e); }
  });
}

async function maisParcela(p) {
  const aberta = p.status === 'pendente' || p.status === 'parcial';
  const m = abrirModal({
    titulo: 'Parcela ' + p.numero + ' · ' + dataBR(p.vencimento),
    corpo: `<div class="grade" style="gap:8px">
      ${aberta && pode('registros') ? '<button class="btn btn-claro btn-grande" id="mp-aj">Ajustar valor ou data</button>' : ''}
      <button class="btn btn-claro btn-grande" id="mp-pg">Ver pagamentos</button>
      ${pode('whatsapp') ? '<button class="btn btn-claro btn-grande" id="mp-zap">' + I.zap + ' Mensagem de WhatsApp</button>' : ''}</div>`,
  });
  const on = (s, f) => { const b = m.querySelector(s); if (b) b.onclick = f; };
  on('#mp-aj', () => ajustarParcela(p));
  on('#mp-pg', () => verPagamentos(p.id));
  on('#mp-zap', () => abrirZap(p.id));
}

/* ── Caderneta de parcelas (tabela pautada) ─────────────── */
function caderneta(parcelas, opc = {}) {
  window.__parc = window.__parc || {};
  parcelas.forEach(p => { window.__parc[p.id] = p; });
  const linhas = parcelas.map(p => {
    const aberta = p.status === 'pendente' || p.status === 'parcial';
    const cls = p.status === 'pago' ? 'paga' : p.status === 'cancelado' ? 'cancelada' : '';
    return `<div class="caderneta-linha ${cls}">
      <div class="n">${p.numero}</div>
      <div class="c-venc num">${dataBR(p.vencimento)}</div>
      <div class="c-valor v num forte">${moeda(p.valor)}${p.status === 'parcial' ? ` <small class="muted" style="font-weight:500">(falta ${moeda(p.valor - p.valor_pago)})</small>` : ''}</div>
      <div class="c-status">${selo(p.situacao)}</div>
      <div class="acoes-linha">
        ${aberta && opc.ativo && pode('pagamentos') ? `<button class="btn btn-p btn-verde btn-icone" title="Registrar pagamento" onclick="receber(${p.id}, ${p.valor - p.valor_pago})">${I.ok}</button>` : ''}
        ${aberta && opc.ativo && pode('whatsapp') ? `<button class="btn btn-p btn-zap btn-icone" title="Enviar WhatsApp" onclick="abrirZap(${p.id})">${I.zap}</button>` : ''}
        <button class="btn btn-p btn-claro btn-icone" title="Mais opções" onclick="maisParcela(window.__parc[${p.id}])">⋯</button>
      </div></div>`;
  }).join('');
  const pago = parcelas.reduce((s, p) => s + p.valor_pago, 0);
  const total = parcelas.filter(p => p.status !== 'cancelado').reduce((s, p) => s + p.valor, 0);
  return `<div class="caderneta"><div class="caderneta-cab"><div class="n">Nº</div><div>Vencimento</div><div class="so-largo">Valor</div><div class="so-largo">Situação</div><div class="so-largo"></div></div>
    <div class="caderneta-rolagem">${linhas}</div>
    <div class="caderneta-rodape"><span>Pago ${moeda(pago)}</span><span>Total ${moeda(total)}</span></div></div>`;
}

/* ═══════════════════ INÍCIO ═══════════════════ */
Admin.inicio = async el => {
  carregando(el);
  const d = await GET('/dashboard');
  const c = d.cards, u = Sessao.usuario;
  const dataExt = new Date(d.hoje + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  el.innerHTML = `
    <div class="topo"><div><h1>Olá, ${esc((u.nome || '').split(' ')[0])}</h1><p>${dataExt}</p></div>
      ${pode('registros') ? `<a class="btn so-desktop" href="#/novo">${I.mais} Novo registro</a>` : ''}</div>
    <div class="faixa-hoje">
      <div><span>Para receber hoje</span><strong>${moeda(c.vence_hoje)}</strong><small>${c.qtd_hoje} ${c.qtd_hoje === 1 ? 'parcela' : 'parcelas'}</small></div>
      <div class="secundario"><span>Em atraso</span><strong>${moeda(c.total_atrasado)}</strong><small>${c.qtd_atrasadas} ${c.qtd_atrasadas === 1 ? 'parcela' : 'parcelas'}</small></div>
      <div class="secundario"><span>Recebido hoje</span><strong>${moeda(c.recebido_hoje)}</strong></div>
    </div>
    <div class="grade grade-3">
      <div class="indicador"><span>Clientes</span><strong>${c.clientes}</strong></div>
      <div class="indicador"><span>Total registrado</span><strong>${moeda(c.total_registrado)}</strong></div>
      <div class="indicador"><span>A receber</span><strong>${moeda(c.total_a_receber)}</strong></div>
      <div class="indicador bom"><span>Total recebido</span><strong>${moeda(c.total_recebido)}</strong></div>
      <div class="indicador"><span>Vence amanhã</span><strong>${moeda(c.vence_amanha)}</strong><small>${c.qtd_amanha} parcela(s)</small></div>
      <div class="indicador"><span>Próximos 7 dias</span><strong>${moeda(c.proximos_7)}</strong><small>${c.qtd_proximos_7} parcela(s)</small></div>
    </div>
    ${d.lembretes.length && pode('whatsapp') ? `<div class="painel mt"><div class="painel-topo"><h2>Lembretes para enviar</h2><small>${d.lembretes.length} pendente(s)</small></div>
      <div class="lista">${d.lembretes.map(l => `<div class="item"><div style="min-width:0"><div class="item-titulo">${esc(l.cliente)}</div>
        <div class="item-sub"><span>${esc(l.descricao)}</span><span>${{ antecipado: 'Lembrete antecipado', hoje: 'Vence hoje', atraso: 'Em atraso' }[l.tipo] || l.tipo}</span><span>venc. ${dataBR(l.vencimento)}</span></div></div>
        <div class="item-valor">${moeda(l.valor - l.valor_pago)}</div>
        <div class="item-acoes"><a class="btn btn-p btn-zap" href="${esc(l.link)}" target="_blank" rel="noopener" data-lemb="${l.id}">${I.zap} Enviar</a>
        <button class="btn btn-p btn-claro" data-ign="${l.id}">Dispensar</button></div></div>`).join('')}</div></div>` : ''}
    <div class="grade grade-2 mt">
      <div class="painel"><div class="painel-topo"><h2>Próximas cobranças</h2><a href="#/cobrancas?aba=proximas">Ver todas</a></div>
        <div class="lista">${d.proximas.length ? d.proximas.map(p => linhaCobranca(p)).join('') : '<div class="vazio">Nenhuma cobrança por vir.</div>'}</div></div>
      <div class="painel"><div class="painel-topo"><h2>Em atraso</h2><a href="#/cobrancas?aba=atrasadas">Ver todas</a></div>
        <div class="lista">${d.atrasadas.length ? d.atrasadas.map(p => linhaCobranca(p)).join('') : '<div class="vazio">Nenhuma parcela em atraso.</div>'}</div></div>
    </div>`;
  el.querySelectorAll('[data-lemb]').forEach(a => a.addEventListener('click', () => {
    POST('/lembretes/' + a.dataset.lemb + '/enviado').then(() => setTimeout(() => App.recarregar(), 500)).catch(() => {});
  }));
  el.querySelectorAll('[data-ign]').forEach(b => b.onclick = async () => {
    try { await POST('/lembretes/' + b.dataset.ign + '/ignorar'); App.recarregar(); } catch (e) { falha(e); }
  });
};

/* ═══════════════════ COBRANÇAS ═══════════════════ */
Admin.cobrancas = async el => {
  await carregarConfig();
  const q = parametros();
  const estado = { aba: q.aba || 'hoje', q: '', de: '', ate: '', status: '', descricao: '', forma: '' };
  const abas = { todas: 'Todas', hoje: 'Hoje', amanha: 'Amanhã', proximas: 'Próximas', atrasadas: 'Atrasadas', pagas: 'Pagas' };
  el.innerHTML = `
    <div class="topo"><div><h1>Cobranças</h1><p id="cb-resumo">&nbsp;</p></div></div>
    <div class="abas" id="cb-abas">${Object.entries(abas).map(([k, v]) => `<button data-a="${k}" class="${k === estado.aba ? 'sel' : ''}">${v}</button>`).join('')}</div>
    <div class="painel">
      <div style="display:flex;gap:8px"><div class="busca" style="flex:1">${I.busca}<input class="entrada" id="cb-q" placeholder="Buscar cliente, descrição ou telefone"></div>
        <button class="btn btn-claro" id="cb-fbtn">Filtros</button></div>
      <div class="filtros" id="cb-filtros" hidden>
        <div class="campo"><label>Vencimento de</label><input class="entrada" type="date" id="cb-de"></div>
        <div class="campo"><label>Até</label><input class="entrada" type="date" id="cb-ate"></div>
        <div class="campo"><label>Situação</label><select class="entrada" id="cb-status"><option value="">Todas</option><option value="futuro">Vencimento futuro</option><option value="hoje">Vence hoje</option><option value="atrasado">Atrasado</option><option value="parcial">Parcialmente pago</option><option value="pago">Pago</option><option value="cancelado">Cancelado</option></select></div>
        <div class="campo"><label>Descrição</label><input class="entrada" id="cb-desc" placeholder="Ex.: Compra"></div>
        <div class="campo"><label>Forma de pagamento</label><select class="entrada" id="cb-forma"><option value="">Todas</option>${CFG.formas.map(f => `<option>${esc(f)}</option>`).join('')}</select></div>
      </div>
      <div class="lista mt" id="cb-lista"></div>
    </div>`;
  const $ = s => el.querySelector(s);
  const buscar = async () => {
    const p = new URLSearchParams({ aba: estado.aba });
    ['q', 'de', 'ate', 'status', 'descricao', 'forma'].forEach(k => { if (estado[k]) p.set(k, estado[k]); });
    carregando($('#cb-lista'));
    try {
      const r = await GET('/parcelas?' + p);
      $('#cb-resumo').textContent = r.quantidade + (r.quantidade === 1 ? ' parcela · ' : ' parcelas · ') + moeda(r.total);
      const vazio = { hoje: 'Nada vence hoje.', amanha: 'Nada vence amanhã.', atrasadas: 'Nenhuma parcela em atraso.', pagas: 'Nenhuma parcela paga encontrada.' }[estado.aba] || 'Nenhuma parcela encontrada.';
      $('#cb-lista').innerHTML = r.parcelas.length ? r.parcelas.map(x => linhaCobranca(x, { mostrarPago: true })).join('') : `<div class="vazio">${vazio}</div>`;
    } catch (e) { falha(e); }
  };
  el.querySelectorAll('#cb-abas button').forEach(b => b.onclick = () => {
    estado.aba = b.dataset.a;
    el.querySelectorAll('#cb-abas button').forEach(x => x.classList.toggle('sel', x === b));
    buscar();
  });
  const abaSel = el.querySelector('#cb-abas .sel');
  if (abaSel) abaSel.parentElement.scrollLeft = abaSel.offsetLeft - 16;
  $('#cb-fbtn').onclick = () => { $('#cb-filtros').hidden = !$('#cb-filtros').hidden; };
  $('#cb-q').addEventListener('input', debounce(e => { estado.q = e.target.value.trim(); buscar(); }, 300));
  [['#cb-de', 'de'], ['#cb-ate', 'ate'], ['#cb-status', 'status'], ['#cb-forma', 'forma']].forEach(([s, k]) => $(s).addEventListener('change', e => { estado[k] = e.target.value; buscar(); }));
  $('#cb-desc').addEventListener('input', debounce(e => { estado.descricao = e.target.value.trim(); buscar(); }, 350));
  buscar();
};

/* ═══════════════════ CLIENTES ═══════════════════ */
function formCliente(c = {}) {
  return `<div class="campo"><label>Nome completo *</label><input class="entrada" name="nome" value="${esc(c.nome)}" autocomplete="off"></div>
    <div class="linha-campos">
      <div class="campo"><label>WhatsApp</label><input class="entrada" name="whatsapp" inputmode="tel" placeholder="(88) 99999-0000" value="${esc(c.whatsapp)}"></div>
      <div class="campo"><label>Telefone</label><input class="entrada" name="telefone" inputmode="tel" value="${esc(c.telefone)}"></div></div>
    <div class="campo"><label>CPF/CNPJ</label><input class="entrada" name="documento" inputmode="numeric" value="${esc(c.documento)}"></div>
    <div class="linha-campos">
      <div class="campo"><label>Endereço</label><input class="entrada" name="endereco" value="${esc(c.endereco)}"></div>
      <div class="campo"><label>Cidade</label><input class="entrada" name="cidade" value="${esc(c.cidade)}"></div></div>
    <div class="campo"><label>Observações</label><textarea class="entrada" name="observacoes" rows="3">${esc(c.observacoes)}</textarea></div>`;
}

function modalCliente(c, aoSalvar) {
  const m = abrirModal({
    titulo: c && c.id ? 'Editar cliente' : 'Novo cliente', corpo: formCliente(c || {}),
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn" id="cl-ok">Salvar cliente</button>',
  });
  m.querySelector('#cl-ok').onclick = async () => {
    const dados = formDados(m);
    try {
      const r = c && c.id ? await PUT('/clientes/' + c.id, dados) : await POST('/clientes', dados);
      fecharModal(); toast('Cliente salvo.', 'ok');
      aoSalvar && aoSalvar(c && c.id ? c.id : r.id, dados);
    } catch (e) { falha(e); }
  };
}

Admin.clientes = async el => {
  el.innerHTML = `<div class="topo"><div><h1>Clientes</h1><p id="cl-qtd">&nbsp;</p></div>
      ${pode('clientes') ? `<button class="btn" id="cl-novo">${I.mais} Novo cliente</button>` : ''}</div>
    <div class="painel"><div class="busca">${I.busca}<input class="entrada" id="cl-q" placeholder="Buscar por nome, CPF, telefone ou cidade"></div>
    <div class="lista mt" id="cl-lista"></div></div>`;
  const lista = el.querySelector('#cl-lista');
  const buscar = async q => {
    carregando(lista);
    try {
      const r = await GET('/clientes' + (q ? '?q=' + encodeURIComponent(q) : ''));
      el.querySelector('#cl-qtd').textContent = r.length + (r.length === 1 ? ' cliente' : ' clientes');
      lista.innerHTML = r.length ? r.map(c => `<div class="item clicavel" onclick="location.hash='#/cliente/${c.id}'">
        <div style="min-width:0"><div class="item-titulo">${esc(c.nome)}</div>
        <div class="item-sub">${c.whatsapp ? '<span>' + esc(c.whatsapp) + '</span>' : ''}${c.cidade ? '<span>' + esc(c.cidade) + '</span>' : ''}<span>${c.registros_ativos} ativo(s)</span>
        ${c.atrasado > 0 ? '<span class="selo s-atrasado">Atraso ' + moeda(c.atrasado) + '</span>' : ''}</div></div>
        <div class="item-valor">${c.pendente > 0 ? moeda(c.pendente) : '<span class="muted" style="font-size:14px;font-weight:500">Em dia</span>'}</div></div>`).join('')
        : `<div class="vazio">${q ? 'Nenhum cliente encontrado.' : 'Você ainda não cadastrou clientes.'}${!q && pode('clientes') ? '<br><button class="btn" onclick="document.getElementById(\'cl-novo\').click()">Cadastrar o primeiro cliente</button>' : ''}</div>`;
    } catch (e) { falha(e); }
  };
  const nb = el.querySelector('#cl-novo');
  if (nb) nb.onclick = () => modalCliente(null, id => { location.hash = '#/cliente/' + id; });
  el.querySelector('#cl-q').addEventListener('input', debounce(e => buscar(e.target.value.trim()), 300));
  buscar('');
};

Admin.cliente = async (el, id) => {
  carregando(el);
  const d = await GET('/clientes/' + id);
  const c = d.cliente, r = d.resumo;
  const fone = c.whatsapp || c.telefone;
  const selReg = s => ({ ativo: '<span class="selo s-futuro">Ativo</span>', quitado: '<span class="selo s-pago">Quitado</span>', cancelado: '<span class="selo s-cancelado">Cancelado</span>' }[s]);
  el.innerHTML = `
    <button class="voltar" onclick="history.length>1?history.back():location.hash='#/clientes'">${I.voltar} Clientes</button>
    <div class="topo"><div><h1>${esc(c.nome)}</h1>
      <div class="contato">${fone ? `<a href="https://wa.me/${esc(String(fone).replace(/\D/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1'))}" target="_blank" rel="noopener">${esc(fone)}</a>` : '<span>Sem WhatsApp</span>'}
        ${c.documento ? '<span>' + esc(c.documento) + '</span>' : ''}${c.cidade ? '<span>' + esc(c.cidade) + '</span>' : ''}${c.endereco ? '<span>' + esc(c.endereco) + '</span>' : ''}</div></div>
      <div class="acoes">${pode('registros') ? `<a class="btn" href="#/novo?cliente=${c.id}">${I.mais} Novo registro</a>` : ''}
        ${pode('clientes') ? '<button class="btn btn-claro" id="cl-ed">Editar</button><button class="btn btn-perigo" id="cl-ex">Excluir</button>' : ''}</div></div>
    ${c.observacoes ? '<div class="aviso info">' + esc(c.observacoes) + '</div>' : ''}
    <div class="grade grade-4">
      <div class="indicador bom"><span>Total já pago</span><strong>${moeda(r.total_pago)}</strong><small>${r.parcelas_pagas} parcela(s) paga(s)</small></div>
      <div class="indicador"><span>Total pendente</span><strong>${moeda(r.total_pendente)}</strong><small>${r.parcelas_pendentes} parcela(s)</small></div>
      <div class="indicador ${r.parcelas_atrasadas ? 'alerta' : ''}"><span>Em atraso</span><strong>${moeda(r.total_atrasado)}</strong><small>${r.parcelas_atrasadas} parcela(s)</small></div>
      <div class="indicador"><span>Registros ativos</span><strong>${r.registros_ativos}</strong><small>${d.registros.length} no total</small></div>
    </div>
    <h2 class="mt" style="margin-bottom:10px">Histórico financeiro</h2>
    ${d.registros.length ? d.registros.map(reg => {
      window.__reg = window.__reg || {}; window.__reg[reg.id] = reg;
      const pago = reg.parcelas.reduce((s, p) => s + p.valor_pago, 0);
      const pctPago = reg.total > 0 ? Math.min(100, pago / reg.total * 100) : 0;
      return `<div class="painel bloco">
        <div class="painel-topo" style="align-items:flex-start"><div><h3>${esc(reg.descricao)}</h3>
          <div class="item-sub" style="margin-top:4px"><span>${FREQ[reg.frequencia]}</span><span>${reg.qtd_parcelas}x</span><span>desde ${dataHora(reg.criado_em).slice(0, 8)}</span>${selReg(reg.status)}</div></div>
          <div class="direita"><div class="item-valor">${moeda(reg.total)}</div><small class="muted">${moeda(reg.valor_principal)} + ${pct(reg.percentual)}</small></div></div>
        <div class="progresso"><i style="width:${pctPago.toFixed(1)}%"></i></div>
        <div class="item-sub" style="margin:6px 0 12px"><span>Pago ${moeda(pago)}</span><span>Falta ${moeda(Math.max(0, reg.total - pago))}</span></div>
        <details ${reg.status === 'ativo' ? 'open' : ''}><summary style="cursor:pointer;font-weight:600;margin-bottom:10px">Parcelas</summary>
          ${caderneta(reg.parcelas, { ativo: reg.status === 'ativo' })}</details>
        ${reg.observacoes ? '<p class="muted" style="margin:10px 0 0">' + esc(reg.observacoes) + '</p>' : ''}
        <div class="acoes mt">
          <button class="btn btn-p btn-claro" onclick="historicoRegistro(${reg.id})">${I.hist} Histórico</button>
          ${pode('registros') && reg.status !== 'cancelado' ? `<a class="btn btn-p" href="#/novo?editar=${reg.id}">✏️ Editar registro</a>` : ''}
          ${reg.status === 'ativo' && pode('pagamentos') ? `<button class="btn btn-p btn-verde" onclick="abaterValor(${reg.id})">💵 Abater valor</button>` : ''}
          ${reg.status === 'ativo' && pode('registros') ? `<button class="btn btn-p ${reg.parcelas.some(p => p.situacao && p.situacao.codigo === 'atrasado') ? '' : 'btn-claro'}" onclick="renegociar(${reg.id})">🤝 Renegociar</button>` : ''}
          ${reg.status === 'ativo' && pode('registros') ? `<button class="btn btn-p btn-perigo" onclick="cancelarRegistro(${reg.id})">Cancelar registro</button>` : ''}
        </div></div>`;
    }).join('') : `<div class="painel vazio">Nenhum registro para este cliente.${pode('registros') ? `<br><a class="btn" href="#/novo?cliente=${c.id}">Criar registro</a>` : ''}</div>`}
    ${d.pagamentos.length ? `<div class="painel mt"><h2 style="margin-bottom:8px">Pagamentos recebidos</h2><div class="tabela-wrap"><table class="tabela">
      <tr><th>Data</th><th>Referente a</th><th>Forma</th><th class="dir">Valor</th></tr>
      ${d.pagamentos.map(p => `<tr><td>${dataBR(p.data_pagamento)}</td><td>${esc(p.descricao)} · parcela ${p.numero}</td><td>${esc(p.forma)}</td><td class="dir forte">${moeda(p.valor)}</td></tr>`).join('')}
    </table></div></div>` : ''}`;
  const ed = el.querySelector('#cl-ed');
  if (ed) ed.onclick = () => modalCliente(c, () => App.recarregar());
  const ex = el.querySelector('#cl-ex');
  if (ex) ex.onclick = async () => {
    if (!await confirmar('Excluir cliente', 'Excluir <b>' + esc(c.nome) + '</b> e todo o histórico dele? Esta ação não pode ser desfeita.', 'Excluir', true)) return;
    try { await DEL('/clientes/' + c.id); toast('Cliente excluído.', 'ok'); location.hash = '#/clientes'; } catch (e) { falha(e); }
  };
};

function cancelarRegistro(id) {
  const reg = (window.__reg || {})[id] || {};
  const m = abrirModal({
    titulo: 'Cancelar registro',
    subtitulo: esc(reg.descricao || '') + (reg.total ? ' · ' + moeda(reg.total) : ''),
    corpo: `<p style="margin-top:0">As parcelas em aberto deixam de ser cobradas. Os pagamentos já recebidos continuam no histórico.</p>
      <div class="campo"><label>Motivo <span class="muted" style="font-weight:500">(opcional)</span></label><input class="entrada" id="cr-motivo" placeholder="Ex.: cliente devolveu o produto"></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn btn-perigo" id="cr-ok">Cancelar registro</button>',
  });
  m.querySelector('#cr-ok').onclick = async e => {
    e.currentTarget.disabled = true;
    try { await POST('/registros/' + id + '/cancelar', { motivo: m.querySelector('#cr-motivo').value }); fecharModal(); toast('Registro cancelado.', 'ok'); App.recarregar(); }
    catch (err) { falha(err); e.currentTarget.disabled = false; }
  };
}
/* ── Abater valor (pagamento antecipado / amortização) ──── */
async function abaterValor(id) {
  await carregarConfig();
  const reg = (window.__reg || {})[id] || {};
  const MODOS = { proximas: 'Próximas', ultimas: 'Últimas', reduzir: 'Diminuir todas' };
  const DICAS = {
    proximas: 'Quita as parcelas mais próximas primeiro.',
    ultimas: 'Quita do fim para o começo: a dívida termina mais cedo e as próximas continuam iguais.',
    reduzir: 'Divide o valor entre todas as parcelas em aberto: cada uma fica menor.',
  };
  let modo = 'proximas';
  const m = abrirModal({
    titulo: 'Abater valor', subtitulo: esc(reg.descricao || ''), largo: true,
    corpo: `<p style="margin-top:0" class="muted">Use quando o cliente paga uma quantia antes do vencimento. O valor entra no Financeiro como recebido.</p>
      <div class="campo"><label for="ab-valor">Valor que o cliente pagou</label><input class="entrada entrada-grande num" id="ab-valor" inputmode="decimal" placeholder="0,00"></div>
      <div class="campo"><span class="rotulo">Onde abater</span><div class="segmentos" id="ab-modo">${Object.entries(MODOS).map(([k, v]) => `<button type="button" data-v="${k}" class="${k === modo ? 'sel' : ''}">${v}</button>`).join('')}</div>
        <small class="muted" id="ab-dica" style="display:block;margin-top:6px">${DICAS[modo]}</small></div>
      <div class="campo"><label for="ab-desc">Desconto por pagar antes <span class="muted" style="font-weight:500">(opcional)</span></label><input class="entrada num" id="ab-desc" inputmode="decimal" placeholder="0,00"></div>
      <div class="campo"><label for="ab-data">Data do pagamento</label><input class="entrada" id="ab-data" type="date" value="${hojeISO()}"></div>
      <div class="campo"><span class="rotulo">Forma de pagamento</span><div class="chips" id="ab-formas">${CFG.formas.map((f, i) => `<button type="button" class="chip${i === 0 ? ' sel' : ''}" data-v="${esc(f)}">${esc(f)}</button>`).join('')}</div></div>
      <div class="campo"><label for="ab-obs">Observação (opcional)</label><input class="entrada" id="ab-obs" placeholder="Ex.: adiantou parte da dívida"></div>
      <div id="ab-previa"><p class="muted">Informe o valor para ver como fica.</p></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn btn-verde" id="ab-ok" disabled>' + I.ok + ' Confirmar abatimento</button>',
  });
  const $ = s => m.querySelector(s), ok = $('#ab-ok');
  const dados = () => ({ valor: lerMoeda($('#ab-valor').value), desconto: lerMoeda($('#ab-desc').value) || 0, modo });
  let seq = 0;
  const previa = debounce(async () => {
    const d = dados(), n = ++seq;
    if (!(d.valor > 0)) { $('#ab-previa').innerHTML = '<p class="muted">Informe o valor para ver como fica.</p>'; ok.disabled = true; return; }
    try {
      const r = await POST('/registros/' + id + '/simular-abatimento', d);
      if (n !== seq) return;
      const mud = r.itens.filter(i => i.pagar > 0 || i.desconto > 0);
      $('#ab-previa').innerHTML = `<div class="painel" style="padding:12px">
        <div class="item-sub" style="margin-bottom:8px"><span>Saldo hoje <b>${moeda(r.saldo)}</b></span><span>Fica devendo <b>${moeda(r.saldo_depois)}</b></span>${r.quitadas ? '<span>' + r.quitadas + ' parcela(s) quitada(s)</span>' : ''}</div>
        ${r.saldo_depois === 0 ? '<div class="aviso info" style="margin:0 0 8px">Com este valor a dívida fica quitada.</div>' : ''}
        <div class="tabela-wrap"><table class="tabela"><tr><th>Parcela</th><th class="dir">Abate</th><th class="dir">Fica</th></tr>
        ${mud.map(i => `<tr><td><b>${i.numero}ª</b><br><small class="muted">${dataBR(i.vencimento)}</small></td><td class="dir" style="white-space:nowrap">${moeda(i.pagar)}${i.desconto ? '<br><small class="muted">desc. ' + moeda(i.desconto) + '</small>' : ''}</td>
          <td class="dir forte" style="white-space:nowrap">${i.quitada ? 'Paga' : moeda(i.restante_depois)}</td></tr>`).join('')}</table></div></div>`;
      ok.disabled = false;
    } catch (e) { if (n !== seq) return; $('#ab-previa').innerHTML = '<div class="aviso erro">' + esc(e.message) + '</div>'; ok.disabled = true; }
  }, 300);
  $('#ab-valor').addEventListener('input', previa);
  $('#ab-desc').addEventListener('input', previa);
  m.querySelectorAll('#ab-modo button').forEach(b => b.onclick = () => {
    modo = b.dataset.v; m.querySelectorAll('#ab-modo button').forEach(x => x.classList.toggle('sel', x === b));
    $('#ab-dica').textContent = DICAS[modo]; previa();
  });
  m.querySelectorAll('#ab-formas .chip').forEach(c => c.onclick = () => { m.querySelectorAll('#ab-formas .chip').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); });
  setTimeout(() => $('#ab-valor').focus(), 50);
  ok.onclick = async () => {
    ok.disabled = true;
    try {
      const r = await POST('/registros/' + id + '/abater', { ...dados(), data: $('#ab-data').value,
        forma: ($('#ab-formas .sel') || {}).dataset?.v || 'Dinheiro', observacao: $('#ab-obs').value });
      mostrarConfirmacao(r.quitado ? 'Dívida quitada' : 'Valor abatido',
        r.quitado ? 'Todas as parcelas foram pagas. O registro foi marcado como quitado.' : 'O valor foi abatido. Agora o cliente deve <b>' + moeda(r.saldo_depois) + '</b>.', r.confirmacao);
      toast('Valor abatido.', 'ok');
      App.recarregar();
    } catch (e) { falha(e); ok.disabled = false; }
  };
}

function mostrarConfirmacao(titulo, texto, conf) {
  const zap = pode('whatsapp') && conf && conf.texto;
  abrirModal({
    titulo, corpo: `<p style="margin-top:0">${texto}</p>${zap ? '<p class="rotulo">Mensagem para o cliente</p><div class="previa">' + esc(conf.texto) + '</div>' : ''}`,
    rodape: '<button class="btn btn-claro" data-fechar>Fechar</button>' +
      (zap ? `<a class="btn btn-zap" href="${esc(conf.link)}" target="_blank" rel="noopener" onclick="setTimeout(fecharModal,300)">${I.zap} Enviar ao cliente</a>` : ''),
  });
}

/* ── Renegociar dívida ──────────────────────────────────── */
async function renegociar(id) {
  await carregarConfig();
  const reg = (window.__reg || {})[id] || {};
  const amanha = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const st = { pct: 0, freq: reg.frequencia && reg.frequencia !== 'personalizado' ? reg.frequencia : 'mensal', modo: 'qtd' };
  const m = abrirModal({
    titulo: 'Renegociar dívida', subtitulo: esc(reg.descricao || ''), largo: true,
    corpo: `<p style="margin-top:0" class="muted">Junta tudo o que falta pagar (inclusive o atrasado) e cria parcelas novas. O que já foi pago continua no histórico.</p>
      <div id="rn-saldo" class="item-sub" style="margin-bottom:12px"></div>
      <div class="campo"><span class="rotulo">Juros da renegociação</span>
        <div class="chips" id="rn-pcts"><button type="button" class="chip sel" data-v="0">Sem juros</button>${CFG.percentuais.map(p => `<button type="button" class="chip" data-v="${p}">${pct(p)}</button>`).join('')}<button type="button" class="chip" data-v="outro">Outro</button></div>
        <input class="entrada mt" id="rn-pct-outro" inputmode="decimal" placeholder="Percentual, ex.: 12,5" hidden></div>
      <div class="campo"><label for="rn-desc">Desconto <span class="muted" style="font-weight:500">(opcional)</span></label><input class="entrada num" id="rn-desc" inputmode="decimal" placeholder="0,00"></div>
      <div class="campo"><span class="rotulo">Como vai pagar</span>
        <div class="segmentos" id="rn-freq">${Object.entries(FREQ).map(([k, v]) => `<button type="button" data-v="${k}" class="${k === st.freq ? 'sel' : ''}">${v}</button>`).join('')}</div>
        <div id="rn-freq-campos" class="mt"></div></div>
      <div class="campo"><div class="segmentos" id="rn-modo"><button type="button" data-v="qtd" class="sel">Nº de parcelas</button><button type="button" data-v="valor">Valor da parcela</button></div>
        <input class="entrada mt num" id="rn-qtd" inputmode="numeric" placeholder="Quantas parcelas? Ex.: 3"></div>
      <div class="campo"><label for="rn-data">Primeiro vencimento</label><input class="entrada" id="rn-data" type="date" value="${amanha}"></div>
      <div class="campo"><label for="rn-motivo">Motivo <span class="muted" style="font-weight:500">(opcional)</span></label><input class="entrada" id="rn-motivo" placeholder="Ex.: cliente atrasou e pediu mais prazo"></div>
      <div id="rn-previa"></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn" id="rn-ok" disabled>' + I.ok + ' Confirmar renegociação</button>',
  });
  const $ = s => m.querySelector(s), ok = $('#rn-ok');
  let selDias = null;
  const camposFreq = () => {
    const box = $('#rn-freq-campos');
    selDias = null;
    if (st.freq === 'diario') {
      const atuais = reg.config && Array.isArray(reg.config.dias_cobranca) ? reg.config.dias_cobranca : (CFG.dias_cobranca || [0, 1, 2, 3, 4, 5, 6]);
      selDias = seletorDias(box, atuais, () => previa());
    } else if (st.freq === 'personalizado') {
      box.innerHTML = '<input class="entrada num" id="rn-int" inputmode="numeric" placeholder="A cada quantos dias? Ex.: 10">';
      $('#rn-int').addEventListener('input', previa);
    } else box.innerHTML = '';
  };
  const dados = () => {
    const pctTxt = st.pct === 'outro' ? $('#rn-pct-outro').value : st.pct;
    const n = $('#rn-qtd').value;
    const b = { acrescimo_pct: Number(String(pctTxt).replace(',', '.')) || 0, desconto: lerMoeda($('#rn-desc').value) || 0,
      frequencia: st.freq, data_inicial: $('#rn-data').value, motivo: $('#rn-motivo').value };
    if (st.modo === 'qtd') b.qtd_parcelas = parseInt(n, 10) || 0; else b.valor_parcela = lerMoeda(n) || 0;
    if (selDias) b.dias_cobranca = selDias.valor();
    if (st.freq === 'personalizado') b.intervalo_dias = parseInt(($('#rn-int') || {}).value, 10) || 0;
    return b;
  };
  let seq = 0;
  const previa = debounce(async () => {
    const n = ++seq;
    try {
      const r = await POST('/registros/' + id + '/simular-renegociacao', dados());
      if (n !== seq) return;
      $('#rn-saldo').innerHTML = `<span>Falta pagar <b>${moeda(r.saldo)}</b> em ${r.parcelas_abertas} parcela(s)</span>${r.atrasado > 0 ? '<span style="color:var(--margem)">Em atraso ' + moeda(r.atrasado) + '</span>' : ''}`;
      const mostrar = r.parcelas.slice(0, 12);
      $('#rn-previa').innerHTML = `<div class="painel" style="padding:12px">
        <div class="item-sub" style="margin-bottom:8px"><span>Saldo ${moeda(r.saldo)}</span>${r.acrescimo ? '<span>+ juros ' + pct(r.acrescimo_pct) + ' = ' + moeda(r.acrescimo) + '</span>' : ''}${r.desconto ? '<span>− desconto ' + moeda(r.desconto) + '</span>' : ''}</div>
        <div style="font-size:1.1rem;margin-bottom:8px">Novo total <b>${moeda(r.novo_total)}</b> em <b>${r.qtd_parcelas}x</b> de ${moeda(r.valor_parcela)}</div>
        <div class="tabela-wrap"><table class="tabela"><tr><th>Nova parcela</th><th>Vencimento</th><th class="dir">Valor</th></tr>
        ${mostrar.map(p => `<tr><td>${p.numero}</td><td>${dataBR(p.vencimento)}</td><td class="dir forte">${moeda(p.valor)}</td></tr>`).join('')}
        ${r.parcelas.length > mostrar.length ? '<tr><td colspan="3" class="muted">… e mais ' + (r.parcelas.length - mostrar.length) + ' parcela(s)</td></tr>' : ''}</table></div></div>`;
      ok.disabled = false;
    } catch (e) {
      if (n !== seq) return;
      const vazio = !(dados().qtd_parcelas || dados().valor_parcela);
      $('#rn-previa').innerHTML = vazio ? '<p class="muted">Informe as parcelas para ver como fica.</p>' : '<div class="aviso erro">' + esc(e.message) + '</div>';
      ok.disabled = true;
    }
  }, 300);
  m.querySelectorAll('#rn-pcts .chip').forEach(c => c.onclick = () => {
    m.querySelectorAll('#rn-pcts .chip').forEach(x => x.classList.toggle('sel', x === c));
    st.pct = c.dataset.v; $('#rn-pct-outro').hidden = st.pct !== 'outro'; if (st.pct === 'outro') $('#rn-pct-outro').focus();
    previa();
  });
  m.querySelectorAll('#rn-freq button').forEach(b => b.onclick = () => {
    st.freq = b.dataset.v; m.querySelectorAll('#rn-freq button').forEach(x => x.classList.toggle('sel', x === b)); camposFreq(); previa();
  });
  m.querySelectorAll('#rn-modo button').forEach(b => b.onclick = () => {
    st.modo = b.dataset.v; m.querySelectorAll('#rn-modo button').forEach(x => x.classList.toggle('sel', x === b));
    const q = $('#rn-qtd'); q.value = ''; q.placeholder = st.modo === 'qtd' ? 'Quantas parcelas? Ex.: 3' : 'Valor de cada parcela, ex.: 150,00';
    q.inputMode = st.modo === 'qtd' ? 'numeric' : 'decimal'; previa();
  });
  ['#rn-pct-outro', '#rn-desc', '#rn-qtd', '#rn-data'].forEach(s => $(s).addEventListener('input', previa));
  camposFreq(); previa();
  ok.onclick = async () => {
    ok.disabled = true;
    try {
      const r = await POST('/registros/' + id + '/renegociar', dados());
      mostrarConfirmacao('Dívida renegociada', 'Novo total <b>' + moeda(r.total) + '</b> em <b>' + r.parcelas + 'x</b>. As parcelas antigas em aberto foram substituídas.', r.confirmacao);
      toast('Dívida renegociada.', 'ok');
      App.recarregar();
    } catch (e) { falha(e); ok.disabled = false; }
  };
}
function editarRegistro(id) {
  const reg = (window.__reg || {})[id] || {};
  const desc = reg.descricao || '', obs = reg.observacoes || '';
  const m = abrirModal({
    titulo: 'Editar registro',
    corpo: `<div class="campo"><label>Descrição</label><input class="entrada" id="er-d" value="${esc(desc)}"></div>
            <div class="campo"><label>Observações</label><textarea class="entrada" id="er-o" rows="3">${esc(obs)}</textarea></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn" id="er-ok">Salvar</button>',
  });
  m.querySelector('#er-ok').onclick = async () => {
    try { await PUT('/registros/' + id, { descricao: m.querySelector('#er-d').value, observacoes: m.querySelector('#er-o').value }); fecharModal(); toast('Registro atualizado.', 'ok'); App.recarregar(); }
    catch (e) { falha(e); }
  };
}
const NOMES_ACAO = {
  registro_criado: 'Registro criado', registro_editado: 'Registro editado', registro_cancelado: 'Registro cancelado',
  registro_abatido: 'Valor abatido', registro_renegociado: 'Dívida renegociada',
  parcela_ajustada: 'Parcela ajustada', pagamento_registrado: 'Pagamento registrado', pagamento_estornado: 'Pagamento estornado',
};
async function historicoRegistro(id) {
  try {
    const r = await GET('/registros/' + id);
    abrirModal({
      titulo: 'Histórico do registro', subtitulo: esc(r.descricao), largo: true,
      corpo: r.historico.length ? '<div class="lista">' + r.historico.map(h => {
        let d = {}; try { d = JSON.parse(h.detalhes || '{}'); } catch (e) {}
        const extra = h.acao === 'registro_abatido' ? moeda(d.valor) + (d.desconto ? ' + desconto ' + moeda(d.desconto) : '') + (d.saldo ? ' · saldo ' + moeda(d.saldo.de) + ' → ' + moeda(d.saldo.para) : '')
          : h.acao === 'registro_renegociado' ? 'Saldo ' + moeda(d.saldo) + (d.acrescimo_pct ? ' + ' + pct(d.acrescimo_pct) : '') + (d.desconto ? ' − ' + moeda(d.desconto) : '') + ' = ' + moeda(d.total) + ' em ' + d.parcelas + 'x'
          : d.valor && typeof d.valor === 'object' ? 'Parcela ' + d.parcela + ': ' + moeda(d.valor.de) + ' → ' + moeda(d.valor.para) + (d.vencimento && d.vencimento.de !== d.vencimento.para ? ', ' + dataBR(d.vencimento.de) + ' → ' + dataBR(d.vencimento.para) : '')
          : d.parcela ? 'Parcela ' + d.parcela + ' · ' + moeda(d.valor) + (d.forma ? ' · ' + d.forma : '') : d.total ? moeda(d.total) + (d.parcelas ? ' em ' + d.parcelas + 'x' : '') : '';
        return `<div class="item"><div><div class="item-titulo">${NOMES_ACAO[h.acao] || esc(h.acao)}</div>
          <div class="item-sub"><span>${dataHora(h.criado_em)}</span><span>por ${esc(h.user_nome || '—')}</span>${extra ? '<span>' + esc(extra) + '</span>' : ''}${d.motivo ? '<span>Motivo: ' + esc(d.motivo) + '</span>' : ''}</div></div></div>`;
      }).join('') + '</div>' : '<div class="vazio">Sem histórico.</div>',
      rodape: '<button class="btn btn-claro" data-fechar>Fechar</button>',
    });
  } catch (e) { falha(e); }
}

/* ═══════════════════ NOVO REGISTRO ═══════════════════ */
Admin.novo = async el => {
  await carregarConfig();
  const q = parametros();
  let caixa = null;
  if (pode('financeiro')) { try { caixa = await GET('/financeiro/caixa'); } catch (e) {} }
  const amanha = somaDias(hojeISO(), 1);
  const st = {
    cliente: null, descricao: '', valor: 0, percentual: CFG.percentuais[1] ?? CFG.percentuais[0] ?? 0,
    frequencia: 'mensal', modo: 'qtd', qtd: 4, valor_parcela: 0,
    data_inicial: '', dia_semana: new Date(amanha + 'T12:00:00').getDay(), dia_mes: Number(hojeISO().slice(8, 10)),
    intervalo_dias: 10, dias_cobranca: [...CFG.dias_cobranca], sim: null, parcelas: null, editado: false,
  };
  if (q.cliente) { try { const d = await GET('/clientes/' + q.cliente); st.cliente = { id: d.cliente.id, nome: d.cliente.nome }; } catch (e) {} }
  // Modo edição: carrega o registro e preenche tudo
  const editId = Number(q.editar) || 0;
  let reg = null;
  if (editId) {
    reg = await GET('/registros/' + editId);
    if (reg.status === 'cancelado') throw new Error('Registro cancelado não pode ser editado.');
    const cfg = reg.config || {};
    const primeira = (reg.parcelas[0] || {}).vencimento || '';
    Object.assign(st, {
      cliente: { id: reg.client_id, nome: reg.cliente }, descricao: reg.descricao, valor: reg.valor_principal, percentual: reg.percentual,
      frequencia: reg.frequencia, modo: 'qtd', qtd: reg.qtd_parcelas, ancora: primeira,
      data_inicial: ['diario', 'quinzenal', 'personalizado'].includes(reg.frequencia) ? (cfg.data_inicial || primeira) : '',
      dia_semana: cfg.dia_semana ?? st.dia_semana, dia_mes: cfg.dia_mes ?? Number(primeira.slice(8, 10)) ?? st.dia_mes,
      intervalo_dias: cfg.intervalo_dias || st.intervalo_dias,
      dias_cobranca: Array.isArray(cfg.dias_cobranca) ? cfg.dias_cobranca : (cfg.pular_domingos ? [1, 2, 3, 4, 5, 6] : st.dias_cobranca),
    });
    st.pagas = reg.parcelas.filter(p => p.status === 'pago' || p.valor_pago > 0).length;
  }

  el.innerHTML = `
    <button class="voltar" onclick="history.back()">${I.voltar} Voltar</button>
    <div class="topo"><div><h1>${editId ? 'Editar registro' : 'Novo registro'}</h1><p>${editId ? 'Mude o que precisar e confira as parcelas antes de salvar.' : 'Preencha e confira as parcelas antes de salvar.'}</p></div></div>
    ${editId && st.pagas ? `<div class="aviso info">Este registro tem <b>${st.pagas} parcela(s) com pagamento</b>. Elas continuam como estão; o sistema recalcula só as que faltam.</div>` : ''}
    <div class="novo-layout">
      <div class="painel" style="padding-top:4px">
        <div class="passo"><div class="passo-n">1</div><div><h3>Cliente</h3>
          <div id="nr-cli"></div></div></div>
        <div class="passo"><div class="passo-n">2</div><div><h3>Descrição</h3>
          <div class="chips" id="nr-descs">${CFG.descricoes.map(d => `<button type="button" class="chip" data-v="${esc(d)}">${esc(d)}</button>`).join('')}</div>
          <input class="entrada mt" id="nr-desc" placeholder="Ex.: Compra de geladeira" maxlength="120"></div></div>
        <div class="passo"><div class="passo-n">3</div><div><h3>Valor e percentual</h3>
          <div class="campo"><label for="nr-valor">Valor principal</label><input class="entrada entrada-grande num" id="nr-valor" inputmode="decimal" placeholder="R$ 0,00"></div>
          <span class="rotulo">Percentual</span>
          <div class="chips" id="nr-pcts" style="margin-top:6px">${CFG.percentuais.map(p => `<button type="button" class="chip" data-v="${p}">${pct(p)}</button>`).join('')}
            <button type="button" class="chip" data-v="0">Sem acréscimo</button><button type="button" class="chip" data-v="outro">Outro</button></div>
          <input class="entrada mt" id="nr-pct-outro" inputmode="decimal" placeholder="Percentual, ex.: 12,5" hidden></div></div>
        <div class="passo"><div class="passo-n">4</div><div><h3>Como vai pagar</h3>
          <div class="segmentos" id="nr-freq">${Object.entries(FREQ).map(([k, v]) => `<button type="button" data-v="${k}">${v}</button>`).join('')}</div>
          <div id="nr-freq-campos" class="mt"></div>
          <div class="segmentos mt" id="nr-modo"><button type="button" data-v="qtd">Nº de parcelas</button><button type="button" data-v="valor">Valor da parcela</button></div>
          <div class="campo mt" id="nr-modo-campo"></div></div></div>
        <div class="passo"><div class="passo-n">5</div><div><h3>Observações <small class="muted" style="font-weight:500">(opcional)</small></h3>
          <textarea class="entrada" id="nr-obs" rows="2" placeholder="Anotações internas"></textarea></div></div>
      </div>
      <div class="fixo">
        <div class="painel"><h2 style="margin-bottom:8px">Resumo</h2><div id="nr-resumo"><p class="muted">Informe o valor para ver o cálculo.</p></div></div>
        <div class="mt" id="nr-parcelas"></div>
        <button class="btn btn-grande mt" id="nr-salvar" disabled>${I.ok} ${editId ? 'Salvar alterações' : 'Criar registro'}</button>
      </div>
    </div>`;
  const $ = s => el.querySelector(s);

  // Cliente: busca com sugestões + cadastro rápido
  const desenharCliente = () => {
    const box = $('#nr-cli');
    if (st.cliente) {
      box.innerHTML = `<div class="item" style="border:1px solid var(--linha);border-radius:var(--r-sm);padding:10px 12px">
        <div class="item-titulo">${esc(st.cliente.nome)}</div><div>${editId ? '' : '<button class="link-btn" id="nr-cli-trocar">Trocar</button>'}</div></div>`;
      if (editId) return;
      $('#nr-cli-trocar').onclick = () => { st.cliente = null; desenharCliente(); validar(); };
      return;
    }
    box.innerHTML = `<div class="busca" style="position:relative">${I.busca}<input class="entrada" id="nr-cli-q" placeholder="Digite o nome do cliente" autocomplete="off"><div class="sugestoes" id="nr-cli-sug" hidden></div></div>
      ${pode('clientes') ? '<button type="button" class="link-btn" id="nr-cli-novo">+ Cadastrar novo cliente</button>' : ''}`;
    const inp = $('#nr-cli-q'), sug = $('#nr-cli-sug');
    const buscar = debounce(async () => {
      const t = inp.value.trim();
      try {
        const r = await GET('/clientes' + (t ? '?q=' + encodeURIComponent(t) : ''));
        sug.innerHTML = r.slice(0, 8).map(c => `<button type="button" data-id="${c.id}" data-n="${esc(c.nome)}"><b>${esc(c.nome)}</b> <span class="muted">${esc(c.whatsapp || '')}</span></button>`).join('')
          || '<div class="vazio" style="padding:12px">Nenhum cliente com esse nome.</div>';
        sug.hidden = false;
        sug.querySelectorAll('button').forEach(b => b.onclick = () => { st.cliente = { id: Number(b.dataset.id), nome: b.dataset.n }; desenharCliente(); validar(); });
      } catch (e) { falha(e); }
    }, 200);
    inp.addEventListener('input', buscar);
    inp.addEventListener('focus', buscar);
    document.addEventListener('click', e => { if (!box.contains(e.target)) sug.hidden = true; }, { once: false });
    const nv = $('#nr-cli-novo');
    if (nv) nv.onclick = () => modalCliente({ nome: inp.value.trim() }, (id, dados) => { st.cliente = { id, nome: dados.nome }; desenharCliente(); validar(); });
  };
  desenharCliente();

  // Descrição
  $('#nr-descs').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    $('#nr-descs').querySelectorAll('.chip').forEach(x => x.classList.toggle('sel', x === c));
    $('#nr-desc').value = c.dataset.v; st.descricao = c.dataset.v; $('#nr-desc').focus(); validar();
  });
  $('#nr-desc').addEventListener('input', e => {
    st.descricao = e.target.value.trim();
    $('#nr-descs').querySelectorAll('.chip').forEach(x => x.classList.toggle('sel', x.dataset.v === st.descricao));
    validar();
  });

  // Valor e percentual
  $('#nr-valor').addEventListener('input', e => { st.valor = lerMoeda(e.target.value); simular(); });
  $('#nr-valor').addEventListener('blur', e => { if (st.valor) e.target.value = moeda(st.valor).replace('R$ ', ''); });
  const marcarPct = () => {
    const outro = !CFG.percentuais.map(Number).includes(Number(st.percentual)) && Number(st.percentual) !== 0;
    $('#nr-pcts').querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c.dataset.v === 'outro' ? outro : Number(c.dataset.v) === Number(st.percentual)));
  };
  $('#nr-pcts').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    if (c.dataset.v === 'outro') { $('#nr-pct-outro').hidden = false; $('#nr-pct-outro').focus(); $('#nr-pcts').querySelectorAll('.chip').forEach(x => x.classList.toggle('sel', x === c)); return; }
    $('#nr-pct-outro').hidden = true; st.percentual = Number(c.dataset.v); marcarPct(); simular();
  });
  $('#nr-pct-outro').addEventListener('input', e => { st.percentual = lerNumero(e.target.value); simular(); });
  marcarPct();

  // Frequência
  const camposFreq = () => {
    const f = st.frequencia, box = $('#nr-freq-campos');
    const dataIni = (rot, pad) => `<div class="campo"><label>${rot}</label><input class="entrada" type="date" id="nr-dini" value="${st.data_inicial || pad}"></div>`;
    if (f === 'diario') {
      box.innerHTML = dataIni('Primeiro pagamento', amanha) + '<span class="rotulo">Dias de cobrança</span><div id="nr-dias" style="margin-top:8px"></div>';
      seletorDias(box.querySelector('#nr-dias'), st.dias_cobranca, d => { st.dias_cobranca = d; simular(); });
    }
    if (f === 'semanal') box.innerHTML = `<div class="campo"><label>Dia da semana</label><select class="entrada" id="nr-dsem">${SEMANA.map((d, i) => `<option value="${i}" ${i === Number(st.dia_semana) ? 'selected' : ''}>${d}</option>`).join('')}</select></div>`;
    if (f === 'quinzenal') box.innerHTML = dataIni('Primeiro vencimento', somaDias(hojeISO(), 15));
    if (f === 'mensal') box.innerHTML = `<div class="campo"><label>Dia do vencimento</label><input class="entrada num" id="nr-dmes" type="number" min="1" max="31" inputmode="numeric" value="${st.dia_mes}"><small>Todo dia ${st.dia_mes} de cada mês. Em meses mais curtos, vence no último dia.</small></div>`;
    if (f === 'personalizado') box.innerHTML = `<div class="linha-campos"><div class="campo"><label>A cada quantos dias</label><input class="entrada num" id="nr-int" type="number" min="1" max="365" value="${st.intervalo_dias}"></div>` + dataIni('Primeiro vencimento', somaDias(hojeISO(), Number(st.intervalo_dias) || 1)) + '</div>';
    const on = (s, ev, fn) => { const x = $(s); if (x) x.addEventListener(ev, fn); };
    on('#nr-dini', 'change', e => { st.data_inicial = e.target.value; simular(); });
    on('#nr-dsem', 'change', e => { st.dia_semana = Number(e.target.value); simular(); });
    on('#nr-dmes', 'input', e => { st.dia_mes = Number(e.target.value); const s = e.target.parentElement.querySelector('small'); if (s) s.textContent = 'Todo dia ' + (st.dia_mes || '?') + ' de cada mês. Em meses mais curtos, vence no último dia.'; simular(); });
    on('#nr-int', 'input', e => { st.intervalo_dias = Number(e.target.value); simular(); });
  };
  $('#nr-freq').querySelectorAll('button').forEach(b => b.onclick = () => {
    st.frequencia = b.dataset.v; st.data_inicial = '';
    if (st.frequencia === 'diario' && st.modo === 'qtd' && st.qtd === 4) st.qtd = 30;
    if (st.frequencia !== 'diario' && st.modo === 'qtd' && st.qtd === 30) st.qtd = 4;
    $('#nr-freq').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    camposFreq(); campoModo(); simular();
  });
  const campoModo = () => {
    $('#nr-modo').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x.dataset.v === st.modo));
    $('#nr-modo-campo').innerHTML = st.modo === 'qtd'
      ? `<label>Quantidade de parcelas</label><input class="entrada num" id="nr-qtd" type="number" min="1" max="1000" inputmode="numeric" value="${st.qtd}">`
      : `<label>Valor de cada parcela</label><input class="entrada num" id="nr-vp" inputmode="decimal" placeholder="Ex.: 40,00" value="${st.valor_parcela ? String(st.valor_parcela).replace('.', ',') : ''}"><small>O sistema calcula quantas parcelas são necessárias.</small>`;
    const qi = $('#nr-qtd'); if (qi) qi.addEventListener('input', e => { st.qtd = Math.floor(Number(e.target.value)) || 0; simular(); });
    const vi = $('#nr-vp'); if (vi) vi.addEventListener('input', e => { st.valor_parcela = lerMoeda(e.target.value); simular(); });
  };
  $('#nr-modo').querySelectorAll('button').forEach(b => b.onclick = () => { st.modo = b.dataset.v; campoModo(); simular(); });
  $('#nr-freq').querySelector(`[data-v="${st.frequencia}"]`).classList.add('sel');
  if (editId) {
    $('#nr-desc').value = st.descricao;
    $('#nr-descs').querySelectorAll('.chip').forEach(x => x.classList.toggle('sel', x.dataset.v === st.descricao));
    $('#nr-valor').value = moeda(st.valor).replace('R$ ', '');
    $('#nr-obs').value = reg.observacoes || '';
    if (!CFG.percentuais.map(Number).includes(Number(st.percentual)) && Number(st.percentual) !== 0) {
      $('#nr-pct-outro').hidden = false; $('#nr-pct-outro').value = String(st.percentual).replace('.', ',');
    }
    marcarPct();
  }
  camposFreq(); campoModo();

  // Simulação no servidor (mesma regra usada ao salvar)
  const corpo = () => ({
    valor_principal: st.valor, percentual: st.percentual, frequencia: st.frequencia,
    qtd_parcelas: st.modo === 'qtd' ? st.qtd : 0, valor_parcela: st.modo === 'valor' ? st.valor_parcela : 0,
    data_inicial: ['diario', 'quinzenal', 'personalizado'].includes(st.frequencia) ? (st.data_inicial || ($('#nr-dini') || {}).value || '') : (editId ? st.ancora : ''),
    dia_semana: st.dia_semana, dia_mes: st.dia_mes, intervalo_dias: st.intervalo_dias, dias_cobranca: st.frequencia === 'diario' ? st.dias_cobranca : undefined,
  });
  let seq = 0;
  const simular = debounce(async () => {
    st.sim = null; st.parcelas = null; st.editado = false;
    if (!st.valor) { $('#nr-resumo').innerHTML = '<p class="muted">Informe o valor para ver o cálculo.</p>'; $('#nr-parcelas').innerHTML = ''; validar(); return; }
    const meu = ++seq;
    try {
      const s = await POST(editId ? '/registros/' + editId + '/simular-edicao' : '/registros/simular', corpo());
      if (meu !== seq) return;
      st.sim = s; st.parcelas = s.parcelas.map(p => ({ ...p }));
      desenharResumo(); desenharParcelas();
    } catch (e) {
      if (meu !== seq) return;
      $('#nr-resumo').innerHTML = '<div class="aviso erro">' + esc(e.message) + '</div>'; $('#nr-parcelas').innerHTML = '';
    }
    validar();
  }, 250);

  const desenharResumo = () => {
    const s = st.sim, soma = st.parcelas.reduce((t, p) => t + p.valor, 0);
    let caixaHtml = '';
    if (caixa && caixa.automatico) {
      const usa = editId ? s.valor_principal - (reg.valor_principal || 0) : s.valor_principal;
      const fica = caixa.saldo - usa;
      const fmtC = v => v < 0 ? '− ' + moeda(-v) : moeda(v);
      caixaHtml = `<div class="conta" style="margin-top:12px;padding-top:8px;border-top:1px solid var(--linha)">
        <div><span>Saldo geral</span><b>${fmtC(caixa.saldo)}</b></div>
        <div><span>Fica depois</span><b style="color:${fica < 0 ? 'var(--margem)' : 'var(--verde)'}">${fmtC(fica)}</b></div></div>
        ${fica < 0 ? '<div class="aviso" style="margin-bottom:0">O valor é maior que o saldo geral. Se entrou dinheiro novo, lance um <b>Extra</b> no Financeiro. Você pode salvar assim mesmo.</div>' : ''}`;
    }
    const livres = st.parcelas.filter(p => !p.fixa), nFix = st.parcelas.length - livres.length;
    const ref = livres.length ? livres : st.parcelas;
    const iguais = ref.every(p => Math.abs(p.valor - ref[0].valor) < 0.005);
    const ultimoDif = !iguais && ref.slice(0, -1).every(p => Math.abs(p.valor - ref[0].valor) < 0.005);
    $('#nr-resumo').innerHTML = `<div class="conta">
      <div><span>Valor principal</span><b>${moeda(s.valor_principal)}</b></div>
      <div><span>Percentual</span><b>${pct(s.percentual)}</b></div>
      <div><span>Valor adicional</span><b>${moeda(s.acrescimo)}</b></div>
      <div class="total"><span style="color:inherit">Total</span><span>${moeda(soma)}</span></div></div>
      <p style="margin:10px 0 0" class="forte">${nFix ? nFix + ' mantida(s) + ' : ''}${ref.length}x de ${moeda(ref[0].valor)}${ultimoDif ? ' <span class="muted" style="font-weight:500">(última de ' + moeda(ref.at(-1).valor) + ')</span>' : iguais ? '' : ' <span class="muted" style="font-weight:500">(valores ajustados)</span>'}</p>
      <p class="muted" style="margin:2px 0 0">${FREQ[s.frequencia]}${s.frequencia === 'diario' && s.config.dias_cobranca && s.config.dias_cobranca.length < 7 ? ', ' + textoDias(s.config.dias_cobranca, true) : ''} · de ${dataBR(st.parcelas[0].vencimento)} a ${dataBR(st.parcelas.at(-1).vencimento)}</p>
      ${caixaHtml}
      ${s.fixas_qtd ? '<div class="aviso info" style="margin-bottom:0">' + s.fixas_qtd + ' parcela(s) com pagamento mantida(s) (' + moeda(s.ja_pago) + ' já recebido). As outras foram recalculadas.</div>' : ''}
      ${st.editado && !s.fixas_qtd && Math.abs(soma - s.total) > 0.004 ? '<div class="aviso">A soma das parcelas (' + moeda(soma) + ') é diferente do total calculado (' + moeda(s.total) + '). Será salvo o valor das parcelas.</div>' : ''}`;
  };
  const desenharParcelas = () => {
    $('#nr-parcelas').innerHTML = `<div class="caderneta editavel"><div class="caderneta-cab"><div class="n">Nº</div><div>Vencimento</div><div>Valor</div></div>
      <div class="caderneta-rolagem">${st.parcelas.map((p, i) => p.fixa
        ? `<div class="caderneta-linha paga"><div class="n">${p.numero}</div><div class="c-venc num" style="padding-left:6px">${dataBR(p.vencimento)}</div>
            <div class="c-valor num forte v" style="padding-left:6px">${moeda(p.valor)} <span class="selo ${p.status === 'pago' ? 's-pago' : 's-parcial'}">${p.status === 'pago' ? 'Paga' : 'Parcial'}</span></div></div>`
        : `<div class="caderneta-linha"><div class="n">${p.numero}</div>
        <div class="c-venc"><input class="entrada" type="date" data-i="${i}" data-c="vencimento" value="${p.vencimento}"></div>
        <div class="c-valor"><input class="entrada num" inputmode="decimal" data-i="${i}" data-c="valor" value="${p.valor.toFixed(2).replace('.', ',')}"></div></div>`).join('')}</div>
      <div class="caderneta-rodape"><span class="muted" style="font-weight:500">Toque para ajustar uma parcela</span><button class="link-btn" id="nr-refazer" style="padding:0" ${st.editado ? '' : 'hidden'}>Desfazer ajustes</button></div></div>`;
    $('#nr-parcelas').querySelectorAll('input').forEach(inp => inp.addEventListener('change', e => {
      const i = Number(e.target.dataset.i);
      if (e.target.dataset.c === 'valor') st.parcelas[i].valor = lerMoeda(e.target.value);
      else st.parcelas[i].vencimento = e.target.value;
      st.editado = true; desenharResumo();
      $('#nr-refazer').hidden = false;
    }));
    $('#nr-refazer').onclick = () => { st.parcelas = st.sim.parcelas.map(p => ({ ...p })); st.editado = false; desenharResumo(); desenharParcelas(); };
  };

  const validar = () => { $('#nr-salvar').disabled = !(st.cliente && st.descricao && st.sim && st.parcelas && st.parcelas.length); };
  $('#nr-salvar').onclick = async () => {
    const b = $('#nr-salvar'); b.disabled = true;
    try {
      if (editId) {
        const r = await POST('/registros/' + editId + '/editar', { ...corpo(), descricao: st.descricao, observacoes: $('#nr-obs').value,
                                                                  parcelas: st.editado ? st.parcelas.filter(p => !p.fixa) : undefined });
        toast('Registro atualizado: ' + r.parcelas + ' parcelas, ' + moeda(r.total) + '.', 'ok');
        location.hash = '#/cliente/' + st.cliente.id;
        return;
      }
      const r = await POST('/registros', { ...corpo(), client_id: st.cliente.id, descricao: st.descricao, observacoes: $('#nr-obs').value,
                                           parcelas: st.editado ? st.parcelas : undefined });
      toast('Registro criado: ' + r.parcelas + ' parcelas, ' + moeda(r.total) + '.', 'ok');
      location.hash = '#/cliente/' + st.cliente.id;
    } catch (e) { falha(e); b.disabled = false; }
  };
  if (editId) simular();
  if (!st.cliente) setTimeout(() => { const i = $('#nr-cli-q'); if (i && window.innerWidth > 640) i.focus(); }, 50);
};

/* ═══════════════════ CALENDÁRIO ═══════════════════ */
Admin.calendario = async el => {
  let mes = hojeISO().slice(0, 7), sel = hojeISO();
  el.innerHTML = `<div class="topo"><div><h1>Calendário</h1><p>Vencimentos por dia</p></div>
    <div class="acoes"><button class="btn btn-claro btn-icone" id="ca-ant" aria-label="Mês anterior">‹</button><h2 id="ca-mes" style="min-width:150px;text-align:center;align-self:center"></h2><button class="btn btn-claro btn-icone" id="ca-prox" aria-label="Próximo mês">›</button></div></div>
    <div class="painel"><div class="cal-cab">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => '<div>' + d + '</div>').join('')}</div><div class="cal" id="ca-grade"></div></div>
    <div class="painel mt"><div class="painel-topo"><h2 id="ca-dia-t"></h2><small id="ca-dia-s"></small></div><div class="lista" id="ca-dia"></div></div>`;
  const $ = s => el.querySelector(s);
  const verDia = async dia => {
    sel = dia;
    el.querySelectorAll('.cal-dia').forEach(x => x.classList.toggle('sel', x.dataset.d === dia));
    $('#ca-dia-t').textContent = new Date(dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    carregando($('#ca-dia'));
    try {
      const r = await GET('/parcelas?aba=todas&de=' + dia + '&ate=' + dia);
      const lista = r.parcelas.filter(p => p.status !== 'cancelado' && p.registro_status !== 'cancelado');
      $('#ca-dia-s').textContent = lista.length ? lista.length + ' parcela(s)' : '';
      $('#ca-dia').innerHTML = lista.length ? lista.map(p => linhaCobranca(p, { mostrarPago: true })).join('') : '<div class="vazio">Nenhum vencimento neste dia.</div>';
    } catch (e) { falha(e); }
  };
  const desenhar = async () => {
    const [a, m] = mes.split('-').map(Number);
    $('#ca-mes').textContent = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const r = await GET('/calendario?mes=' + mes);
    const mapa = Object.fromEntries(r.dias.map(d => [d.dia, d]));
    const inicio = new Date(Date.UTC(a, m - 1, 1)).getUTCDay(), total = new Date(Date.UTC(a, m, 0)).getUTCDate();
    let h = '';
    for (let i = 0; i < inicio; i++) h += '<div class="cal-dia fora"></div>';
    for (let d = 1; d <= total; d++) {
      const iso = mes + '-' + String(d).padStart(2, '0'), x = mapa[iso];
      const tipo = x ? (x.atrasadas ? 't-atraso' : x.pagas === x.qtd ? 't-pago' : 't-aberto') : '';
      h += `<button class="cal-dia ${tipo} ${iso === r.hoje ? 'hoje' : ''} ${iso === sel ? 'sel' : ''}" data-d="${iso}"><b>${d}</b>
        ${x ? `<span class="cq muted">${x.qtd} parc.</span><span class="cv">${moedaCurta(x.pagas === x.qtd ? x.total : x.a_receber)}</span>` : ''}</button>`;
    }
    $('#ca-grade').innerHTML = h;
    el.querySelectorAll('.cal-dia[data-d]').forEach(b => b.onclick = () => verDia(b.dataset.d));
  };
  const mudar = n => { const [a, m] = mes.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); mes = d.toISOString().slice(0, 7); desenhar().catch(falha); };
  $('#ca-ant').onclick = () => mudar(-1);
  $('#ca-prox').onclick = () => mudar(1);
  await desenhar();
  verDia(sel);
};

/* ═══════════════════ RELATÓRIOS ═══════════════════ */
Admin.relatorios = async el => {
  const h = hojeISO();
  const iniMes = h.slice(0, 7) + '-01';
  const antIni = (() => { const [a, m] = h.split('-').map(Number); return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10); })();
  const antFim = somaDias(iniMes, -1);
  const periodos = { hoje: ['Hoje', h, h], d7: ['7 dias', somaDias(h, -6), h], d30: ['30 dias', somaDias(h, -29), h], mes: ['Este mês', iniMes, h], ant: ['Mês anterior', antIni, antFim], pers: ['Personalizado'] };
  let atual = 'hoje';
  el.innerHTML = `<div class="topo"><div><h1>Relatórios</h1><p id="rl-per"></p></div><button class="btn btn-claro" onclick="window.print()">Imprimir</button></div>
    <div class="abas" id="rl-abas">${Object.entries(periodos).map(([k, v]) => `<button data-p="${k}" class="${k === atual ? 'sel' : ''}">${v[0]}</button>`).join('')}</div>
    <div class="linha-campos" id="rl-pers" hidden style="max-width:420px"><div class="campo"><label>De</label><input class="entrada" type="date" id="rl-de" value="${iniMes}"></div><div class="campo"><label>Até</label><input class="entrada" type="date" id="rl-ate" value="${h}"></div></div>
    <div id="rl-corpo"></div>`;
  const $ = s => el.querySelector(s);
  const tabela = (titulo, linhas, cols) => `<div class="painel"><h2 style="margin-bottom:8px">${titulo}</h2>${linhas.length ? `<div class="tabela-wrap"><table class="tabela"><tr>${cols.map(c => `<th class="${c.dir ? 'dir' : ''}">${c.t}</th>`).join('')}</tr>
    ${linhas.map(l => '<tr>' + cols.map(c => `<td class="${c.dir ? 'dir' : ''}">${c.f(l)}</td>`).join('') + '</tr>').join('')}</table></div>` : '<div class="vazio">Sem dados no período.</div>'}</div>`;
  const carregar = async (de, ate) => {
    carregando($('#rl-corpo'));
    try {
      const r = await GET('/relatorios?de=' + de + '&ate=' + ate);
      $('#rl-per').textContent = dataBR(r.de) + ' a ' + dataBR(r.ate);
      const max = Math.max(1, ...r.por_periodo.map(p => Math.max(p.previsto, p.recebido)));
      $('#rl-corpo').innerHTML = `
        <div class="grade grade-4">
          <div class="indicador"><span>Total registrado</span><strong>${moeda(r.registrado.v)}</strong><small>${r.registrado.n} registro(s)</small></div>
          <div class="indicador bom"><span>Total recebido</span><strong>${moeda(r.recebido.v)}</strong><small>${r.recebido.n} pagamento(s)</small></div>
          <div class="indicador"><span>Pendente no período</span><strong>${moeda(r.pendente.v)}</strong><small>${r.pendente.n} parcela(s)</small></div>
          <div class="indicador alerta"><span>Em atraso hoje</span><strong>${moeda(r.atrasado.v)}</strong><small>${r.atrasado.n} parcela(s)</small></div>
          <div class="indicador"><span>Vencimentos no período</span><strong>${moeda(r.previsto.v)}</strong></div>
          <div class="indicador"><span>Acréscimos dos registros do período</span><strong>${moeda(r.registrado.acr)}</strong></div>
          <div class="indicador"><span>Acréscimos previstos (ativos)</span><strong>${moeda(r.acrescimos_ativos)}</strong></div>
          <div class="indicador"><span>Recebido ÷ vencimentos</span><strong>${r.previsto.v > 0 ? pct(r.recebido.v / r.previsto.v * 100) : '—'}</strong></div>
        </div>
        <div class="painel mt"><div class="painel-topo"><h2>Valores por período</h2><div class="legenda"><span><i style="background:#C9D5EE"></i>Vencimentos</span><span><i style="background:var(--verde)"></i>Recebido</span></div></div>
          ${r.por_periodo.length ? `<div class="barras">${r.por_periodo.map(p => `<div class="barra" title="${esc(p.periodo)}: vencimentos ${moeda(p.previsto)}, recebido ${moeda(p.recebido)}"><div class="par">
            <div class="b1" style="height:${(p.previsto / max * 100).toFixed(1)}%"></div><div class="b2" style="height:${(p.recebido / max * 100).toFixed(1)}%"></div></div>
            <small>${p.periodo.length === 7 ? p.periodo.slice(5) + '/' + p.periodo.slice(2, 4) : dataCurta(p.periodo)}</small></div>`).join('')}</div>` : '<div class="vazio">Sem movimentação no período.</div>'}</div>
        <div class="grade grade-2 mt">
          ${tabela('Por cliente', r.por_cliente, [{ t: 'Cliente', f: l => `<a href="#/cliente/${l.id}">${esc(l.nome)}</a>` }, { t: 'Recebido', dir: 1, f: l => moeda(l.recebido) }, { t: 'Pendente', dir: 1, f: l => moeda(l.pendente) }, { t: 'Atraso', dir: 1, f: l => l.atrasado ? '<span style="color:var(--margem)">' + moeda(l.atrasado) + '</span>' : '—' }])}
          ${tabela('Por descrição', r.por_descricao, [{ t: 'Descrição', f: l => esc(l.chave) }, { t: 'Qtd', dir: 1, f: l => l.registros }, { t: 'Total', dir: 1, f: l => moeda(l.total) }, { t: 'Recebido', dir: 1, f: l => moeda(l.recebido) }])}
          ${tabela('Por frequência', r.por_frequencia, [{ t: 'Frequência', f: l => FREQ[l.chave] || esc(l.chave) }, { t: 'Qtd', dir: 1, f: l => l.registros }, { t: 'Total', dir: 1, f: l => moeda(l.total) }, { t: 'Acréscimos', dir: 1, f: l => moeda(l.acrescimo) }])}
          ${tabela('Por forma de pagamento', r.por_forma, [{ t: 'Forma', f: l => esc(l.chave) }, { t: 'Pagamentos', dir: 1, f: l => l.n }, { t: 'Valor', dir: 1, f: l => moeda(l.v) }])}
        </div>`;
    } catch (e) { falha(e); }
  };
  el.querySelectorAll('#rl-abas button').forEach(b => b.onclick = () => {
    atual = b.dataset.p;
    el.querySelectorAll('#rl-abas button').forEach(x => x.classList.toggle('sel', x === b));
    $('#rl-pers').hidden = atual !== 'pers';
    if (atual === 'pers') carregar($('#rl-de').value, $('#rl-ate').value);
    else carregar(periodos[atual][1], periodos[atual][2]);
  });
  ['#rl-de', '#rl-ate'].forEach(s => $(s).addEventListener('change', () => carregar($('#rl-de').value, $('#rl-ate').value)));
  carregar(h, h);
};

/* ═══════════════════ CONFIGURAÇÕES ═══════════════════ */
Admin.config = async el => {
  const c = await carregarConfig(true);
  const mod = await GET('/modelos');
  const editar = pode('configuracoes');
  const lig = k => String(c[k]) === '1';
  const tg = (k, t) => `<label class="check"><input type="checkbox" name="${k}" ${lig(k) ? 'checked' : ''} ${editar ? '' : 'disabled'}> ${t}</label>`;
  el.innerHTML = `<div class="topo"><div><h1>Configurações</h1><p>${editar ? 'Ajuste o sistema ao seu jeito de trabalhar.' : 'Você pode ver, mas não alterar, estas configurações.'}</p></div></div>
    <div class="grade grade-2" style="align-items:start">
      <div>
        <div class="painel" id="cf-empresa"><h2 style="margin-bottom:12px">Dados da empresa</h2>
          <div class="campo"><label>Nome que aparece nas mensagens</label><input class="entrada" name="empresa_nome" value="${esc(c.empresa_nome)}"></div>
          <div class="linha-campos"><div class="campo"><label>CPF/CNPJ</label><input class="entrada" name="empresa_documento" value="${esc(c.empresa_documento)}"></div>
          <div class="campo"><label>Telefone</label><input class="entrada" name="empresa_telefone" value="${esc(c.empresa_telefone)}"></div></div>
          <div class="campo"><label>Endereço</label><input class="entrada" name="empresa_endereco" value="${esc(c.empresa_endereco)}"></div>
          <div class="campo"><label>Chave Pix (variável {pix})</label><input class="entrada" name="pix_chave" value="${esc(c.pix_chave)}"></div>
          ${editar ? '<button class="btn" data-salvar="cf-empresa">Salvar dados</button>' : ''}</div>
        <div class="painel" id="cf-cobranca"><h2 style="margin-bottom:12px">Cobrança</h2>
          <div class="campo"><label>Percentuais rápidos</label><input class="entrada" name="percentuais_padrao" data-lista="num" value="${esc(c.percentuais.join('; '))}"><small>Separe com ponto e vírgula. Ex.: 10; 12; 12,5; 20</small></div>
          <div class="campo"><label>Descrições rápidas</label><input class="entrada" name="descricoes_padrao" data-lista="txt" value="${esc(c.descricoes.join('; '))}"><small>Aparecem como atalhos no novo registro.</small></div>
          <div class="campo"><label>Formas de pagamento</label><input class="entrada" name="formas_pagamento" data-lista="txt" value="${esc(c.formas.join('; '))}"></div>
          <div class="campo"><label>Dias de cobrança (pagamentos diários)</label><div id="cf-dias"></div><small>Já vem marcado assim em todo novo registro diário. Dá para mudar em cada registro.</small></div>
          ${editar ? '<button class="btn" data-salvar="cf-cobranca">Salvar cobrança</button>' : ''}</div>
        <div class="painel" id="cf-lemb"><h2 style="margin-bottom:6px">Lembretes</h2><p class="muted" style="margin-top:0">O sistema prepara os lembretes todos os dias. No modo manual, eles aparecem no Início para você enviar com um toque.</p>
          ${tg('lembrete_7d', '7 dias antes')}${tg('lembrete_3d', '3 dias antes')}${tg('lembrete_1d', '1 dia antes')}${tg('lembrete_hoje', 'No dia do vencimento')}
          ${tg('lembrete_diario', 'Pagamentos diários: lembrete todo dia de pagamento')}
          ${tg('lembrete_atraso', 'Depois do vencimento')}
          <div class="linha-campos"><div class="campo"><label>Repetir a cada (dias)</label><input class="entrada" type="number" min="1" max="30" name="lembrete_atraso_intervalo" value="${esc(c.lembrete_atraso_intervalo)}" ${editar ? '' : 'disabled'}></div>
          <div class="campo"><label>Parar após (dias de atraso)</label><input class="entrada" type="number" min="1" max="365" name="lembrete_atraso_max" value="${esc(c.lembrete_atraso_max)}" ${editar ? '' : 'disabled'}></div></div>
          ${editar ? '<button class="btn" data-salvar="cf-lemb">Salvar lembretes</button>' : ''}</div>
      </div>
      <div>
        <div class="painel"><h2 style="margin-bottom:6px">Modelos de cobrança</h2><p class="muted" style="margin-top:0">Toque numa variável para inserir no texto.</p>
          <div class="chips" style="gap:6px;margin-bottom:10px">${mod.variaveis.map(v => `<button type="button" class="var-chip" data-var="${v}">${v}</button>`).join('')}</div>
          ${mod.modelos.map(m => `<div class="campo" style="margin-top:16px"><label>${esc(m.titulo)}</label>
            <textarea class="entrada" data-modelo="${m.tipo}" rows="8" ${editar ? '' : 'disabled'}>${esc(m.texto)}</textarea>
            <div class="acoes">${editar ? `<button class="btn btn-p" data-mod-salvar="${m.tipo}">Salvar</button><button class="btn btn-p btn-claro" data-mod-rest="${m.tipo}">Restaurar padrão</button>` : ''}<button class="btn btn-p btn-claro" data-mod-prev="${m.tipo}">Ver exemplo</button></div></div>`).join('')}</div>
        <div class="painel" id="cf-zap"><h2 style="margin-bottom:6px">WhatsApp</h2>
          <div class="campo"><label>Modo de envio</label><select class="entrada" name="whatsapp_provedor" ${editar ? '' : 'disabled'}>
            <option value="manual" ${c.whatsapp_provedor === 'manual' ? 'selected' : ''}>Manual: abro o WhatsApp com a mensagem pronta</option>
            <option value="webhook" ${c.whatsapp_provedor === 'webhook' ? 'selected' : ''}>Automático: enviar por uma API de WhatsApp</option></select></div>
          <div id="cf-zap-auto" ${c.whatsapp_provedor === 'webhook' ? '' : 'hidden'}>
            <div class="campo"><label>Endereço da API (URL)</label><input class="entrada" name="whatsapp_webhook_url" placeholder="https://..." value="${esc(c.whatsapp_webhook_url)}"><small>O sistema envia um POST com { telefone, mensagem } das 8h às 20h.</small></div>
            <div class="campo"><label>Token de acesso</label><input class="entrada" name="whatsapp_webhook_token" type="password" value="${esc(c.whatsapp_webhook_token)}"></div>
            ${editar ? '<div class="linha-campos"><div class="campo"><label>Número para teste</label><input class="entrada" id="cf-zap-tel" inputmode="tel" placeholder="(88) 99999-0000"></div></div><button class="btn btn-claro" id="cf-zap-teste">Enviar teste</button>' : ''}
          </div>
          ${editar ? '<button class="btn mt" data-salvar="cf-zap">Salvar WhatsApp</button>' : ''}</div>
        <div class="painel"><h2 style="margin-bottom:12px">Minha conta</h2>
          <p style="margin-top:0"><b>${esc(Sessao.usuario.nome)}</b></p>
          <div class="campo"><label>Senha atual</label><input class="entrada" type="password" id="cf-s1" autocomplete="current-password"></div>
          <div class="campo"><label>Nova senha</label><input class="entrada" type="password" id="cf-s2" autocomplete="new-password"><small>Mínimo de 6 caracteres.</small></div>
          <button class="btn" id="cf-senha">Trocar senha</button></div>
      </div>
    </div>`;
  const $ = s => el.querySelector(s);
  const selDias = seletorDias($('#cf-dias'), c.dias_cobranca);
  if (!editar) $('#cf-dias').querySelectorAll('input,button').forEach(x => { x.disabled = true; });
  el.querySelectorAll('[data-salvar]').forEach(b => b.onclick = async () => {
    const box = $('#' + b.dataset.salvar), dados = {};
    if (b.dataset.salvar === 'cf-cobranca') {
      dados.dias_cobranca_padrao = JSON.stringify(selDias.valor());
      if (!selDias.valor().length) return toast('Marque pelo menos um dia de cobrança.', 'erro');
    }
    box.querySelectorAll('[name]').forEach(i => {
      if (i.type === 'checkbox') dados[i.name] = i.checked ? '1' : '0';
      else if (i.dataset.lista) dados[i.name] = JSON.stringify(i.value.split(';').map(x => x.trim()).filter(Boolean).map(x => i.dataset.lista === 'num' ? lerNumero(x) : x));
      else dados[i.name] = i.value;
    });
    try { await PUT('/config', dados); await carregarConfig(true); toast('Configurações salvas.', 'ok'); } catch (e) { falha(e); }
  });
  let ultimoTexto = null;
  el.querySelectorAll('[data-modelo]').forEach(t => t.addEventListener('focus', () => { ultimoTexto = t; }));
  el.querySelectorAll('[data-var]').forEach(v => v.onclick = () => {
    const t = ultimoTexto || el.querySelector('[data-modelo]');
    if (!t || t.disabled) return;
    const i = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, i) + v.dataset.var + t.value.slice(t.selectionEnd ?? i);
    t.focus(); t.selectionStart = t.selectionEnd = i + v.dataset.var.length;
  });
  el.querySelectorAll('[data-mod-salvar]').forEach(b => b.onclick = async () => {
    try { await PUT('/modelos/' + b.dataset.modSalvar, { texto: el.querySelector(`[data-modelo="${b.dataset.modSalvar}"]`).value }); toast('Modelo salvo.', 'ok'); } catch (e) { falha(e); }
  });
  el.querySelectorAll('[data-mod-rest]').forEach(b => b.onclick = async () => {
    try { const r = await POST('/modelos/' + b.dataset.modRest + '/restaurar'); el.querySelector(`[data-modelo="${b.dataset.modRest}"]`).value = r.texto; toast('Modelo restaurado.', 'ok'); } catch (e) { falha(e); }
  });
  el.querySelectorAll('[data-mod-prev]').forEach(b => b.onclick = async () => {
    try {
      const r = await POST('/modelos/previa', { tipo: b.dataset.modPrev, texto: el.querySelector(`[data-modelo="${b.dataset.modPrev}"]`).value });
      abrirModal({ titulo: 'Exemplo da mensagem', subtitulo: 'Com dados fictícios', corpo: '<div class="previa">' + esc(r.texto) + '</div>', rodape: '<button class="btn btn-claro" data-fechar>Fechar</button>' });
    } catch (e) { falha(e); }
  });
  const sel = el.querySelector('[name=whatsapp_provedor]');
  sel.addEventListener('change', () => { $('#cf-zap-auto').hidden = sel.value !== 'webhook'; });
  const tb = $('#cf-zap-teste');
  if (tb) tb.onclick = async () => {
    try { const r = await POST('/whatsapp/teste', { telefone: $('#cf-zap-tel').value }); r.ok ? toast('Mensagem de teste enviada.', 'ok') : toast(r.erro || 'Falha no envio.', 'erro'); } catch (e) { falha(e); }
  };
  $('#cf-senha').onclick = async () => {
    try { await PUT('/auth/senha', { atual: $('#cf-s1').value, nova: $('#cf-s2').value }); $('#cf-s1').value = $('#cf-s2').value = ''; toast('Senha alterada.', 'ok'); } catch (e) { falha(e); }
  };
};

/* ═══════════════════ FINANCEIRO ═══════════════════ */
const TIPO_FIN = {
  recebido: { t: 'Recebido', ic: '↓', sinal: '+' },
  investimento: { t: 'Investimento', ic: '↑', sinal: '−' },
  extra: { t: 'Extra', ic: '+', sinal: '+' },
  despesa: { t: 'Despesa', ic: '−', sinal: '−' },
};

function modalLancamento(tipo, l, categorias, aoSalvar) {
  let tp = l ? l.tipo : tipo;
  const m = abrirModal({
    titulo: l ? 'Editar lançamento' : 'Novo lançamento',
    corpo: `<div class="fin-tipos" id="lc-tipos">${['investimento', 'extra', 'despesa'].map(k => `<button type="button" class="${k}${k === tp ? ' sel' : ''}" data-t="${k}">${TIPO_FIN[k].t}</button>`).join('')}</div>
      <p class="muted" id="lc-ajuda" style="margin:10px 0 4px;font-size:13px"></p>
      <div class="campo mt"><label>Valor</label><input class="entrada entrada-grande num" id="lc-valor" inputmode="decimal" placeholder="0,00" value="${l ? String(Number(l.valor).toFixed(2)).replace('.', ',') : ''}"></div>
      <div class="campo"><label>Descrição</label><input class="entrada" id="lc-desc" maxlength="120" value="${esc(l ? l.descricao : '')}"></div>
      <div class="chips" id="lc-cats" style="margin:-4px 0 14px"></div>
      <div class="linha-campos">
        <div class="campo"><label>Data</label><input class="entrada" type="date" id="lc-data" value="${l ? l.data : hojeISO()}"></div>
        <div class="campo"><label>Forma <span class="muted" style="font-weight:500">(opcional)</span></label><select class="entrada" id="lc-forma"><option value="">—</option>${CFG.formas.map(f => `<option ${l && l.forma === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
      </div>`,
    rodape: (l ? '<button class="btn btn-perigo" id="lc-del" style="margin-right:auto">Excluir</button>' : '') + '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn" id="lc-ok">Salvar</button>',
  });
  let categoria = l ? l.categoria : '';
  const ajuda = { investimento: 'Dinheiro que saiu para emprestar, comprar mercadoria ou aplicar no negócio.', extra: 'Dinheiro que entra no caixa sem ser parcela de cliente: o dinheiro que você colocou para emprestar, uma venda à vista…', despesa: 'Gastos do negócio: combustível, aluguel, contas, salários…' };
  const placeholder = { investimento: 'Ex.: Compra de mercadoria', extra: 'Ex.: Dinheiro colocado no caixa', despesa: 'Ex.: Gasolina da moto' };
  const desenhar = () => {
    m.querySelectorAll('#lc-tipos button').forEach(b => b.classList.toggle('sel', b.dataset.t === tp));
    m.querySelector('#lc-ajuda').textContent = ajuda[tp];
    m.querySelector('#lc-desc').placeholder = placeholder[tp];
    const box = m.querySelector('#lc-cats');
    box.innerHTML = tp === 'despesa' ? categorias.map(c => `<button type="button" class="chip${c === categoria ? ' sel' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('') : '';
    box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
      categoria = categoria === b.dataset.c ? '' : b.dataset.c;
      const d = m.querySelector('#lc-desc'); if (!d.value.trim() && categoria) d.value = categoria;
      desenhar();
    });
  };
  m.querySelectorAll('#lc-tipos button').forEach(b => b.onclick = () => { tp = b.dataset.t; if (tp !== 'despesa') categoria = ''; desenhar(); });
  desenhar();
  if (window.innerWidth > 640) setTimeout(() => m.querySelector('#lc-valor').focus(), 60);
  m.querySelector('#lc-ok').onclick = async e => {
    const corpo = { tipo: tp, valor: lerMoeda(m.querySelector('#lc-valor').value), descricao: m.querySelector('#lc-desc').value,
                    data: m.querySelector('#lc-data').value, forma: m.querySelector('#lc-forma').value, categoria };
    e.currentTarget.disabled = true;
    try {
      if (l) await PUT('/financeiro/lancamentos/' + l.id, corpo); else await POST('/financeiro/lancamentos', corpo);
      fecharModal(); toast(TIPO_FIN[tp].t + (tp === 'despesa' ? (l ? ' atualizada.' : ' lançada.') : (l ? ' atualizado.' : ' lançado.')), 'ok'); aoSalvar && aoSalvar();
    } catch (err) { falha(err); e.currentTarget.disabled = false; }
  };
  const del = m.querySelector('#lc-del');
  if (del) del.onclick = async () => {
    fecharModal();
    if (!await confirmar('Excluir lançamento', 'Excluir <b>' + esc(l.descricao) + '</b> de ' + moeda(l.valor) + '?', 'Excluir', true)) return;
    try { await DEL('/financeiro/lancamentos/' + l.id); toast('Lançamento excluído.', 'ok'); aoSalvar && aoSalvar(); } catch (err) { falha(err); }
  };
}

Admin.financeiro = async el => {
  await carregarConfig();
  const h = hojeISO(), iniMes = h.slice(0, 7) + '-01';
  const antIni = (() => { const [a, m] = h.split('-').map(Number); return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10); })();
  const periodos = { hoje: ['Hoje', h, h], d7: ['7 dias', somaDias(h, -6), h], mes: ['Este mês', iniMes, h], ant: ['Mês anterior', antIni, somaDias(iniMes, -1)], ano: ['Este ano', h.slice(0, 4) + '-01-01', h], pers: ['Personalizado'] };
  const est = { per: 'hoje', de: h, ate: h, filtro: 'todos', dados: null };
  let secao = 'resumo';
  try { secao = sessionStorage.getItem('cf_fin_secao') || 'resumo'; } catch (e) {}
  el.innerHTML = `<div class="topo"><div><h1>Financeiro</h1></div></div>
    <div id="fn-caixa"></div>
    <div class="fin-botoes">
      <button class="btn btn-claro" data-novo="investimento" style="color:var(--tinta)"><b>↑</b>Investimento</button>
      <button class="btn btn-claro" data-novo="extra" style="color:#0E7C77"><b>+</b>Extra</button>
      <button class="btn btn-claro" data-novo="despesa" style="color:var(--margem)"><b>−</b>Despesa</button>
    </div>
    <div class="segmentos fin-secoes" id="fn-secoes">
      <button data-s="resumo">Resumo</button><button data-s="receber">A receber</button><button data-s="livro">Livro-caixa</button>
    </div>
    <div id="fn-periodo">
      <div class="abas" id="fn-abas">${Object.entries(periodos).map(([k, v]) => `<button data-p="${k}" class="${k === est.per ? 'sel' : ''}">${v[0]}</button>`).join('')}</div>
      <div class="linha-campos" id="fn-pers" hidden style="max-width:420px"><div class="campo"><label>De</label><input class="entrada" type="date" id="fn-de" value="${iniMes}"></div><div class="campo"><label>Até</label><input class="entrada" type="date" id="fn-ate" value="${h}"></div></div>
      <p class="muted" id="fn-per" style="margin:0 0 12px;font-size:13px">&nbsp;</p>
    </div>
    <div data-secao="resumo">
      <div class="grade grade-2" style="align-items:start">
        <div id="fn-extrato"></div>
        <div><div id="fn-formas"></div>
          <details class="painel" id="fn-ajustes-box"><summary style="cursor:pointer;font-weight:700">Ajustes do financeiro</summary><div id="fn-ajustes" style="margin-top:10px"></div></details></div>
      </div>
    </div>
    <div data-secao="receber" hidden><div class="painel" id="fn-receber"></div></div>
    <div data-secao="livro" hidden>
      <div class="painel"><div class="painel-topo"><h2>Livro-caixa</h2><small id="fn-qtd"></small></div>
        <div id="fn-conf"></div>
        <div class="abas" id="fn-filtro" style="margin-bottom:4px">${[['todos', 'Todas'], ['entradas', 'Entradas'], ['saidas', 'Saídas'], ['recebido', 'Recebido'], ['investimento', 'Investimento'], ['extra', 'Extra'], ['despesa', 'Despesa']].map(([k, t]) => `<button data-f="${k}" class="${k === 'todos' ? 'sel' : ''}">${t}</button>`).join('')}</div>
        <div class="lista" id="fn-lista"></div></div>
    </div>`;
  const $ = s => el.querySelector(s);

  const linha = (tipo, valor, sub) => `<div class="extrato-linha"><span class="ic t-${tipo}">${TIPO_FIN[tipo].ic}</span>
    <span class="rot"><b>Total ${TIPO_FIN[tipo].t}</b><small>${sub}</small></span><span class="val v-${tipo}">${moeda(valor)}</span></div>`;
  const desenharExtrato = () => {
    const t = est.dados.totais, inv = t.investimento;
    const subInv = inv.automatico
      ? `${inv.qtd_registros} registro(s)${inv.qtd_manual ? ' + ' + inv.qtd_manual + ' lançamento(s)' : ''}`
      : `${inv.qtd_manual} lançamento(s)`;
    const cx = est.dados.caixa, hj = est.dados.hoje || { entradas: 0, saidas: 0, saldo: 0 };
    const fmtS = v => v < 0 ? '− ' + moeda(-v) : moeda(v);
    $('#fn-caixa').innerHTML = `<div class="faixa-hoje faixa-caixa">
      <div><span>Saldo geral</span><strong>${fmtS(cx.saldo)}</strong><small>Extra − empréstimos + o que os clientes já pagaram − despesas, desde o começo</small></div>
      <div class="secundario"><span>Entrou hoje</span><strong>${moeda(hj.entradas)}</strong></div>
      <div class="secundario"><span>Saiu hoje</span><strong>${moeda(hj.saidas)}</strong></div></div>`;
    const g = est.dados.geral || t, ehHoje = est.de === hojeISO() && est.ate === hojeISO();
    const rotPer = ehHoje ? 'Hoje' : est.de === est.ate ? dataBR(est.de) : 'No período';
    const rs = (rot, v, vg) => `<div class="resumo-fin-linha"><b>${rot}</b><span class="rf-per">${fmtS(v)}</span><span class="rf-ger">${fmtS(vg)}</span></div>`;
    let aberto = false; try { aberto = sessionStorage.getItem('cf_fin_det') === '1'; } catch (e) {}
    $('#fn-extrato').innerHTML = `<div class="resumo-fin">
      <div class="resumo-fin-linha cab"><b></b><span class="rf-per">${rotPer}</span><span class="rf-ger">Desde o começo</span></div>
      ${rs('Recebido', t.recebido.total, g.recebido.total)}${rs('Investimento', inv.total, g.investimento.total)}${rs('Extra', t.extra.total, g.extra.total)}${rs('Despesa', t.despesa.total, g.despesa.total)}
      <div class="resumo-fin-linha saldo"><b>Saldo em caixa</b><span style="color:${est.dados.saldo_final < 0 ? 'var(--margem)' : 'var(--verde)'}">${fmtS(est.dados.saldo_final)}</span></div>
      <div class="resumo-fin-nota">Saldo em caixa = Extra + Recebido − Investimento − Despesa, somando <b>desde o começo</b>${ehHoje ? '' : ' até o fim do período'}. A coluna "${rotPer}" mostra só o que aconteceu ${ehHoje ? 'hoje' : 'no período'}.</div></div>
    <details id="fn-det" class="mt"${aberto ? ' open' : ''}><summary style="cursor:pointer;font-weight:600;margin-bottom:10px">Ver detalhes</summary><div class="extrato">
      ${linha('recebido', t.recebido.total, t.recebido.qtd + ' pagamento(s) · ' + moeda(t.recebido.capital) + ' de volta + ' + moeda(t.recebido.juros) + ' de lucro')}
      ${linha('investimento', inv.total, subInv)}
      ${linha('extra', t.extra.total, t.extra.qtd + ' lançamento(s)')}
      ${linha('despesa', t.despesa.total, t.despesa.qtd + ' lançamento(s)')}
      <div class="extrato-linha"><span class="ic t-extra">%</span><span class="rot"><b>Lucro dos juros recebido</b><small>Parte do recebido que é acréscimo (juros)</small></span><span class="val v-extra">${moeda(t.recebido.juros)}</span></div>
    </div></details>`;
    $('#fn-det').addEventListener('toggle', e => { try { sessionStorage.setItem('cf_fin_det', e.target.open ? '1' : '0'); } catch (x) {} });
  };
  const desenharReceber = () => {
    const r = est.dados.a_receber;
    const card = (rot, x, cls) => `<div class="indicador ${cls || ''}"><span>${rot}</span><strong>${moeda(x.total)}</strong><small>${x.qtd} parcela(s)${x.juros ? '<br>' + moeda(x.juros) + ' de lucro' : ''}</small></div>`;
    const MOSTRA = 7;
    const sem = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const amanhaISO = somaDias(hojeISO(), 1);
    $('#fn-receber').innerHTML = `<div class="painel-topo"><h2>A receber</h2><small>Total em aberto: <b>${moeda(r.total.total)}</b></small></div>
      <div class="grade grade-3">${card('Hoje', r.hoje)}${card('Amanhã', r.amanha)}${card('Próximos 7 dias', r.dias7)}${card('Próximos 30 dias', r.dias30)}${card('Em atraso', r.atrasado, 'alerta')}${card('Lucro ainda a receber', { total: r.total.juros, qtd: r.total.qtd }, 'bom')}</div>
      ${r.agenda.length ? `<h3 class="mt" style="margin-bottom:6px">Agenda de recebimentos</h3><div class="lista" id="fn-agenda">${r.agenda.map((a, i) => `<div class="item clicavel" data-dia="${a.dia}" ${i >= MOSTRA ? 'data-extra hidden' : ''}>
        <div><div class="item-titulo">${a.dia === hojeISO() ? 'Hoje' : a.dia === amanhaISO ? 'Amanhã' : dataBR(a.dia)} <span class="muted" style="font-weight:500;font-size:13px">${sem(a.dia)}</span></div>
        <div class="item-sub"><span>${a.qtd} parcela(s)</span></div></div><div class="item-valor">${moeda(a.total)}</div></div>`).join('')}</div>
        ${r.agenda.length > MOSTRA ? `<button class="btn btn-claro btn-grande mt" id="fn-agenda-mais">Ver mais ${r.agenda.length - MOSTRA} dia(s)</button>` : ''}` : '<div class="vazio">Nenhuma parcela para os próximos 30 dias.</div>'}`;
    el.querySelectorAll('[data-dia]').forEach(d => d.onclick = () => verDiaReceber(d.dataset.dia));
    const mais = $('#fn-agenda-mais');
    if (mais) mais.onclick = () => { el.querySelectorAll('#fn-agenda [data-extra]').forEach(x => { x.hidden = false; }); mais.remove(); };
  };
  const verDiaReceber = async dia => {
    try {
      const r = await GET('/parcelas?aba=todas&de=' + dia + '&ate=' + dia);
      const lista = r.parcelas.filter(p => (p.status === 'pendente' || p.status === 'parcial') && p.registro_status === 'ativo');
      const m = abrirModal({ titulo: 'Receber em ' + dataBR(dia), subtitulo: lista.length + ' parcela(s) · ' + moeda(lista.reduce((t, p) => t + p.valor - p.valor_pago, 0)),
        corpo: '<div class="lista">' + (lista.map(p => linhaCobranca(p)).join('') || '<div class="vazio">Nada em aberto.</div>') + '</div>', largo: true,
        rodape: '<button class="btn btn-claro" data-fechar>Fechar</button>' });
    } catch (e) { falha(e); }
  };
  const desenharFormas = () => {
    const f = est.dados.recebido_por_forma;
    $('#fn-formas').innerHTML = f.length ? `<div class="painel" style="margin-bottom:16px"><h3 style="margin-bottom:8px">Recebido por tipo</h3><div class="lista">${f.map(x => `<div class="item"><div><div class="item-titulo">${esc(x.forma)}</div><div class="item-sub"><span>${x.qtd} pagamento(s)</span></div></div><div class="item-valor v-recebido">${moeda(x.total)}</div></div>`).join('')}</div></div>` : '';
  };
  const desenharLista = () => {
    const d = est.dados;
    const tt = d.totais, fm = v => v < 0 ? '− ' + moeda(-v) : moeda(v);
    $('#fn-conf').innerHTML = `<div class="conta" style="margin-bottom:8px;font-size:14px">
      <div><span>Recebido</span><b>${moeda(tt.recebido.total)}</b></div>
      <div><span>Extra</span><b>${moeda(tt.extra.total)}</b></div>
      <div><span>Investimento</span><b>${moeda(tt.investimento.total)}</b></div>
      <div><span>Despesa</span><b>${moeda(tt.despesa.total)}</b></div>
      <div><span><b>Resultado do período</b> (entrou − saiu)</span><b style="white-space:nowrap;color:${tt.saldo < 0 ? 'var(--margem)' : 'var(--verde)'}">${fm(tt.saldo)}</b></div>
      <div><span>Saldo no início do período</span><b>${d.saldo_inicial < 0 ? '− ' + moeda(-d.saldo_inicial) : moeda(d.saldo_inicial)}</b></div>
      <div><span>Saldo no fim do período</span><b>${d.saldo_final < 0 ? '− ' + moeda(-d.saldo_final) : moeda(d.saldo_final)}</b></div></div>
      <div class="aviso ${d.confere ? 'info' : 'erro'}" style="font-size:13px">${d.confere ? '✓ Conferido: o livro-caixa bate com os totais.' : '⚠ O livro-caixa não bateu com os totais. Faça um backup e fale com o suporte.'}</div>`;
    const f = est.filtro, mov = est.dados.movimentos.filter(x => f === 'todos' || x.tipo === f ||
      (f === 'entradas' && (x.tipo === 'recebido' || x.tipo === 'extra')) || (f === 'saidas' && (x.tipo === 'investimento' || x.tipo === 'despesa')));
    $('#fn-qtd').textContent = mov.length + ' item(ns)';
    window.__lanc = {};
    $('#fn-lista').innerHTML = mov.length ? mov.map(x => {
      if (x.origem === 'lancamento') window.__lanc[x.id] = { id: x.id, tipo: x.tipo, valor: x.valor, descricao: x.descricao, data: x.data, categoria: x.categoria, forma: x.forma };
      const clic = x.origem === 'lancamento' ? `onclick="editarLancamento(${x.id})"` : x.client_id ? `onclick="location.hash='#/cliente/${x.client_id}'"` : '';
      return `<div class="item clicavel" ${clic}><div style="min-width:0;display:flex;gap:12px;align-items:center">
        <span class="ic t-${x.tipo}" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;flex-shrink:0">${TIPO_FIN[x.tipo].ic}</span>
        <div style="min-width:0"><div class="item-titulo">${esc(x.titulo)}</div><div class="item-sub"><span>${dataBR(x.data)}</span><span>${TIPO_FIN[x.tipo].t}</span>${x.detalhe ? '<span>' + esc(x.detalhe) + '</span>' : ''}</div></div></div>
        <div class="item-valor v-${x.tipo}">${TIPO_FIN[x.tipo].sinal} ${moeda(x.valor)}<div class="muted" style="font-size:11.5px;font-weight:500;font-family:var(--f-texto)">caixa: ${x.saldo_apos < 0 ? '− ' + moeda(-x.saldo_apos) : moeda(x.saldo_apos)}</div></div></div>`;
    }).join('') : '<div class="vazio">Nenhuma movimentação neste período.</div>';
  };
  const desenharAjustes = () => {
    const inv = est.dados.totais.investimento;
    $('#fn-ajustes').innerHTML = `<label class="check"><input type="checkbox" id="fn-auto" ${inv.automatico ? 'checked' : ''} ${pode('configuracoes') ? '' : 'disabled'}> Somar o valor principal de cada novo registro no Investimento</label>
      <small class="muted">Ligado: cada venda ou empréstimo registrado entra como dinheiro investido. Desligue se você prefere lançar o investimento à mão.</small>
      <div class="campo mt"><label>Categorias de despesa</label><input class="entrada" id="fn-cats" value="${esc(est.dados.categorias.join('; '))}" ${pode('configuracoes') ? '' : 'disabled'}><small>Separe com ponto e vírgula.</small></div>
      ${pode('configuracoes') ? '<button class="btn btn-p btn-claro" id="fn-salvar-aj">Salvar ajustes</button>' : ''}
      ${pode('configuracoes') ? `<div class="mt" style="border-top:1px solid var(--linha);padding-top:14px"><b>Zerar o Extra (valor investido)</b>
        <p class="muted" style="margin:4px 0 10px;font-size:13px">Use quando o Extra foi lançado errado. Os Extras lançados até agora deixam de contar. Os <b>empréstimos continuam descontando</b> e os <b>pagamentos continuam somando</b>. Depois é só lançar de novo um <b>Extra</b> com o valor certo que foi investido.</p>
        ${est.dados.zerado_em ? `<div class="aviso info" style="margin-top:0">Extra zerado em ${dataHora(est.dados.zerado_em.replace(' ', 'T') + 'Z')}.</div>` : ''}
        <div class="acoes"><button class="btn btn-p btn-perigo" id="fn-zerar">Zerar o Extra</button>${est.dados.zerado_em ? '<button class="btn btn-p btn-claro" id="fn-desfazer">Desfazer o zerar</button>' : ''}</div></div>` : ''}`;
    const b = $('#fn-salvar-aj');
    if (b) b.onclick = async () => {
      try {
        await PUT('/financeiro/config', { investimento_auto: $('#fn-auto').checked, categorias: $('#fn-cats').value.split(';').map(x => x.trim()).filter(Boolean) });
        toast('Ajustes salvos.', 'ok'); carregar();
      } catch (e) { falha(e); }
    };
    const z = $('#fn-zerar');
    if (z) z.onclick = async () => {
      if (!await confirmar('Zerar o Extra', 'Os Extras lançados até agora deixam de contar.<br><br>Os empréstimos <b>continuam descontando</b> e os pagamentos <b>continuam somando</b>. Clientes e histórico não mudam. Se precisar, dá para desfazer depois.', 'Zerar o Extra', true)) return;
      try { await POST('/financeiro/zerar', {}); toast('Extra zerado. Agora lance o Extra com o valor certo investido.', 'ok'); carregar(); } catch (e) { falha(e); }
    };
    const dz = $('#fn-desfazer');
    if (dz) dz.onclick = async () => {
      if (!await confirmar('Desfazer o zerar', 'Os Extras lançados antes de zerar voltam a contar. Os lançados depois continuam.', 'Desfazer')) return;
      try { await POST('/financeiro/desfazer-zerar', {}); toast('Pronto, voltou como era.', 'ok'); carregar(); } catch (e) { falha(e); }
    };
  };
  const carregar = async () => {
    carregando($('#fn-lista'));
    try {
      est.dados = await GET('/financeiro?de=' + est.de + '&ate=' + est.ate);
      $('#fn-per').textContent = est.de === est.ate ? dataBR(est.de) : dataBR(est.de) + ' a ' + dataBR(est.ate);
      desenharExtrato(); desenharReceber(); desenharFormas(); desenharLista(); desenharAjustes();
    } catch (e) { falha(e); }
  };
  const mostrarSecao = sx => {
    secao = sx; try { sessionStorage.setItem('cf_fin_secao', sx); } catch (e) {}
    el.querySelectorAll('#fn-secoes button').forEach(b => b.classList.toggle('sel', b.dataset.s === sx));
    el.querySelectorAll('[data-secao]').forEach(d => { d.hidden = d.dataset.secao !== sx; });
    $('#fn-periodo').hidden = sx === 'receber';
  };
  el.querySelectorAll('#fn-secoes button').forEach(b => b.onclick = () => mostrarSecao(b.dataset.s));
  mostrarSecao(secao);
  window.editarLancamento = id => modalLancamento(null, window.__lanc[id], est.dados.categorias, carregar);
  el.querySelectorAll('[data-novo]').forEach(b => b.onclick = () => modalLancamento(b.dataset.novo, null, (est.dados && est.dados.categorias) || [], carregar));
  el.querySelectorAll('#fn-abas button').forEach(b => b.onclick = () => {
    est.per = b.dataset.p; el.querySelectorAll('#fn-abas button').forEach(x => x.classList.toggle('sel', x === b));
    $('#fn-pers').hidden = est.per !== 'pers';
    if (est.per === 'pers') { est.de = $('#fn-de').value; est.ate = $('#fn-ate').value; } else { est.de = periodos[est.per][1]; est.ate = periodos[est.per][2]; }
    carregar();
  });
  ['#fn-de', '#fn-ate'].forEach(s => $(s).addEventListener('change', () => { est.de = $('#fn-de').value; est.ate = $('#fn-ate').value; carregar(); }));
  el.querySelectorAll('#fn-filtro button').forEach(b => b.onclick = () => { est.filtro = b.dataset.f; el.querySelectorAll('#fn-filtro button').forEach(x => x.classList.toggle('sel', x === b)); desenharLista(); });
  await carregar();
};
