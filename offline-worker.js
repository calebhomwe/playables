/* Shared offline engine. Only this application's namespaced caches are owned. */
'use strict';
const config = self.OFFLINE_CONFIG;
const base = new URL('./', self.registration.scope);
const prefix = `${config.namespace}-`;
const shellName = `${prefix}shell-${config.revision}`;
const markerURL = new URL('__offline_complete__', base).href;
const absolute = file => new URL(file, base).href;
const groupName = (id, group) => `${prefix}pack-${id}-${group.revision}`;
const pending = new Map();
const poolName = `${prefix}assets`;
function assetKey(url, digest) { const u = new URL(url, base); u.searchParams.set('__offline_sha', digest); return u.href; }

async function fetchAsset(file) {
  const url = new URL(file, base);
  if (url.origin !== base.origin) throw new Error('Only local dependencies can be installed');
  const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (response.status !== 200 || response.type === 'opaque' || response.redirected) throw new Error(`Incomplete download: ${file}`);
  const expected = config.assets[file];
  if (!expected) throw new Error(`Unlisted asset: ${file}`);
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== expected.size) throw new Error(`Wrong size: ${file}`);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== expected.sha256) throw new Error(`Release changed during download: ${file}`);
  return response;
}
async function fill(cache, files, notify = () => {}) {
  // Serial transfers bound memory while Safari writes audio to disk.
  let completed = 0;
  for (const file of files) {
    await cache.put(absolute(file), await fetchAsset(file));
    await notify({ type: 'OFFLINE_PROGRESS', completed: ++completed, total: files.length });
  }
}
async function hasFiles(cache, files) {
  const keys = new Set((await cache.keys()).map(request => request.url));
  return files.every(file => keys.has(absolute(file)));
}
async function complete(name, files) {
  if (!(await caches.keys()).includes(name)) return false;
  const cache = await caches.open(name);
  const marker = await cache.match(markerURL);
  if (!marker) return false;
  const metadata = await marker.json();
  if (!metadata.files) return hasFiles(cache, files);
  const pool = await caches.open(poolName);
  const keys = new Set((await pool.keys()).map(request => request.url));
  for (const file of files) {
    const digest = metadata.files[absolute(file)];
    if (digest !== config.assets[file]?.sha256 || !keys.has(assetKey(file, digest))) return false;
  }
  return true;
}
const mark = cache => cache.put(markerURL, new Response('{"complete":true}', { headers: { 'Content-Type': 'application/json' } }));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellName);
    try {
      await fill(cache, config.shell, async progress => {
        for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(progress);
      });
      await mark(cache);
    } catch (error) {
      await caches.delete(shellName);
      throw error; // Leave the previous installed worker and complete release intact.
    }
  })());
  // Updates wait for the player's existing SKIP_WAITING button.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    for (const name of names) if (name.startsWith(`${prefix}shell-`) && name !== shellName) await caches.delete(name);
    await self.clients.claim();
  })());
});
async function downloadGroup(id, notify) {
  const group = config.groups[id];
  if (!group) throw new Error('No verified offline package is available for this game');
  const name = groupName(id, group);
  if (await complete(name, group.files)) return;
  const pool = await caches.open(poolName);
  const files = {};
  let completed = 0;
  for (const file of group.files) {
    const digest = config.assets[file].sha256;
    const key = assetKey(file, digest);
    if (!(await pool.match(key))) await pool.put(key, await fetchAsset(file));
    files[absolute(file)] = digest;
    notify({ type: 'OFFLINE_PROGRESS', completed: ++completed, total: group.files.length });
  }
  // Shared assets have immutable digest keys. One metadata write commits the
  // package, so interrupted downloads cannot replace a previous complete game.
  const target = await caches.open(name);
  await target.put(markerURL, new Response(JSON.stringify({ id, revision: group.revision, files }), { headers: { 'Content-Type': 'application/json' } }));
}
self.addEventListener('message', event => {
  const port = event.ports?.[0];
  const send = data => { try { port?.postMessage(data); } catch {} };
  if (event.data?.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (!['OFFLINE_STATUS', 'OFFLINE_DOWNLOAD'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      const id = event.data.id;
      const group = id && config.groups[id];
      if (event.data.type === 'OFFLINE_DOWNLOAD') {
        if (!pending.has(id)) pending.set(id, downloadGroup(id, send).finally(() => pending.delete(id)));
        await pending.get(id);
      }
      const ready = await complete(shellName, config.shell) && (!id || !!group && await complete(groupName(id, group), group.files));
      send({ type: 'status', ready, id: id || null, revision: config.revision });
    } catch (error) {
      send({ type: 'error', ready: false, message: error.name === 'QuotaExceededError' ? 'Not enough free storage. Free space, then retry.' : error.message });
    }
  })());
});
async function rangeResponse(request, response) {
  const range = request.headers.get('range');
  if (!range) return response;
  const bytes = await response.arrayBuffer();
  const length = bytes.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start, end;
  if (match && (match[1] || match[2])) {
    start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
    end = match[1] && match[2] ? Number(match[2]) : length - 1;
    end = Math.min(end, length - 1);
  }
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= length || end < start) {
    headers.set('Content-Range', `bytes */${length}`); headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
async function packFor(event, url) {
  const client = event.clientId ? await self.clients.get(event.clientId) : null;
  const clientURL = client && new URL(client.url);
  const groups = Object.entries(config.groups);
  const pair = groups.find(([, g]) => absolute(g.entry).split('?')[0] === url.origin + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : '')) ||
    groups.find(([, g]) => clientURL && absolute(g.entry).split('?')[0] === clientURL.origin + clientURL.pathname + (clientURL.pathname.endsWith('/') ? 'index.html' : ''));
  if (!pair) return null;
  const [id, group] = pair;
  const current = groupName(id, group);
  const names = await caches.keys();
  const readPack = async name => {
    const marker = await (await caches.open(name)).match(markerURL);
    if (!marker) return null;
    const data = await marker.json();
    return data.id === id && data.files ? data : null;
  };
  if (names.includes(current)) { const pack = await readPack(current); if (pack) return pack; }
  // Shell updates retain the last complete downloaded release of each game.
  for (const name of names.reverse()) {
    if (name.startsWith(`${prefix}pack-${id}-`)) { const pack = await readPack(name); if (pack) return pack; }
  }
  return null;
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== base.origin) return;
  event.respondWith((async () => {
    const isNavigation = request.mode === 'navigate';
    const clean = url.origin + url.pathname;
    const key = isNavigation && url.pathname === base.pathname ? absolute(config.index) : isNavigation ? clean + (url.pathname.endsWith('/') ? 'index.html' : '') : request.url;
    const pack = await packFor(event, url);
    const packKey = pack?.files[key] ? key : Object.keys(pack?.files || {}).find(file => file.split('?')[0] === clean);
    const digest = packKey && pack.files[packKey];
    let hit = digest && await (await caches.open(poolName)).match(assetKey(packKey, digest));
    const shellKey = config.shell.find(file => absolute(file) === key) || config.shell.find(file => absolute(file).split('?')[0] === clean);
    if (!hit && shellKey) hit = await (await caches.open(shellName)).match(absolute(shellKey));
    if (hit) return rangeResponse(request, hit);
    try { return await fetch(request); }
    catch {
      // Preserve previously visited games during migration without treating an
      // old, opportunistic HTTP cache as a verified new offline installation.
      for (const name of config.legacyCaches || []) {
        if (!(await caches.keys()).includes(name)) continue;
        const legacy = await (await caches.open(name)).match(key);
        if (legacy) return rangeResponse(request, legacy);
      }
      return new Response('This file is not downloaded. Reconnect, finish the offline download, then launch again.', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
