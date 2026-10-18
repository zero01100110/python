import {CONFIG} from './config.js';
export class BrowserKernel {
  constructor(onEvent,onState){this.onEvent=onEvent;this.onState=onState;this.worker=null;this.pending=new Map();this.serial=0;this.ready=null;this.kind='browser';this.catalog={};this.installed={};}
  request(action,args={},timeout=120000){
    if(!this.worker)return Promise.reject(new Error('Kernel chưa khởi động.'));
    const id=++this.serial;return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.reset('Đã hết thời gian. Kernel được dừng để tránh treo.');},timeout);
      this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,action,args});
    });
  }
  async ensure(){
    if(this.ready)return this.ready;
    this.onState('loading');
    this.worker=new Worker(new URL('./kernel.worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{
      if(data.type==='event'){this.onEvent(data.event);return;}
      const waiter=this.pending.get(data.id);if(!waiter)return;clearTimeout(waiter.timer);this.pending.delete(data.id);
      if(data.error)waiter.reject(new Error(data.error));else waiter.resolve(data.result);
    };
    this.worker.onerror=e=>this.reset('Lỗi tải kernel. Kiểm tra Internet và CDN Pyodide. '+e.message);
    const base=new URL(CONFIG.indexURL,new URL('../',import.meta.url)).href.replace(/\/?$/,'/');
    this.ready=this.request('init',{indexURL:base},180000).then(info=>{this.catalog=info.catalog;this.installed=info.installed;this.version=info.version;this.onState('ready');return info;}).catch(e=>{this.reset(e.message);throw e;});
    return this.ready;
  }
  reset(reason='Đã dừng kernel; biến trong RAM được xóa.'){
    this.worker?.terminate();this.worker=null;this.ready=null;this.installed={};
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}this.pending.clear();this.onState('stopped');
  }
  async run(args,timeout){await this.ensure();const result=await this.request('run',args,timeout);this.installed=result.installed;return result;}
  async interrupt(){this.reset();}
  async install(requirements){await this.ensure();this.installed=await this.request('install',{requirements},300000);return this.installed;}
  async data(args){await this.ensure();const result=await this.request('data',args,120000);this.installed=result.installed;return result;}
  async validate(code,filename){if(!this.ready||!this.worker)return [];return this.request('validate',{code,filename},10000);}
  async format(code){await this.ensure();return this.request('format',{code},180000);}
  async lint(code,filename){await this.ensure();return this.request('lint',{code,filename},180000);}
  async complete(code,line,column,path){if(!this.ready||!this.worker)return [];return this.request('complete',{code,line,column,path},10000);}
}
