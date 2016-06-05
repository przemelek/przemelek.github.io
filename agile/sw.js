self.addEventListener('install', function(e) {
 e.waitUntil(
   caches.open('timer').then(function(cache) {
     return cache.addAll([
       '/',
       'Agile.html',
       'agile.js',
       'agile.css',
       'pokercard.png'
     ]);
   })
 );
});
self.addEventListener('fetch', function(event) {
 event.respondWith(
   caches.match(event.request).then(function(response) {
     return response || fetch(event.request);
   })
 );
});
