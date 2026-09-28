/**
 * Service worker: mantém a aplicação disponível offline.
 *
 * A versão vem de assets/js/versao.js. Ao alterá-la, o navegador detecta a mudança,
 * instala um cache novo e a aplicação oferece "Atualizar".
 *
 * Estratégia: os arquivos da aplicação são pré-carregados na instalação e servidos
 * sempre do cache (versões nunca se misturam). Requisições à API (outra origem ou
 * não-GET) não passam pelo service worker.
 */
importScripts('assets/js/versao.js');

const CACHE = `auditoria-mobile-${self.APP_VERSAO}`;

const ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/js/versao.js',
  'assets/js/app.js',
  'assets/js/auth.js',
  'assets/js/catalogo.js',
  'assets/js/config.js',
  'assets/js/db.js',
  'assets/js/imagem.js',
  'assets/js/sync.js',
  'assets/js/ui.js',
  'assets/js/data/catalogo-padrao.js',
  'assets/js/views/login.js',
  'assets/js/views/sincronizacao.js',
  'assets/js/views/teste.js',
  'assets/js/views/testes.js',
  'assets/js/views/unidades.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(ARQUIVOS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes
      .filter((n) => n.startsWith('auditoria-mobile-') && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ev) => {
  if (ev.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const emCache = await cache.match(req, { ignoreSearch: true });
    if (emCache) return emCache;
    try {
      return await fetch(req);
    } catch {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
