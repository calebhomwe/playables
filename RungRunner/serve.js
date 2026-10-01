const http=require('http'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');   /* the repo root: the game uses the shared ../lib3d */
const PORT=process.env.PORT||8151;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){res.writeHead(302,{Location:'/RungRunner/index.html'});return res.end();}
  const f=path.join(root,p);
  fs.readFile(f,(e,d)=>{
    if(e){res.writeHead(404);return res.end('404');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    res.end(d);
  });
}).listen(PORT,()=>console.log('serving on http://localhost:'+PORT));
