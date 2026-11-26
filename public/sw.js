// 설치 가능한 앱(PWA)용 서비스 워커. 채팅/로그인 데이터(API)는 절대 저장하지 않고,
// 화면 파일만 "인터넷 우선, 안 되면 저장본" 방식으로 써서 새 버전이 항상 바로 반영돼요.
const CACHE = 'dtalk-shell-v1';
const SHELL = ['/', '/style.css', '/app.js', '/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match('/'))));
});
