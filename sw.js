self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('dayflow-cache').then((cache) => cache.addAll([
      '/index1.html',
      '/style2.css',
      '/script3.js'
    ]))
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});