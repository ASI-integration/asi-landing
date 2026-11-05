// Exact atomic JSON contract formerly imported from the Strigunov prototype.
// Single-file atomicity only, with file + parent-directory fsync. No ledger reset.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export async function atomicWriteJson(filename,value){
  const parent=path.dirname(filename);
  const temp=filename+'.'+randomUUID()+'.tmp';
  let fd,created=false;
  try{
    fd=await fs.open(temp,'wx',0o600);created=true;
    await fd.writeFile(JSON.stringify(value,null,2)+'\n','utf8');
    await fd.sync();await fd.close();fd=null;
    await fs.rename(temp,filename);created=false;
    // A directory-fsync failure remains an UNKNOWN write outcome, never retried.
    let d;
    try{d=await fs.open(parent,'r');await d.sync();}
    finally{if(d)await d.close();}
  }catch(e){
    if(fd)await fd.close().catch(()=>{});
    if(created)await fs.unlink(temp).catch(()=>{});
    throw e;
  }
}
