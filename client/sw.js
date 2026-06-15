/* ═══════════════════════════════════════════════════════════════
   Service Worker — YT Playlist PWA
   オフライン起動・シェルキャッシュ戦略
═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'yt-pwa-v1';

// キャッシュするアプリシェル（静的アセット）
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

/* ── Install: シェルをキャッシュ ──────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: 古いキャッシュを削除 ─────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Cache First（アプリシェル） ──────────────────── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // YouTube IFrame API や外部リクエストはキャッシュしない（ネットワーク優先）
  if (
    url.hostname.includes('youtube.com') ||
    url.hostname.includes('ytimg.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('onrender.com') ||
    event.request.method !== 'GET'
  ) {
    return; // ブラウザのデフォルト処理に委譲
  }

  // アプリシェル → Cache First
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      // キャッシュになければネットワーク取得 → キャッシュに追加
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(() => {
        // オフライン時: index.html にフォールバック
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

/* ── Background Sync 対応（将来的な拡張用） ─────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
