// 오프라인에서도 게임이 열리도록 파일을 기기에 저장해 둡니다.
// 게임 파일을 고치면 VERSION 을 올려 주세요. 그래야 기존 기기에 새 버전이 퍼집니다.
const VERSION = 'awana-v2';
const FILES = [
  './',
  './index.html',
  './relay/',
  './relay/index.html',
  './manifest.webmanifest',
  './fonts/jua.woff',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // 화면(게임 모음, 각 게임): 인터넷이 되면 최신 버전, 안 되면 저장해 둔 버전
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./')))
    );
    return;
  }

  // 글꼴·아이콘: 저장해 둔 것을 먼저
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
