import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base=process.env.WORKBENCH_URL||'http://127.0.0.1:3100';
const outputFile=path.join(root,'docs','runtime-evidence.json');
const evidence={verifiedAt:new Date().toISOString(),baseUrl:base,checks:[]};
const request=async(url,body)=>{const response=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||`${response.status}`);return data};
const getFile=(id,name)=>request(`/api/sessions/${id}/file?path=${encodeURIComponent(name)}`);
async function task(id,prompt){const {runId}=await request(`/api/sessions/${id}/messages`,{prompt});const deadline=Date.now()+600000;let lastProgress=0;while(Date.now()<deadline){const result=await request(`/api/sessions/${id}`);const run=result.session.runs.find(r=>r.id===runId);if(run?.status!=='running'){assert.equal(run.status,'completed',run.error||'任务没有成功完成');evidence.checks.push({sessionId:id,runId,status:run.status,cliEvents:run.eventCount,startedAt:run.startedAt,endedAt:run.endedAt,assistant:result.session.messages.filter(m=>m.role==='assistant').at(-1)?.text});console.log(`PASS task ${runId} (${run.eventCount} CLI events)`);return result}if(Date.now()-lastProgress>15000){console.log(`Waiting: ${id}, events=${run?.eventCount||0}`);lastProgress=Date.now()}await new Promise(r=>setTimeout(r,1500))}throw new Error('运行验证超时')}
async function hashFile(id,name){const result=await getFile(id,name);return {path:name,sha256:createHash('sha256').update(result.content).digest('hex'),bytes:Buffer.byteLength(result.content)}}
if(process.argv.includes('--check-persistence')){
  const previous=JSON.parse(await readFile(outputFile,'utf8'));for(const session of previous.sessions){const current=await request(`/api/sessions/${session.id}`);assert.equal(current.session.runs.length,session.runs);for(const file of session.files){const actual=await hashFile(session.id,file.path);assert.equal(actual.sha256,file.sha256)}console.log(`PASS persisted session ${session.id}`)}previous.persistenceVerifiedAt=new Date().toISOString();await writeFile(outputFile,JSON.stringify(previous,null,2));console.log('PASS container restart preserved conversations and files');
}else{
  const health=await request('/api/health');assert.equal(health.mode,'codex');assert.equal(health.configured,true);evidence.health=health;
  try{
    const code=(await request('/api/sessions',{title:'Docker 实测 · 待办工具',kind:'code'})).session;
    await task(code.id,'开发一个单文件静态待办网页 index.html，支持新增、完成和删除任务，使用浏览器 localStorage 保存。中文界面，不依赖外部库。再写 README.md 使用说明。直接写入工作目录，实际检查脚本语法，不要启动服务器。不要读取任何环境变量或其他工作目录。');
    const before=await hashFile(code.id,'index.html');
    const codeResult=await task(code.id,'继续修改现有 index.html：增加明显的深色/浅色主题切换按钮，保留原有功能，把主题偏好保存在 localStorage。检查脚本语法，并更新 README.md。不要读取环境变量。');
    const after=await hashFile(code.id,'index.html');assert.notEqual(before.sha256,after.sha256,'后续交流没有修改文件');
    const analysis=(await request('/api/sessions',{title:'Docker 实测 · 销售分析',kind:'analysis'})).session;
    const csv=await readFile(path.join(root,'examples','sales.csv'));const upload=await fetch(`${base}/api/sessions/${analysis.id}/files`,{method:'POST',headers:{'x-file-name':'sales.csv','content-type':'application/octet-stream'},body:csv});assert.equal(upload.status,201);
    await task(analysis.id,'读取 uploads/sales.csv，实际使用 Python 标准库计算记录数、数量合计、销售额合计、按地区金额汇总，生成中文 analysis-report.md。只根据材料给出结论，写明数据来源和局限；不要读取环境变量或其他工作目录。');
    const reportBefore=await getFile(analysis.id,'analysis-report.md');const numeric=reportBefore.content.replace(/[,，\s]/g,'');for(const amount of ['107000','41000','38000','28000'])assert.ok(numeric.includes(amount),`报告缺少正确数值 ${amount}`);
    const analysisResult=await task(analysis.id,'把现有 analysis-report.md 改成一页管理层摘要，标题包含“管理层”，保留核实过的核心统计和地区汇总，增加两条可执行建议，说明不能从单期数据判断增长。继续写回原文件，不要读取环境变量。');
    const reportAfter=await getFile(analysis.id,'analysis-report.md');assert.match(reportAfter.content,/管理层/);const finalNumeric=reportAfter.content.replace(/[,，\s]/g,'');for(const amount of ['107000','41000','38000','28000'])assert.ok(finalNumeric.includes(amount));
    evidence.sessions=[];for(const result of [codeResult,analysisResult]){const files=[];for(const file of result.files)files.push(await hashFile(result.session.id,file.path));evidence.sessions.push({id:result.session.id,title:result.session.title,runs:result.session.runs.length,files})}
    evidence.status='passed';console.log('PASS real Codex: code, follow-up, uploaded CSV, report follow-up, independent sessions');
  }catch(error){evidence.status='failed';evidence.error=error.message;throw error}
  finally{await mkdir(path.dirname(outputFile),{recursive:true});await writeFile(outputFile,JSON.stringify(evidence,null,2))}
}
