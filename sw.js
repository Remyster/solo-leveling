// Hunter System — Service Worker
// Push notificaties + offline caching

const CACHE = 'hunter-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './bg-warrior.jpg',
  './bg-monarch.png',
];

// ── INSTALL ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH (offline support) ───────────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || '【SYSTEM】', {
      body: data.body || 'Hunter System melding',
      icon: './icon-192.png',
      badge: './icon-96.png',
      vibrate: [200, 100, 200],
      data: data,
      actions: [
        { action: 'open', title: 'Open App' },
        { action: 'dismiss', title: 'Sluiten' }
      ]
    })
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      if (list.length) return list[0].focus();
      return clients.openWindow('./');
    })
  );
});

// ── SCHEDULED LOCAL NOTIFICATIONS ────────────────────────
// Gebruikt door de app om notificaties in te plannen
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { delay, title, body } = e.data;
    setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: './icon-192.png',
        badge: './icon-96.png',
        vibrate: [200, 100, 200],
      });
    }, delay);
  }
});
