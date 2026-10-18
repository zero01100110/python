import {uid,normalizePath,base64ToBytes,decoder,newFile,parseRequirements} from './core.js';
import {PY_HELPERS} from './kernel-python.js';

export function serverConfig(url,token=''){
  const base=new URL(url);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('Dùng URL HTTP/HTTPS của Jupyter Server.');
  token=token||base.searchParams.get('token')||'';base.search='';base.hash='';base.pathname=base.pathname.replace(/\/?$/,'/');
  return {url:base.href,token};
}
function decodeExpression(reply){
  if(!reply||reply.status!=='ok')return null;
  const text=reply.data?.['text/plain'];if(typeof text!=='string')return null;
  const encoded=text.trim().replace(/^['"]|['"]$/g,'');
  try{return JSON.parse(decoder.decode(base64ToBytes(encoded)));}catch{return null;}
}
const b64Expr=expression=>`__import__('base64').b64encode((${expression}).encode('utf-8')).decode('ascii')`;

// Jupyter Server HTTP + legacy WebSocket JSON protocol. Token chỉ giữ trong RAM.
export class JupyterKernel {
  constructor(config,projectId,onEvent,onState,onInput){
    this.config=serverConfig(config.url,config.token);this.root='pyforge/'+projectId.replace(/[^a-zA-Z0-9_-]/g,'');this.onEvent=onEvent;this.onState=onState;this.onInput=onInput;this.kind='jupyter';this.session=uid();this.pending=new Map();this.catalog={};this.installed={};this.ready=null;this.kernelId=null;this.socket=null;this.previous=new Set();
  }
  async api(path,{method='GET',body}={}){
    const url=new URL(path,this.config.url);const response=await fetch(url,{method,headers:{...(this.config.token?{Authorization:'token '+this.config.token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    if(!response.ok){let reason='';try{const data=await response.json();reason=String(data.message||data.reason||'');if(this.config.token)reason=reason.split(this.config.token).join('[token]');}catch{}throw new Error(`Jupyter HTTP ${response.status}. ${reason||'Kiểm tra URL, token, CORS và quyền truy cập.'}`);}
    return response.status===204?null:response.json();
  }
  contents(path){return 'api/contents/'+path.split('/').map(encodeURIComponent).join('/');}
  async directories(path){let parent='';for(const part of path.split('/')){parent=parent?parent+'/'+part:part;try{await this.api(this.contents(parent));}catch(e){if(!e.message.includes('404'))throw e;await this.api(this.contents(parent),{method:'PUT',body:{type:'directory'}});}}}
  async ensure(){
    if(this.ready)return this.ready;
    this.onState('loading');
    this.ready=(async()=>{
      await this.directories(this.root);
      const kernel=await this.api('api/kernels',{method:'POST',body:{name:'python3',path:this.root}});this.kernelId=kernel.id;
      const url=new URL('api/kernels/'+encodeURIComponent(kernel.id)+'/channels',this.config.url);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('session_id',this.session);if(this.config.token)url.searchParams.set('token',this.config.token);
      const socket=new WebSocket(url);socket.binaryType='arraybuffer';this.socket=socket;
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Hết thời gian kết nối WebSocket Jupyter.')),20000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(new Error('Không kết nối được WebSocket. Kiểm tra CORS, HTTPS và token.'));};socket.onclose=()=>{clearTimeout(timer);reject(new Error('Jupyter đóng kết nối khi đang khởi động.'));};});
      socket.onmessage=event=>this.receive(event.data);socket.onclose=()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Jupyter đã ngắt kết nối.'));}this.pending.clear();this.ready=null;this.onState('stopped');};
      const info=await this.execute(this.helperSetup(),{silent:true,expressions:{installed:b64Expr("_pf_helpers['_forge_installed']()"),version:b64Expr("__import__('json').dumps(_pf_sys.version.split()[0])")},timeout:30000});
      if(!info.success)throw new Error(info.error||'Không khởi tạo được kernel Python native.');
      this.installed=decodeExpression(info.expressions.installed)||{};this.version=decodeExpression(info.expressions.version)||'native';
      this.onState('ready');return {catalog:{},installed:this.installed,version:this.version};
    })().catch(async error=>{await this.reset(error.message);throw error;});
    return this.ready;
  }
  message(type,content,channel='shell',parent={}){const id=uid();return {header:{msg_id:id,username:'pyforge',session:this.session,msg_type:type,version:'5.3',date:new Date().toISOString()},parent_header:parent,metadata:{},content,channel,buffers:[]};}
  receive(raw){
    let msg;try{
      if(typeof raw==='string')msg=JSON.parse(raw);
      else{const view=new DataView(raw);const count=view.getUint32(0,false);const start=view.getUint32(4,false);const end=count>1?view.getUint32(8,false):raw.byteLength;msg=JSON.parse(decoder.decode(new Uint8Array(raw,start,end-start)));}
    }catch{return;}
    const type=msg.header?.msg_type;const pending=this.pending.get(msg.parent_header?.msg_id);if(!pending)return;const c=msg.content||{};
    if(type==='input_request'){
      Promise.resolve(this.onInput(c.prompt||'input()',c.password)).then(value=>{if(this.socket?.readyState===1)this.socket.send(JSON.stringify(this.message('input_reply',{value:String(value??'')},'stdin',msg.header)));});
    }else if(type==='stream'){if(!pending.silent)this.onEvent({kind:c.name==='stderr'?'stderr':'stdout',text:c.text});}
    else if(type==='error'){pending.error=(c.traceback||[c.ename+': '+c.evalue]).join('\n').replace(/\x1b\[[0-9;]*m/g,'');if(!pending.silent)this.onEvent({kind:'error',text:pending.error});}
    else if(type==='display_data'||type==='execute_result'||type==='update_display_data'){if(!pending.silent)this.onEvent({kind:'rich',data:c.data||{},metadata:c.metadata||{}});}
    else if(type==='execute_reply'){pending.reply=c;pending.shell=true;}
    else if(type==='status'&&c.execution_state==='idle'){pending.idle=true;}
    else if(type==='complete_reply'){clearTimeout(pending.timer);this.pending.delete(msg.parent_header.msg_id);pending.resolve(c);return;}
    if(pending.shell&&pending.idle){clearTimeout(pending.timer);this.pending.delete(msg.parent_header.msg_id);pending.resolve({success:pending.reply.status==='ok',error:pending.error||pending.reply.evalue||'',expressions:pending.reply.user_expressions||{}});}
  }
  execute(code,{silent=false,expressions={},timeout=120000}={}){
    const msg=this.message('execute_request',{code,silent,store_history:!silent,user_expressions:expressions,allow_stdin:true,stop_on_error:true});
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(msg.header.msg_id);this.interrupt().catch(()=>{});reject(new Error('Jupyter chạy quá thời gian, đã gửi interrupt.'));},timeout);this.pending.set(msg.header.msg_id,{resolve,reject,timer,silent,shell:false,idle:false});this.socket.send(JSON.stringify(msg));});
  }
  helperSetup(){return `import os as _pf_os, sys as _pf_sys, importlib as _pf_importlib, shutil as _pf_shutil\n_pf_helpers={'__name__':'pyforge_helpers'}\nexec(${JSON.stringify(PY_HELPERS)}, _pf_helpers)\n_pf_helpers['_forge_workspace']=_pf_os.getcwd()\nif _pf_os.getcwd() not in _pf_sys.path: _pf_sys.path.insert(0,_pf_os.getcwd())\nfor _pf_name, _pf_module in list(_pf_sys.modules.items()):\n    if _pf_name!='__main__' and str(getattr(_pf_module,'__file__','')).startswith(_pf_os.getcwd()+'/'):\n        _pf_sys.modules.pop(_pf_name,None)\nfor _pf_dir, _pf_dirs, _pf_files in _pf_os.walk(_pf_os.getcwd()):\n    if '__pycache__' in _pf_dirs:\n        _pf_shutil.rmtree(_pf_os.path.join(_pf_dir,'__pycache__'),ignore_errors=True)\n        _pf_dirs.remove('__pycache__')\n_pf_importlib.invalidate_caches()\n`;}
  async syncFiles(files,folders=[]){
    await this.directories(this.root);
    for(const old of this.previous)if(!files.some(f=>f.path===old)){try{await this.api(this.contents(this.root+'/'+old),{method:'DELETE'});}catch(e){if(!e.message.includes('404'))throw e;}}
    for(const f of files){const path=this.root+'/'+normalizePath(f.path);await this.directories(path.slice(0,path.lastIndexOf('/')));await this.api(this.contents(path),{method:'PUT',body:{type:'file',format:f.encoding==='text'?'text':'base64',content:f.content}});}
    for(const folder of folders)await this.directories(this.root+'/'+normalizePath(folder));
    this.previous=new Set(files.map(f=>f.path));
  }
  async collectFiles(){
    const files=[];let size=0;
    const walk=async path=>{
      const item=await this.api(this.contents(path)+'?content=1');
      if(item.type==='directory'){for(const child of item.content){if(child.name==='__pycache__'||child.name==='.ipynb_checkpoints')continue;if(child.size>25*1024*1024)continue;if(files.length<2500)await walk(child.path);}}
      else{const relative=normalizePath(item.path.slice(this.root.length+1));const content=item.type==='notebook'?JSON.stringify(item.content,null,2):item.content;if(typeof content!=='string')return;size+=item.size||content.length;if(size>80*1024*1024)throw new Error('File trên Jupyter vượt giới hạn tự đồng bộ 80 MB.');files.push({path:relative,encoding:item.format==='base64'?'base64':'text',content,modified:Date.now()});}
    };await walk(this.root);this.previous=new Set(files.map(f=>f.path));return files;
  }
  async run(args,timeout=120000){
    await this.syncFiles(args.files,args.folders);await this.ensure();
    let code=this.helperSetup()+`_pf_sys.argv=[${JSON.stringify(args.filename)}, *${JSON.stringify(args.argv||[])}]\n__file__=_pf_os.path.join(_pf_os.getcwd(),${JSON.stringify(args.filename)})\nif _pf_os.path.dirname(__file__) not in _pf_sys.path: _pf_sys.path.insert(0,_pf_os.path.dirname(__file__))\n`;
    if(args.trace){code+=`_pf_helpers['_forge_start_trace']()\ntry:\n    exec(compile(${JSON.stringify(args.code)}, __file__, 'exec'),globals())\nfinally:\n    _pf_helpers['_forge_end_trace']()\n`;}else code+=args.code;
    const expressions={variables:b64Expr("_pf_helpers['_forge_variables'](globals())"),installed:b64Expr("_pf_helpers['_forge_installed']()")};
    if(args.trace)expressions.trace=b64Expr("_pf_helpers['_forge_end_trace']()");
    const started=performance.now();const reply=await this.execute(code,{timeout,expressions});
    this.installed=decodeExpression(reply.expressions.installed)||this.installed;
    let files;try{files=await this.collectFiles();}catch(e){this.onEvent({kind:'stderr',text:'Đồng bộ file sau khi chạy: '+e.message+'\n'});}
    return {...reply,elapsed:performance.now()-started,variables:decodeExpression(reply.expressions.variables)||[],trace:decodeExpression(reply.expressions.trace),installed:this.installed,files};
  }
  async utility(code,expression){await this.ensure();const reply=await this.execute(this.helperSetup()+code,{silent:true,expressions:{value:b64Expr(expression)}});if(!reply.success)throw new Error(reply.error||'Jupyter utility thất bại.');const result=decodeExpression(reply.expressions.value);if(result===null)throw new Error('Không đọc được kết quả từ Jupyter.');return result;}
  async install(requirements){
    for(const r of requirements)parseRequirements(r);
    await this.ensure();const code=`import subprocess as _pf_subprocess, sys as _pf_sys\n_pf_subprocess.run([_pf_sys.executable,'-m','pip','install',*${JSON.stringify(requirements)}],check=True)\nimport importlib as _pf_importlib\n_pf_importlib.invalidate_caches()\n`;
    const reply=await this.execute(this.helperSetup()+code,{expressions:{value:b64Expr("_pf_helpers['_forge_installed']()")},timeout:300000});if(!reply.success)throw new Error(reply.error);this.installed=decodeExpression(reply.expressions.value)||{};return this.installed;
  }
  async data(args){await this.syncFiles(args.files,args.folders);const required=['pandas'];if(/\.xlsx$/i.test(args.path))required.push('openpyxl');if(/\.xls$/i.test(args.path))required.push('xlrd');if(/\.parquet$/i.test(args.path))required.push('fastparquet');const missing=required.filter(p=>!this.installed[p]);if(missing.length)await this.install(missing);const result=await this.utility('',`_pf_helpers['_forge_data'](_pf_os.path.join(_pf_os.getcwd(),${JSON.stringify(args.path)}),${JSON.stringify(args.sql||'')})`);return {result,files:await this.collectFiles(),installed:this.installed};}
  async validate(code,filename){return this.utility('',`_pf_helpers['_forge_validate'](${JSON.stringify(code)},${JSON.stringify(filename)})`);}
  async format(code){await this.install(['autopep8']);return this.utility('',`__import__('json').dumps(_pf_helpers['_forge_format'](${JSON.stringify(code)}))`);}
  async lint(code,filename){await this.install(['pyflakes']);return this.utility('',`_pf_helpers['_forge_lint'](${JSON.stringify(code)},${JSON.stringify(filename)})`);}
  async complete(code,line,column){
    if(!this.socket||this.socket.readyState!==1)return [];
    const lines=code.split('\n');const cursor=lines.slice(0,line-1).reduce((a,s)=>a+s.length+1,0)+column;
    const msg=this.message('complete_request',{code,cursor_pos:cursor});const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(msg.header.msg_id);resolve({matches:[]});},8000);this.pending.set(msg.header.msg_id,{resolve,reject,timer});this.socket.send(JSON.stringify(msg));});
    return (result.matches||[]).map(s=>({label:s,insertText:s,detail:'Jupyter completion'}));
  }
  async interrupt(){if(this.kernelId)await this.api('api/kernels/'+encodeURIComponent(this.kernelId)+'/interrupt',{method:'POST'});}
  async reset(reason='Đã đóng kernel Jupyter.'){
    const id=this.kernelId;this.kernelId=null;this.ready=null;this.socket?.close();this.socket=null;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}this.pending.clear();this.onState('stopped');
    if(id)try{await this.api('api/kernels/'+encodeURIComponent(id),{method:'DELETE'});}catch{/* Files ở thư mục riêng vẫn được giữ lại. */}
  }
}
