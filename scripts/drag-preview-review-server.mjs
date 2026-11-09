// Local synthetic UI regression harness. Never imported by the app or copied to dist.
// Cloud/auth modules are mocked only on this isolated loopback test origin.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const port=Number(process.argv[2]??4297);
const harness=await readFile(new URL('./drag-preview-review-ui.mjs',import.meta.url),'utf8');
const mocks={
 'app/auth-client.mjs':'export function getStudioClient(){return null;}',
 'app/auth-context.mjs':'export function getBootAccess(){return null;}',
 'app/cloud-ui.mjs':'export function initializeCloudUI(){return {loading:false,workspace:null};}',
};
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const match=url.pathname.match(/^\/(before|after)\/(.+)$/);
  let version=match?.[1]??'after', path=match?.[2]??url.pathname.slice(1);
  if(path==='app/'||path==='app')path='app/index.html';
  if(!/^(app|src|node_modules\/pdfjs-dist)\//.test(path)||path.includes('..')){res.writeHead(404);return res.end();}
  let content=mocks[path];
  if(content===undefined)content=version==='before'&&!path.startsWith('node_modules/')&&!path.startsWith('app/vendor/')?execFileSync('git',['show',`f956cf0:${path}`],{cwd:root,maxBuffer:24*1024*1024}):await readFile(resolve(root,path));
  if(path==='app/index.html')content=String(content).replace('src="./bootstrap.mjs"','src="./main.mjs"').replace('<div class="app-shell" hidden','<div class="app-shell"').replace('<main class="app-shell" hidden','<main class="app-shell"');
  if(path==='app/main.mjs')content=String(content)+'\n'+harness.replaceAll('__REVIEW_VERSION__',version);
  res.writeHead(200,{'Content-Type':({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});res.end(content);
 }catch(error){res.writeHead(500);res.end(String(error));}
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic review only: http://127.0.0.1:${port}/after/app/ and /before/app/`));
