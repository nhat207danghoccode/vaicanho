/* Offline cho web động — NETWORK-FIRST: có mạng luôn lấy bản mới nhất, mất mạng mới dùng bản đã lưu */
const VERSION = 'v1';
const CACHE = 'tracnghiem-' + VERSION;
const PRECACHE = ["./", "./index.html", "DS.txt", "DS1.txt", "DS2.txt", "DS3.txt", "DS4.txt", "DS5.txt", "1.gif", "1.mp3", "2.mp3", "n.mp3", "web.mp3"];          // file có sẵn cùng thư mục, tải trước khi cài
const NET_TIMEOUT = 5000;               // mạng chậm hơn 5s mà đã có bản lưu -> hiện bản lưu trước, mạng về sau vẫn cập nhật ngầm

// Không bao giờ chặn: Firebase realtime/auth... (tự nó xử lý online/offline)
const BYPASS = [
  'firestore.googleapis.com', 'firebasedatabase.app', 'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com', 'firebaseinstallations.googleapis.com', 'firebaseio.com'
];
// Thư viện/font có version cố định: cache-first + cập nhật ngầm
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async u => {
      try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r.ok) await c.put(keyOf(new Request(u, {mode:'same-origin'})), r); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tracnghiem-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Bỏ query chống cache (?v=..., ?_question_refresh=..., ?t=...) để cùng 1 file dùng chung 1 bản lưu
function keyOf(req) { const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (BYPASS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  if (req.headers.has('range')) return e.respondWith(rangeRequest(req));
  if (STATIC_HOSTS.includes(url.hostname)) return e.respondWith(staleWhileRevalidate(e, req));
  e.respondWith(networkFirst(e, req));
});

async function lookup(req) {
  const c = await caches.open(CACHE);
  let hit = await c.match(keyOf(req));
  if (!hit && req.mode === 'navigate') hit = (await c.match(keyOf(new Request('./')))) || (await c.match(keyOf(new Request('./index.html'))));
  return hit;
}

function networkFirst(e, req) {
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const net = fetch(req).then(async res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const c = await caches.open(CACHE);
        await c.put(keyOf(req), res.clone());
      }
      if (res.status >= 500) { const hit = await lookup(req); if (hit) return finish(hit); }
      finish(res);
    }).catch(async () => {
      const hit = await lookup(req);
      finish(hit || (req.mode === 'navigate' ? offlinePage() : Response.error()));
    });
    e.waitUntil(net);                       // giữ SW sống để cập nhật bản lưu ngầm
    const timer = setTimeout(async () => { const hit = await lookup(req); if (hit) finish(hit); }, NET_TIMEOUT);
  });
}

async function staleWhileRevalidate(e, req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  return (await net) || Response.error();
}

// Audio/video gửi Range: online thì đi thẳng mạng, offline thì cắt từ file đã lưu
async function rangeRequest(req) {
  try { return await fetch(req); } catch (_) {
    const hit = await lookup(req);
    if (!hit) return Response.error();
    const buf = await hit.arrayBuffer();
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
    const start = m && m[1] ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
    return new Response(buf.slice(start, end + 1), { status: 206, headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1) } });
  }
}

function offlinePage() {
  return new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;text-align:center;padding:15vh 20px"><h2>Đang offline</h2><p>Hãy mở trang này khi có mạng ít nhất 1 lần để lưu dữ liệu.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
