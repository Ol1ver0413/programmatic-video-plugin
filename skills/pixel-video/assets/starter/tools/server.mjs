import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {localFile} from './project.mjs';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.srt':'application/x-subrip; charset=utf-8'};
export async function startServer(port=0){
  const actualRoot=await realpath(root);
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      const ref=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';
      const file=await realpath(localFile(root,ref)),relative=path.relative(actualRoot,file);
      if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){res.writeHead(403).end();return}
      const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return}
      const headers={'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
      let from=0,to=info.size-1,code=200;
      if(req.headers.range){
        const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        if(!match){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return}
        from=Number(match[1]);to=Math.min(match[2]?Number(match[2]):to,to);
        if(from>to||from<0){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return}
        headers['Content-Range']=`bytes ${from}-${to}/${info.size}`;code=206;
      }
      res.writeHead(code,{...headers,'Content-Length':Math.max(0,to-from+1)});
      if(req.method==='HEAD'||info.size===0){res.end();return}
      const stream=createReadStream(file,{start:from,end:to});stream.on('error',()=>res.destroy());stream.pipe(res);
    }catch(error){res.writeHead(error.code==='ENOENT'?404:400).end('Resource unavailable')}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {server,url}=await startServer(Number(process.env.PORT||4173));console.log(url);
  process.on('SIGINT',()=>server.close(()=>process.exit()));
}
