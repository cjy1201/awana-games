// 오프라인에서도 게임이 열리도록 파일을 기기에 저장해 둡니다.
// 게임 파일을 고치면 VERSION 을 올려 주세요. 그래야 기존 기기에 새 버전이 퍼집니다.
const VERSION = 'awana-v32';
const FILES = [
  './',
  './index.html',
  './relay/',
  './relay/index.html',
  './safari/',
  './safari/index.html',
  './ballrelay/',
  './ballrelay/index.html',
  './bowling/',
  './bowling/index.html',
  './inout/',
  './inout/index.html',
  './zigzag/',
  './zigzag/index.html',
  './standpin/',
  './standpin/index.html',
  './stacks/',
  './stacks/index.html',
  './hoop/',
  './hoop/index.html',
  './curling/',
  './curling/index.html',
  './beanbagmove/',
  './beanbagmove/index.html',
  './beanbagrelay/',
  './beanbagrelay/index.html',
  './ttrelay/',
  './ttrelay/index.html',
  './basketball/',
  './basketball/index.html',
  './firefighter/',
  './firefighter/index.html',
  './ttballrelay/',
  './ttballrelay/index.html',
  './speedstacks/',
  './speedstacks/index.html',
  './ttzigzag/',
  './ttzigzag/index.html',
  './football/',
  './football/index.html',
  './tug/',
  './tug/index.html',
  './shared/court.js',
  './shared/court.css',
  './manifest.webmanifest',
  './fonts/jua.woff',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', event => {
  // 브라우저 HTTP 캐시를 건너뛰고 서버에서 새로 받아 저장해요
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
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

  // 화면(게임 모음, 각 게임)과 공통 코드(shared/): 인터넷이 되면 최신 버전, 안 되면 저장해 둔 버전
  // 공통 코드도 화면과 같이 새로 받아야 새 화면이 옛 공통 코드와 섞이지 않아요
  const page = req.mode === 'navigate';
  if (page || req.destination === 'script' || req.destination === 'style') {
    event.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })   // 항상 서버에 새 버전이 있는지 확인
        .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (page ? caches.match('./') : Response.error())))
    );
    return;
  }

  // 글꼴·아이콘: 저장해 둔 것을 먼저
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
