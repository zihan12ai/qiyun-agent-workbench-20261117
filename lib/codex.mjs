import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function codexAgent({session,root,prompt,signal,onStep,onLog,onEvent,config}){
  if(!process.env.CODEX_API_KEY)throw new Error('真实模式未配置 CODEX_API_KEY。请在服务端 .env 中配置密钥并重启。没有切换到演示模式。');
  if(!process.env.CODEX_MODEL)throw new Error('请设置 CODEX_MODEL 为平台实际提供的模型名称。');
  const codexHome=path.join(config.dataDir,'codex',session.id);await mkdir(codexHome,{recursive:true});
  const baseUrl=process.env.OPENAI_BASE_URL||'https://api.openai.com/v1';
  if(!/^https?:\/\//.test(baseUrl))throw new Error('OPENAI_BASE_URL 必须以 http:// 或 https:// 开头');
  const args=['exec','--json','--skip-git-repo-check','--ephemeral','--sandbox','workspace-write','-c','approval_policy="never"','-c','web_search="disabled"','-c','model_provider="workbench"','-c','model_providers.workbench.name="Workbench API"','-c',`model_providers.workbench.base_url=${JSON.stringify(baseUrl)}`,'-c','model_providers.workbench.env_key="CODEX_API_KEY"','-c','model_providers.workbench.wire_api="responses"','-m',process.env.CODEX_MODEL,'-'];
  const context=session.messages.slice(0,-1).slice(-20).map(m=>`${m.role}: ${m.text.slice(0,6000)}`).join('\n\n');
  const instruction=`你是单用户工作台里的 Agent。用中文回复。当前目录是本会话工作目录，只在这里修改文件；上传材料位于 uploads/。直接完成任务、保存产物并实际验证，最后说明文件路径和验证结果。不要访问其他会话或读取凭据，不要启动长期后台服务。网页成果优先使用可直接打开的静态文件。\n\n此前交流（可能截取了最近20条）：\n${context||'无'}\n\n当前用户请求：\n${prompt}`;
  onStep('启动真实 Codex CLI（Responses API）','running');
  const env={...process.env,CODEX_HOME:codexHome};delete env.NODE_OPTIONS;
  let output='',pending='',stderr='',turnError='',closed=false;
  await new Promise((resolve,reject)=>{
    let child;try{child=spawn(process.env.CODEX_BIN||'codex',args,{cwd:root,env,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']})}catch(e){reject(e);return}
    const stop=()=>{if(closed||!child.pid)return;if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill())}else{try{process.kill(-child.pid,'SIGTERM')}catch{child.kill()} }};
    signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
    const line=raw=>{if(!raw.trim())return;let event;try{event=JSON.parse(raw)}catch{onLog(raw.slice(0,2000));return}onEvent(event);const item=event.item;
      if(event.type==='thread.started')onLog('Codex 会话已建立');
      if(event.type==='item.started'&&item?.type==='command_execution')onLog(`执行：${item.command}`);
      if(event.type==='item.completed'&&item){if(item.type==='agent_message'){output=item.text||output;onLog(item.text||'')}else if(item.type==='command_execution'){onLog(`$ ${item.command}\n${item.aggregated_output||''}\n退出码：${item.exit_code}`)}else if(item.type==='file_change')onLog(`文件变更：${JSON.stringify(item.changes||[])}`)}
      if(event.type==='error'||event.type==='turn.failed'){turnError=event.error?.message||event.message||'Codex 执行失败';onLog(turnError)}
    };
    child.stdout.on('data',chunk=>{pending+=chunk.toString();if(pending.length>1024*1024){onLog('单条 Agent 事件过大，已截断');pending=pending.slice(-65536)}const lines=pending.split(/\r?\n/);pending=lines.pop();for(const l of lines)line(l)});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);onLog(chunk.toString())});
    child.stdin.on('error',()=>{});child.stdin.end(instruction);
    const cleanup=()=>{closed=true;signal.removeEventListener('abort',stop)};
    child.on('error',e=>{cleanup();reject(new Error(e.code==='ENOENT'?'未找到 Codex CLI，请安装或设置 CODEX_BIN。':e.message))});
    child.on('close',code=>{cleanup();if(pending)line(pending);if(signal.aborted)return reject(new Error('任务已取消或超时'));if(code!==0)return reject(new Error(`Codex 退出码 ${code}。${turnError||stderr.slice(-1500)}`));if(turnError)return reject(new Error(turnError));if(!output)return reject(new Error('Codex 没有返回最终答复，请检查 API 协议和模型兼容性。'));resolve()});
  });
  onStep('启动真实 Codex CLI（Responses API）','completed');return output;
}
