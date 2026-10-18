// ZIP không nén khi xuất: không cần thư viện CDN. Nhập hỗ trợ STORE/DEFLATE.
import {encoder,decoder,normalizePath} from './core.js';
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const x of bytes)c=table[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function header(size){const bytes=new Uint8Array(size);return {bytes,v:new DataView(bytes.buffer)};}
export function makeZip(entries){
  const local=[],central=[];let offset=0;
  for(const e of entries){
    const name=encoder.encode(normalizePath(e.path));const bytes=e.bytes instanceof Uint8Array?e.bytes:encoder.encode(e.bytes);const crc=crc32(bytes);
    const a=header(30+name.length);a.v.setUint32(0,0x04034b50,true);a.v.setUint16(4,20,true);a.v.setUint16(6,0x800,true);a.v.setUint32(14,crc,true);a.v.setUint32(18,bytes.length,true);a.v.setUint32(22,bytes.length,true);a.v.setUint16(26,name.length,true);a.bytes.set(name,30);
    local.push(a.bytes,bytes);
    const b=header(46+name.length);b.v.setUint32(0,0x02014b50,true);b.v.setUint16(4,20,true);b.v.setUint16(6,20,true);b.v.setUint16(8,0x800,true);b.v.setUint32(16,crc,true);b.v.setUint32(20,bytes.length,true);b.v.setUint32(24,bytes.length,true);b.v.setUint16(28,name.length,true);b.v.setUint32(42,offset,true);b.bytes.set(name,46);central.push(b.bytes);offset+=a.bytes.length+bytes.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0);const end=header(22);end.v.setUint32(0,0x06054b50,true);end.v.setUint16(8,entries.length,true);end.v.setUint16(10,entries.length,true);end.v.setUint32(12,centralSize,true);end.v.setUint32(16,offset,true);
  return new Blob([...local,...central,end.bytes],{type:'application/zip'});
}
export async function readZip(buffer,{maxBytes=80*1024*1024,maxFiles=2500}={}){
  const bytes=new Uint8Array(buffer);const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<22)throw new Error('ZIP bị thiếu dữ liệu.');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0)throw new Error('Không tìm thấy bảng file ZIP.');
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true))throw new Error('ZIP nhiều phần chưa hỗ trợ.');
  const count=v.getUint16(end+10,true);let cursor=v.getUint32(end+16,true),total=0;const files=[];
  if(count>maxFiles)throw new Error('ZIP có quá nhiều file.');
  for(let i=0;i<count;i++){
    if(cursor+46>end||v.getUint32(cursor,true)!==0x02014b50)throw new Error('Bảng file ZIP hỏng.');
    const flags=v.getUint16(cursor+8,true),method=v.getUint16(cursor+10,true),crc=v.getUint32(cursor+16,true),compressed=v.getUint32(cursor+20,true),size=v.getUint32(cursor+24,true),nl=v.getUint16(cursor+28,true),el=v.getUint16(cursor+30,true),cl=v.getUint16(cursor+32,true),lo=v.getUint32(cursor+42,true);
    if(cursor+46+nl+el+cl>end)throw new Error('ZIP hỏng.');
    const raw=decoder.decode(bytes.subarray(cursor+46,cursor+46+nl));cursor+=46+nl+el+cl;
    if(raw.endsWith('/')){normalizePath(raw.slice(0,-1));continue;}
    const path=normalizePath(raw);
    if(flags&1)throw new Error('ZIP có mật khẩu chưa hỗ trợ.');
    if(size>25*1024*1024||(total+=size)>maxBytes)throw new Error('ZIP vượt giới hạn kích thước.');
    if(lo+30>bytes.length||v.getUint32(lo,true)!==0x04034b50)throw new Error('Header file ZIP hỏng.');
    const start=lo+30+v.getUint16(lo+26,true)+v.getUint16(lo+28,true);
    if(start+compressed>end)throw new Error('File ZIP bị cắt ngắn.');
    let data=bytes.slice(start,start+compressed);
    if(method===8){
      if(!globalThis.DecompressionStream)throw new Error('Trình duyệt chưa hỗ trợ giải nén. Dùng Chrome/Edge/Firefox mới hoặc nhập thư mục.');
      const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const chunks=[];let n=0;
      try{for(;;){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>size||n>maxBytes)throw new Error('File giải nén vượt kích thước khai báo.');chunks.push(value);}}catch(e){await reader.cancel();throw e;}
      data=new Uint8Array(n);let pos=0;for(const c of chunks){data.set(c,pos);pos+=c.length;}
    }else if(method!==0)throw new Error(`Phương thức nén ${method} chưa hỗ trợ.`);
    if(data.length!==size||crc32(data)!==crc)throw new Error(`Kiểm tra CRC thất bại: ${path}`);
    if(files.some(f=>f.path===path))throw new Error(`Tên file ZIP trùng: ${path}`);
    files.push({path,bytes:data});
  }
  return files;
}
