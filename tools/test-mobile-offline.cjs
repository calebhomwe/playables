/* Per-repository real-browser smoke: download -> close -> disconnected launch
   -> source-authored start input -> screenshot -> save reload. No media stubs.
   This is boot/input evidence, not a claim that every level or mechanic works. */
const {chromium,webkit,devices}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),spec=JSON.parse(fs.readFileSync(path.join(root,'offline-games.json'))),repo=spec.repository;
const output=path.join(root,'qa/offline-results');fs.mkdirSync(output,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),prefix='/'+repo+'/';
 if(!u.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
 let file=path.resolve(root,decodeURIComponent(u.pathname.slice(prefix.length))||'index.html');
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');const b=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(b);}catch{res.writeHead(404);res.end('Missing');}
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let origin;
async function suite(engine){
 const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']}: {})});
 const context=await browser.newContext({...devices[engine===webkit?'iPhone 13':'Pixel 7'],serviceWorkers:'allow'});
 const results=[];const filter=process.env.GAME_IDS?.split(',');
 try{
  let warm=await context.newPage();await warm.goto(origin+'/'+repo+'/index.html');
  await warm.evaluate(async()=>{const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});if(reg.active)return;await new Promise((resolve,reject)=>{const w=reg.installing||reg.waiting;w.addEventListener('statechange',()=>{if(w.state==='activated')resolve();if(w.state==='redundant')reject(Error('Offline install failed'));});});});
  if(repo==='arcade'){
   try{
    await warm.goto(origin+'/'+repo+'/offline.html');
    await warm.locator('#game-search').fill('High Nest');
    const card=warm.locator('article[data-game="high-nest"]');await card.locator('button').tap();
    await warm.waitForFunction(()=>document.querySelector('article[data-game="high-nest"] .status')?.dataset.ready==='true',{},{timeout:120000});
    assert.equal(await warm.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'installer horizontal overflow');
    await warm.screenshot({path:path.join(output,engine.name()+'-installer.png')});
   }catch(error){await warm.screenshot({path:path.join(output,engine.name()+'-installer-failure.png')}).catch(()=>{});throw error;}
  }
  for(const game of spec.games.filter(g=>!filter||filter.includes(g.id))){
   let page;const errors=[];
   try{
    await context.setOffline(false);
    if(warm.isClosed()){warm=await context.newPage();await warm.goto(origin+'/'+repo+'/index.html');}
    const ready=await warm.evaluate(async id=>{
      const reg=await navigator.serviceWorker.getRegistration();return new Promise((resolve,reject)=>{const c=new MessageChannel(),timer=setTimeout(()=>reject(Error('Download timed out')),120000);c.port1.onmessage=e=>{const d=e.data;if(d.type==='status'||d.type==='error'){clearTimeout(timer);c.port1.close();resolve(d);}};reg.active.postMessage({type:'OFFLINE_DOWNLOAD',id},[c.port2]);});
    },game.id);assert.equal(ready.ready,true,JSON.stringify(ready));
    await warm.evaluate(()=>localStorage.setItem('__offline_save_sentinel','preserved'));
    await warm.close();await context.setOffline(true);page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('requestfailed',request=>{if(['script','stylesheet','document'].includes(request.resourceType()))errors.push(request.url()+' '+request.failure()?.errorText);});
    page.on('response',response=>{if(response.status()>=400)errors.push('HTTP '+response.status()+' '+response.url());});
    await page.goto(origin+'/'+repo+'/'+game.entry+'?offline-regression=1',{waitUntil:'load',timeout:45000});
    const start=game.start;
    if(start?.startsWith('key:'))await page.keyboard.press(start.slice(4));
    else if(start){const control=page.locator(start).first();await control.waitFor({state:'visible',timeout:15000});await control.tap({force:true});}
    await sleep(700);
    const canvases=page.locator('canvas');if(await canvases.count()){
      const rect=await canvases.first().boundingBox();if(rect)await page.touchscreen.tap(rect.x+rect.width*.5,rect.y+rect.height*.65);
    }
    await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');await sleep(300);
    assert.ok(await page.locator('body').evaluate(el=>el.children.length>0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'horizontal overflow');
    assert.equal(await page.evaluate(()=>localStorage.getItem('__offline_save_sentinel')),'preserved');
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(output,engine.name()+'-'+game.id+'.png')});
    const snapshot=await page.evaluate(()=>{const out={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);out[k]=localStorage.getItem(k);}return out;});
    await page.close();page=await context.newPage();await page.goto(origin+'/'+repo+'/'+game.entry,{waitUntil:'load'});
    const restored=await page.evaluate(()=>{const out={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);out[k]=localStorage.getItem(k);}return out;});
    assert.equal(restored.__offline_save_sentinel,'preserved');
    // Game state may legitimately advance on boot (idle earnings, daily state).
    // Primitive best-score records must survive; keep all observed key names as evidence.
    for(const [key,value]of Object.entries(snapshot)){
      let parsed;try{parsed=JSON.parse(value);}catch{parsed=value;}
      if(/(?:_rec|_best|highscore|best_score)$/i.test(key)&&['number','string','boolean'].includes(typeof parsed))assert.equal(restored[key],value,'record changed across reload: '+key);
    }
    results.push({id:game.id,result:'offline-boot-input-smoke-pass',engine:engine.name(),gameplayReview:'not established by this smoke test',saveKeysObserved:Object.keys(snapshot),errors});
   }catch(error){
    results.push({id:game.id,result:'failure',engine:engine.name(),error:String(error),errors});
    if(page&&!page.isClosed())await page.screenshot({path:path.join(output,engine.name()+'-'+game.id+'-failure.png')}).catch(()=>{});
   }finally{if(page&&!page.isClosed())await page.close();}
   fs.writeFileSync(path.join(output,engine.name()+'-report.json'),JSON.stringify(results,null,2));
  }
  const failures=results.filter(r=>r.result==='failure');console.log(`${engine.name()}: ${results.length-failures.length}/${results.length} offline boot/input smoke cases passed`);if(failures.length)throw Error(JSON.stringify(failures));
 }finally{await browser.close();}
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;try{for(const engine of[chromium,webkit])if(!process.env.ENGINE||process.env.ENGINE===engine.name())await suite(engine);}finally{server.closeAllConnections();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
