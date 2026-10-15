// sw.js — permite instalar o app e abrir rápido, SEM nunca prender versão antiga.
// Regra: tudo vem do servidor (conferindo se mudou); a cópia salva só é usada sem internet.
const VERSAO = 'cf-v3';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(
    ['/manifest.json', '/icone-192.png', '/icone-512.png'].map(u => new Request(u, { cache: 'reload' }))
  )).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const chaves = await caches.keys();
    const eraAtualizacao = chaves.some(k => k.startsWith('cf-') && k !== VERSAO);
    await Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k)));
    await self.clients.claim();
    // Se havia uma versão antiga, recarrega as telas abertas para entrar a nova na hora
    if (eraAtualizacao) {
      const janelas = await self.clients.matchAll({ type: 'window' });
      janelas.forEach(j => { try { j.navigate(j.url); } catch (err) {} });
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const navegacao = req.mode === 'navigate';
  // 'no-cache' = sempre pergunta ao servidor se mudou (ignora o que o navegador guardou)
  const busca = navegacao ? fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(
    busca.then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(navegacao ? '/' : req, copia)); }
      return res;
    }).catch(() => caches.match(navegacao ? '/' : req, { ignoreSearch: !navegacao }))
  );
});
