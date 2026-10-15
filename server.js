// server.js — Controle Fácil
const express = require('express');
const path    = require('path');
require('./db');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// Cabeçalhos básicos de segurança
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
const VERSAO_APP = String(Date.now());
app.get('/api/publico', (req, res) => {
  const c = require('./util').getConfig(0);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ sistema_nome: c.sistema_nome, suporte_contato: c.suporte_contato, versao: VERSAO_APP });
});
app.use('/api/auth',      require('./rotas-auth'));
app.use('/api/super',     require('./rotas-super'));
app.use('/api/clientes',  require('./rotas-clientes'));
app.use('/api/registros', require('./rotas-registros'));
app.use('/api/parcelas',  require('./rotas-parcelas'));
app.use('/api/financeiro', require('./rotas-financeiro'));
app.use('/api',           require('./rotas-painel'));
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Só estes arquivos são entregues ao navegador (o código do servidor fica protegido)
const PUBLICOS = { '/estilo.css': 'text/css', '/tela-base.js': 'application/javascript', '/tela-admin.js': 'application/javascript',
                   '/tela-super.js': 'application/javascript', '/tela-app.js': 'application/javascript',
                   '/manifest.json': 'application/manifest+json', '/sw.js': 'application/javascript',
                   '/icone-192.png': 'image/png', '/icone-512.png': 'image/png', '/icone-mascara.png': 'image/png', '/icone-apple.png': 'image/png' };
app.get(Object.keys(PUBLICOS), (req, res) => {
  res.type(PUBLICOS[req.path]);
  // arquivos com ?v= mudam de endereço a cada versão; sem ?v= (ex.: sw.js) sempre conferem
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, req.path.slice(1)));
});
// index.html com número de versão em cada arquivo: a cada implantação o endereço muda,
// então nenhum cache (navegador, Cloudflare...) consegue entregar arquivo antigo.
const fs = require('fs');
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .replace(/(src|href)="\/(tela-[a-z]+\.js|estilo\.css)"/g, (m, attr, arq) => `${attr}="/${arq}?v=${VERSAO_APP}"`);
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.type('html').send(INDEX);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Controle Fácil rodando na porta ' + PORT);
  require('./agendador').iniciar();
  require('./backup').iniciar();
  require('./telegram').iniciar();
});
