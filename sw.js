// WerkHub: offline-shell en pushmeldingen, geen API-caching.
const CACHE = 'werkhub-v12';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nooit API-calls (Supabase/Anthropic) cachen, alleen de eigen shell
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let payload;
    try{
      payload = e.data ? e.data.json() : {};
    }catch(error){
      console.error('WerkHub push: ongeldig bericht');
      return;
    }
    await self.registration.showNotification('WerkHub', {
      body: payload.body || 'Open WerkHub voor je planning.',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: payload.tag || 'werkhub-reminder',
      data: { url: new URL('./index.html?tab=projecten', self.registration.scope).href }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const url = new URL('./index.html?tab=projecten', self.registration.scope).href;
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for(const client of windows){
      if(client.url.startsWith(self.registration.scope) && 'focus' in client){
        await client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
