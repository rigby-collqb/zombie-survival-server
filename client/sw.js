const CACHE='zso-shell-v23-60';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==CACHE)await caches.delete(k);await self.clients.claim();})());});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;e.respondWith((async()=>{try{const r=await fetch(e.request,{cache:'no-store'});if(r&&r.ok){const c=await caches.open(CACHE);c.put(e.request,r.clone()).catch(()=>{});}return r;}catch(_){const c=await caches.open(CACHE);return (await c.match(e.request))||Response.error();}})());});
