import {CONFIG} from './config.js';
import {escapeHTML} from './core.js';
const keywords='False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'.split(' ');
const builtins='abs all any bin bool bytes callable chr dict dir enumerate eval filter float format getattr help hex input int isinstance iter len list map max min next object open ord pow print range repr reversed round set sorted str sum super tuple type zip display'.split(' ');
const snippets=[
  ['def','def ${1:function_name}(${2:args}):\n    ${3:pass}','Hàm Python'],
  ['class','class ${1:ClassName}:\n    def __init__(self, ${2:args}):\n        ${3:pass}','Lớp Python'],
  ['for','for ${1:item} in ${2:items}:\n    ${3:pass}','Vòng lặp'],
  ['ifmain','if __name__ == "__main__":\n    ${1:main()}','Điểm vào chương trình'],
  ['try','try:\n    ${1:pass}\nexcept ${2:Exception} as error:\n    ${3:print(error)}','Xử lý lỗi'],
  ['with','with open(${1:"file.txt"}, ${2:"r"}, encoding="utf-8") as file:\n    ${3:data = file.read()}','Đọc/ghi file'],
  ['dataclass','from dataclasses import dataclass\n\n@dataclass\nclass ${1:Model}:\n    ${2:name}: ${3:str}','Data class'],
];
let monacoPromise;
function loadMonaco(){
  if(monacoPromise)return monacoPromise;
  monacoPromise=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Monaco CDN timeout')),20000);
    const blobURL=URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:${JSON.stringify(CONFIG.monacoURL.replace(/\/vs$/,'/'))}};importScripts(${JSON.stringify(CONFIG.monacoURL+'/base/worker/workerMain.js')});`],{type:'text/javascript'}));
    window.MonacoEnvironment={getWorkerUrl:()=>blobURL};
    const script=document.createElement('script');script.src=CONFIG.monacoURL+'/loader.js';script.onerror=()=>{clearTimeout(timer);reject(new Error('Không tải được Monaco.'));};
    script.onload=()=>{window.require.config({paths:{vs:CONFIG.monacoURL}});window.require(['vs/editor/editor.main'],()=>{clearTimeout(timer);resolve(window.monaco);},e=>{clearTimeout(timer);reject(e);});};document.head.append(script);
  });return monacoPromise;
}
function highlight(code){
  const pattern=/("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|#[^\n]*|(?:[rubfRUBF]{0,2})(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|0x[0-9a-fA-F]+)\b|\b[a-zA-Z_]\w*\b)/g;
  let last=0,result='',m;
  while((m=pattern.exec(code))){result+=escapeHTML(code.slice(last,m.index));const token=m[0];let cls='';if(token.startsWith('#'))cls='comment';else if(/^(?:[rubfRUBF]{0,2})["']/.test(token))cls='string';else if(/^\d/.test(token))cls='number';else if(keywords.includes(token))cls='keyword';else if(builtins.includes(token))cls='builtin';result+=cls?`<span class="syntax-${cls}">${escapeHTML(token)}</span>`:escapeHTML(token);last=m.index+token.length;}
  return result+escapeHTML(code.slice(last))+'\n';
}
export class CodeEditor{
  constructor(holder,callbacks,settings){this.holder=holder;this.callbacks=callbacks;this.settings=settings;this.models=new Map();this.path=null;this.breakpoints=[];this.decos=[];this.traceDecos=[];this.silent=false;this.makeFallback();this.load();}
  makeFallback(){
    this.holder.innerHTML='<div class="fallback-editor"><div class="fallback-gutter" aria-label="Nhấn số dòng để đặt breakpoint"></div><div class="fallback-code"><pre class="syntax-layer" aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Trình soạn thảo mã nguồn" wrap="off"></textarea></div></div>';
    this.fallback=this.holder.querySelector('.fallback-editor');this.text=this.holder.querySelector('textarea');this.pre=this.holder.querySelector('pre');this.gutter=this.holder.querySelector('.fallback-gutter');
    this.text.addEventListener('input',()=>{this.paint();if(!this.silent)this.callbacks.change(this.text.value);this.cursor();});
    this.text.addEventListener('scroll',()=>{this.pre.style.transform=`translate(${-this.text.scrollLeft}px,${-this.text.scrollTop}px)`;this.gutter.scrollTop=this.text.scrollTop;});
    for(const e of ['click','keyup','select'])this.text.addEventListener(e,()=>this.cursor());
    this.gutter.onclick=e=>{const line=Number(e.target.dataset.line);if(line)this.callbacks.breakpoint(line);};
    this.text.addEventListener('keydown',e=>{
      if(e.key==='Tab'){e.preventDefault();this.indent(e.shiftKey);}
      else if(e.key==='Enter'&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();const start=this.text.selectionStart;const before=this.text.value.slice(0,start);const line=before.slice(before.lastIndexOf('\n')+1);this.insert('\n'+(line.match(/^\s*/)?.[0]||'')+(line.trimEnd().endsWith(':')?' '.repeat(this.settings.tabSize):''));}
      else if((e.ctrlKey||e.metaKey)&&e.key==='/'){e.preventDefault();this.comment();}
      else if((e.ctrlKey||e.metaKey)&&e.key===' '){e.preventDefault();this.fallbackComplete();}
    });this.applySettings(this.settings);
  }
  async load(){
    try{
      const monaco=await loadMonaco();this.monaco=monaco;const value=this.getValue();this.fallback.style.display='none';this.surface=document.createElement('div');this.surface.className='monaco-surface';this.holder.append(this.surface);
      monaco.editor.defineTheme('forge-dark',{base:'vs-dark',inherit:true,rules:[{token:'comment',foreground:'6D8190'},{token:'keyword',foreground:'CF9DFF'},{token:'string',foreground:'A7D7A5'},{token:'number',foreground:'E6B778'}],colors:{'editor.background':'#151b23','editor.foreground':'#d8e2ed','editorLineNumber.foreground':'#506071','editorLineNumber.activeForeground':'#a9bbce','editor.selectionBackground':'#254959','editor.lineHighlightBackground':'#1b2531','editorCursor.foreground':'#50dec2','editorIndentGuide.background1':'#25313f'}});
      this.instance=monaco.editor.create(this.surface,{value,language:'python',theme:this.settings.theme==='light'?'vs':'forge-dark',fontFamily:'"JetBrains Mono", "Cascadia Code", Consolas, monospace',fontSize:this.settings.fontSize,tabSize:this.settings.tabSize,wordWrap:this.settings.wrap?'on':'off',minimap:{enabled:this.settings.minimap},automaticLayout:true,glyphMargin:true,scrollBeyondLastLine:false,padding:{top:18,bottom:18},smoothScrolling:true,renderWhitespace:'selection',bracketPairColorization:{enabled:true},fixedOverflowWidgets:true});
      this.instance.onDidChangeModelContent(()=>{if(!this.silent)this.callbacks.change(this.instance.getValue());});this.instance.onDidChangeCursorPosition(e=>this.callbacks.cursor(e.position.lineNumber,e.position.column));
      this.instance.onMouseDown(e=>{if(e.target.type===monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN&&e.target.position)this.callbacks.breakpoint(e.target.position.lineNumber);});
      monaco.languages.registerCompletionItemProvider('python',{triggerCharacters:['.'],provideCompletionItems:async(model,pos)=>{
        const word=model.getWordUntilPosition(pos);const range={startLineNumber:pos.lineNumber,endLineNumber:pos.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn};
        const dynamic=await this.callbacks.complete(model.getValue(),pos.lineNumber,pos.column-1,this.path).catch(()=>[]);
        const names=[...new Set(model.getValue().match(/\b[a-zA-Z_]\w*\b/g)||[])];
        const suggestions=[...dynamic.map(c=>({...c,kind:monaco.languages.CompletionItemKind.Function,range})),...[...keywords,...builtins,...names].map(label=>({label,insertText:label,kind:monaco.languages.CompletionItemKind.Text,range})),...snippets.map(([label,insertText,detail])=>({label,insertText,detail,kind:monaco.languages.CompletionItemKind.Snippet,insertTextRules:monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,range}))];return {suggestions};
      }});
      this.instance.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.Enter,()=>this.callbacks.run(true));this.instance.addCommand(monaco.KeyCode.F5,()=>this.callbacks.run(false));
      if(this.path)this.setFile(this.path,value);this.setBreakpoints(this.breakpoints);this.callbacks.status('Monaco');
    }catch{this.callbacks.status('Editor tích hợp');}
  }
  paint(){
    const code=this.text.value;const python=this.path?.endsWith('.py');this.pre.innerHTML=python?highlight(code):escapeHTML(code)+'\n';const lines=code.split('\n').length;
    this.gutter.innerHTML=Array.from({length:Math.min(lines,10000)},(_,i)=>`<button type="button" tabindex="-1" class="${this.breakpoints.includes(i+1)?'breakpoint':''}" data-line="${i+1}" title="Breakpoint dòng ${i+1}">${i+1}</button>`).join('');
  }
  cursor(){const prefix=this.text.value.slice(0,this.text.selectionStart);const lines=prefix.split('\n');this.callbacks.cursor(lines.length,lines.at(-1).length+1);}
  getValue(){return this.instance?this.instance.getValue():this.text.value;}
  setFile(path,value){
    this.path=path;this.silent=true;
    if(this.instance){let model=this.models.get(path);if(!model){const ext=path.split('.').at(-1);const lang=({py:'python',json:'json',md:'markdown',html:'html',js:'javascript',css:'css',sql:'sql',yml:'yaml',yaml:'yaml',toml:'ini'})[ext]||'plaintext';model=this.monaco.editor.createModel(value,lang,this.monaco.Uri.parse('inmemory://project/'+path));this.models.set(path,model);}else if(model.getValue()!==value)model.setValue(value);this.instance.setModel(model);}
    else{this.text.value=value;this.text.selectionStart=this.text.selectionEnd=0;this.text.scrollTop=0;this.paint();}
    this.silent=false;
  }
  setValue(value){this.silent=true;if(this.instance)this.instance.setValue(value);else{this.text.value=value;this.paint();}this.silent=false;}
  removeModel(path){const model=this.models.get(path);if(this.instance?.getModel()===model)this.instance.setModel(null);model?.dispose();this.models.delete(path);}
  resetModels(){this.instance?.setModel(null);for(const model of this.models.values())model.dispose();this.models.clear();this.path=null;}
  selection(){if(this.instance){const sel=this.instance.getSelection();return sel.isEmpty()?'':this.instance.getModel().getValueInRange(sel);}return this.text.value.slice(this.text.selectionStart,this.text.selectionEnd);}
  insert(value){if(this.instance)this.instance.executeEdits('forge',[{range:this.instance.getSelection(),text:value,forceMoveMarkers:true}]);else{this.text.setRangeText(value,this.text.selectionStart,this.text.selectionEnd,'end');this.paint();this.callbacks.change(this.text.value);this.cursor();}this.focus();}
  indent(out=false){const t=this.text;const start=t.value.lastIndexOf('\n',t.selectionStart-1)+1;let end=t.value.indexOf('\n',t.selectionEnd);if(end<0)end=t.value.length;const old=t.value.slice(start,end);const changed=old.split('\n').map(line=>out?line.replace(new RegExp(`^( {1,${this.settings.tabSize}}|\\t)`),''):' '.repeat(this.settings.tabSize)+line).join('\n');t.setRangeText(changed,start,end,'select');this.paint();this.callbacks.change(t.value);}
  comment(){const t=this.text;const start=t.value.lastIndexOf('\n',t.selectionStart-1)+1;let end=t.value.indexOf('\n',t.selectionEnd);if(end<0)end=t.value.length;const lines=t.value.slice(start,end).split('\n');const remove=lines.every(s=>!s.trim()||/^\s*#/.test(s));t.setRangeText(lines.map(s=>remove?s.replace(/^(\s*)# ?/,'$1'):s.replace(/^(\s*)/,'$1# ')).join('\n'),start,end,'select');this.paint();this.callbacks.change(t.value);}
  async fallbackComplete(){const value=this.text.value;const point=this.text.selectionStart;const prefix=value.slice(0,point).match(/[a-zA-Z_]\w*$/)?.[0]||'';const matches=[...new Set([...builtins,...keywords,...(value.match(/\b[a-zA-Z_]\w*\b/g)||[])])].filter(x=>x.startsWith(prefix)&&x!==prefix).slice(0,20);if(!matches.length)return;const choice=window.prompt('Gợi ý: '+matches.join(', '),matches[0]);if(choice){this.text.selectionStart=point-prefix.length;this.insert(choice);}}
  setBreakpoints(lines){this.breakpoints=[...lines];if(this.instance){this.decos=this.instance.deltaDecorations(this.decos,lines.map(line=>({range:new this.monaco.Range(line,1,line,1),options:{glyphMarginClassName:'breakpoint-glyph',glyphMarginHoverMessage:{value:'Trace breakpoint'}}})));}else this.paint();}
  goTo(line,column=1){if(this.instance){this.instance.revealLineInCenter(line);this.instance.setPosition({lineNumber:line,column});}else{const lines=this.text.value.split('\n');const pos=lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0)+column-1;this.text.selectionStart=this.text.selectionEnd=pos;this.text.scrollTop=Math.max(0,(line-5)*this.settings.fontSize*1.65);this.text.dispatchEvent(new Event('scroll'));this.cursor();}this.focus();}
  traceLine(line){if(this.instance)this.traceDecos=this.instance.deltaDecorations(this.traceDecos,line?[{range:new this.monaco.Range(line,1,line,1),options:{isWholeLine:true,className:'trace-line'}}]:[]);else this.gutter.querySelectorAll('button').forEach(b=>b.classList.toggle('trace-line',Number(b.dataset.line)===line));}
  markers(items){if(this.instance)this.monaco.editor.setModelMarkers(this.instance.getModel(),'pyforge',items.map(m=>({startLineNumber:m.line,startColumn:m.column,endLineNumber:m.line,endColumn:m.column+1,message:m.message,severity:m.severity==='error'?this.monaco.MarkerSeverity.Error:this.monaco.MarkerSeverity.Warning})));}
  find(){if(this.instance)this.instance.trigger('forge','actions.find');else{const term=window.prompt('Tìm trong file');if(!term)return;let at=this.text.value.indexOf(term,this.text.selectionEnd);if(at<0)at=this.text.value.indexOf(term);if(at>=0){this.text.selectionStart=at;this.text.selectionEnd=at+term.length;this.focus();}}}
  applySettings(settings){this.settings=settings;if(this.instance){this.monaco.editor.setTheme(settings.theme==='light'?'vs':'forge-dark');this.instance.updateOptions({fontSize:settings.fontSize,tabSize:settings.tabSize,wordWrap:settings.wrap?'on':'off',minimap:{enabled:settings.minimap}});}else{this.fallback.style.setProperty('--code-size',settings.fontSize+'px');this.text.style.tabSize=settings.tabSize;this.pre.style.tabSize=settings.tabSize;} }
  focus(){if(this.instance)this.instance.focus();else this.text.focus();}
}
