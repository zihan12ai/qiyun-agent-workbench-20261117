import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(root) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'workbench.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.sessions = new Map(this.db.prepare('SELECT id,data FROM sessions').all().map(row => [row.id, JSON.parse(row.data)]));
    this.saveQuery = this.db.prepare('INSERT INTO sessions (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
    for (const session of this.sessions.values()) {
      if (session.status === 'running') {
        session.status = 'interrupted';
        const run = session.runs.at(-1);
        if (run) { run.status = 'interrupted'; run.endedAt = new Date().toISOString(); }
        session.messages.push({ id: crypto.randomUUID(), role: 'system', text: '服务已重启，上次任务已中断。已有文件保留，可以发送消息继续。', createdAt: new Date().toISOString() });
        this.save(session);
      }
    }
  }
  save(session) { this.saveQuery.run(session.id, JSON.stringify(session)); this.sessions.set(session.id, session); }
  get(id) { return this.sessions.get(id); }
  list() {
    return [...this.sessions.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(({id,title,kind,mode,status,createdAt,updatedAt,messages,runs}) => ({id,title,kind,mode,status,createdAt,updatedAt,messageCount:messages.filter(m => m.role === 'user').length,runCount:runs.length,lastMessage:messages.filter(m => m.role === 'user').at(-1)?.text.slice(0,100) || ''}));
  }
  close() { this.db.close(); }
}
