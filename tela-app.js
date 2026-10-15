/* app.js — login, navegação e estrutura da tela */
'use strict';

const App = {
  rotaAtual: null,
  recarregar() { rotear(); },
};

const MENU_ADMIN = [
  { h: '#/inicio', t: 'Início', i: 'inicio' },
  { h: '#/cobrancas', t: 'Cobranças', i: 'cobrar' },
  { h: '#/clientes', t: 'Clientes', i: 'clientes' },
  { h: '#/calendario', t: 'Calendário', i: 'cal' },
  { h: '#/financeiro', t: 'Financeiro', i: 'fin', perm: 'financeiro' },
  { h: '#/relatorios', t: 'Relatórios', i: 'rel', perm: 'relatorios' },
  { h: '#/config', t: 'Configurações', i: 'config' },
];
const MENU_SUPER = [
  { h: '#/super', t: 'Painel', i: 'inicio' },
  { h: '#/super/admins', t: 'Administradores', i: 'admins' },
  { h: '#/super/auditoria', t: 'Auditoria', i: 'hist' },
  { h: '#/super/avisos', t: 'Avisos', i: 'sino' },
  { h: '#/super/sistema', t: 'Sistema', i: 'config' },
];

function menuVisivel() {
  const u = Sessao.usuario;
  if (u.role === 'superadmin') return MENU_SUPER;
  return MENU_ADMIN.filter(m => !m.perm || pode(m.perm));
}

function desenharEstrutura() {
  const u = Sessao.usuario, sup = u.role === 'superadmin';
  const itens = menuVisivel();
  const novo = !sup && pode('registros') ? `<a class="novo-btn" href="#/novo">${I.mais} Novo registro</a>` : '';
  const inferior = sup
    ? itens.slice(0, 4).map(m => `<a href="${m.h}" data-rota="${m.h}">${I[m.i]}<span>${m.t === 'Administradores' ? 'Admins' : m.t}</span></a>`).join('') + `<button id="bi-mais">${I.menu}<span>Mais</span></button>`
    : `<a href="#/inicio" data-rota="#/inicio">${I.inicio}<span>Início</span></a>
       <a href="#/cobrancas" data-rota="#/cobrancas">${I.cobrar}<span>Cobranças</span></a>
       ${pode('registros') ? `<a href="#/novo" class="mais-novo" data-rota="#/novo"><span class="circ">${I.mais}</span><span>Novo</span></a>` : `<a href="#/calendario" data-rota="#/calendario">${I.cal}<span>Calendário</span></a>`}
       <a href="#/clientes" data-rota="#/clientes">${I.clientes}<span>Clientes</span></a>
       <button id="bi-mais">${I.menu}<span>Mais</span></button>`;
  document.getElementById('raiz').innerHTML = `
    <div class="app">
      <aside class="lateral">
        <div class="marca"><span class="marca-icone">${I.ok}</span><span id="marca-nome">Controle Fácil</span></div>
        <nav class="nav">${novo}${itens.map(m => `<a href="${m.h}" data-rota="${m.h}">${I[m.i]}${m.t}</a>`).join('')}</nav>
        <div class="lateral-rodape"><strong>${esc(u.nome)}</strong>${sup ? 'Super Admin' : 'Administrador'}<br><button id="sair">Sair</button></div>
      </aside>
      <main class="principal"><div class="conteudo" id="pagina"></div></main>
      <nav class="barra-inferior">${inferior}</nav>
    </div>`;
  document.getElementById('sair').onclick = sair;
  GET('/publico').then(p => { if (p.sistema_nome) { document.getElementById('marca-nome').textContent = p.sistema_nome; document.title = p.sistema_nome; } }).catch(() => {});
  document.getElementById('bi-mais').onclick = () => {
    const extras = sup ? itens.slice(4) : itens.filter(m => !['#/inicio', '#/cobrancas', '#/clientes'].includes(m.h));
    const m = abrirModal({
      titulo: 'Menu', subtitulo: esc(u.nome),
      corpo: `<div class="grade" style="gap:8px">${extras.map(x => `<a class="btn btn-claro btn-grande" style="justify-content:flex-start" href="${x.h}">${I[x.i]} ${x.t}</a>`).join('')}
        ${jaInstalado() ? '' : '<button class="btn btn-claro btn-grande" style="justify-content:flex-start" id="m-inst">📲 Instalar aplicativo</button>'}
        <button class="btn btn-perigo btn-grande" style="justify-content:flex-start" id="m-sair">${I.sair} Sair</button></div>`,
    });
    m.querySelectorAll('a').forEach(a => a.addEventListener('click', fecharModal));
    m.querySelector('#m-sair').onclick = sair;
    const mi = m.querySelector('#m-inst'); if (mi) mi.onclick = () => { fecharModal(); instalarApp(); };
  };
}

function marcarMenu(hash) {
  document.querySelectorAll('[data-rota]').forEach(a => {
    const r = a.dataset.rota;
    const ativo = hash === r || (r !== '#/super' && hash.startsWith(r + '/')) || (r === '#/clientes' && hash.startsWith('#/cliente/')) || (r === '#/super/admins' && hash.startsWith('#/super/admin/'));
    a.classList.toggle('ativo', ativo);
  });
}

async function rotear() {
  const u = Sessao.usuario;
  if (!u || !Sessao.token) return telaLogin();
  if (!document.getElementById('pagina')) desenharEstrutura();
  let hash = (location.hash || '').split('?')[0];
  const sup = u.role === 'superadmin';
  if (!hash || hash === '#/' || hash === '#') { hash = sup ? '#/super' : '#/inicio'; history.replaceState(null, '', hash); }
  if (sup !== hash.startsWith('#/super')) { hash = sup ? '#/super' : '#/inicio'; history.replaceState(null, '', hash); }
  marcarMenu(hash);
  const el = document.getElementById('pagina');
  const partes = hash.slice(2).split('/');
  const rotas = sup ? {
    'super': () => Super.inicio(el), 'super/admins': () => Super.admins(el), 'super/admin': () => Super.admin(el, partes[2]),
    'super/auditoria': () => Super.auditoria(el), 'super/avisos': () => Super.avisos(el), 'super/sistema': () => Super.sistema(el),
  } : {
    'inicio': () => Admin.inicio(el), 'cobrancas': () => Admin.cobrancas(el), 'clientes': () => Admin.clientes(el),
    'cliente': () => Admin.cliente(el, partes[1]), 'novo': () => Admin.novo(el), 'calendario': () => Admin.calendario(el),
    'relatorios': () => Admin.relatorios(el), 'financeiro': () => Admin.financeiro(el), 'config': () => Admin.config(el),
  };
  const chave = sup ? partes.slice(0, partes[1] === 'admin' ? 2 : 2).join('/').replace(/^super\/?$/, 'super') : partes[0];
  const fn = rotas[chave] || rotas[sup ? 'super' : 'inicio'];
  const ordem = App.rotaAtual = Symbol();
  try {
    await fn();
    if (App.rotaAtual === ordem && location.hash.split('?')[0] !== App.ultimoHash) window.scrollTo(0, 0);
    App.ultimoHash = location.hash.split('?')[0];
  } catch (e) {
    if (App.rotaAtual === ordem) el.innerHTML = '<div class="painel vazio">' + esc(e.message) + '<br><button class="btn btn-claro" onclick="App.recarregar()">Tentar de novo</button></div>';
  }
}

async function sair() {
  try { await POST('/auth/logout'); } catch (e) {}
  Sessao.limpar(); CFG = null;
  location.hash = '';
  telaLogin();
}

function telaLogin() {
  document.getElementById('raiz').innerHTML = `
    <div class="login">
      <div class="login-lado">
        <div class="marca" style="color:#fff;padding-bottom:0"><span class="marca-icone" style="background:#fff;color:var(--tinta)">${I.ok}</span>Controle Fácil</div>
        <div><h2>Cada parcela anotada, cada cobrança no dia certo.</h2><p>Cadastre, acompanhe e receba sem planilha e sem caderno perdido.</p></div>
        <p class="rodape-lado" id="lg-suporte" style="font-size:14px"></p>
      </div>
      <div class="login-form"><form id="lg" autocomplete="on">
        <h1>Entrar</h1><p class="sub">Use seu e-mail ou nome de usuário.</p>
        <div class="campo"><label for="lg-u">E-mail ou usuário</label><input class="entrada" id="lg-u" name="username" autocomplete="username" autocapitalize="off" required></div>
        <div class="campo"><label for="lg-s">Senha</label><input class="entrada" id="lg-s" type="password" autocomplete="current-password" required></div>
        <div class="linha-login"><label class="check" style="padding:0"><input type="checkbox" id="lg-lembrar" checked> Lembrar acesso</label>
          <button type="button" class="link-btn" id="lg-esqueci">Esqueci minha senha</button></div>
        <div id="lg-erro"></div>
        <button class="btn btn-grande" type="submit" id="lg-btn">Entrar</button>
      </form></div>
    </div>`;
  const f = document.getElementById('lg');
  f.onsubmit = async e => {
    e.preventDefault();
    const b = document.getElementById('lg-btn'); b.disabled = true; b.textContent = 'Entrando…';
    document.getElementById('lg-erro').innerHTML = '';
    try {
      const r = await POST('/auth/login', { login: document.getElementById('lg-u').value, senha: document.getElementById('lg-s').value, lembrar: document.getElementById('lg-lembrar').checked });
      Sessao.salvar(r.token, r.usuario, document.getElementById('lg-lembrar').checked);
      location.hash = r.usuario.role === 'superadmin' ? '#/super' : '#/inicio';
      rotear();
    } catch (err) {
      document.getElementById('lg-erro').innerHTML = '<div class="aviso erro">' + esc(err.message) + '</div>';
      b.disabled = false; b.textContent = 'Entrar';
    }
  };
  document.getElementById('lg-esqueci').onclick = () => {
    const m = abrirModal({
      titulo: 'Esqueci minha senha', subtitulo: 'O administrador do sistema recebe o seu pedido e define uma senha nova.',
      corpo: `<div class="campo"><label>Seu e-mail ou usuário</label><input class="entrada" id="es-u" value="${esc(document.getElementById('lg-u').value)}"></div>`,
      rodape: '<button class="btn btn-claro" data-fechar>Voltar</button><button class="btn" id="es-ok">Enviar pedido</button>',
    });
    m.querySelector('#es-ok').onclick = async () => {
      try { const r = await POST('/auth/esqueci', { login: m.querySelector('#es-u').value }); fecharModal(); toast(r.mensagem, 'ok'); } catch (e) { falha(e); }
    };
  };
  if (window.innerWidth > 860) setTimeout(() => document.getElementById('lg-u').focus(), 50);
  GET('/publico').then(p => {
    const s = document.getElementById('lg-suporte');
    if (s && p.suporte_contato) s.textContent = 'Precisa de ajuda? ' + p.suporte_contato;
  }).catch(() => {});
}

async function iniciar() {
  if (Sessao.token) {
    try {
      const me = await GET('/auth/me');
      Sessao.atualizarUsuario({ id: me.id, nome: me.nome, role: me.role, permissoes: me.permissoes });
    } catch (e) { if (!Sessao.token) return telaLogin(); }
  }
  window.addEventListener('hashchange', () => { fecharModal(); rotear(); });
  rotear();
}
/* ── Instalar como aplicativo (Android/Chrome) ─────────── */
let pedidoInstalar = null;
const jaInstalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; mostrarInstalar(); });
window.addEventListener('appinstalled', () => { pedidoInstalar = null; document.querySelectorAll('.instalar-app').forEach(b => b.remove()); toast('Aplicativo instalado!', 'ok'); });

async function instalarApp() {
  if (pedidoInstalar) {
    pedidoInstalar.prompt();
    await pedidoInstalar.userChoice;
    pedidoInstalar = null;
    return;
  }
  abrirModal({
    titulo: 'Instalar o aplicativo',
    corpo: /iphone|ipad/i.test(navigator.userAgent)
      ? '<p style="margin-top:0">No Safari, toque em <b>Compartilhar</b> (o quadrado com a seta) e depois em <b>Adicionar à Tela de Início</b>.</p>'
      : '<p style="margin-top:0">No Chrome, toque nos <b>três pontinhos</b> no canto de cima e depois em <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>.</p>',
    rodape: '<button class="btn" data-fechar>Entendi</button>',
  });
}

function mostrarInstalar() {
  if (jaInstalado()) return;
  const lugares = [document.querySelector('.login-form form'), document.querySelector('.lateral-rodape')];
  lugares.forEach(l => {
    if (!l || l.querySelector('.instalar-app')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-claro instalar-app';
    b.style.cssText = 'width:100%;margin-top:12px';
    b.innerHTML = '📲 Instalar aplicativo';
    b.onclick = instalarApp;
    l.appendChild(b);
  });
}
new MutationObserver(() => { if (pedidoInstalar || /iphone|ipad/i.test(navigator.userAgent)) mostrarInstalar(); })
  .observe(document.getElementById('raiz'), { childList: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

iniciar();
