const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto, createHash } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../offline-worker.js'), 'utf8');
const scope = 'https://test.invalid/games/grace/';
function setup(options = {}) {
  const listeners = {}, db = new Map(), fetches = [], contents = Buffer.from('0123456789');
  let claims = 0, skips = 0;
  const assets = { 'index.html': { size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') }, 'song.mp3': { size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') } };
  const config = { namespace: 'hg-offline', revision: 'new', index: 'index.html', assets, shell: ['index.html', 'song.mp3'], groups: { demo: { entry:'demo.html', revision:'v1', files:['song.mp3'] } } };
  const key = req => typeof req === 'string' ? req : req.url;
  const caches = {
    keys: async () => [...db.keys()], delete: async name => db.delete(name),
    open: async name => {
      if (!db.has(name)) db.set(name, new Map());
      const rows = db.get(name);
      return { keys:async()=>[...rows.keys()].map(url=>new Request(url)), put: async (req,res) => { if(options.quota) throw Object.assign(new Error('quota'), { name:'QuotaExceededError' }); rows.set(key(req),res.clone()); }, match:async req => rows.get(key(req))?.clone(), delete:async req => rows.delete(key(req)) };
    }
  };
  const self = { OFFLINE_CONFIG:config, registration:{scope}, clients:{ claim:async()=>claims++, matchAll:async()=>[], get:async()=>({url:scope+'demo.html'}) }, skipWaiting:()=>skips++, addEventListener:(type,fn)=>listeners[type]=fn };
  const fetch = async request => {
    fetches.push(request);
    if(options.offline) throw Error('disconnected');
    const bad = request.url.endsWith(options.fail || '__none__');
    return new Response(options.corrupt ? 'XXXXXXXXXX' : contents, { status:bad?404:200, headers:{'Content-Type':'audio/mpeg'} });
  };
  const context = vm.createContext({ self, URL, Request, Response, Headers, caches, fetch, crypto:webcrypto, console, Date, Map, Uint8Array, Number });
  vm.runInContext(source, context);
  const lifecycle = async type => { let promise; listeners[type]({ waitUntil:p=>promise=p }); await promise; };
  const message = async data => { let promise; const result=[]; listeners.message({ data, ports:[{postMessage:x=>result.push(x)}], waitUntil:p=>promise=p }); await promise; return result.at(-1); };
  const get = async (file,headers={},mode='cors') => { let result; const request = new Request(scope+file,{headers}); Object.defineProperty(request,'mode',{value:mode}); listeners.fetch({request,clientId:'test',respondWith:p=>result=p});return result; };
  return { db, caches, options, fetches, config, lifecycle, message, get, counts:()=>({claims,skips}) };
}
test('all critical files are installed and status verifies the whole inventory',async()=>{
  const s=setup(); await s.lifecycle('install'); assert.equal((await s.message({type:'OFFLINE_STATUS'})).ready,true);
  assert.ok(s.fetches.every(r=>!r.headers.has('range')&&r.cache==='reload'));
  await (await s.caches.open('hg-offline-shell-new')).delete(scope+'song.mp3');
  assert.equal((await s.message({type:'OFFLINE_STATUS'})).ready,false);
});
for (const options of [{fail:'song.mp3'},{corrupt:true},{quota:true}]) test(`installation rejects incomplete, stale or quota-limited files ${JSON.stringify(options)}`,async()=>{
  const s=setup(options); await s.caches.open('hg-offline-shell-old');await s.caches.open('other-game-save-cache');
  await assert.rejects(s.lifecycle('install'));assert.equal(s.db.has('hg-offline-shell-new'),false);assert.equal(s.db.has('hg-offline-shell-old'),true);assert.equal(s.db.has('other-game-save-cache'),true);
});
test('activation owns only its shell caches and never forces an update during a run',async()=>{
  const s=setup();await s.caches.open('hg-offline-shell-old');await s.caches.open('hg-offline-pack-demo-old');await s.caches.open('arcade-v14');
  await s.lifecycle('install');assert.equal(s.counts().skips,0);await s.lifecycle('activate');
  assert.equal(s.db.has('hg-offline-shell-old'),false);assert.equal(s.db.has('arcade-v14'),true);assert.equal(s.db.has('hg-offline-pack-demo-old'),true);assert.equal(s.counts().claims,1);
});
test('cold offline navigation handles a start URL query and root alias without network',async()=>{
  const s=setup();await s.lifecycle('install');s.options.offline=true;
  for(const p of ['index.html?launch=installed',''])assert.equal(await(await s.get(p,{},'navigate')).text(),'0123456789');
  assert.equal(await(await s.get('song.mp3?cache-bust=123')).text(),'0123456789');
  assert.equal(s.fetches.length,2);
  assert.equal((await s.get('never-downloaded.html',{},'navigate')).status,504);
});
test('offline audio supports bounded, open, suffix, clipped and invalid Safari ranges',async()=>{
  const s=setup();await s.lifecycle('install');s.options.offline=true;
  for(const [range,status,text] of [['bytes=2-4',206,'234'],['bytes=7-',206,'789'],['bytes=-3',206,'789'],['bytes=8-99',206,'89'],['bytes=99-',416,''],['bytes=4-2',416,''],['bytes=-0',416,''],['bytes=0-1,4-5',416,'']]){
    const r=await s.get('song.mp3',{Range:range});assert.equal(r.status,status,range);assert.equal(await r.text(),text,range);assert.equal(r.headers.get('accept-ranges'),'bytes');
  }
});
test('a game is ready only after the package transaction commits',async()=>{
  const s=setup();await s.lifecycle('install');assert.equal((await s.message({type:'OFFLINE_STATUS',id:'demo'})).ready,false);
  assert.equal((await s.message({type:'OFFLINE_DOWNLOAD',id:'demo'})).ready,true);s.options.offline=true;
  assert.equal(await(await s.get('song.mp3')).text(),'0123456789');assert.equal(s.db.has('hg-offline-pack-demo-v1'),true);
});
test('failed package download is retryable and never leaves a completion marker',async()=>{
  const s=setup();await s.lifecycle('install');s.options.fail='song.mp3';
  assert.equal((await s.message({type:'OFFLINE_DOWNLOAD',id:'demo'})).ready,false);
  assert.ok([...s.db.keys()].every(k=>!k.includes('stage-')));
  s.options.fail=null;assert.equal((await s.message({type:'OFFLINE_DOWNLOAD',id:'demo'})).ready,true);
});
test('games share immutable assets and a partial eviction invalidates readiness',async()=>{
  const s=setup();await s.lifecycle('install');s.config.groups.second={entry:'second.html',revision:'v1',files:['song.mp3']};
  await s.message({type:'OFFLINE_DOWNLOAD',id:'demo'});const before=s.fetches.length;
  assert.equal((await s.message({type:'OFFLINE_DOWNLOAD',id:'second'})).ready,true);assert.equal(s.fetches.length,before,'shared audio must not be downloaded twice');
  const pool=s.db.get('hg-offline-assets');pool.clear();
  assert.equal((await s.message({type:'OFFLINE_STATUS',id:'demo'})).ready,false);
});
test('migration retains a previously visited game without claiming it as a verified package',async()=>{
  const s=setup();s.config.legacyCaches=['old-own-cache'];
  await(await s.caches.open('old-own-cache')).put(scope+'previous.mp3',new Response('0123456789'));
  await s.lifecycle('install');await s.lifecycle('activate');s.options.offline=true;
  const response=await s.get('previous.mp3',{Range:'bytes=2-4'});assert.equal(response.status,206);assert.equal(await response.text(),'234');
  assert.equal((await s.message({type:'OFFLINE_STATUS',id:'not-in-new-packages'})).ready,false);
  assert.ok(s.db.has('old-own-cache'));
});
