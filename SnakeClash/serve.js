const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname;
const PORT=process.env.PORT||8155;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.svg':'image/svg+xml','.md':'text/markdown'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/')p='/index.html';
  const f=path.join(root,p);
  fs.readFile(f,(e,d)=>{
    if(e){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('404');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream',
      'Cache-Control':'no-store'});
    res.end(d);
  });
}).listen(PORT,()=>console.log('SNAKE CLASH serving on http://localhost:'+PORT));
