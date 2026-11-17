import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { listFiles, safeFile, uploadFile, MAX_FILE_BYTES } from './lib/files.mjs';
import { demoAgent } from './lib/demo.mjs';
import { codexAgent } from './lib/codex.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
export async function createWorkbench(options={}){
  const config={dataDir:path.resolve(options.dataDir||process.env.DATA_DIR||path.join(ROOT,'data')),mode:process.env.AGENT_MODE||'demo',timeout:Math.max(1000,Number(process.env.RUN_TIMEOUT_MS)||600000),maxConcurrent:Math.max(1,Number(process.env.MAX_CONCURRENT_RUNS)||2),...options};
  if(!['demo','codex'].includes(config.mode))throw new Error('AGENT_MODE 只能为 demo 或 codex');
  const store=new Store(config.dataDir);const jobs=new Map(),clients=new Map();let stopping=false;
  const workspaces=path.join(config.dataDir,'workspaces');await mkdir(workspaces,{recursive:true});
  const now=()=>new Date().toISOString();const rootFor=id=>path.join(workspaces,id);
  const redact=value=>{let t=String(value);for(const key of [process.env.CODEX_API_KEY,process.env.OPENAI_API_KEY])if(key)t=t.split(key).join('[REDACTED]');return t.replace(/Bearer\s+[A-Za-z0-9_.-]+/gi,'Bearer [REDACTED]')};
  function emit(id,event,payload){for(const res of clients.get(id)||[])res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)}
  function snapshot(s){return {...s,files:undefined}}
  function persist(s){s.updatedAt=now();store.save(s);emit(s.id,'update',{id:s.id})}
  function addMessage(s,role,text,extra={}){const m={id:randomUUID(),role,text:redact(text),createdAt:now(),...extra};s.messages.push(m);return m}
  const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
  async function buffer(req,max=MAX_FILE_BYTES){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>max)fail('请求内容过大',413);chunks.push(c)}return Buffer.concat(chunks)}
  async function input(req){try{return JSON.parse((await buffer(req,64000)).toString()||'{}')}catch(e){if(e.status)throw e;fail('JSON 格式无效')}}
  async function launch(s,prompt){
    const run={id:randomUUID(),status:'running',startedAt:now(),steps:[],logs:[],eventCount:0};s.runs.push(run);s.status='running';
    const controller=new AbortController();const job={controller,timedOut:false};jobs.set(s.id,job);persist(s);
    const timer=setTimeout(()=>{job.timedOut=true;controller.abort()},config.timeout);
    const onStep=(label,status)=>{let step=run.steps.find(x=>x.label===label&&x.status==='running');if(!step){step={label,status,at:now()};run.steps.push(step)}else step.status=status;persist(s)};
    const onLog=message=>{run.logs.push({at:now(),text:redact(message).slice(0,6000)});if(run.logs.length>100)run.logs.shift();store.save(s);emit(s.id,'update',{id:s.id})};
    job.promise=(async()=>{try{const text=await(s.mode==='demo'?demoAgent:codexAgent)({session:s,prompt,root:rootFor(s.id),signal:controller.signal,onStep,onLog,onEvent:()=>{run.eventCount++},config});if(controller.signal.aborted)throw new Error('任务已取消');run.status='completed';s.status='idle';addMessage(s,'assistant',text,{runId:run.id})}
      catch(e){run.status=job.timedOut?'timed_out':controller.signal.aborted?'cancelled':'failed';run.error=redact(job.timedOut?'任务超时，已有文件保留。可以重试或修改 RUN_TIMEOUT_MS。':controller.signal.aborted?'任务已取消，已有文件保留。':e.message);s.status=run.status==='cancelled'?'idle':'error';addMessage(s,'system',run.error,{runId:run.id});for(const step of run.steps)if(step.status==='running')step.status=run.status}
      finally{clearTimeout(timer);run.endedAt=now();jobs.delete(s.id);persist(s);emit(s.id,'complete',{id:s.id})}})();return run;
  }
  async function api(req,res,url){
    const p=url.pathname.split('/').filter(Boolean);
    if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,mode:config.mode,active:jobs.size,version:'0.1.0',configured:!!process.env.CODEX_API_KEY&&!!process.env.CODEX_MODEL});
    if(url.pathname==='/api/sessions'){
      if(req.method==='GET')return json(res,200,{sessions:store.list()});
      if(req.method==='POST'){const body=await input(req);if(typeof body.title!=='string'||!body.title.trim())fail('请输入工作名称');if(body.kind&&!['code','analysis'].includes(body.kind))fail('工作类型无效');const s={id:randomUUID(),title:body.title.trim().slice(0,80),kind:body.kind||'code',mode:config.mode,status:'idle',createdAt:now(),updatedAt:now(),messages:[],runs:[]};await mkdir(rootFor(s.id),{recursive:true});store.save(s);return json(res,201,{session:snapshot(s)})}
    }
    if(p[1]!=='sessions')fail('接口不存在',404);const s=store.get(p[2]);if(!s)fail('工作不存在',404);const action=p[3];
    if(!action&&req.method==='GET')return json(res,200,{session:snapshot(s),files:await listFiles(rootFor(s.id))});
    if(action==='events'&&req.method==='GET'){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});res.write('event: ready\ndata: {}\n\n');const group=clients.get(s.id)||new Set();group.add(res);clients.set(s.id,group);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);res.on('close',()=>{clearInterval(heartbeat);group.delete(res)});return;
    }
    if(action==='messages'&&req.method==='POST'){
      if(stopping)fail('服务正在停止',503);if(jobs.has(s.id))fail('当前工作正在执行，请等待完成或先停止',409);if(jobs.size>=config.maxConcurrent)fail('并发任务已满，请稍后重试',429);
      const body=await input(req);if(typeof body.prompt!=='string'||!body.prompt.trim())fail('请输入任务');if(body.prompt.length>10000)fail('单条任务不能超过 10000 字');
      addMessage(s,'user',body.prompt.trim());const run=await launch(s,body.prompt.trim());return json(res,202,{runId:run.id});
    }
    if(action==='cancel'&&req.method==='POST'){const job=jobs.get(s.id);if(!job)fail('没有正在运行的任务',409);job.controller.abort();return json(res,202,{ok:true})}
    if(action==='files'&&req.method==='POST'){
      if(jobs.has(s.id))fail('请等待当前任务结束再上传材料',409);const raw=req.headers['x-file-name'];if(typeof raw!=='string')fail('缺少文件名');let name;try{name=decodeURIComponent(raw)}catch{fail('文件名编码无效')}
      const stored=await uploadFile(rootFor(s.id),name,await buffer(req));addMessage(s,'system',`已上传 ${stored}`);persist(s);return json(res,201,{path:stored});
    }
    if(action==='preview'&&req.method==='GET'){
      const name=url.searchParams.get('path');if(!/\.html?$/i.test(name||''))fail('仅支持 HTML 预览');const file=await safeFile(rootFor(s.id),name);const meta=await stat(file);if(meta.size>MAX_FILE_BYTES)fail('文件过大',413);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"});return res.end(await readFile(file));
    }
    if(action==='file'&&req.method==='GET'){
      const name=url.searchParams.get('path');const file=await safeFile(rootFor(s.id),name);const meta=await stat(file);if(!meta.isFile())fail('不是文件');
      const download=url.searchParams.get('download')==='1';if(!download&&meta.size>MAX_FILE_BYTES)fail('文件超过 5 MB，请下载后查看',413);const content=await readFile(file);
      if(download){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`});return res.end(content)}
      if(content.subarray(0,8000).includes(0))fail('该文件是二进制格式，请下载后查看',415);
      return json(res,200,{path:name,content:content.toString('utf8')});
    }
    fail('接口不存在',404);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    try{
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)fail('不允许跨站请求',403);
      const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);
      if(req.method!=='GET'&&req.method!=='HEAD')fail('资源不存在',404);const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};const name=files[url.pathname];if(!name)fail('资源不存在',404);
      const content=await readFile(path.join(ROOT,'public',name));res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");res.writeHead(200,{'content-type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
    }catch(e){if(!res.headersSent)json(res,e.status||((e.code==='ENOENT')?404:500),{error:redact(e.message)});else res.end()}
  });
  async function close(){stopping=true;for(const job of jobs.values())job.controller.abort();await Promise.allSettled([...jobs.values()].map(j=>j.promise));for(const group of clients.values())for(const res of group)res.end();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));store.close()}
  return {server,store,config,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.loadEnvFile(path.join(ROOT,'.env'))}catch(e){if(e.code!=='ENOENT')throw e}
  const app=await createWorkbench();const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3100);
  app.server.listen(port,host,()=>console.log(`Workbench ready: http://${host}:${port} | mode=${app.config.mode}`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void app.close().then(()=>process.exit(0))});
}
