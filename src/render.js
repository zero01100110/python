import {escapeHTML,sourceOf} from './core.js';
const E=escapeHTML;
export function tableHTML(data){
  const cols=data.columns||[],rows=data.rows||[];
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>${E(data.indexName||'#')}</th>${cols.map(c=>`<th>${E(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row,i)=>`<tr><td class="row-number">${E(data.index?.[i]??i+1)}</td>${row.map(value=>`<td title="${E(value===null?'None':typeof value==='object'?JSON.stringify(value):value)}">${E(value===null?'None':typeof value==='object'?JSON.stringify(value):value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function markdown(text){
  // Chủ động không thực thi HTML trong Markdown của project.
  const parts=text.split(/```([^\n]*)\n([\s\S]*?)```/g);let out='';
  for(let i=0;i<parts.length;i+=3){
    out+=parts[i].split('\n').map(line=>{const heading=line.match(/^(#{1,6})\s+(.*)$/);let safe=E(heading?heading[2]:line).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');if(heading)return `<h${heading[1].length}>${safe}</h${heading[1].length}>`;if(line.startsWith('> '))return `<blockquote>${E(line.slice(2))}</blockquote>`;if(/^[-*] /.test(line))return `<p>• ${E(line.slice(2))}</p>`;return line?`<p>${safe}</p>`:'';}).join('');
    if(parts[i+2]!==undefined)out+=`<pre><code>${E(parts[i+2])}</code></pre>`;
  }return `<div class="markdown-preview">${out}</div>`;
}
export function renderRich(event,container,{download}={}){
  const card=document.createElement('div');card.className='output-card';
  const table=event.kind==='table'?event:event.data?.['application/vnd.pyforge.table+json'];
  const png=event.kind==='image'?event.data:event.data?.['image/png'];const svg=event.data?.['image/svg+xml'];
  const html=event.data?.['text/html'];const text=event.text||event.data?.['text/plain'];
  const title=table?`Table · ${table.totalRows??table.rows.length}${table.hasMore?'+':''} rows × ${table.totalColumns??table.columns.length} columns`:png||svg?'Figure':'Python output';
  card.innerHTML=`<div class="output-header"><span>${E(title)}</span><button class="small-button" title="Tải kết quả">↓ Export</button></div>`;
  let blob,filename;
  if(table){card.insertAdjacentHTML('beforeend',tableHTML(table));const csv=[table.columns,...table.rows].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n');blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});filename='output.csv';}
  else if(png||svg){const box=document.createElement('div');box.className='output-image';const img=document.createElement('img');img.alt='Python figure';img.src=png?'data:image/png;base64,'+png:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(Array.isArray(svg)?svg.join(''):svg);box.append(img);card.append(box);if(png){blob=fetch(img.src).then(r=>r.blob());filename='figure.png';}else{blob=new Blob([svg],{type:'image/svg+xml'});filename='figure.svg';}}
  else if(html){const frame=document.createElement('iframe');frame.setAttribute('sandbox','');frame.style.cssText='width:100%;height:240px;border:0;background:white';frame.title='Python HTML output';const content=Array.isArray(html)?html.join(''):html;frame.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'"><style>body{font:13px system-ui;padding:10px;overflow:auto}table{border-collapse:collapse}th,td{padding:6px 10px;border:1px solid #ddd}</style>`+content;card.append(frame);blob=new Blob([content],{type:'text/html'});filename='output.html';}
  else{const pre=document.createElement('pre');pre.textContent=Array.isArray(text)?text.join(''):text||JSON.stringify(event.data,null,2);card.append(pre);blob=new Blob([pre.textContent],{type:'text/plain'});filename='output.txt';}
  card.querySelector('button').onclick=async()=>download?.(await blob,filename);container.append(card);return card;
}
export function renderNotebookOutput(output,container,options){
  if(output.output_type==='stream'||output.output_type==='error'){
    const pre=document.createElement('pre');pre.className=output.output_type==='error'||output.name==='stderr'?'error':'';
    pre.textContent=output.output_type==='error'?(output.traceback||[output.evalue]).join('\n'):Array.isArray(output.text)?output.text.join(''):output.text;container.append(pre);
  }else renderRich({kind:'rich',data:output.data||{}},container,options);
}
export function variableHTML(variables){
  return variables.length?`<table class="data-table"><thead><tr><th>Name</th><th>Type</th><th>Shape</th><th>Value</th></tr></thead><tbody>${variables.map(v=>`<tr><td>${E(v.name)}</td><td>${E(v.type)}</td><td>${E(v.shape||'')}</td><td>${E(v.value)}</td></tr>`).join('')}</tbody></table>`:'<div class="panel-empty">Chưa có biến trong namespace hiện tại.</div>';
}
