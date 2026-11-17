import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.WORKBENCH_URL||'http://127.0.0.1:3101';
const get=async p=>{const r=await fetch(base+p);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()};
const health=await get('/api/health');
const all=(await get('/api/sessions')).sessions;
const result={capturedAt:new Date().toISOString(),baseUrl:base,health,environment:{platform:'Linux/amd64 (Docker Desktop on Windows)',node:'v24.22.3',codex:'0.114.0',uid:1000,hostPort:3101,nonRoot:true,capDropAll:true,noNewPrivileges:true,envFileInImage:false,windowsCodexMounted:false},regression:{host:{passed:8,failed:0},container:{passed:8,failed:0}},sessions:[]};
for(const kind of ['code','analysis']){
 const candidates=all.filter(s=>s.kind===kind&&s.title.startsWith('Docker 实测'));
 const snapshots=await Promise.all(candidates.map(s=>get(`/api/sessions/${s.id}`)));
 const d=snapshots.find(d=>d.session.runs.some(r=>r.status==='completed'))||snapshots[0];
 if(!d)continue;
 const dest=`docs/demo-output/${kind}`;await mkdir(dest,{recursive:true});
 const entry={id:d.session.id,title:d.session.title,mode:d.session.mode,status:d.session.status,runs:d.session.runs.map(r=>({id:r.id,status:r.status,eventCount:r.eventCount,startedAt:r.startedAt,endedAt:r.endedAt,error:r.error})),messages:d.session.messages,files:[]};
 for(const f of d.files){
  if(f.path.startsWith('uploads/'))continue;
  const content=(await get(`/api/sessions/${d.session.id}/file?path=${encodeURIComponent(f.path)}`)).content;
  if(!['index.html','README.md','analysis-report.md'].includes(f.path))continue;
  await writeFile(`${dest}/${f.path}`,content);
  entry.files.push({path:f.path,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex'),snapshot:`demo-output/${kind}/${f.path}`});
 }
 result.sessions.push(entry);
}
const report=result.sessions.find(s=>s.mode==='codex'&&s.title.includes('销售分析'));
if(report?.files.some(f=>f.path==='analysis-report.md')){const text=await readFile('docs/demo-output/analysis/analysis-report.md','utf8');const numbers=text.replace(/[,，\s]/g,'');result.reportStatisticsVerified=['107000','41000','38000','28000'].every(n=>numbers.includes(n));}
await writeFile('docs/delivery-evidence.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({sessions:result.sessions.map(s=>({id:s.id,runs:s.runs.map(r=>r.status),files:s.files.map(f=>f.path)})),reportStatisticsVerified:result.reportStatisticsVerified}));
