const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),context={self:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'offline-manifest.js'),'utf8'),context);
const config=context.self.OFFLINE_CONFIG,spec=JSON.parse(fs.readFileSync(path.join(root,'offline-games.json')));
assert.match(config.namespace,/^[a-z0-9-]+-mobile$/);
assert.equal(Object.keys(config.groups).length,spec.games.length);
for(const [url,asset]of Object.entries(config.assets)){
 const parsed=new URL(url,'https://offline.invalid/');assert.equal(parsed.origin,'https://offline.invalid');
 const file=path.resolve(root,decodeURIComponent(parsed.pathname.slice(1)));assert.ok(file.startsWith(root+path.sep));
 const bytes=fs.readFileSync(file);assert.equal(bytes.length,asset.size,url);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256,url);
}
for(const game of spec.games){
 const group=config.groups[game.id];assert.equal(group.entry,game.entry);assert.ok(group.files.includes(game.entry));
 assert.ok(group.files.every(f=>config.assets[f]),game.id);assert.equal(group.bytes,group.files.reduce((n,f)=>n+config.assets[f].size,0));assert.ok(group.bytes<=64*1024*1024);
}
assert.ok(!/localStorage|indexedDB|clearSiteData/.test(fs.readFileSync(path.join(root,'offline-worker.js'),'utf8')),'worker must never access or clear game saves');
if(fs.existsSync(path.join(root,'offline-catalog.json'))){const list=JSON.parse(fs.readFileSync(path.join(root,'offline-catalog.json')));assert.equal(list.length,112);assert.equal(list.filter(g=>g.supported).length,99);assert.ok(list.filter(g=>!g.supported).every(g=>g.reason));}
console.log(`PASS ${spec.games.length} packages: all release digests, entries, sizes, local asset URLs and save isolation`);
