// sw.js — permite instalar o app e abrir rápido.
// Os dados (API) vêm sempre do servidor, nunca do cache, para não mostrar valores velhos.
const VERSAO = 'cf-v1';
const ARQUIVOS = ['/', '/estilo.css', '/tela-base.js', '/tela-admin.js', '/tela-super.js', '/tela-app.js',
                  '/manifest.json', '/icone-192.png', '/icone-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Rede primeiro (sempre a versão mais nova); sem internet, usa a cópia salva
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(req.mode === 'navigate' ? '/' : req, copia)); }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req))
  );
});
