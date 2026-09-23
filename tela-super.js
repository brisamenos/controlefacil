/* super.js — telas do Super Admin */
'use strict';

const Super = {};
const PERM_NOMES = { clientes: 'Clientes', registros: 'Registros', pagamentos: 'Pagamentos', relatorios: 'Relatórios', whatsapp: 'WhatsApp', configuracoes: 'Configurações' };

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
  parcela_ajustada: 'Parcela ajustada', pagamento_registrado: 'Pagamento registrado', pagamento_estornado: 'Pagamento estornado',
  config_alterada: 'Configurações alteradas', modelo_alterado: 'Modelo de mensagem alterado', config_sistema: 'Configuração do sistema',
  backup_criado: 'Backup criado', backup_baixado: 'Backup baixado',
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

Super.sistema = async el => {
  carregando(el);
  const c = await GET('/super/config');
  el.innerHTML = `<div class="topo"><div><h1>Sistema</h1><p>Configurações gerais e cópias de segurança</p></div></div>
    <div class="grade grade-2" style="align-items:start">
      <div class="painel"><h2 style="margin-bottom:12px">Preferências do sistema</h2>
        <div class="campo"><label>Nome do sistema</label><input class="entrada" id="si-nome" value="${esc(c.sistema_nome)}"></div>
        <div class="campo"><label>Contato de suporte</label><input class="entrada" id="si-sup" placeholder="WhatsApp ou e-mail" value="${esc(c.suporte_contato)}"><small>Aparece na tela de login.</small></div>
        <button class="btn" id="si-salvar">Salvar</button></div>
      <div class="painel"><div class="painel-topo"><h2>Backups</h2><button class="btn btn-p" id="si-bk">Fazer backup agora</button></div>
        <p class="muted" style="margin-top:0">Um backup automático é feito por dia. Os 14 mais recentes ficam guardados.</p>
        <div class="lista">${c.backups.length ? c.backups.map(b => `<div class="item"><div><div class="item-titulo" style="font-size:14px">${esc(b.arquivo)}</div><div class="item-sub">${(b.tamanho / 1024).toFixed(0)} KB</div></div>
          <div><button class="btn btn-p btn-claro" data-bk="${esc(b.arquivo)}">Baixar</button></div></div>`).join('') : '<div class="vazio">Nenhum backup ainda.</div>'}</div></div>
      <div class="painel"><h2 style="margin-bottom:12px">Minha senha</h2>
        <div class="campo"><label>Senha atual</label><input class="entrada" type="password" id="si-s1"></div>
        <div class="campo"><label>Nova senha</label><input class="entrada" type="password" id="si-s2"></div>
        <button class="btn" id="si-senha">Trocar senha</button></div>
    </div>`;
  const $ = s => el.querySelector(s);
  $('#si-salvar').onclick = async () => { try { await PUT('/super/config', { sistema_nome: $('#si-nome').value, suporte_contato: $('#si-sup').value }); toast('Salvo.', 'ok'); } catch (e) { falha(e); } };
  $('#si-bk').onclick = async () => { try { await POST('/super/backup'); toast('Backup criado.', 'ok'); App.recarregar(); } catch (e) { falha(e); } };
  el.querySelectorAll('[data-bk]').forEach(b => b.onclick = async () => {
    try {
      const res = await fetch('/api/super/backup/' + encodeURIComponent(b.dataset.bk), { headers: { Authorization: 'Bearer ' + Sessao.token } });
      if (!res.ok) throw new Error('Não foi possível baixar o backup.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = b.dataset.bk; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { falha(e); }
  });
  $('#si-senha').onclick = async () => { try { await PUT('/auth/senha', { atual: $('#si-s1').value, nova: $('#si-s2').value }); $('#si-s1').value = $('#si-s2').value = ''; toast('Senha alterada.', 'ok'); } catch (e) { falha(e); } };
};
