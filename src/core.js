export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
export function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
export function escapeHTML(s = '') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Tên file không được để trống.');
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes('\0') || /[\x00-\x1f]/.test(path)) throw new Error('Chỉ dùng đường dẫn tương đối trong project.');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw new Error('Đường dẫn có thành phần không hợp lệ.');
  if (parts.some(p => p.length > 200) || path.length > 800) throw new Error('Đường dẫn quá dài.');
  return parts.join('/');
}
export function bytesToBase64(bytes) {
  let result = '';
  for (let i=0;i<bytes.length;i+=16384) result += String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(result);
}
export function base64ToBytes(s) { const raw = atob(s); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
export function fileBytes(file) { return file.encoding === 'base64' ? base64ToBytes(file.content) : encoder.encode(file.content); }
export function fileFromBytes(path, bytes) {
  path = normalizePath(path);
  const binaryExt = /\.(xlsx?|parquet|db|sqlite3?|png|jpe?g|gif|webp|ico|pdf|np[yz]|pkl|pickle|joblib|zip|gz|woff2?|ttf|mp[34]|wav)$/i;
  let binary = binaryExt.test(path) || bytes.subarray(0, Math.min(bytes.length,2048)).includes(0);
  if (!binary) { try { new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { binary=true; } }
  return {path, encoding:binary?'base64':'text',content:binary?bytesToBase64(bytes):decoder.decode(bytes), modified:Date.now()};
}
export function newFile(path, content='') { return {path:normalizePath(path),encoding:'text',content,modified:Date.now()}; }
export function newProject(name, files=[]) { return {id:uid(),name:name.trim()||'python-project',files,folders:[],tabs:files.filter(f=>f.path.endsWith('.py')).slice(0,1).map(f=>f.path),active:files.find(f=>f.path.endsWith('.py'))?.path||files[0]?.path||null,breakpoints:{},packages:[],created:Date.now(),modified:Date.now()}; }
export function validateProject(project, limit=80*1024*1024) {
  if (!project || typeof project.name!=='string' || !Array.isArray(project.files)) throw new Error('Project không hợp lệ.');
  const seen=new Set(); let size=0;
  const files=project.files.map(file=>{
    const path=normalizePath(file.path);
    if (seen.has(path)) throw new Error(`File trùng: ${path}`);
    seen.add(path);
    if (!['text','base64'].includes(file.encoding)||typeof file.content!=='string') throw new Error(`Nội dung không hợp lệ: ${path}`);
    const bytes=fileBytes(file); size+=bytes.length;
    if (bytes.length>25*1024*1024) throw new Error(`File vượt 25 MB: ${path}`);
    return {...file,path};
  });
  if (size>limit) throw new Error('Project vượt giới hạn 80 MB.');
  for(const path of seen) {const parts=path.split('/'); parts.pop(); let prefix=''; for(const p of parts) {prefix=prefix?prefix+'/'+p:p; if(seen.has(prefix)) throw new Error(`Đường dẫn file/thư mục xung đột: ${prefix}`);}}
  const folders=Array.isArray(project.folders)?project.folders.map(normalizePath):[];
  for(const folder of folders){let prefix='';for(const part of folder.split('/')){prefix=prefix?prefix+'/'+part:part;if(seen.has(prefix))throw new Error('Tên thư mục trùng tên file: '+prefix);}}
  const breakpoints=Object.fromEntries(Object.entries(project.breakpoints||{}).filter(([p,lines])=>seen.has(p)&&p.endsWith('.py')&&Array.isArray(lines)).map(([p,lines])=>[p,[...new Set(lines.filter(n=>Number.isInteger(n)&&n>0&&n<=1000000))].sort((a,b)=>a-b)]));
  const packages=Array.isArray(project.packages)?project.packages:[];
  for(const requirement of packages){if(typeof requirement!=='string'||parseRequirements(requirement).length!==1)throw new Error('Yêu cầu thư viện trong project không hợp lệ.');}
  return {...project,id:typeof project.id==='string'?project.id:uid(),files,folders,tabs:(Array.isArray(project.tabs)?project.tabs:[]).filter(p=>seen.has(p)),active:seen.has(project.active)?project.active:files[0]?.path||null,breakpoints,packages};
}
export function parseRequirements(content) {
  return content.split(/\r?\n/).map(s=>s.replace(/\s+#.*$/, '').trim()).filter(s=>s&&!s.startsWith('#')).map(s=>{
    if(s.startsWith('-')||s.includes('://')||!/^([A-Za-z0-9_.-]+)(\[[A-Za-z0-9_,.-]+\])?([<>=!~].*)?$/.test(s)) throw new Error(`Requirement chưa hỗ trợ: ${s}. Dùng tên gói hoặc tên==phiên_bản.`);
    return s;
  });
}
export function sourceOf(cell) { return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source||''); }
export function readNotebook(text) {
  const nb=JSON.parse(text);
  if(nb.nbformat!==4 || !Array.isArray(nb.cells)) throw new Error('Cần notebook định dạng .ipynb v4.');
  nb.cells=nb.cells.map(c=>({...c,id:c.id||uid().slice(0,8),source:sourceOf(c),metadata:c.metadata||{},outputs:c.outputs||[]}));
  return nb;
}
export function emptyNotebook() { return {nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},cells:[{cell_type:'code',id:uid().slice(0,8),source:'',metadata:{},outputs:[],execution_count:null}]}; }
export function toNotebookOutput(event) {
  if(event.kind==='stdout'||event.kind==='stderr') return {output_type:'stream',name:event.kind,text:event.text};
  if(event.kind==='error') return {output_type:'error',ename:'PythonError',evalue:event.text,traceback:[event.text]};
  if(event.kind==='image') return {output_type:'display_data',metadata:{},data:{'image/png':event.data}};
  if(event.kind==='rich') return {output_type:'display_data',metadata:{},data:event.data};
  if(event.kind==='result') return {output_type:'execute_result',execution_count:null,metadata:{},data:{'text/plain':event.text}};
  if(event.kind==='table') return {output_type:'display_data',metadata:{},data:{'application/vnd.pyforge.table+json':event,'text/plain':`${event.totalRows||event.rows.length} rows × ${event.columns.length} columns`}};
  return null;
}
export function searchFiles(files, query, caseSensitive=false) {
  if(!query) return [];
  const needle=caseSensitive?query:query.toLowerCase(); const hits=[];
  for(const f of files) if(f.encoding==='text') f.content.split('\n').forEach((text,index)=>{
    if((caseSensitive?text:text.toLowerCase()).includes(needle)&&hits.length<500) hits.push({path:f.path,line:index+1,text});
  });
  return hits;
}
