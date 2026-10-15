/* super.js — telas do Super Admin */
'use strict';

const Super = {};
const PERM_NOMES = { clientes: 'Clientes', registros: 'Registros', pagamentos: 'Pagamentos', financeiro: 'Financeiro', relatorios: 'Relatórios', whatsapp: 'WhatsApp', configuracoes: 'Configurações' };

function seloAtivo(a) { return a.ativo ? '<span class="selo s-pago">Ativo</span>' : '<span class="selo s-atrasado">Bloqueado</span>'; }

function tabelaAdmins(admins) {
  if (!admins.length) return '<div class="vazio">Nenhum administrador cadastrado.<br><button class="btn" onclick="modalAdmin()">Criar o primeiro</button></div>';
  window.__adm = Object.fromEntries(admins.map(a => [a.id, a]));
  return `<div class="tabela-wrap"><table class="tabela">
    <tr><th>Administrador</th><th class="dir">Clientes</th><th class="dir">Registros</th><th>Status</th><th>Último acesso</th><th>Ações</th></tr>
    ${admins.map(a => `<tr>
      <td><a href="#/super/admin/${a.id}" class="forte" style="text-decoration:none">${esc(a.nome)}</a><div class="muted" style="font-size:12px">${esc(a.email || a.usuario || '')}</div></td>
      <td class="dir">${a.clientes}${a.limite_clientes != null ? '<span class="muted">/' + a.limite_clientes + '</span>' : ''}</td>
      <td class="dir">${a.registros}${a.limite_registros != null ? '<span class="muted">/' + a.limite_registros + '</span>' : ''}</td>
      <td>${seloAtivo(a)}</td>
      <td style="white-space:nowrap">${a.ultimo_acesso ? dataHora(a.ultimo_acesso) : '<span class="muted">Nunca entrou</span>'}</td>
      <td><div class="acoes" style="flex-wrap:nowrap">
        <a class="btn btn-p btn-claro" href="#/super/admin/${a.id}">Ver</a>
        <button class="btn btn-p btn-claro" onclick="modalAdmin(window.__adm[${a.id}])">Editar</button>
        <button class="btn btn-p ${a.ativo ? 'btn-perigo' : 'btn-verde'}" onclick="alternarAdmin(${a.id}, ${a.ativo ? 0 : 1})">${a.ativo ? 'Bloquear' : 'Ativar'}</button>
        <button class="btn btn-p btn-claro" onclick="redefinirSenha(${a.id})">Senha</button>
      </div></td></tr>`).join('')}</table></div>`;
}

function modalAdmin(a) {
  const novo = !a;
  a = a || { ativo: 1, permissoes: Object.fromEntries(Object.keys(PERM_NOMES).map(k => [k, true])) };
  const m = abrirModal({
    titulo: novo ? 'Novo administrador' : 'Editar administrador', largo: true,
    corpo: `<div class="linha-campos">
        <div class="campo"><label>Nome *</label><input class="entrada" name="nome" value="${esc(a.nome)}"></div>
        <div class="campo"><label>Telefone</label><input class="entrada" name="telefone" inputmode="tel" value="${esc(a.telefone)}"></div></div>
      <div class="linha-campos">
        <div class="campo"><label>E-mail</label><input class="entrada" name="email" type="email" value="${esc(a.email)}"></div>
        <div class="campo"><label>Usuário</label><input class="entrada" name="usuario" autocapitalize="off" value="${esc(a.usuario)}"><small>Pode entrar com o e-mail ou com o usuário.</small></div></div>
      ${novo ? '<div class="campo"><label>Senha *</label><input class="entrada" name="senha" type="text" autocomplete="off"><small>Mínimo de 6 caracteres. Passe para o administrador.</small></div>' : ''}
      <div class="linha-campos">
        <div class="campo"><label>Limite de clientes</label><input class="entrada" name="limite_clientes" type="number" min="0" placeholder="Sem limite" value="${a.limite_clientes ?? ''}"></div>
        <div class="campo"><label>Limite de registros</label><input class="entrada" name="limite_registros" type="number" min="0" placeholder="Sem limite" value="${a.limite_registros ?? ''}"></div>
        <div class="campo"><label>Status</label><select class="entrada" name="ativo"><option value="1" ${a.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${a.ativo ? '' : 'selected'}>Bloqueado</option></select></div></div>
      <span class="rotulo">Permissões</span>
      <div class="linha-campos" id="ad-perm">${Object.entries(PERM_NOMES).map(([k, v]) => `<label class="check"><input type="checkbox" data-perm="${k}" ${a.permissoes && a.permissoes[k] ? 'checked' : ''}> ${v}</label>`).join('')}</div>
      <div class="campo mt"><label>Observações</label><textarea class="entrada" name="observacoes" rows="2">${esc(a.observacoes)}</textarea></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn" id="ad-ok">' + (novo ? 'Criar administrador' : 'Salvar alterações') + '</button>',
  });
  m.querySelector('#ad-ok').onclick = async () => {
    const d = formDados(m);
    d.ativo = d.ativo === '1';
    d.permissoes = {};
    m.querySelectorAll('[data-perm]').forEach(c => { d.permissoes[c.dataset.perm] = c.checked; });
    try {
      if (novo) await POST('/super/admins', d); else await PUT('/super/admins/' + a.id, d);
      fecharModal(); toast(novo ? 'Administrador criado.' : 'Alterações salvas.', 'ok'); App.recarregar();
    } catch (e) { falha(e); }
  };
}

async function alternarAdmin(id, ativo) {
  const a = (window.__adm || {})[id] || {};
  if (!ativo && !await confirmar('Bloquear acesso', 'Bloquear <b>' + esc(a.nome || '') + '</b>? Ele sai do sistema na hora e não consegue entrar até ser ativado.', 'Bloquear', true)) return;
  try { await POST('/super/admins/' + id + '/status', { ativo }); toast(ativo ? 'Acesso ativado.' : 'Acesso bloqueado.', 'ok'); App.recarregar(); } catch (e) { falha(e); }
}

async function redefinirSenha(id) {
  const s = await pedirTexto('Redefinir senha', 'Nova senha (mínimo 6 caracteres)', 'Redefinir');
  if (!s) return;
  try { await POST('/super/admins/' + id + '/senha', { senha: s }); toast('Senha redefinida. Informe ao administrador.', 'ok'); } catch (e) { falha(e); }
}

async function excluirAdmin(id, nome) {
  const t = await pedirTexto('Excluir administrador', 'Todos os clientes e registros de ' + nome + ' serão apagados. Digite EXCLUIR para confirmar', 'Excluir definitivamente', true);
  if (!t) return;
  try { await DEL('/super/admins/' + id, { confirmar: t }); toast('Administrador excluído.', 'ok'); location.hash = '#/super/admins'; } catch (e) { falha(e); }
}

Super.inicio = async el => {
  carregando(el);
  const d = await GET('/super/dashboard');
  el.innerHTML = `<div class="topo"><div><h1>Painel geral</h1><p>Visão de todos os administradores</p></div><button class="btn" onclick="modalAdmin()">${I.mais} Novo administrador</button></div>
    ${d.notificacoes ? `<a class="aviso" style="display:block;text-decoration:none" href="#/super/avisos">Você tem ${d.notificacoes} aviso(s) novo(s), como pedidos de nova senha.</a>` : ''}
    <div class="grade grade-4">
      <div class="indicador"><span>Administradores</span><strong>${d.total_admins}</strong><small>${d.admins_ativos} ativo(s)</small></div>
      <div class="indicador"><span>Clientes cadastrados</span><strong>${d.total_clientes}</strong></div>
      <div class="indicador"><span>Registros</span><strong>${d.total_registros}</strong></div>
      <div class="indicador"><span>Total movimentado</span><strong>${moeda(d.total_movimentado)}</strong></div>
      <div class="indicador bom"><span>Total recebido</span><strong>${moeda(d.total_recebido)}</strong></div>
      <div class="indicador"><span>Total pendente</span><strong>${moeda(d.total_pendente)}</strong></div>
      <div class="indicador alerta"><span>Em atraso</span><strong>${moeda(d.total_atrasado)}</strong></div>
      <div class="indicador"><span>Administradores ativos</span><strong>${d.admins_ativos}</strong></div>
    </div>
    <div class="painel mt"><div class="painel-topo"><h2>Administradores</h2><a href="#/super/admins">Gerenciar</a></div>${tabelaAdmins(d.admins)}</div>`;
};

Super.admins = async el => {
  carregando(el);
  const lista = await GET('/super/admins');
  el.innerHTML = `<div class="topo"><div><h1>Administradores</h1><p>${lista.length} cadastrado(s)</p></div><button class="btn" onclick="modalAdmin()">${I.mais} Novo administrador</button></div>
    <div class="painel">${tabelaAdmins(lista)}</div>`;
};

Super.admin = async (el, id) => {
  carregando(el);
  const a = await GET('/super/admins/' + id);
  window.__adm = { [a.id]: a };
  el.innerHTML = `<button class="voltar" onclick="location.hash='#/super/admins'">${I.voltar} Administradores</button>
    <div class="topo"><div><h1>${esc(a.nome)}</h1><div class="contato"><span>${esc(a.email || '')}</span>${a.usuario ? '<span>Usuário: ' + esc(a.usuario) + '</span>' : ''}${a.telefone ? '<span>' + esc(a.telefone) + '</span>' : ''}${seloAtivo(a)}</div></div>
      <div class="acoes"><button class="btn btn-claro" onclick="modalAdmin(window.__adm[${a.id}])">Editar</button>
      <button class="btn ${a.ativo ? 'btn-perigo' : 'btn-verde'}" onclick="alternarAdmin(${a.id}, ${a.ativo ? 0 : 1})">${a.ativo ? 'Bloquear' : 'Ativar'}</button>
      <button class="btn btn-claro" onclick="redefinirSenha(${a.id})">Redefinir senha</button>
      <button class="btn btn-perigo" onclick="excluirAdmin(${a.id}, ${esc(JSON.stringify(a.nome))})">Excluir</button></div></div>
    <div class="grade grade-4">
      <div class="indicador"><span>Clientes</span><strong>${a.clientes}${a.limite_clientes != null ? ' / ' + a.limite_clientes : ''}</strong></div>
      <div class="indicador"><span>Registros</span><strong>${a.registros}${a.limite_registros != null ? ' / ' + a.limite_registros : ''}</strong></div>
      <div class="indicador"><span>Movimentado</span><strong>${moeda(a.movimentado)}</strong></div>
      <div class="indicador bom"><span>Recebido</span><strong>${moeda(a.recebido)}</strong><small>Pendente ${moeda(a.pendente)}</small></div>
    </div>
    <div class="painel mt"><span class="rotulo">Permissões</span><div class="chips" style="margin-top:8px">${Object.entries(PERM_NOMES).map(([k, v]) => `<span class="selo ${a.permissoes[k] ? 's-pago' : 's-cancelado'}">${v}</span>`).join('')}</div>
      ${a.observacoes ? '<p class="muted">' + esc(a.observacoes) + '</p>' : ''}<p class="muted" style="margin-bottom:0">Criado em ${dataHora(a.criado_em)} · último acesso ${a.ultimo_acesso ? dataHora(a.ultimo_acesso) : 'nunca'}</p></div>
    <div class="grade grade-2 mt">
      <div class="painel"><h2 style="margin-bottom:8px">Últimos pagamentos</h2>${a.movimentos.length ? `<div class="tabela-wrap"><table class="tabela"><tr><th>Data</th><th>Cliente</th><th class="dir">Valor</th></tr>
        ${a.movimentos.map(m => `<tr><td>${dataBR(m.data_pagamento)}</td><td>${esc(m.cliente)}<div class="muted" style="font-size:12px">${esc(m.descricao)} · parc. ${m.numero} · ${esc(m.forma)}</div></td><td class="dir forte">${moeda(m.valor)}</td></tr>`).join('')}</table></div>` : '<div class="vazio">Nenhum pagamento ainda.</div>'}</div>
      <div class="painel"><h2 style="margin-bottom:8px">Últimos registros</h2>${a.registros.length ? `<div class="tabela-wrap"><table class="tabela"><tr><th>Criado</th><th>Cliente</th><th class="dir">Total</th></tr>
        ${a.registros.map(r => `<tr><td>${dataHora(r.criado_em).slice(0, 8)}</td><td>${esc(r.cliente)}<div class="muted" style="font-size:12px">${esc(r.descricao)} · ${r.status}</div></td><td class="dir forte">${moeda(r.total)}</td></tr>`).join('')}</table></div>` : '<div class="vazio">Nenhum registro ainda.</div>'}</div>
    </div>
    <div class="acoes mt"><a class="btn btn-claro" href="#/super/auditoria?admin=${a.id}">${I.hist} Ver histórico de atividades</a></div>`;
};

const ACOES_AUDIT = {
  login: 'Entrou no sistema', senha_alterada: 'Trocou a senha', senha_redefinida: 'Senha redefinida', admin_criado: 'Administrador criado',
  admin_editado: 'Administrador editado', admin_bloqueado: 'Acesso bloqueado', admin_ativado: 'Acesso ativado', admin_excluido: 'Administrador excluído',
  cliente_criado: 'Cliente criado', cliente_editado: 'Cliente editado', cliente_excluido: 'Cliente excluído',
  registro_criado: 'Registro criado', registro_editado: 'Registro editado', registro_cancelado: 'Registro cancelado',
  registro_abatido: 'Valor abatido', registro_renegociado: 'Dívida renegociada',
  parcela_ajustada: 'Parcela ajustada', pagamento_registrado: 'Pagamento registrado', pagamento_estornado: 'Pagamento estornado',
  config_alterada: 'Configurações alteradas', modelo_alterado: 'Modelo de mensagem alterado', config_sistema: 'Configuração do sistema',
  lancamento_criado: 'Lançamento financeiro criado', lancamento_editado: 'Lançamento financeiro editado', lancamento_excluido: 'Lançamento financeiro excluído',
  backup_criado: 'Backup criado', backup_baixado: 'Backup baixado', backup_exportado: 'Backup exportado',
  backup_telegram: 'Backup enviado ao Telegram', backup_importado: 'Backup importado', telegram_configurado: 'Telegram configurado',
};

function resumoDetalhes(det) {
  let d; try { d = JSON.parse(det || 'null'); } catch (e) { return ''; }
  if (!d) return '';
  if (Array.isArray(d)) return d.join(', ');
  const partes = [];
  if (d.cliente) partes.push(d.cliente);
  if (d.nome) partes.push(d.nome);
  if (d.descricao && typeof d.descricao === 'string') partes.push(d.descricao);
  if (d.parcela) partes.push('parcela ' + d.parcela);
  if (typeof d.valor === 'number') partes.push(moeda(d.valor));
  if (d.valor && typeof d.valor === 'object') partes.push(moeda(d.valor.de) + ' → ' + moeda(d.valor.para));
  if (d.total) partes.push(moeda(d.total));
  if (d.forma) partes.push(d.forma);
  if (d.motivo) partes.push('motivo: ' + d.motivo);
  if (!partes.length) Object.keys(d).forEach(k => { if (typeof d[k] === 'object' && d[k] && 'de' in d[k]) partes.push(k + ': ' + (d[k].de ?? '—') + ' → ' + (d[k].para ?? '—')); });
  return partes.join(' · ');
}

Super.auditoria = async el => {
  const q = parametros();
  const admins = await GET('/super/admins');
  el.innerHTML = `<div class="topo"><div><h1>Histórico e auditoria</h1><p>Quem fez o quê, e quando</p></div></div>
    <div class="painel"><div class="filtros" style="margin-top:0">
      <div class="campo"><label>Administrador</label><select class="entrada" id="au-adm"><option value="">Todos</option>${admins.map(a => `<option value="${a.id}" ${String(a.id) === q.admin ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label>Ação</label><select class="entrada" id="au-acao"><option value="">Todas</option>${Object.entries(ACOES_AUDIT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="campo"><label>De</label><input class="entrada" type="date" id="au-de"></div>
      <div class="campo"><label>Até</label><input class="entrada" type="date" id="au-ate"></div></div>
      <div id="au-lista"></div></div>`;
  const $ = s => el.querySelector(s);
  const carregar = async () => {
    carregando($('#au-lista'));
    const p = new URLSearchParams();
    if ($('#au-adm').value) p.set('admin_id', $('#au-adm').value);
    if ($('#au-acao').value) p.set('acao', $('#au-acao').value);
    if ($('#au-de').value) p.set('de', $('#au-de').value);
    if ($('#au-ate').value) p.set('ate', $('#au-ate').value);
    try {
      const r = await GET('/super/auditoria?' + p);
      $('#au-lista').innerHTML = r.length ? `<div class="tabela-wrap"><table class="tabela"><tr><th>Data e hora</th><th>Ação</th><th>Feito por</th><th>Conta</th><th>Detalhes</th></tr>
        ${r.map(l => `<tr><td style="white-space:nowrap">${dataHora(l.criado_em)}</td><td class="forte">${ACOES_AUDIT[l.acao] || esc(l.acao)}</td><td>${esc(l.user_nome || '—')}</td>
          <td>${esc(l.admin_nome || '—')}</td><td class="muted" style="font-size:13px">${esc(resumoDetalhes(l.detalhes))}${l.ip ? '<div style="font-size:11px">IP ' + esc(l.ip) + '</div>' : ''}</td></tr>`).join('')}</table></div>`
        : '<div class="vazio">Nenhuma atividade encontrada com esses filtros.</div>';
    } catch (e) { falha(e); }
  };
  ['#au-adm', '#au-acao', '#au-de', '#au-ate'].forEach(s => $(s).addEventListener('change', carregar));
  carregar();
};

Super.avisos = async el => {
  carregando(el);
  const lista = await GET('/super/notificacoes');
  el.innerHTML = `<div class="topo"><div><h1>Avisos</h1><p>Pedidos de nova senha e outros avisos</p></div>
    ${lista.some(n => !n.lida) ? '<button class="btn btn-claro" id="av-lidas">Marcar todos como lidos</button>' : ''}</div>
    <div class="painel"><div class="lista">${lista.length ? lista.map(n => `<div class="item"><div><div class="item-titulo">${n.lida ? '' : '● '}${esc(n.titulo)}</div>
      <div class="item-sub"><span>${esc(n.texto || '')}</span><span>${dataHora(n.criado_em)}</span></div></div></div>`).join('') : '<div class="vazio">Nenhum aviso.</div>'}</div></div>`;
  const b = el.querySelector('#av-lidas');
  if (b) b.onclick = async () => { await POST('/super/notificacoes/lidas'); App.recarregar(); };
};

const FREQ_BK = { diario: 'Uma vez por dia', '12h': 'A cada 12 horas', '6h': 'A cada 6 horas', semanal: 'Uma vez por semana' };
const tamanhoArq = b => b > 1048576 ? (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

async function baixarArquivo(url, nome) {
  const res = await fetch('/api' + url, { headers: { Authorization: 'Bearer ' + Sessao.token } });
  if (!res.ok) { let j = {}; try { j = await res.json(); } catch (e) {} throw new Error(j.erro || 'Não foi possível baixar.'); }
  const disp = res.headers.get('Content-Disposition') || '';
  const m = disp.match(/filename="([^"]+)"/);
  const link = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = link; a.download = nome || (m && m[1]) || 'backup.db.gz';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(link), 8000);
}

async function enviarBinario(url, arquivo, senha) {
  const headers = { Authorization: 'Bearer ' + Sessao.token, 'Content-Type': 'application/octet-stream' };
  if (senha) headers['X-Senha'] = btoa(unescape(encodeURIComponent(senha)));
  const res = await fetch('/api' + url, { method: 'POST', headers, body: await arquivo.arrayBuffer() });
  let j = {}; try { j = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(j.erro || 'Erro ' + res.status);
  return j;
}

function statusTelegram(t) {
  if (!t.ultimo_status) return '<span class="muted">Nenhum backup enviado ainda.</span>';
  const [tipo, origem, msg] = t.ultimo_status.split('|');
  const quando = t.ultimo_envio ? dataHora(t.ultimo_envio) : '';
  return tipo === 'ok'
    ? `<span class="selo s-pago">Último envio ok</span> <span class="muted">${quando} · ${origem === 'automatico' ? 'automático' : 'manual'}</span>`
    : `<span class="selo s-atrasado">Falhou</span> <span class="muted">${esc(msg || '')}</span>`;
}

Super.sistema = async el => {
  carregando(el);
  const c = await GET('/super/config');
  const t = c.telegram;
  const r = c.resumo;
  el.innerHTML = `<div class="topo"><div><h1>Sistema</h1><p>Backups, Telegram e configurações gerais</p></div></div>
    <div class="grade grade-2" style="align-items:start">
      <div>
        <div class="painel"><div class="painel-topo"><h2>Backup</h2></div>
          <p class="muted" style="margin-top:0">Agora o sistema tem ${r.administradores} administrador(es), ${r.clientes} cliente(s), ${r.registros} registro(s) e ${r.pagamentos} pagamento(s). Um backup automático é guardado no servidor todo dia.</p>
          <div class="grade" style="gap:8px">
            <button class="btn btn-grande" id="bk-exportar">⬇️ Exportar backup agora</button>
            <button class="btn btn-claro btn-grande" id="bk-tg-agora" ${t.token_salvo && t.chat_id ? '' : 'disabled title="Configure o Telegram primeiro"'}>📨 Enviar backup ao Telegram agora</button>
            <button class="btn btn-perigo btn-grande" id="bk-importar">⬆️ Importar backup</button>
          </div>
          <input type="file" id="bk-arquivo" accept=".db,.gz,application/gzip,application/octet-stream" hidden>
        </div>

        <div class="painel" id="tg"><div class="painel-topo"><h2>Backup automático no Telegram</h2>${t.ativo ? '<span class="selo s-pago">Ligado</span>' : '<span class="selo s-cancelado">Desligado</span>'}</div>
          <p style="margin-top:0">${statusTelegram(t)}</p>
          <details ${t.token_salvo ? '' : 'open'} style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:600">Como criar o bot (passo a passo)</summary>
            <ol class="muted" style="padding-left:20px;margin:10px 0 0;line-height:1.7">
              <li>No Telegram, procure <b>@BotFather</b> e mande <b>/newbot</b>.</li>
              <li>Escolha um nome e um usuário terminado em <b>bot</b> (ex.: controlefacil_backup_bot).</li>
              <li>Ele responde com o <b>token</b>. Copie e cole no campo abaixo.</li>
              <li>Abra o seu bot no Telegram e toque em <b>Iniciar</b> (ou mande "oi").</li>
              <li>Volte aqui e toque em <b>Descobrir meu ID</b>.</li>
            </ol></details>
          <div class="campo"><label>Token do bot</label>
            <input class="entrada" id="tg-token" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t.token_salvo ? esc(t.token_mascara) + ' (salvo, deixe em branco para manter)' : '123456789:ABCdef...'}"></div>
          <div class="campo"><label>ID do chat</label>
            <div style="display:flex;gap:8px"><input class="entrada" id="tg-chat" inputmode="numeric" value="${esc(t.chat_id)}" placeholder="Ex.: 123456789">
            <button class="btn btn-claro" id="tg-descobrir" style="flex-shrink:0">Descobrir meu ID</button></div>
            <div id="tg-chats"></div></div>
          <div class="linha-campos">
            <div class="campo"><label>Frequência</label><select class="entrada" id="tg-freq">${Object.entries(FREQ_BK).map(([k, v]) => `<option value="${k}" ${k === t.frequencia ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
            <div class="campo" id="tg-hora-c"><label>Horário (Brasília)</label><select class="entrada" id="tg-hora">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === t.hora ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
          </div>
          <label class="check"><input type="checkbox" id="tg-ativo" ${t.ativo ? 'checked' : ''}> Enviar backup automaticamente</label>
          <div class="acoes mt"><button class="btn" id="tg-salvar">Salvar</button><button class="btn btn-claro" id="tg-testar">Testar conexão</button>
            ${t.token_salvo ? '<button class="btn btn-perigo" id="tg-remover">Remover bot</button>' : ''}</div>
        </div>
      </div>
      <div>
        <div class="painel"><div class="painel-topo"><h2>Backups no servidor</h2><button class="btn btn-p btn-claro" id="si-bk">Fazer backup</button></div>
          <div class="lista">${c.backups.length ? c.backups.map(b => `<div class="item"><div style="min-width:0"><div class="item-titulo" style="font-size:14px">${dataHora(b.criado_em)}${b.arquivo.includes('antes-importar') ? ' <span class="selo s-hoje">antes de importar</span>' : ''}</div>
            <div class="item-sub">${tamanhoArq(b.tamanho)}</div></div>
            <div><button class="btn btn-p btn-claro" data-bk="${esc(b.arquivo)}">Baixar</button></div></div>`).join('') : '<div class="vazio">Nenhum backup ainda.</div>'}</div></div>
        <div class="painel"><h2 style="margin-bottom:12px">Preferências do sistema</h2>
          <div class="campo"><label>Nome do sistema</label><input class="entrada" id="si-nome" value="${esc(c.sistema_nome)}"></div>
          <div class="campo"><label>Contato de suporte</label><input class="entrada" id="si-sup" placeholder="WhatsApp ou e-mail" value="${esc(c.suporte_contato)}"><small>Aparece na tela de login.</small></div>
          <button class="btn" id="si-salvar">Salvar</button></div>
        <div class="painel"><h2 style="margin-bottom:12px">Minha senha</h2>
          <div class="campo"><label>Senha atual</label><input class="entrada" type="password" id="si-s1"></div>
          <div class="campo"><label>Nova senha</label><input class="entrada" type="password" id="si-s2"></div>
          <button class="btn" id="si-senha">Trocar senha</button></div>
      </div>
    </div>`;
  const $ = s => el.querySelector(s);
  const ocupado = async (btn, texto, fn) => {
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = texto;
    try { await fn(); } catch (e) { falha(e); } finally { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = orig; } }
  };
  const horaVisivel = () => { $('#tg-hora-c').hidden = !['diario', 'semanal'].includes($('#tg-freq').value); };
  $('#tg-freq').addEventListener('change', horaVisivel); horaVisivel();

  // Exportar / enviar
  $('#bk-exportar').onclick = e => ocupado(e.currentTarget, 'Gerando…', async () => { await baixarArquivo('/super/backup-exportar'); toast('Backup exportado.', 'ok'); });
  $('#bk-tg-agora').onclick = e => ocupado(e.currentTarget, 'Enviando…', async () => {
    const r = await POST('/super/telegram/enviar'); toast('Backup enviado ao Telegram (' + tamanhoArq(r.tamanho) + ').', 'ok'); App.recarregar();
  });
  $('#si-bk').onclick = e => ocupado(e.currentTarget, 'Criando…', async () => { await POST('/super/backup'); toast('Backup criado.', 'ok'); App.recarregar(); });
  el.querySelectorAll('[data-bk]').forEach(b => b.onclick = () => ocupado(b, '…', () => baixarArquivo('/super/backup/' + encodeURIComponent(b.dataset.bk), b.dataset.bk)));

  // Importar
  $('#bk-importar').onclick = () => { $('#bk-arquivo').value = ''; $('#bk-arquivo').click(); };
  $('#bk-arquivo').onchange = async () => {
    const arq = $('#bk-arquivo').files[0];
    if (!arq) return;
    let v;
    try { toast('Conferindo o arquivo…'); v = await enviarBinario('/super/backup-validar', arq); } catch (e) { return falha(e); }
    const linha = x => `${x.administradores} administrador(es), ${x.clientes} cliente(s), ${x.registros} registro(s), ${x.pagamentos} pagamento(s)`;
    const m = abrirModal({
      titulo: 'Importar backup',
      subtitulo: esc(arq.name) + ' · ' + tamanhoArq(arq.size),
      corpo: `<div class="aviso erro" style="margin-top:0"><b>Atenção:</b> todos os dados atuais serão substituídos pelos dados deste backup.</div>
        <div class="conta"><div><span>Dados atuais</span><b style="text-align:right">${linha(v.atual)}</b></div>
        <div><span>Dados do backup</span><b style="text-align:right">${linha(v.backup)}</b></div></div>
        <p class="muted">Antes de importar, o sistema guarda uma cópia dos dados atuais. Se precisar, ela aparece em "Backups no servidor".</p>
        <div class="campo"><label>Digite sua senha para confirmar</label><input class="entrada" type="password" id="im-senha" autocomplete="current-password"></div>`,
      rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-perigo" id="im-ok">Substituir dados</button>',
    });
    m.querySelector('#im-ok').onclick = e => ocupado(e.currentTarget, 'Importando…', async () => {
      const senha = m.querySelector('#im-senha').value;
      if (!senha) throw new Error('Digite sua senha.');
      const r = await enviarBinario('/super/backup-importar', arq, senha);
      fecharModal();
      abrirModal({
        titulo: 'Backup importado',
        corpo: `<p style="margin-top:0">Os dados foram restaurados: ${linha(r.info)}.</p><p class="muted">Por segurança, entre novamente no sistema.</p>`,
        rodape: '<button class="btn" id="im-sair">Entrar novamente</button>',
      }).querySelector('#im-sair').onclick = () => { Sessao.limpar(); location.hash = ''; location.reload(); };
    });
  };

  // Telegram
  const dadosTg = () => ({ token: $('#tg-token').value.trim(), chat_id: $('#tg-chat').value.trim() });
  $('#tg-descobrir').onclick = e => ocupado(e.currentTarget, 'Buscando…', async () => {
    const r = await POST('/super/telegram/descobrir', dadosTg());
    const box = $('#tg-chats');
    if (!r.chats.length) { box.innerHTML = '<div class="aviso">Nenhuma conversa encontrada. Abra o seu bot no Telegram, toque em <b>Iniciar</b> ou mande "oi", e tente de novo.</div>'; return; }
    if (r.chats.length === 1) { $('#tg-chat').value = r.chats[0].id; box.innerHTML = '<small class="muted">Encontrado: ' + esc(r.chats[0].nome) + '</small>'; toast('ID encontrado.', 'ok'); return; }
    box.innerHTML = '<div class="chips" style="margin-top:8px">' + r.chats.map(c => `<button type="button" class="chip" data-chat="${esc(c.id)}">${esc(c.nome)} (${c.tipo === 'private' ? 'você' : 'grupo'})</button>`).join('') + '</div>';
    box.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => { $('#tg-chat').value = b.dataset.chat; box.querySelectorAll('.chip').forEach(x => x.classList.toggle('sel', x === b)); });
  });
  $('#tg-testar').onclick = e => ocupado(e.currentTarget, 'Testando…', async () => {
    const r = await POST('/super/telegram/testar', dadosTg());
    toast('Conectado ao bot @' + r.bot + '. Veja a mensagem no Telegram.', 'ok');
  });
  $('#tg-salvar').onclick = e => ocupado(e.currentTarget, 'Salvando…', async () => {
    await PUT('/super/telegram', { ...dadosTg(), frequencia: $('#tg-freq').value, hora: $('#tg-hora').value, ativo: $('#tg-ativo').checked });
    toast($('#tg-ativo').checked ? 'Backup automático ligado.' : 'Configuração salva.', 'ok');
    App.recarregar();
  });
  const rm = $('#tg-remover');
  if (rm) rm.onclick = async () => {
    if (!await confirmar('Remover bot', 'O backup automático pelo Telegram será desligado.', 'Remover', true)) return;
    try { await PUT('/super/telegram', { remover_token: true }); toast('Bot removido.', 'ok'); App.recarregar(); } catch (e) { falha(e); }
  };

  $('#si-salvar').onclick = async () => { try { await PUT('/super/config', { sistema_nome: $('#si-nome').value, suporte_contato: $('#si-sup').value }); toast('Salvo.', 'ok'); } catch (e) { falha(e); } };
  $('#si-senha').onclick = async () => { try { await PUT('/auth/senha', { atual: $('#si-s1').value, nova: $('#si-s2').value }); $('#si-s1').value = $('#si-s2').value = ''; toast('Senha alterada.', 'ok'); } catch (e) { falha(e); } };
};
