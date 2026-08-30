/* ============================================================
   Friend or Fraud — service worker

   BUMP CACHE_VERSION whenever you change any file below,
   otherwise phones keep serving the old copy.
   ============================================================ */
const CACHE_VERSION = 'ff-v10';

// Canonical paths — the fetch handler ignores ?v= query strings when matching,
// so these keep working after you bump the version numbers in index.html.
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './online.js',
  './answer-check.js',
  './music.js',
  './firebase-config.js',
  './manifest.json',
  './favicon.png',
  './favicon-16.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

// Anything live must never be served from cache.
function isLiveData(url){
  return url.hostname.endsWith('firebaseio.com') ||
         url.hostname.endsWith('firebasedatabase.app') ||
         url.hostname.endsWith('googleapis.com') ||
         url.hostname.endsWith('google-analytics.com');
}

self.addEventListener('install', event=>{
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache=>
      // addAll fails the whole install if one file 404s, so add individually
      Promise.all(SHELL.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(()=>{})
      ))
    )
  );
});

self.addEventListener('activate', event=>{
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(()=> self.clients.claim())
  );
});

// The page asks for this after the user accepts an update.
self.addEventListener('message', event=>{
  if(event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(isLiveData(url)) return;                     // straight to the network

  // Navigations: try the network so updates land fast, fall back to the
  // cached shell when there is no connection.
  if(req.mode === 'navigate'){
    event.respondWith(
      fetch(req)
        .then(res=>{
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c=> c.put('./index.html', copy)).catch(()=>{});
          return res;
        })
        .catch(()=> caches.match('./index.html', { ignoreSearch:true })
                          .then(r => r || caches.match('./')))
    );
    return;
  }

  // Same-origin assets: cache first, ignoring the ?v= string.
  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(req, { ignoreSearch:true }).then(hit=>{
        if(hit) return hit;
        return fetch(req).then(res=>{
          if(res && res.status === 200){
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c=> c.put(req, copy)).catch(()=>{});
          }
          return res;
        });
      })
    );
    return;
  }

  // Fonts and the Firebase SDK: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(req).then(hit=>{
      const net = fetch(req).then(res=>{
        if(res && (res.status === 200 || res.type === 'opaque')){
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c=> c.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(()=> hit);
      return hit || net;
    })
  );
});
