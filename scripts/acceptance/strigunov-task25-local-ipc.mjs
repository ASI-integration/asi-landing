// Task25 test-only Unix domain socket adapter. No cloud, no public TCP,
// no operator credentials, no independent owner service, no guest sending.
import {createServer,createConnection} from 'node:net';
import {chmodSync,existsSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {observeTask25,recordTask25} from './strigunov-task25-local-ledger.mjs';
const MAX=1500;
const denied=(why)=>JSON.stringify({
 status:'HOLD',reason:why,scope:'DISPOSABLE_TEST_FIXTURE_ONLY',
 authorized:false,canSend:false,canIssueReceipt:false
})+'\n';
const result=x=>JSON.stringify({
 status:x.status,reason:x.reason,scope:'DISPOSABLE_TEST_FIXTURE_ONLY',
 authorized:false,canSend:false,canIssueReceipt:false
})+'\n';
export async function startTask25FixtureIpc(root){
 if(process.platform!=='linux')throw Error('LINUX_FIXTURE_ONLY');
 if(observeTask25(root).status!=='READBACK')throw Error('FIXTURE_NOT_READY');
 const socketPath=join(root,'broker-test.sock');
 if(existsSync(socketPath))throw Error('SOCKET_NOT_FRESH');
 const server=createServer({allowHalfOpen:true},socket=>{
  let bytes=Buffer.alloc(0),handled=false;
  socket.setTimeout(3000,()=>{if(!handled){handled=true;socket.end(denied('IPC_TIMEOUT'));}});
  socket.on('error',()=>{});
  socket.on('data',chunk=>{
   if(handled)return;
   bytes=Buffer.concat([bytes,chunk]);
   if(bytes.length>MAX){handled=true;socket.end(denied('IPC_SIZE'));return;}
   const end=bytes.indexOf(10);
   if(end!==-1&&end!==bytes.length-1){
    handled=true;socket.end(denied('IPC_MULTIPLE_OR_TRAILING'));
   }
  });
  // Wait for peer half-close. A complete first data event is NOT proof the
  // peer cannot append another frame in a later data event.
  socket.on('end',()=>{
   if(handled)return;
   handled=true;
   const end=bytes.indexOf(10);
   if(end===-1){socket.end(denied('IPC_NO_FRAME'));return;}
   if(end!==bytes.length-1){socket.end(denied('IPC_MULTIPLE_OR_TRAILING'));return;}
   const raw=bytes.subarray(0,end).toString('utf8');
   const reply=recordTask25(root,raw);
   socket.end(result(reply));
  });
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(socketPath,()=>{
   server.removeListener('error',reject);
   resolve();
  });
 });
 chmodSync(socketPath,0o600);
 return Object.freeze({
  path:socketPath,
  mode:'SYNTHETIC_UNAUTHENTICATED_LOCAL_SOCKET',
  authorized:false,canSend:false,
  close:async()=>{
   await new Promise(resolve=>server.close(()=>resolve()));
   // Delete ONLY the exact task-owned local socket, not arbitrary paths.
   if(existsSync(socketPath)&&lstatSync(socketPath).isSocket())unlinkSync(socketPath);
  }
 });
}
export function sendTask25FixtureRequest(socketPath,raw){
 return new Promise((resolve,reject)=>{
  const socket=createConnection(socketPath);
  let bytes=Buffer.alloc(0);
  socket.setTimeout(3000,()=>{socket.destroy();reject(Error('IPC_CLIENT_TIMEOUT'));});
  socket.on('connect',()=>socket.end(raw+'\n'));
  socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);});
  socket.on('end',()=>{
   try{resolve(JSON.parse(bytes.toString('utf8').trim()));}
   catch{reject(Error('IPC_REPLY_UNREADABLE'));}
  });
  socket.on('error',reject);
 });
}
