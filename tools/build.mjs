import {mkdir,rm,cp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));const dest=path.join(root,'dist');
await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});
for(const name of ['index.html','styles.css','manifest.webmanifest','sw.js','assets','src','README.md','LICENSE','THIRD_PARTY_NOTICES.md'])await cp(path.join(root,name),path.join(dest,name),{recursive:true});
try{await cp(path.join(root,'vendor'),path.join(dest,'vendor'),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(path.join(dest,'.nojekyll'),'');console.log('Static site ready: dist/');
