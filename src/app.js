import {CONFIG} from './config.js';
import {uid,escapeHTML as E,normalizePath,newFile,fileBytes,fileFromBytes,newProject,validateProject,parseRequirements,readNotebook,emptyNotebook,sourceOf,toNotebookOutput,searchFiles} from './core.js';
import {WorkspaceStore} from './storage.js';
import {makeZip,readZip} from './zip.js';
import {CodeEditor} from './editor.js';
import {BrowserKernel} from './browser-kernel.js';
import {JupyterKernel} from './jupyter-kernel.js';
import {TEMPLATES,templateProject,notebookFile} from './templates.js';
import {renderRich,renderNotebookOutput,markdown,variableHTML} from './render.js';
const $=id=>document.getElementById(id);
const defaults={theme:'dark',fontSize:14,tabSize:4,wrap:false,minimap:false,autoPip:true,timeout:60,clearOnRun:true};
const state={store:null,projects:[],project:null,settings:{...defaults},editor:null,panel:'explorer',bottom:'console',kernel:null,kernelState:'stopped',restored:false,busy:false,revision:0,savedRevision:0,saveTimer:null,lintTimer:null,collapsed:new Set(),consoleChars:0,outputs:0,variables:[],problems:[],trace:null,traceIndex:-1,capture:null,count:0,rawNotebook:false,remoteConfig:null,replHistory:[],replIndex:0};
const actions={};

function toast(message,error=false){const node=document.createElement('div');node.className='toast'+(error?' error':'');node.textContent=message;$('toasts').append(node);setTimeout(()=>node.remove(),error?10000:5000);}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
function modal(title,body,buttons=[['cancel','Hủy'],['submit','Xác nhận']]){
  const dialog=$('dialog');state.closeModal?.('cancel');if(dialog.open)dialog.close();
  $('dialog-content').innerHTML=`<div class="modal-header"><h2>${E(title)}</h2><button class="icon-button" data-modal-close aria-label="Đóng">×</button></div><div class="modal-body">${body}</div>${buttons.length?`<div class="modal-footer">${buttons.map(([key,label])=>`<button type="button" class="${key==='submit'?'primary':'small-button'}" data-modal-submit="${E(key)}">${E(label)}</button>`).join('')}</div>`:''}`;
  dialog.showModal();setTimeout(()=>dialog.querySelector('input:not([type=checkbox]),textarea')?.focus(),30);
  return new Promise(resolve=>{
    let settled=false;
    const finish=action=>{if(settled)return;settled=true;const values={};dialog.querySelectorAll('[name]').forEach(el=>values[el.name]=el.type==='checkbox'?el.checked:el.value);if(state.closeModal===finish)state.closeModal=null;dialog.onclose=null;dialog.oncancel=null;dialog.close();resolve(action==='cancel'?null:{action,values});};state.closeModal=finish;
    dialog.querySelector('[data-modal-close]').onclick=()=>finish('cancel');dialog.querySelectorAll('[data-modal-submit]').forEach(b=>b.onclick=()=>finish(b.dataset.modalSubmit));
    dialog.oncancel=e=>{e.preventDefault();finish('cancel');};dialog.onclose=()=>{if(!settled&&!dialog.open)finish('cancel');};
    dialog.onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type!=='checkbox'){const submit=dialog.querySelector('[data-modal-submit=submit]');if(submit){e.preventDefault();submit.click();}}};
  });
}
async function ask(title,label,value=''){const r=await modal(title,`<label>${E(label)}<input name="value" value="${E(value)}"></label>`);return r?.values.value;}
async function confirmAction(title,message){return !!await modal(title,`<p>${E(message)}</p>`);}
function setSaveStatus(text,error=false){$('save-status').textContent=text;$('save-status').classList.toggle('error',error);}
function markChanged(){state.revision++;state.project.modified=Date.now();setSaveStatus(state.store?'● Đang lưu…':'● Chỉ trong RAM',!state.store);clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>save().catch(e=>toast('Lưu thất bại: '+e.message,true)),400);}
async function save(){
  clearTimeout(state.saveTimer);if(!state.project)return;if(!state.store){setSaveStatus('Chưa lưu — hãy xuất ZIP/backup',true);return;}
  const id=state.project.id,rev=state.revision;
  try{await state.store.put(state.project);if(state.project.id===id&&state.revision===rev){state.savedRevision=rev;setSaveStatus('✓ Đã lưu trên thiết bị');}}catch(e){setSaveStatus('Lưu thất bại — xuất backup',true);throw e;}
}
function activeFile(){return state.project.files.find(f=>f.path===state.project.active);}
function currentFiles(){return structuredClone(state.project.files);}
function replaceProject(candidate){const valid=validateProject(candidate);const at=state.projects.findIndex(p=>p.id===valid.id);state.projects[at]=valid;state.project=valid;markChanged();renderFiles();}
function fileIcon(path){const ext=path.split('.').at(-1).toLowerCase();return `<span class="file-icon ${E(ext)}">${E(({py:'Py',ipynb:'▦',csv:'▤',xlsx:'▤',json:'{}',md:'M↓',db:'◉',txt:'≡'})[ext]||'◇')}</span>`;}
function renderProjectSelect(){$('project-select').innerHTML=state.projects.map(p=>`<option value="${E(p.id)}"${p.id===state.project.id?' selected':''}>${E(p.name)}</option>`).join('');$('title-project').textContent=state.project.name;$('workspace-label').textContent=state.project.name;document.title=state.project.name+' — PyForge';}
function renderTree(){
  const root={folders:new Map(),files:[]};
  function folder(parts){let n=root;for(const part of parts){if(!n.folders.has(part))n.folders.set(part,{folders:new Map(),files:[]});n=n.folders.get(part);}return n;}
  state.project.folders.forEach(p=>folder(p.split('/')));
  state.project.files.forEach(f=>{const parts=f.path.split('/');parts.pop();folder(parts).files.push(f);});
  const build=(node,prefix='',depth=0)=>{let html='';for(const [name,child] of [...node.folders.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){const path=prefix+name,closed=state.collapsed.has(path);html+=`<div class="tree-folder" role="treeitem" tabindex="0" aria-expanded="${!closed}" data-folder="${E(path)}" style="padding-left:${12+depth*14}px"><span class="folder-icon">${closed?'›':'⌄'}</span><span class="file-name">${E(name)}</span><button class="icon-button file-menu" data-folder-menu="${E(path)}" aria-label="Tùy chọn thư mục">⋯</button></div>`;if(!closed)html+=build(child,path+'/',depth+1);}for(const f of node.files.sort((a,b)=>a.path.localeCompare(b.path))){html+=`<div class="tree-file${f.path===state.project.active?' active':''}" role="treeitem" tabindex="0" data-open="${E(f.path)}" style="padding-left:${17+depth*14}px">${fileIcon(f.path)}<span class="file-name">${E(f.path.split('/').at(-1))}</span><button class="icon-button file-menu" data-file-menu="${E(f.path)}" aria-label="Tùy chọn ${E(f.path)}">⋯</button></div>`;}return html;};
  $('file-tree').innerHTML=build(root)||'<div class="panel-empty">Project trống. Tạo file hoặc nhập thư mục.</div>';
  const bytes=state.project.files.reduce((n,f)=>n+(f.encoding==='base64'?f.content.length*.75:new TextEncoder().encode(f.content).length),0);$('storage-summary').textContent=`${state.project.files.length} file · ${(bytes/1024).toFixed(1)} KB · lưu trên thiết bị`;
}
function renderTabs(){$('file-tabs').innerHTML=state.project.tabs.map(path=>`<button class="file-tab${path===state.project.active?' active':''}" role="tab" aria-selected="${path===state.project.active}" data-tab="${E(path)}">${fileIcon(path)}${E(path.split('/').at(-1))}<span class="tab-close" data-close-tab="${E(path)}" aria-label="Đóng ${E(path)}">×</span></button>`).join('');}
function renderFiles(){renderProjectSelect();renderTree();renderTabs();renderDataFiles();renderBreakpoints();}
function renderDataFiles(){const list=state.project.files.filter(f=>/\.(csv|tsv|xlsx?|json|jsonl|ndjson|parquet|db|sqlite3?)$/i.test(f.path));const chosen=$('data-file').value;$('data-file').innerHTML=list.map(f=>`<option value="${E(f.path)}">${E(f.path)}</option>`).join('');if(list.some(f=>f.path===chosen))$('data-file').value=chosen;else if(list.some(f=>f.path===state.project.active))$('data-file').value=state.project.active;dataFileChanged();}
function dataFileChanged(){$('sql-input').classList.toggle('hidden',!/\.(db|sqlite3?)$/i.test($('data-file').value));}
function openFile(path,line,column=1){
  if(!state.project.files.some(f=>f.path===path))return;
  if(!state.project.tabs.includes(path))state.project.tabs.push(path);state.project.active=path;state.rawNotebook=false;
  const parts=path.split('/');parts.pop();let prefix='';for(const p of parts){prefix=prefix?prefix+'/'+p:p;state.collapsed.delete(prefix);}
  markChanged();renderFiles();showFile();if(line)setTimeout(()=>state.editor.goTo(line,column),0);if(window.innerWidth<=760)$('sidebar').classList.remove('mobile-open');
}
function showFile(){
  const f=activeFile();for(const id of ['code-editor','notebook-editor','file-preview','empty-editor'])$(id).classList.add('hidden');
  $('breadcrumb').textContent=f?state.project.name+'  ›  '+f.path.split('/').join('  ›  '):'Workspace';$('language-status').textContent=f?.path.endsWith('.py')?'Python':f?.path.split('.').at(-1)?.toUpperCase()||'';
  if(!f){$('empty-editor').classList.remove('hidden');return;}
  if(f.path.endsWith('.ipynb')&&!state.rawNotebook){try{renderNotebook(f);$('notebook-editor').classList.remove('hidden');}catch(e){$('file-preview').classList.remove('hidden');$('file-preview').innerHTML=`<p>${E(e.message)}</p><button class="primary" data-action="notebook-source">Mở JSON source</button>`;}return;}
  if(f.encoding==='base64'){const box=$('file-preview');box.classList.remove('hidden');let content=/\.(png|jpe?g|gif|webp)$/i.test(f.path)?`<img alt="${E(f.path)}" src="data:image/${f.path.split('.').at(-1)};base64,${f.content}">`:'<div class="big-icon">◇</div>';box.innerHTML=`<div class="binary-preview">${content}<h3>${E(f.path)}</h3><p>File nhị phân · ${(fileBytes(f).length/1024).toFixed(1)} KB</p><div class="row" style="justify-content:center"><button class="primary" data-action="download-file">↓ Tải file</button>${/\.(xlsx?|parquet|db|sqlite3?)$/i.test(f.path)?'<button class="small-button" data-action="open-data">▦ Xem dữ liệu</button>':''}</div></div>`;return;}
  $('code-editor').classList.remove('hidden');state.editor.setFile(f.path,f.content);state.editor.setBreakpoints(state.project.breakpoints[f.path]||[]);state.editor.traceLine(null);
}
function changeCode(code){const f=activeFile();if(!f||f.encoding!=='text')return;f.content=code;f.modified=Date.now();markChanged();scheduleValidate();}
function scheduleValidate(){clearTimeout(state.lintTimer);state.lintTimer=setTimeout(async()=>{const f=activeFile();if(!f?.path.endsWith('.py')||state.busy||state.kernelState!=='ready')return;const path=f.path,code=f.content;try{const result=await state.kernel.validate(code,path);if(activeFile()?.path===path&&activeFile().content===code){state.problems=result.map(m=>({...m,path}));state.editor.markers(result);renderProblems();}}catch{}},750);}

function setPanel(name){state.panel=name;for(const n of ['explorer','search','packages','data','trace'])$('panel-'+n).classList.toggle('hidden',n!==name);document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));$('panel-title').textContent=({explorer:'EXPLORER',search:'SEARCH',packages:'PYTHON PACKAGES',data:'DATA & SQL',trace:'TRACE INSPECTOR'})[name];$('sidebar').style.display='';if(window.innerWidth<=760)$('sidebar').classList.add('mobile-open');if(name==='packages')renderPackages();if(name==='search')$('search-input').focus();}
function setBottom(name){state.bottom=name;$('bottom-panel').classList.remove('collapsed');for(const n of ['console','outputs','variables','problems','stdin'])$('bottom-'+n).classList.toggle('hidden',n!==name);document.querySelectorAll('[data-bottom]').forEach(b=>b.classList.toggle('active',b.dataset.bottom===name));}
function setBusy(busy){state.busy=busy;$('run-button').disabled=busy;$('stop-button').disabled=!busy;$('repl-input').disabled=busy;document.querySelectorAll('.cell-run').forEach(b=>b.disabled=busy);updateKernelState();}
function updateKernelState(){
  const status=state.busy?'busy':state.kernelState;$('kernel-dot').className='status-dot '+status;
  const name=state.kernel?.kind==='jupyter'?'Python native · Jupyter':'Python '+(state.kernel?.version||'')+' · Browser';$('kernel-label').textContent=name;
  $('status-kernel').textContent=({stopped:'○ Kernel chưa tải',loading:'◌ Đang tải Python…',ready:'● '+name,busy:'◌ Python đang chạy'})[status]||status;
}
function createKernel(config=null){
  let kernel;const onState=value=>{if(state.kernel!==kernel)return;state.kernelState=value;updateKernelState();if(value==='ready')renderPackages();};const onEvent=e=>{if(state.kernel===kernel)receiveEvent(e);};
  kernel=config?new JupyterKernel(config,state.project.id,onEvent,onState,async(prompt,password)=>{const result=await modal('Python input()',`<label>${E(prompt)}<input name="value" type="${password?'password':'text'}" autocomplete="off"></label>`,[['submit','Gửi vào Python']]);return result?.values.value||'';}):new BrowserKernel(onEvent,onState);
  state.kernel=kernel;state.kernelState='stopped';state.restored=false;updateKernelState();return kernel;
}
async function ensureKernel(){const info=await state.kernel.ensure();if(!state.restored){state.restored=true;if(state.project.packages.length)try{await state.kernel.install(state.project.packages);}catch(e){state.restored=false;receiveEvent({kind:'stderr',text:'Không khôi phục được một số gói: '+e.message+'\n'});}}renderPackages();return info;}
function consoleLine(kind,text){
  if(!text)return;if(state.consoleChars>=CONFIG.maxOutputChars)return;const allowed=String(text).slice(0,CONFIG.maxOutputChars-state.consoleChars);state.consoleChars+=allowed.length;
  const log=$('console-output');const nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<80;let node=log.lastElementChild;
  if(!node||!node.classList.contains(kind)||kind==='error'||kind==='command'){node=document.createElement('pre');node.className='console-line '+kind;log.append(node);}
  node.append(document.createTextNode(allowed+(kind==='error'||kind==='result'||kind==='command'?'\n':'')));if(nearEnd)log.scrollTop=log.scrollHeight;
  if(state.consoleChars>=CONFIG.maxOutputChars){const note=document.createElement('pre');note.className='console-line system';note.textContent='\n[Console đạt giới hạn hiển thị 250.000 ký tự. Code vẫn tiếp tục chạy.]';log.append(note);}
}
function receiveEvent(event){
  if(['stdout','stderr','error','system','result'].includes(event.kind))consoleLine(event.kind,event.text);
  if(['image','table','rich'].includes(event.kind)){if(state.outputs<100){if(state.outputs===0)$('rich-outputs').innerHTML='';renderRich(event,$('rich-outputs'),{download});state.outputs++;$('output-count').textContent=state.outputs;}else consoleLine('system','Giới hạn 100 rich outputs mỗi lần chạy.\n');}
  if(state.capture){const f=state.project.files.find(f=>f.path===state.capture.path);if(f){try{const nb=readNotebook(f.content);const cell=nb.cells.find(c=>c.id===state.capture.id);const out=toNotebookOutput(event);if(cell&&out){const last=cell.outputs.at(-1);if(out.output_type==='stream'&&last?.output_type==='stream'&&last.name===out.name)last.text=sourceOf({source:last.text})+out.text;else if(cell.outputs.length<120)cell.outputs.push(out);f.content=JSON.stringify(nb,null,2);markChanged();scheduleCellOutput(state.capture.id);}}catch{}}}
}
function clearConsole(){state.consoleChars=0;state.outputs=0;$('console-output').innerHTML='';$('rich-outputs').innerHTML='<div class="panel-empty">Biểu đồ, bảng dữ liệu và rich output sẽ hiển thị tại đây.</div>';$('output-count').textContent='0';$('console-badge').textContent='';}
function mergeFiles(incoming,baseline){
  if(!incoming)return;const originals=new Map(baseline.map(f=>[f.path,f]));const current=new Map(state.project.files.map(f=>[f.path,f]));const result=[];let conflict=false;
  const same=(a,b)=>a&&b&&a.content===b.content&&a.encoding===b.encoding;
  for(const next of incoming){const old=originals.get(next.path),now=current.get(next.path);if(now&&((old&&!same(now,old))||(!old&&!same(now,next)))){result.push(now);if(!next.path.endsWith('.ipynb'))conflict=true;}else result.push(next);current.delete(next.path);}
  for(const [path,f] of current){const old=originals.get(path);if(!old||!same(f,old))result.push(f);}
  const validated=validateProject({...state.project,files:result});state.project.files=validated.files;state.project.tabs=validated.tabs;state.project.active=validated.active;markChanged();renderFiles();if(conflict)toast('Giữ các file bạn sửa trong lúc kernel chạy.');
}
function argsForRun(){let argv;try{argv=JSON.parse($('argv-input').value||'[]');}catch{throw new Error('Sys.argv cần mảng JSON, ví dụ ["--file", "data.csv"].');}if(!Array.isArray(argv)||argv.some(x=>typeof x!=='string'))throw new Error('Mỗi phần tử sys.argv phải là chuỗi.');const raw=$('stdin-input').value;return {argv,stdin:raw?raw.replace(/\r/g,'').split('\n'):[]};}
async function runCode(code,filename,mode='script',trace=false){
  if(state.busy){toast('Kernel đang chạy. Dừng hoặc chờ hoàn thành.');return null;}
  const baseline=currentFiles(),projectId=state.project.id;const io=argsForRun();setBusy(true);$('run-summary').textContent='Đang chạy…';
  try{
    await save();await ensureKernel();const result=await state.kernel.run({code,filename,mode,trace,files:baseline,folders:[...state.project.folders],autoPip:state.settings.autoPip,...io},state.settings.timeout*1000);
    if(state.project.id!==projectId)return result;mergeFiles(result.files,baseline);state.variables=result.variables||[];$('variables-view').innerHTML=variableHTML(state.variables);$('variable-count').textContent=state.variables.length;renderPackages();
    $('run-summary').textContent=`${result.success?'✓':'×'} ${(result.elapsed/1000).toFixed(2)}s`;$('console-badge').textContent=result.success?'':'!';
    consoleLine('system',`\n[${result.success?'Completed':'Failed'} in ${(result.elapsed/1000).toFixed(2)}s]\n`);
    if(trace&&result.trace){state.trace=result.trace;state.traceIndex=-1;setPanel('trace');traceStep(0);}
    await save();return result;
  }catch(e){consoleLine('error',e.message);$('run-summary').textContent='× '+(state.kernelState==='stopped'?'Kernel đã dừng':'Lỗi');return {success:false,error:e.message};}
  finally{setBusy(false);}
}
async function runFile(selection=false,trace=false){
  const f=activeFile();if(!f){toast('Tạo hoặc mở file Python trước.');return;}if(f.path.endsWith('.ipynb')&&!state.rawNotebook)return runNotebook();if(!f.path.endsWith('.py')){toast('Run dùng cho file .py hoặc .ipynb.');return;}
  if(state.busy)return;if(state.settings.clearOnRun)clearConsole();setBottom('console');state.capture=null;state.editor.traceLine(null);
  const selected=selection?state.editor.selection():'';consoleLine('system',`▶ ${f.path}${selected?' · selection':''}${trace?' · trace':''}\n`);await runCode(selected||f.content,f.path,selected?'repl':'script',trace);scheduleValidate();
}
function renderProblems(){$('problem-count').textContent=state.problems.length;$('problems-view').innerHTML=state.problems.map(p=>`<button class="problem-row ${E(p.severity)}" data-problem-path="${E(p.path)}" data-line="${p.line}" data-column="${p.column}"><span>${p.severity==='error'?'×':'△'}</span><span>${E(p.message)}</span><small>${E(p.path)}:${p.line}</small></button>`).join('')||'<div class="panel-empty">Không có lỗi phân tích được báo.</div>';}
function renderPackages(){
  const kernel=state.kernel;if(!kernel)return;const filter=$('package-filter').value.trim().toLowerCase();const installed=kernel.installed||{},catalog=kernel.catalog||{};
  const list=new Map(Object.entries(catalog).map(([name,meta])=>[name,{name,version:meta.version,imports:meta.imports||[]}])) ;for(const [name,version] of Object.entries(installed))if(!list.has(name))list.set(name,{name,version,imports:[]});
  const favourites=['numpy','pandas','matplotlib','scipy','scikit-learn','nltk','pillow','sympy','jedi','sqlite3','seaborn','openpyxl','autopep8','pyflakes'];
  for(const name of favourites)if(!list.has(name))list.set(name,{name,version:'PyPI',imports:[],pypi:true});
  const visible=[...list.values()].filter(p=>p.name.includes(filter)||p.imports.some(s=>s.toLowerCase().includes(filter))).sort((a,b)=>(Number(!!installed[b.name])-Number(!!installed[a.name]))||(favourites.indexOf(a.name)<0?99:favourites.indexOf(a.name))-(favourites.indexOf(b.name)<0?99:favourites.indexOf(b.name))||a.name.localeCompare(b.name));
  $('package-count').textContent=kernel.kind==='jupyter'?`${Object.keys(installed).length} gói trong kernel native`:`${Object.keys(catalog).length} gói Pyodide · ${Object.keys(installed).length} đã nạp`;
  $('package-list').innerHTML=visible.slice(0,400).map(p=>`<div class="package-item ${installed[p.name]?'installed':''}"><div><strong>${E(p.name)}</strong><small>${E(installed[p.name]||p.version)} · ${installed[p.name]?'đã nạp':p.pypi?'wheel từ PyPI':'WebAssembly'}</small></div><button class="small-button" data-install="${E(p.name)}" ${state.busy?'disabled':''}>${installed[p.name]?'↻':'＋ Cài'}</button></div>`).join('');
}
async function installPackages(requirements){
  if(state.busy){toast('Kernel đang chạy.');return;}if(!requirements.length)return;setBusy(true);setBottom('console');consoleLine('system','Cài: '+requirements.join(', ')+'\n');
  try{await ensureKernel();await state.kernel.install(requirements);state.project.packages=[...new Set([...state.project.packages,...requirements])];markChanged();renderPackages();toast('Đã cài thư viện.');}
  catch(e){consoleLine('error',e.message);toast('Không cài được gói. Xem Console để biết lỗi tương thích hoặc mạng.',true);}finally{setBusy(false);renderPackages();}
}

let cellPaintTimer;
function scheduleCellOutput(id){clearTimeout(cellPaintTimer);cellPaintTimer=setTimeout(()=>paintCellOutput(id),60);}
function renderNotebook(f){
  const nb=readNotebook(f.content);$('notebook-editor').innerHTML=`<div class="notebook-toolbar"><button class="primary" data-action="run-notebook">▶ Run all</button><button class="small-button" data-action="add-cell">＋ Code cell</button><button class="small-button" data-action="add-markdown">＋ Markdown</button><button class="small-button" data-action="clear-notebook">Clear outputs</button><button class="small-button" data-action="notebook-source">{ } JSON</button><span>${nb.cells.length} cells · kernel dùng chung</span></div>${nb.cells.map((c,i)=>`<div class="notebook-cell" data-cell-id="${E(c.id)}"><div class="cell-toolbar"><span>[${c.execution_count??' '} ] · Cell ${i+1}</span><div class="small-tools"><select data-cell-type="${E(c.id)}" aria-label="Kiểu cell"><option ${c.cell_type==='code'?'selected':''}>code</option><option ${c.cell_type==='markdown'?'selected':''}>markdown</option></select>${c.cell_type==='code'?`<button class="cell-run" data-run-cell="${E(c.id)}"${state.busy?' disabled':''}>▶ Run</button>`:''}<button data-move-cell="${E(c.id)}" data-direction="-1" title="Lên">↑</button><button data-move-cell="${E(c.id)}" data-direction="1" title="Xuống">↓</button><button data-delete-cell="${E(c.id)}" title="Xóa cell">×</button></div></div><textarea class="cell-source" data-cell-source="${E(c.id)}" aria-label="Source cell ${i+1}" spellcheck="false" rows="${Math.min(18,Math.max(3,sourceOf(c).split('\n').length+1))}">${E(sourceOf(c))}</textarea>${c.cell_type==='markdown'?`<div class="cell-rendered">${markdown(sourceOf(c))}</div>`:''}<div class="cell-output" data-cell-output="${E(c.id)}"></div></div>`).join('')}`;
  for(const c of nb.cells)paintCellOutput(c.id);
}
function editNotebook(fn){const f=activeFile();if(!f?.path.endsWith('.ipynb'))return;const nb=readNotebook(f.content);fn(nb);f.content=JSON.stringify(nb,null,2);f.modified=Date.now();markChanged();return nb;}
function paintCellOutput(id){const f=activeFile();if(!f?.path.endsWith('.ipynb')||state.rawNotebook)return;const box=document.querySelector(`[data-cell-output="${CSS.escape(id)}"]`);if(!box)return;try{const cell=readNotebook(f.content).cells.find(c=>c.id===id);box.innerHTML='';for(const out of cell?.outputs||[])renderNotebookOutput(out,box,{download});}catch{}}
async function runCell(id){
  if(state.busy)return false;const f=activeFile();if(!f)return false;const nb=readNotebook(f.content),cell=nb.cells.find(c=>c.id===id);if(!cell||cell.cell_type!=='code')return true;
  editNotebook(nb=>{const c=nb.cells.find(c=>c.id===id);c.outputs=[];c.execution_count=null;});paintCellOutput(id);state.capture={path:f.path,id};const el=document.querySelector(`[data-cell-id="${CSS.escape(id)}"]`);el?.classList.add('running');
  const result=await runCode(sourceOf(cell),f.path,'notebook');state.capture=null;el?.classList.remove('running');
  const current=state.project.files.find(x=>x.path===f.path);if(current){const n=readNotebook(current.content);const c=n.cells.find(c=>c.id===id);if(c){c.execution_count=++state.count;current.content=JSON.stringify(n,null,2);markChanged();}if(activeFile()?.path===f.path)renderNotebook(current);}
  return !!result?.success;
}
async function runNotebook(){if(state.busy)return;state.cancelBatch=false;const f=activeFile();if(!f?.path.endsWith('.ipynb'))return;const ids=readNotebook(f.content).cells.filter(c=>c.cell_type==='code').map(c=>c.id);if(state.settings.clearOnRun)clearConsole();for(const id of ids){if(state.cancelBatch||activeFile()?.path!==f.path)break;if(!await runCell(id))break;}await save();}
function renderBreakpoints(){const rows=Object.entries(state.project.breakpoints).flatMap(([path,lines])=>lines.map(line=>({path,line})));$('breakpoint-list').innerHTML=rows.map(x=>`<button class="search-hit" data-open="${E(x.path)}" data-line="${x.line}"><strong>● ${E(x.path)}:${x.line}</strong></button>`).join('')||'<div class="panel-empty">Nhấn cạnh số dòng trong editor.</div>';}
function traceStep(index){
  if(!state.trace?.rows.length){$('trace-position').textContent='Không có dòng Python được ghi.';return;}state.traceIndex=Math.max(0,Math.min(index,state.trace.rows.length-1));const row=state.trace.rows[state.traceIndex];$('trace-position').textContent=`Bước ${state.traceIndex+1}/${state.trace.rows.length}${state.trace.truncated?' · giới hạn 2.000 bước':''} · ${row.file}:${row.line}`;
  $('trace-locals').innerHTML=row.locals.map(v=>`<div class="trace-var"><strong>${E(v.name)}</strong> <span>${E(v.type)}</span><br>${E(v.value)}</div>`).join('')||'<div class="panel-empty">Chưa có locals.</div>';$('trace-stack').innerHTML=row.stack.map(f=>`<div class="trace-stack-row">${E(f.function)} · ${E(f.file)}:${f.line}</div>`).join('');openFile(row.file,row.line);state.editor.traceLine(row.line);if(window.innerWidth<=760)$('sidebar').classList.add('mobile-open');
}

async function switchProject(id,skipSave=false){
  if(state.busy){toast('Dừng kernel trước khi đổi project.');renderProjectSelect();return;}
  const project=state.projects.find(p=>p.id===id);if(!project)return;if(!skipSave)await save();
  clearTimeout(state.saveTimer);const old=state.kernel;state.kernel=null;state.project=project;state.revision=0;state.savedRevision=0;state.collapsed.clear();state.editor.resetModels();state.trace=null;state.variables=[];state.problems=[];state.capture=null;state.count=0;clearConsole();$('variables-view').innerHTML=variableHTML([]);$('variable-count').textContent='0';renderProblems();$('trace-locals').innerHTML='';$('trace-stack').innerHTML='';$('trace-position').textContent='Chưa có bản ghi.';
  createKernel(state.remoteConfig);renderFiles();showFile();await old?.reset();if(state.store&&state.project.id===id)await state.store.setMeta('active',id);setSaveStatus(state.store?'✓ Đã lưu trên thiết bị':'Chưa lưu — hãy xuất backup',!state.store);
}
async function addProject(project){if(state.busy)throw new Error('Dừng kernel trước khi tạo/mở project.');project=validateProject(project);state.projects.push(project);if(state.store)await state.store.put(project);await switchProject(project.id);toast('Đã mở project '+project.name);}
function uniquePath(path){if(!state.project.files.some(f=>f.path===path))return path;const at=path.lastIndexOf('.'),base=at>=0?path.slice(0,at):path,ext=at>=0?path.slice(at):'';let n=2;while(state.project.files.some(f=>f.path===base+'_'+n+ext))n++;return base+'_'+n+ext;}
async function uploadFiles(list,asFolder=false){
  if(state.busy)throw new Error('Dừng kernel trước khi nhập file.');if(!list.length)return;
  const rootName=asFolder?(list[0].webkitRelativePath?.split('/')[0]||'imported-project'):null;
  const files=[];
  for(const file of list){let path=asFolder?(file.webkitRelativePath||file.name).split('/').slice(1).join('/'):file.name;if(!path)path=file.name;if(path.split('/').some(p=>['.git','node_modules','.venv','venv','__pycache__'].includes(p)))continue;if(file.size>CONFIG.maxFileBytes)throw new Error('File vượt 25 MB: '+path);files.push(fileFromBytes(path,new Uint8Array(await file.arrayBuffer())));}
  if(asFolder){await addProject(newProject(rootName,files));return;}
  const overwrite=files.filter(f=>state.project.files.some(old=>old.path===f.path));if(overwrite.length&&!await confirmAction('Thay file trong project',`Ghi đè ${overwrite.length} file: ${overwrite.slice(0,5).map(f=>f.path).join(', ')}?`))return;
  replaceProject({...state.project,files:[...state.project.files.filter(old=>!files.some(f=>f.path===old.path)),...files]});if(files[0])openFile(files[0].path);toast(`Đã nhập ${files.length} file.`);
}
async function importZip(file){
  if(state.busy)throw new Error('Dừng kernel trước khi nhập ZIP.');const entries=await readZip(await file.arrayBuffer());
  let paths=entries;const roots=new Set(entries.map(e=>e.path.split('/')[0]));if(roots.size===1&&entries.every(e=>e.path.includes('/'))){paths=entries.map(e=>({...e,path:e.path.slice(e.path.indexOf('/')+1)}));}
  let meta={};const metadata=paths.find(e=>e.path==='.pyforge-project.json');if(metadata){try{const parsed=JSON.parse(new TextDecoder().decode(metadata.bytes));if(parsed.format==='pyforge-project'){meta=parsed;paths=paths.filter(e=>e!==metadata);}}catch{}}
  const files=paths.filter(e=>!e.path.split('/').some(p=>['.git','node_modules','.venv','venv','__pycache__'].includes(p))).map(e=>fileFromBytes(e.path,e.bytes));
  const project=newProject(meta.name||file.name.replace(/\.zip$/i,''),files);Object.assign(project,{folders:meta.folders||[],packages:meta.packages||[],breakpoints:meta.breakpoints||{},tabs:meta.tabs||project.tabs,active:meta.active||project.active});await addProject(project);
}
async function renamePath(path,folder=false){
  if(state.busy)throw new Error('Dừng kernel trước khi đổi tên.');const input=await ask(folder?'Đổi tên thư mục':'Đổi tên file','Đường dẫn mới trong project',path);if(input===undefined)return;const next=normalizePath(input);if(next===path)return;
  const remap=p=>(p===path||(folder&&p.startsWith(path+'/')))?next+p.slice(path.length):p;
  const candidate={...state.project,files:state.project.files.map(f=>({...f,path:remap(f.path)})),folders:state.project.folders.map(remap),tabs:state.project.tabs.map(remap),active:state.project.active?remap(state.project.active):null,breakpoints:Object.fromEntries(Object.entries(state.project.breakpoints).map(([p,b])=>[remap(p),b]))};
  replaceProject(candidate);state.editor.resetModels();showFile();
}
async function deletePath(path,folder=false){
  if(state.busy)throw new Error('Dừng kernel trước khi xóa file.');const match=p=>p===path||(folder&&p.startsWith(path+'/'));const count=state.project.files.filter(f=>match(f.path)).length;
  if(!await confirmAction('Xóa khỏi project',`Xóa ${folder?'thư mục':'file'} "${path}"${folder?' và '+count+' file':''}?`))return;
  replaceProject({...state.project,files:state.project.files.filter(f=>!match(f.path)),folders:state.project.folders.filter(p=>!match(p)),breakpoints:Object.fromEntries(Object.entries(state.project.breakpoints).filter(([p])=>!match(p)))});state.editor.resetModels();showFile();
}

Object.assign(actions,{
 'save':async()=>{await save();toast(state.store?'Đã lưu workspace.':'Hãy xuất ZIP hoặc backup để giữ project.',!state.store);},
 'new-file':async()=>{const input=await ask('File mới','Đường dẫn tương đối (có thể kèm thư mục)',uniquePath('untitled.py'));if(input===undefined)return;const path=normalizePath(input);if(state.project.files.some(f=>f.path===path))throw new Error('File đã tồn tại.');replaceProject({...state.project,files:[...state.project.files,path.endsWith('.ipynb')?notebookFile(path):newFile(path)]});openFile(path);},
 'new-folder':async()=>{const input=await ask('Thư mục mới','Đường dẫn thư mục','src');if(input===undefined)return;const path=normalizePath(input);replaceProject({...state.project,folders:[...new Set([...state.project.folders,path])]});},
 'new-notebook':async()=>{const input=await ask('Notebook mới','Tên file .ipynb',uniquePath('analysis.ipynb'));if(input===undefined)return;let path=normalizePath(input);if(!path.endsWith('.ipynb'))path+='.ipynb';if(state.project.files.some(f=>f.path===path))throw new Error('File đã tồn tại.');replaceProject({...state.project,files:[...state.project.files,notebookFile(path)]});openFile(path);},
 'new-project':async()=>{
   const promise=modal('Tạo Python workspace',`<label>Tên project<input name="name" value="python-project"></label><input name="template" type="hidden" value="blank"><div class="template-grid"><button class="template-card selected" data-template="blank"><small>EMPTY</small><strong>Project trống</strong><span>Bắt đầu bằng main.py của bạn.</span></button>${TEMPLATES.map(t=>`<button class="template-card" data-template="${E(t.id)}"><small>${E(t.tag)}</small><strong>${E(t.name)}</strong><span>${E(t.description)}</span></button>`).join('')}</div>`);
   $('dialog').querySelectorAll('[data-template]').forEach(b=>b.onclick=()=>{$('dialog').querySelector('[name=template]').value=b.dataset.template;$('dialog').querySelectorAll('[data-template]').forEach(x=>x.classList.toggle('selected',x===b));});
   const r=await promise;if(!r)return;const name=r.values.name.trim()||'python-project';const project=r.values.template==='blank'?newProject(name,[newFile('main.py','')]):templateProject(r.values.template,name);await addProject(project);
 },
 'rename-project':async()=>{const name=await ask('Đổi tên project','Tên project',state.project.name);if(name?.trim()){state.project.name=name.trim();markChanged();renderProjectSelect();}},
 'delete-project':async()=>{if(state.busy)throw new Error('Dừng kernel trước khi xóa project.');if(!await confirmAction('Xóa project',`Xóa toàn bộ "${state.project.name}" trên thiết bị này? Xuất backup trước nếu cần giữ dữ liệu.`))return;clearTimeout(state.saveTimer);const id=state.project.id;state.projects=state.projects.filter(p=>p.id!==id);if(!state.projects.length){const p=newProject('python-project',[newFile('main.py','')]);state.projects.push(p);if(state.store)await state.store.put(p);}if(state.store)await state.store.delete(id);await switchProject(state.projects[0].id,true);},
 'rename-file':data=>renamePath(data.path), 'delete-file':data=>deletePath(data.path), 'rename-folder':data=>renamePath(data.path,true), 'delete-folder':data=>deletePath(data.path,true),
 'upload':()=>{$('file-upload').value='';$('file-upload').click();},'upload-folder':()=>{$('folder-upload').value='';$('folder-upload').click();},'import-zip':()=>{$('zip-upload').value='';$('zip-upload').click();},
 'export-project':async()=>{await save();const p=state.project;const entries=p.files.map(f=>({path:f.path,bytes:fileBytes(f)}));if(!p.files.some(f=>f.path==='.pyforge-project.json'))entries.push({path:'.pyforge-project.json',bytes:JSON.stringify({format:'pyforge-project',version:1,name:p.name,folders:p.folders,packages:p.packages,tabs:p.tabs,active:p.active,breakpoints:p.breakpoints},null,2)});download(makeZip(entries),p.name.replace(/[^\p{L}\p{N}._-]/gu,'_')+'.zip');},
 'backup':async()=>{await save();download(new Blob([JSON.stringify({format:'pyforge-backup',version:1,projects:state.projects},null,2)],{type:'application/json'}),'PyForge_backup_'+new Date().toISOString().slice(0,10)+'.json');},
 'import-backup':()=>{$('backup-upload').value='';$('backup-upload').click();},
 'download-file':data=>{const f=data?.path?state.project.files.find(f=>f.path===data.path):activeFile();if(f)download(new Blob([fileBytes(f)],{type:'application/octet-stream'}),f.path.split('/').at(-1));},
 'file-options':(_,event)=>showDropdown(event?.target||$('file-tree'),[['rename-project','Đổi tên project'],['import-zip','Nhập project ZIP'],['backup','Backup mọi project'],['import-backup','Nhập backup'],null,['delete-project','Xóa project','',true]]),
 'toggle-sidebar':()=>{if(window.innerWidth<=760)$('sidebar').classList.toggle('mobile-open');else $('sidebar').style.display=$('sidebar').style.display==='none'?'':'none';},
 'toggle-bottom':()=>$('bottom-panel').classList.toggle('collapsed'),
 'theme':async()=>{state.settings.theme=state.settings.theme==='dark'?'light':'dark';applySettings();if(state.store)await state.store.setMeta('settings',state.settings);},
 'settings':async()=>{
   const s=state.settings;const r=await modal('Cài đặt IDE',`<label>Giao diện<select name="theme"><option value="dark"${s.theme==='dark'?' selected':''}>Tối</option><option value="light"${s.theme==='light'?' selected':''}>Sáng</option></select></label><div class="row"><label>Cỡ chữ<input name="fontSize" type="number" min="10" max="28" value="${s.fontSize}"></label><label>Thụt lề<select name="tabSize"><option${s.tabSize===2?' selected':''}>2</option><option${s.tabSize===4?' selected':''}>4</option><option${s.tabSize===8?' selected':''}>8</option></select></label><label>Timeout (giây)<input name="timeout" type="number" min="5" max="600" value="${s.timeout}"></label></div><label class="check-label"><input type="checkbox" name="wrap"${s.wrap?' checked':''}> Word wrap (Monaco)</label><label class="check-label"><input type="checkbox" name="minimap"${s.minimap?' checked':''}> Minimap (Monaco)</label><label class="check-label"><input type="checkbox" name="autoPip"${s.autoPip?' checked':''}> Tự cài module thiếu qua micropip khi import (Browser)</label><label class="check-label"><input type="checkbox" name="clearOnRun"${s.clearOnRun?' checked':''}> Xóa console và outputs trước khi chạy file</label><p>Project tự lưu bằng IndexedDB trên trình duyệt này. Mã nguồn IDE nằm trên GitHub; project bạn code không tự gửi lên GitHub.</p>`);
   if(!r)return;state.settings={...r.values,fontSize:Math.max(10,Math.min(28,Number(r.values.fontSize)||14)),tabSize:Number(r.values.tabSize),timeout:Math.max(5,Math.min(600,Number(r.values.timeout)||60))};applySettings();if(state.store)await state.store.setMeta('settings',state.settings);
 },
 'kernel':async()=>{
   const native=state.kernel.kind==='jupyter';const promise=modal('Python execution environment',`<div class="kernel-choice"><button class="${!native?'selected':''}" data-kernel-choice="browser"><strong>Browser · Pyodide</strong><span>Python WebAssembly. Chạy tại chỗ, không cần server.</span></button><button class="${native?'selected':''}" data-kernel-choice="jupyter"><strong>Native · Jupyter</strong><span>Dùng mọi thư viện đã cài trên máy chủ Python của bạn.</span></button></div><input name="kind" type="hidden" value="${native?'jupyter':'browser'}"><div id="remote-fields"${native?'':' class="hidden"'}><label>URL gốc của Jupyter Server<input name="url" value="${E(state.remoteConfig?.url||'http://localhost:8888/')}" placeholder="https://jupyter.example.com/"></label><label style="margin-top:12px">Token<input name="token" type="password" autocomplete="off" placeholder="Jupyter Server token"></label><p style="margin-top:12px">Code và file được đồng bộ vào thư mục pyforge/project-id trên server. Token giữ trong RAM, không lưu vào project hay backup. Server cần cho phép origin của IDE và WebSocket. Website HTTPS cần server HTTPS/WSS phù hợp.</p></div><p id="browser-note"${native?' class="hidden"':''}>NumPy, Pandas, Matplotlib, SciPy, scikit-learn, NLTK và các wheel tương thích chạy trong trình duyệt. Torch, TensorFlow, CUDA, Tkinter và subprocess native cần Jupyter. Bạn có thể nhập notebook chứa %pip khi dùng Jupyter.</p>`,[['cancel','Hủy'],['submit','Kết nối kernel']]);
   $('dialog').querySelectorAll('[data-kernel-choice]').forEach(b=>b.onclick=()=>{const kind=b.dataset.kernelChoice;$('dialog').querySelector('[name=kind]').value=kind;$('remote-fields').classList.toggle('hidden',kind!=='jupyter');$('browser-note').classList.toggle('hidden',kind==='jupyter');$('dialog').querySelectorAll('[data-kernel-choice]').forEach(x=>x.classList.toggle('selected',x===b));});
   const r=await promise;if(!r)return;if(state.busy)throw new Error('Dừng kernel trước khi đổi môi trường.');
   let config=null;if(r.values.kind==='jupyter'){const url=new URL(r.values.url);if(!['http:','https:'].includes(url.protocol))throw new Error('URL Jupyter không hợp lệ.');config={url:r.values.url,token:r.values.token||state.remoteConfig?.token||''};}
   const old=state.kernel;state.kernel=null;await old.reset();state.remoteConfig=config;createKernel(config);clearConsole();state.capture=null;state.variables=[];$('variables-view').innerHTML=variableHTML([]);$('variable-count').textContent='0';setBusy(true);try{await ensureKernel();toast('Kernel đã sẵn sàng.');}finally{setBusy(false);}
 },
 'load-kernel':async()=>{if(state.busy)return;setBusy(true);try{await ensureKernel();toast('Python đã sẵn sàng.');}finally{setBusy(false);}},
 'restart-kernel':async()=>{if(state.busy)throw new Error('Dừng chương trình trước.');await state.kernel.reset();state.restored=false;state.variables=[];$('variables-view').innerHTML=variableHTML([]);$('variable-count').textContent='0';await actions['load-kernel']();},
 'run':()=>runFile(false), 'run-selection':()=>runFile(true),'trace':()=>runFile(false,true),
 'stop':async()=>{state.cancelBatch=true;await state.kernel.interrupt();state.restored=false;consoleLine('system','Đã gửi lệnh dừng kernel.\n');},
 'clear-console':clearConsole,
 'pip-install':async()=>{const input=$('pip-input').value.trim();if(!input)return;await installPackages(parseRequirements(input));},
 'requirements':async()=>{const f=activeFile()?.path.includes('requirements')?activeFile():state.project.files.find(f=>f.path==='requirements.txt');if(!f||f.encoding!=='text')throw new Error('Chưa có requirements.txt. Tạo hoặc nhập file trước.');await installPackages(parseRequirements(f.content));},
 'find':()=>state.editor.find(),
 'format':async()=>{const f=activeFile();if(!f?.path.endsWith('.py'))throw new Error('Format dùng cho file .py.');if(state.busy)return;const code=f.content;setBusy(true);try{await ensureKernel();const formatted=await state.kernel.format(code);if(f.content!==code){const path=uniquePath(f.path.replace(/\.py$/,'_formatted.py'));replaceProject({...state.project,files:[...state.project.files,newFile(path,formatted)]});toast('File đã thay đổi trong lúc format. Bản format được lưu tại '+path);}else{f.content=formatted;f.modified=Date.now();if(activeFile()?.path===f.path)state.editor.setValue(formatted);markChanged();toast('Đã format code.');}}finally{setBusy(false);renderPackages();}},
 'lint':async()=>{const f=activeFile();if(!f?.path.endsWith('.py'))throw new Error('Pyflakes dùng cho file .py.');if(state.busy)return;setBusy(true);try{await ensureKernel();const result=await state.kernel.lint(f.content,f.path);state.problems=result.map(m=>({...m,path:f.path}));if(activeFile()?.path===f.path)state.editor.markers(result);renderProblems();setBottom('problems');}finally{setBusy(false);renderPackages();}},
 'open-data':()=>{setPanel('data');renderDataFiles();$('data-file').value=state.project.active;dataFileChanged();},
 'preview-data':async()=>{
   const path=$('data-file').value;if(!path)throw new Error('Nhập CSV, Excel, JSON, Parquet hoặc SQLite vào project trước.');if(state.busy)return;state.capture=null;const baseline=currentFiles(),sql=$('sql-input').classList.contains('hidden')?'':$('sql-input').value;setBusy(true);
   try{await ensureKernel();const result=await state.kernel.data({path,sql,files:baseline,folders:state.project.folders});mergeFiles(result.files,baseline);receiveEvent(result.result);setBottom(result.result.kind==='table'?'outputs':'console');renderPackages();}finally{setBusy(false);}
 },
 'data-code':async()=>{const path=$('data-file').value;if(!path)return;let code='import pandas as pd\n';if(/\.(db|sqlite3?)$/i.test(path))code+=`import sqlite3\n\nwith sqlite3.connect(${JSON.stringify(path)}) as connection:\n    df = pd.read_sql_query("SELECT name FROM sqlite_master WHERE type='table'", connection)\n`;
   else code+=`\ndf = pd.${/\.xlsx?$/i.test(path)?'read_excel':/\.parquet$/i.test(path)?'read_parquet':/\.json/i.test(path)?'read_json':'read_csv'}(${JSON.stringify(path)}${/\.tsv$/i.test(path)?', sep="\\t"':''})\n`;code+='display(df)\n';if(activeFile()?.path.endsWith('.py'))state.editor.insert(code);else{const name=uniquePath('inspect_data.py');replaceProject({...state.project,files:[...state.project.files,newFile(name,code)]});openFile(name);}},
 'run-notebook':()=>runNotebook(),'notebook-source':()=>{state.rawNotebook=true;showFile();},
 'add-cell':()=>{editNotebook(nb=>nb.cells.push({cell_type:'code',id:uid().slice(0,8),source:'',metadata:{},outputs:[],execution_count:null}));showFile();$('notebook-editor').scrollTop=$('notebook-editor').scrollHeight;},
 'add-markdown':()=>{editNotebook(nb=>nb.cells.push({cell_type:'markdown',id:uid().slice(0,8),source:'## Markdown',metadata:{}}));showFile();$('notebook-editor').scrollTop=$('notebook-editor').scrollHeight;},
 'clear-notebook':()=>{editNotebook(nb=>nb.cells.forEach(c=>{if(c.cell_type==='code'){c.outputs=[];c.execution_count=null;}}));showFile();},
 'trace-prev':()=>traceStep(state.traceIndex-1),'trace-next':()=>traceStep(state.traceIndex+1),
 'trace-continue':()=>{if(!state.trace)return;const next=state.trace.rows.findIndex((row,i)=>i>state.traceIndex&&(state.project.breakpoints[row.file]||[]).includes(row.line));traceStep(next<0?state.trace.rows.length-1:next);},
 'replace-all':async()=>{const query=$('search-input').value;if(!query)return;const replacement=$('replace-input').value;const hits=searchFiles(state.project.files,query,$('search-case').checked);if(!hits.length)return;if(!await confirmAction('Thay trong project',`Thay mọi lần xuất hiện của "${query}" trong ${new Set(hits.map(h=>h.path)).size} file?`))return;
   for(const f of state.project.files)if(f.encoding==='text'){if($('search-case').checked)f.content=f.content.split(query).join(replacement);else{const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');f.content=f.content.replace(pattern,()=>replacement);}f.modified=Date.now();}markChanged();showFile();runSearch();
 },
 'about':()=>modal('PyForge · Python IDE',`<p>IDE frontend cho project Python: editor Monaco, file/workspace, notebook, console, thư viện, dữ liệu và trace.</p><p>Browser kernel: CPython qua Pyodide ${CONFIG.pyodideVersion}. Native kernel: Jupyter Server HTTP/WebSocket.</p><p>File tự lưu trên thiết bị này. Dùng ZIP/backup để chuyển máy hoặc lưu lên GitHub.</p><p>Đây là IDE độc lập. Extension VS Code và terminal hệ điều hành không được hỗ trợ trong browser kernel.</p>`,[['cancel','Đóng'],['submit','Mở hướng dẫn']]).then(r=>r?.action==='submit'?actions['help']():null),
 'help':async()=>{const response=await fetch(new URL('../README.md',import.meta.url));if(!response.ok)throw new Error('Mở README.md trong mã nguồn để xem hướng dẫn.');await modal('Hướng dẫn sử dụng',markdown(await response.text()),[['cancel','Đóng']]);},
 'github-help':()=>modal('Đưa IDE lên GitHub Pages',`<p>1. Tạo repository GitHub và upload các file trong thư mục PyForge (index.html ở gốc repository).</p><p>2. Vào Settings → Pages → Build and deployment → chọn Deploy from a branch → main → / (root) → Save.</p><p>3. Mở URL Pages sau khi GitHub deploy xong. Không cần npm install hoặc backend.</p><p>Có workflow GitHub Actions trong .github/workflows/pages.yml nếu bạn chọn Source: GitHub Actions. Xem README.md để biết cả hai cách.</p>`,[['cancel','Đóng']]),
 'snippets':async()=>{const promise=modal('Chèn Python snippet',`<div class="template-grid">${[['function','Hàm'],['class','Class'],['main','Main guard'],['async','Async function'],['unittest','Unit test'],['numpy','NumPy']].map(([key,label])=>`<button class="template-card" data-snippet="${key}"><strong>${label}</strong></button>`).join('')}</div>`,[['cancel','Đóng']]);$('dialog').querySelectorAll('[data-snippet]').forEach(b=>b.onclick=()=>{const f=activeFile();if(!f?.path.endsWith('.py'))return toast('Mở file .py trước.');const code={function:'def function_name(args):\n    pass\n',class:'class ClassName:\n    def __init__(self):\n        pass\n',main:'if __name__ == "__main__":\n    main()\n',async:'async def task():\n    await asyncio.sleep(1)\n',unittest:'import unittest\n\nclass TestExample(unittest.TestCase):\n    def test_example(self):\n        self.assertEqual(1 + 1, 2)\n',numpy:'import numpy as np\n\nx = np.array([1, 2, 3])\nprint(x.mean())\n'}[b.dataset.snippet];$('dialog').close();state.editor.insert(code);});await promise;},
 'commands':()=>commandPalette(false),'quick-open':()=>commandPalette(true),
});

const MENUS={
 file:[['new-file','File mới','Ctrl N'],['new-notebook','Notebook mới'],['new-folder','Thư mục mới'],['new-project','Project mới'],null,['upload','Nhập file'],['upload-folder','Mở thư mục từ máy'],['import-zip','Mở project ZIP'],null,['save','Lưu workspace','Ctrl S'],['download-file','Tải file hiện tại'],['export-project','Xuất project ZIP'],['backup','Backup mọi project'],['import-backup','Nhập backup']],
 edit:[['find','Tìm trong file','Ctrl F'],['show-search','Tìm / thay trong project','Ctrl Shift F'],['format','Format Python','Alt Shift F'],['snippets','Chèn snippet']],
 view:[['show-explorer','Explorer'],['show-packages','Packages'],['show-data','Data / SQL'],['show-trace','Trace inspector'],null,['show-console','Console'],['show-outputs','Rich outputs'],['show-variables','Variables'],['show-problems','Problems'],['show-stdin','Stdin / Args'],null,['toggle-sidebar','Ẩn/hiện sidebar','Ctrl B'],['toggle-bottom','Ẩn/hiện console'],['theme','Đổi sáng/tối']],
 run:[['run','Chạy file / notebook','F5'],['run-selection','Chạy selection','Ctrl Enter'],['trace','Chạy và ghi trace'],['stop','Dừng Python'],['restart-kernel','Khởi động lại kernel'],['kernel','Chọn môi trường Python']],
 tools:[['show-packages','Thư viện Python'],['requirements','Cài requirements.txt'],['format','Format với autopep8'],['lint','Phân tích với Pyflakes'],['show-data','Data / SQL'],['settings','Cài đặt IDE']],
 help:[['commands','Command palette','Ctrl Shift P'],['help','Hướng dẫn sử dụng'],['github-help','Đưa lên GitHub Pages'],['about','Giới thiệu PyForge']],
};
for(const p of ['explorer','search','packages','data','trace'])actions['show-'+p]=()=>setPanel(p);
for(const p of ['console','outputs','variables','problems','stdin'])actions['show-'+p]=()=>setBottom(p);
function showDropdown(anchor,items,extra={}){const box=$('dropdown');const rect=anchor.getBoundingClientRect();box.innerHTML=items.map(item=>item?`<button class="${item[3]?'danger':''}" data-action="${E(item[0])}"${extra.path?` data-path="${E(extra.path)}"`:''}><span>${E(item[1])}</span>${item[2]?`<kbd>${E(item[2])}</kbd>`:''}</button>`:'<hr>').join('');box.classList.remove('hidden');box.style.left=Math.min(rect.left,window.innerWidth-260)+'px';box.style.top=Math.min(rect.bottom+4,window.innerHeight-box.offsetHeight-10)+'px';}
function commandPalette(filesOnly){
  const commands=filesOnly?state.project.files.map(f=>({label:f.path,detail:'File',run:()=>openFile(f.path)})):[...new Map(Object.values(MENUS).flat().filter(Boolean).map(a=>[a[0],{label:a[1],detail:a[2]||'',run:()=>invoke(a[0])}])).values()];
  const promise=modal(filesOnly?'Mở file':'Command palette','<input class="palette-input" id="palette-filter" placeholder="Nhập để tìm…"><div class="command-list" id="palette-list"></div>',[]);let filtered=commands;
  const render=()=>{const query=$('palette-filter').value.toLowerCase();filtered=commands.filter(c=>c.label.toLowerCase().includes(query));$('palette-list').innerHTML=filtered.slice(0,60).map((c,i)=>`<button class="command-item" data-command-index="${i}"><span>${E(c.label)}</span><small>${E(c.detail)}</small></button>`).join('')||'<div class="panel-empty">Không có kết quả.</div>';$('palette-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{const command=filtered[Number(b.dataset.commandIndex)];state.closeModal?.('cancel');command.run();});};
  $('palette-filter').oninput=render;$('palette-filter').onkeydown=e=>{if(e.key==='Enter'&&filtered[0]){e.preventDefault();const command=filtered[0];state.closeModal?.('cancel');command.run();}};render();return promise;
}
function runSearch(){const hits=searchFiles(state.project.files,$('search-input').value,$('search-case').checked);$('search-count').textContent=hits.length+' dòng phù hợp'+(hits.length===500?' (tối đa 500)':'');$('search-results').innerHTML=hits.map(h=>`<button class="search-hit" data-open="${E(h.path)}" data-line="${h.line}"><strong>${E(h.path)}:${h.line}</strong><span>${E(h.text.trim())}</span></button>`).join('');}
async function invoke(action,data={},event){try{await actions[action]?.(data,event);}catch(e){toast(e.message||String(e),true);}}
function applySettings(){document.documentElement.dataset.theme=state.settings.theme;state.editor?.applySettings(state.settings);$('indent-status').textContent='Spaces: '+state.settings.tabSize;}

function bindEvents(){
 document.addEventListener('click',e=>{
   const menu=e.target.closest('[data-menu]');if(menu){showDropdown(menu,MENUS[menu.dataset.menu]);return;}
   const fileMenu=e.target.closest('[data-file-menu]');if(fileMenu){showDropdown(fileMenu,[['rename-file','Đổi tên file'],['download-file','Tải file'],['delete-file','Xóa file','',true]],{path:fileMenu.dataset.fileMenu});return;}
   const folderMenu=e.target.closest('[data-folder-menu]');if(folderMenu){showDropdown(folderMenu,[['rename-folder','Đổi tên thư mục'],['delete-folder','Xóa thư mục','',true]],{path:folderMenu.dataset.folderMenu});return;}
   const action=e.target.closest('[data-action]');if(action){$('dropdown').classList.add('hidden');invoke(action.dataset.action,{...action.dataset},e);return;}
   if(!e.target.closest('#dropdown'))$('dropdown').classList.add('hidden');
   const panel=e.target.closest('[data-panel]');if(panel){setPanel(panel.dataset.panel);return;}
   const bottom=e.target.closest('[data-bottom]');if(bottom){setBottom(bottom.dataset.bottom);return;}
   const close=e.target.closest('[data-close-tab]');if(close){const path=close.dataset.closeTab,at=state.project.tabs.indexOf(path);state.project.tabs=state.project.tabs.filter(p=>p!==path);if(state.project.active===path)state.project.active=state.project.tabs[Math.min(at,state.project.tabs.length-1)]||null;markChanged();renderFiles();showFile();return;}
   const tab=e.target.closest('[data-tab]');if(tab){openFile(tab.dataset.tab);return;}
   const folder=e.target.closest('[data-folder]');if(folder){const path=folder.dataset.folder;state.collapsed.has(path)?state.collapsed.delete(path):state.collapsed.add(path);renderTree();return;}
   const open=e.target.closest('[data-open]');if(open){openFile(open.dataset.open,Number(open.dataset.line)||undefined);return;}
   const install=e.target.closest('[data-install]');if(install){installPackages([install.dataset.install]);return;}
   const problem=e.target.closest('[data-problem-path]');if(problem){openFile(problem.dataset.problemPath,Number(problem.dataset.line),Number(problem.dataset.column));return;}
   const run=e.target.closest('[data-run-cell]');if(run){runCell(run.dataset.runCell);return;}
   const move=e.target.closest('[data-move-cell]');if(move){editNotebook(nb=>{const i=nb.cells.findIndex(c=>c.id===move.dataset.moveCell),j=i+Number(move.dataset.direction);if(j>=0&&j<nb.cells.length)[nb.cells[i],nb.cells[j]]=[nb.cells[j],nb.cells[i]];});showFile();return;}
   const del=e.target.closest('[data-delete-cell]');if(del){if(state.busy)return;confirmAction('Xóa cell','Xóa cell này khỏi notebook?').then(ok=>{if(ok){editNotebook(nb=>nb.cells=nb.cells.filter(c=>c.id!==del.dataset.deleteCell));showFile();}});return;}
 });
 $('project-select').onchange=e=>switchProject(e.target.value).catch(e=>toast(e.message,true));$('search-input').oninput=runSearch;$('search-case').onchange=runSearch;$('package-filter').oninput=renderPackages;$('data-file').onchange=dataFileChanged;
 $('pip-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();invoke('pip-install');}};
 for(const [id,folder] of [['file-upload',false],['folder-upload',true]])$(id).onchange=async e=>{try{const files=[...e.target.files];if(!folder&&files.length===1&&files[0].name.endsWith('.zip'))await importZip(files[0]);else await uploadFiles(files,folder);}catch(error){toast(error.message,true);}};
 $('zip-upload').onchange=async e=>{if(e.target.files[0])try{await importZip(e.target.files[0]);}catch(error){toast(error.message,true);}};
 $('backup-upload').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(state.busy)throw new Error('Dừng kernel trước khi nhập backup.');const backup=JSON.parse(await file.text());if(backup.format!=='pyforge-backup'||backup.version!==1||!Array.isArray(backup.projects))throw new Error('File không phải backup PyForge v1.');const projects=backup.projects.map(p=>validateProject({...p,id:uid(),name:p.name+' (restored)'}));if(!projects.length)return;for(const p of projects){state.projects.push(p);if(state.store)await state.store.put(p);}await switchProject(projects[0].id);toast('Đã nhập '+projects.length+' project.');}catch(error){toast(error.message,true);}};
 $('notebook-editor').addEventListener('input',e=>{const id=e.target.dataset.cellSource;if(!id)return;const nb=editNotebook(nb=>{const c=nb.cells.find(c=>c.id===id);if(c)c.source=e.target.value;});const cell=nb?.cells.find(c=>c.id===id);if(cell?.cell_type==='markdown')e.target.nextElementSibling.innerHTML=markdown(cell.source);});
 $('notebook-editor').addEventListener('change',e=>{const id=e.target.dataset.cellType;if(!id)return;editNotebook(nb=>{const c=nb.cells.find(c=>c.id===id);c.cell_type=e.target.value;if(c.cell_type==='code'){c.outputs=[];c.execution_count=null;}else{delete c.outputs;delete c.execution_count;}});showFile();});
 $('notebook-editor').addEventListener('keydown',e=>{if(e.target.dataset.cellSource&&e.key==='Tab'){e.preventDefault();e.target.setRangeText(' '.repeat(state.settings.tabSize),e.target.selectionStart,e.target.selectionEnd,'end');e.target.dispatchEvent(new Event('input',{bubbles:true}));}});
 $('repl-form').onsubmit=async e=>{e.preventDefault();const code=$('repl-input').value;if(!code.trim()||state.busy)return;state.replHistory.push(code);state.replIndex=state.replHistory.length;$('repl-input').value='';state.capture=null;consoleLine('command','>>> '+code);await runCode(code,'__console__.py','repl');$('repl-input').focus();};
 $('repl-input').onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();state.replIndex=Math.max(0,Math.min(state.replHistory.length,state.replIndex+(e.key==='ArrowUp'?-1:1)));e.target.value=state.replHistory[state.replIndex]||'';}};
 document.addEventListener('keydown',e=>{
   if(e.key==='Escape')$('dropdown').classList.add('hidden');if($('dialog').open)return;
   const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();let action;
   if(e.key==='F5')action='run';else if(mod&&e.key==='Enter'){const cell=e.target.closest('[data-cell-id]');if(cell){e.preventDefault();e.stopImmediatePropagation();runCell(cell.dataset.cellId);return;}action='run-selection';}
   else if(mod&&e.shiftKey&&key==='p')action='commands';else if(mod&&e.shiftKey&&key==='f')action='show-search';else if(mod&&key==='s')action='save';else if(mod&&key==='n')action='new-file';else if(mod&&key==='b')action='toggle-sidebar';else if(mod&&key==='k')action='commands';else if(mod&&key==='p')action='quick-open';else if(e.altKey&&e.shiftKey&&key==='f')action='format';else if(mod&&key==='f'&&!state.editor.instance)action='find';
   if(action){e.preventDefault();e.stopImmediatePropagation();invoke(action);}
 },true);
 let dragDepth=0,overlay;
 document.addEventListener('dragenter',e=>{if(!e.dataTransfer?.types.includes('Files'))return;e.preventDefault();if(++dragDepth===1){overlay=document.createElement('div');overlay.className='drag-overlay';overlay.textContent='Thả file vào workspace';document.body.append(overlay);}});
 document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});document.addEventListener('dragleave',()=>{if(--dragDepth<=0){overlay?.remove();dragDepth=0;}});
 document.addEventListener('drop',async e=>{if(!e.dataTransfer?.files.length)return;e.preventDefault();overlay?.remove();dragDepth=0;try{const files=[...e.dataTransfer.files];if(files.length===1&&files[0].name.endsWith('.zip'))await importZip(files[0]);else await uploadFiles(files);}catch(error){toast(error.message,true);}});
 window.addEventListener('beforeunload',e=>{if(state.revision!==state.savedRevision){save().catch(()=>{});e.preventDefault();e.returnValue='';}});document.addEventListener('visibilitychange',()=>{if(document.hidden)save().catch(()=>{});});
 for(const [id,axis] of [['sidebar-resizer','x'],['panel-resizer','y']])$(id).onpointerdown=e=>{e.preventDefault();const origin=axis==='x'?e.clientX:e.clientY;const size=axis==='x'?$('sidebar').offsetWidth:$('bottom-panel').offsetHeight;const target=$(id);target.setPointerCapture(e.pointerId);target.onpointermove=ev=>{const delta=axis==='x'?ev.clientX-origin:origin-ev.clientY;const next=Math.max(axis==='x'?180:100,Math.min(axis==='x'?520:window.innerHeight*.65,size+delta));document.documentElement.style.setProperty(axis==='x'?'--sidebar-width':'--panel-height',next+'px');};target.onpointerup=()=>{target.onpointermove=null;target.releasePointerCapture(e.pointerId);};};
 $('file-tree').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.target.click();}});
}

async function boot(){
 if(location.protocol==='file:'){toast('Mở bằng HTTP: dùng Live Server hoặc python -m http.server 8000. Trình duyệt chặn module/worker ở file://.',true);setSaveStatus('Cần HTTP server',true);return;}
 try{state.store=await new WorkspaceStore().open();state.settings={...defaults,...await state.store.getMeta('settings')};const projects=await state.store.all();for(const p of projects)try{state.projects.push(validateProject(p));}catch(e){toast('Project '+(p.name||'')+' có dữ liệu lỗi: '+e.message,true);}const active=await state.store.getMeta('active');state.project=state.projects.find(p=>p.id===active)||state.projects[0];}
 catch(e){state.store=null;toast('Trình duyệt không cho lưu workspace. Hãy dùng ZIP/backup để giữ file. '+e.message,true);}
 if(!state.project){state.project=templateProject('python','python-workspace');state.projects.push(state.project);if(state.store){await state.store.put(state.project);await state.store.setMeta('active',state.project.id);}}
 state.editor=new CodeEditor($('code-editor'),{change:changeCode,cursor:(line,column)=>$('cursor-status').textContent=`Ln ${line}, Col ${column}`,breakpoint:line=>{const f=activeFile();if(!f?.path.endsWith('.py'))return;const b=state.project.breakpoints[f.path]||[];state.project.breakpoints[f.path]=b.includes(line)?b.filter(n=>n!==line):[...b,line].sort((a,b)=>a-b);markChanged();state.editor.setBreakpoints(state.project.breakpoints[f.path]);renderBreakpoints();},complete:async(code,line,column,path)=>{if(state.busy||state.kernelState!=='ready')return [];return state.kernel.complete(code,line,column,path);},run:selection=>runFile(selection),status:name=>{if(name!=='Monaco')toast('Monaco chưa tải được. Editor tích hợp vẫn cho phép soạn và chạy Python.');}},state.settings);
 createKernel();applySettings();renderFiles();showFile();renderProblems();bindEvents();setSaveStatus(state.store?'✓ Đã lưu trên thiết bị':'Chưa lưu — hãy xuất backup',!state.store);
 consoleLine('system','PyForge · Python workspace\nF5 chạy file · Ctrl Enter chạy selection · Ctrl Shift P mở lệnh\nNhấn Run hoặc Tải kernel để khởi động Python.\n');
 if('serviceWorker' in navigator)navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname}).catch(()=>{});
}
export const appReady=boot().catch(error=>{toast('Không mở được IDE: '+error.message,true);console.error(error);throw error;});
