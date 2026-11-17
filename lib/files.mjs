import { readdir, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ignored = new Set(['node_modules','__pycache__','venv','dist','build']);
export function inside(root, target) { const rel = path.relative(root,target); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
export async function safeFile(root, name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.split('/').some(s => !s || s === '.' || s === '..' || s.startsWith('.')) || path.isAbsolute(name)) throw Object.assign(new Error('文件路径无效'), {status:400});
  const target = path.resolve(root,name);
  if (!inside(root,target)) throw Object.assign(new Error('文件路径超出工作目录'), {status:403});
  let cursor = root;
  for (const segment of name.split('/')) {
    cursor = path.join(cursor,segment);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw Object.assign(new Error('不允许访问符号链接'), {status:403});
  }
  if (!inside(await realpath(root), await realpath(target))) throw Object.assign(new Error('文件路径无效'), {status:403});
  return target;
}
export async function listFiles(root) {
  const files = [];
  async function walk(dir, depth = 0) {
    if (depth > 6 || files.length >= 250) return;
    for (const entry of await readdir(dir,{withFileTypes:true})) {
      if (entry.name.startsWith('.') || ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(dir,entry.name);
      if (entry.isDirectory()) await walk(full,depth+1);
      else if (entry.isFile()) {
        const stat = await lstat(full);
        files.push({path:path.relative(root,full).split(path.sep).join('/'),name:entry.name,size:stat.size,updatedAt:stat.mtime.toISOString(),type:entry.name.split('.').at(-1).toLowerCase()});
        if (files.length >= 250) break;
      }
    }
  }
  await walk(root);
  return files.sort((a,b) => Number(a.path.startsWith('uploads/')) - Number(b.path.startsWith('uploads/')) || a.path.localeCompare(b.path));
}
export async function uploadFile(root, name, buffer) {
  if (typeof name !== 'string' || !name.trim() || name.length > 150 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name.startsWith('.') || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) throw Object.assign(new Error('文件名无效，请使用普通文件名'), {status:400});
  if (buffer.length > MAX_FILE_BYTES) throw Object.assign(new Error('单个文件不能超过 5 MB'),{status:413});
  await mkdir(path.join(root,'uploads'),{recursive:true});
  const uploadRoot = await safeFile(root,'uploads');
  const parsed = path.parse(name);
  for (let i=0; i<1000; i++) {
    const filename = i ? `${parsed.name} (${i})${parsed.ext}` : name;
    const full = path.join(uploadRoot,filename);
    try { await writeFile(full,buffer,{flag:'wx'}); return `uploads/${filename}`; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw Object.assign(new Error('同名文件过多'),{status:409});
}
