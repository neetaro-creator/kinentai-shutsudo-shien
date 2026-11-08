/*
 * CACHE_VERSION: キャッシュの版。アプリ本体(HTML/CSS/JS)や構成を変えたら必ず上げる。
 * 形式: v<連番>-<計画の版>  例: v1-r8-08 = 1回目 / 令和8年8月版
 * data/*.json はネットワーク優先で取得し直すため、計画の改正だけなら上げなくてもよいが、
 * 初回インストール時の内容を更新したいときは上げる。
 */
const CACHE_VERSION = 'v4-r8-08';
const CACHE_PREFIX = 'kinentai-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// すべて sw.js からの相対パス（サブパス公開でも動く）
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'src/judge.js',
  'src/allocation.js',
  'src/quake.js',
  'src/quake-ui.js',
  'src/ap-view.js',
  'manifest.webmanifest',
  'icon.svg',
  'data/rule_table_a.json',
  'data/rule_table_7.json',
  'data/formation.json',
  'data/procedure.json',
  'data/forms.json',
  'data/honbu.json',
  'data/meta.json',
  'data/cities.json',
  'data/action_plans.json',
  'data/tsunami_area_map.json'
];

const INDEX_URL = new URL('index.html', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isDataJson(url) {
  return /\/data\/[^/]+\.json$/.test(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (res && res.ok) {
      await cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });

  const update = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') {
        return cache.put(request, res.clone()).then(() => res);
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }

  const res = await update;
  if (res) return res;

  if (request.mode === 'navigate') {
    const fallback = await cache.match(INDEX_URL);
    if (fallback) return fallback;
  }
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isDataJson(url)) {
    event.respondWith(
      networkFirst(request).catch(() => Response.error())
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      cacheFirstRevalidate(event).then(async (res) => {
        if (res && (res.ok || res.type === 'opaqueredirect')) return res;
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(INDEX_URL)) || res;
      })
    );
    return;
  }

  event.respondWith(cacheFirstRevalidate(event));
});
