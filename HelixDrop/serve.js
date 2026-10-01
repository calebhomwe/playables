const http=require('http'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');   /* the repo root: the game uses the shared ../lib3d */
const PORT=process.env.PORT||8154;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.svg':'image/svg+xml','.md':'text/markdown','.glb':'model/gltf-binary','.mp3':'audio/mpeg'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){res.writeHead(302,{Location:'/HelixDrop/index.html'});return res.end();}
  const f=path.join(root,p);
  fs.readFile(f,(e,d)=>{
    if(e){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('404');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream',
      'Cache-Control':'no-store'});
    res.end(d);
  });
}).listen(PORT,()=>console.log('HELIX DROP serving on http://localhost:'+PORT));
