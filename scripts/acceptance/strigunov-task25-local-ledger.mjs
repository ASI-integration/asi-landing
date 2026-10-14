// Task25 - REAL fsync-backed, single-writer disposable LOCAL fixture.
// This is NOT an independent custodian, authenticated issuer, or production ledger.
// Every result explicitly forbids permission, receipt, deployment and guest sending.
import {
  constants,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,
  readFileSync,readSync,realpathSync,readdirSync,renameSync,rmdirSync,
  statSync,unlinkSync,writeSync,writeFileSync
} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
const BASE='9bc8175aa772e92366c7a2363e26900a042fc3ce';
const RUN=/^strig-t25-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const RID=/^[a-f0-9]{32}$/;
const ACTIONS=Object.freeze([
 'inspect-owned-host','verify-immutable-release','read-technical-phase1',
 'verify-operator-revocation','readonly-reconcile','stop-owned-lab'
]);
const ZERO='0'.repeat(64);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fields=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const stop=reason=>{throw Object.assign(new Error(reason),{code:reason});};
const safe=(status,reason,extra={})=>Object.freeze({
 status,reason,scope:'DISPOSABLE_TEST_FIXTURE_ONLY',
 authorized:false,canInstall:false,canIssueReceipt:false,
 canApprove:false,canSend:false,canRetryUnknownCommit:false,
 ...extra
});
const digest=x=>createHash('sha256').update(x).digest('hex');
export const TASK25_ACTIONS=ACTIONS;
export const TASK25_SOURCE_BASE=BASE;
// Restrict ALL disk writes to new task-owned paths in the OS temp directory.
export function createTask25Root(){
 const base=realpathSync(tmpdir());
 const root=join(base,'asi-task25-'+randomBytes(6).toString('hex'));
 mkdirSync(root,{mode:0o700});
 return root;
}
function checkRoot(root){
 if(typeof root!=='string'||!resolve(root)||!/^asi-task25-[a-f0-9]{12}$/.test(basename(root))||
  resolve(dirname(root))!==realpathSync(tmpdir())||
  !existsSync(root)||lstatSync(root).isSymbolicLink()||
  !lstatSync(root).isDirectory()||realpathSync(root)!==resolve(root))stop('FOREIGN_OR_UNSAFE_ROOT');
 if(process.platform!=='win32'&&(statSync(root).mode&0o077)!==0)stop('ROOT_ACCESS_TOO_BROAD');
 return root;
}
function fsyncDir(root){
 // POSIX directory fsync is required for the physical CI durability claim.
 // Windows does not reliably support it: Windows tests prove only local source behavior.
 if(process.platform==='win32')return;
 const fd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY);
 try{fsyncSync(fd);}finally{closeSync(fd);}
}
function putNew(file,text){
 const fd=openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
 try{const buf=Buffer.from(text,'utf8');if(writeSync(fd,buf)!==buf.length)stop('SHORT_WRITE');
   fsyncSync(fd);}finally{closeSync(fd);}
}
export function initializeTask25(root,{runId,manifestSha256,sourceSha=BASE}={}){
 checkRoot(root);
 if(!RUN.test(runId||'')||typeof runId!=='string'||
    typeof manifestSha256!=='string'||!HEX.test(manifestSha256)||
    sourceSha!==BASE)stop('INVALID_SCOPE');
 if(readdirSync(root).length!==0)stop('NOT_FRESH');
 const meta=JSON.stringify({schema:1,kind:'TASK25_SYNTHETIC_LEDGER',runId,
  sourceSha,manifestSha256,canSend:false})+'\n';
 putNew(join(root,'identity.json'),meta);
 putNew(join(root,'events.ndjson'),'');
 fsyncDir(root);
 return safe('INITIALIZED','TEST_ONLY');
}
function identity(root){
 checkRoot(root);
 const path=join(root,'identity.json');
 if(lstatSync(path).isSymbolicLink()||statSync(path).size>1024)stop('IDENTITY_TAMPERED');
 const raw=readFileSync(path,'utf8'),m=JSON.parse(raw);
 if(!fields(m,['schema','kind','runId','sourceSha','manifestSha256','canSend'])||
    m.schema!==1||m.kind!=='TASK25_SYNTHETIC_LEDGER'||
    typeof m.runId!=='string'||!RUN.test(m.runId)||
    m.sourceSha!==BASE||typeof m.manifestSha256!=='string'||!HEX.test(m.manifestSha256)||
    m.canSend!==false)stop('IDENTITY_INVALID');
 return m;
}
function readJournal(root,id){
 const file=join(root,'events.ndjson');
 if(lstatSync(file).isSymbolicLink())stop('JOURNAL_SYMLINK');
 const stat=statSync(file);
 if(!stat.isFile()||stat.size>16000)stop('JOURNAL_SIZE');
 const bytes=readFileSync(file,'utf8');
 if(bytes&&!bytes.endsWith('\n'))stop('TORN_TAIL');
 const lines=bytes?bytes.trimEnd().split('\n'):[];
 if(lines.length>ACTIONS.length)stop('EVENT_OVERFLOW');
 let prev=ZERO,state='OPEN';
 const ids=new Set();
 const events=[];
 for(const [i,line] of lines.entries()){
  let e;try{e=JSON.parse(line);}catch{stop('CORRUPT_EVENT');}
  const ks=['v','runId','manifestSha256','seq','requestId','command','observation','prevHash','hash'];
  if(!fields(e,ks)||e.v!==1||e.runId!==id.runId||
    e.manifestSha256!==id.manifestSha256||e.seq!==i+1||
    typeof e.requestId!=='string'||!RID.test(e.requestId)||ids.has(e.requestId)||
    e.command!==ACTIONS[i]||!['OBSERVED','COMMIT_UNCERTAIN','DENIED'].includes(e.observation)||
    e.prevHash!==prev||typeof e.hash!=='string'||!HEX.test(e.hash)||
    state!=='OPEN')stop('JOURNAL_CHAIN_INVALID');
  const {hash,...withoutHash}=e;
  if(digest(JSON.stringify(withoutHash))!==hash)stop('HASH_CHAIN_INVALID');
  ids.add(e.requestId);events.push(e);
  prev=e.hash;
  if(e.observation!=='OBSERVED')state='HOLD';
  else if(i===ACTIONS.length-1)state='CLOSED';
 }
 return {id,events,state,lastHash:prev};
}
export function observeTask25(root){
 try{
  const id=identity(root),s=readJournal(root,id);
  return safe('READBACK','PHYSICAL_FILE_OBSERVATION',{
   state:s.state,sequence:s.events.length,caseCount:s.events.length,
   lastHash:s.lastHash,processedIds:s.events.map(e=>e.requestId)
  });
 }catch(e){return safe('HOLD',e.code||'READBACK_FAILED',{state:'HOLD'});}
}
const REQUEST_FIELDS=['kind','runId','manifestSha256','sourceSha','seq','requestId',
 'command','observation'];
function parseRequest(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>1500)stop('REQUEST_SIZE');
 let x;try{x=JSON.parse(raw);}catch{stop('REQUEST_JSON');}
 if(!fields(x,REQUEST_FIELDS)||x.kind!=='TASK25_LOCAL_FIXTURE_V1'||
    typeof x.runId!=='string'||!RUN.test(x.runId)||
    typeof x.manifestSha256!=='string'||!HEX.test(x.manifestSha256)||
    x.sourceSha!==BASE||!Number.isSafeInteger(x.seq)||x.seq<1||
    x.seq>ACTIONS.length||typeof x.requestId!=='string'||!RID.test(x.requestId)||
    !ACTIONS.includes(x.command)||!['OBSERVED','COMMIT_UNCERTAIN','DENIED'].includes(x.observation))
  stop('REQUEST_SHAPE');
 return x;
}
export function recordTask25(root,raw){
 let locked=false,lock=join(root,'writer.lock');
 try{
  checkRoot(root);
  const req=parseRequest(raw);
  // Atomic OS mkdir gives exactly one writer lock. A crash leaves HOLD until
  // independent manual investigation; NEVER auto-steal a stale lock by PID/TTL.
  try{mkdirSync(lock,{mode:0o700});locked=true;}catch{return safe('HOLD','WRITER_LOCKED');}
  fsyncDir(root);
  const id=identity(root),s=readJournal(root,id);
  if(req.runId!==id.runId||req.manifestSha256!==id.manifestSha256)
    return safe('HOLD','RUN_BINDING');
  if(s.state!=='OPEN')return safe('HOLD',s.state==='HOLD'?'UNKNOWN_OUTCOME_HOLD':'CLOSED');
  if(req.seq!==s.events.length+1||s.events.some(x=>x.requestId===req.requestId))
    return safe('HOLD','REPLAY_OR_GAP');
  if(req.command!==ACTIONS[s.events.length])return safe('HOLD','COMMAND_NOT_ALLOWED');
  const event={v:1,runId:id.runId,manifestSha256:id.manifestSha256,
   seq:req.seq,requestId:req.requestId,command:req.command,
   observation:req.observation,prevHash:s.lastHash};
  const line=JSON.stringify({...event,hash:digest(JSON.stringify(event))})+'\n';
  const flags=constants.O_WRONLY|constants.O_APPEND|(constants.O_NOFOLLOW||0);
  const fd=openSync(join(root,'events.ndjson'),flags);
  try{
   const b=Buffer.from(line);if(writeSync(fd,b)!==b.length)stop('SHORT_APPEND');
   fsyncSync(fd);
  }finally{closeSync(fd);}
  return safe(req.observation==='OBSERVED'?'RECORDED_LOCAL_ONLY':'HOLD',
   req.observation==='OBSERVED'?'FSYNC_COMPLETE_NO_AUTHORITY':'UNKNOWN_OUTCOME_NO_RETRY',
   {sequence:req.seq,state:req.observation==='OBSERVED'?'OPEN_OR_CLOSED':'HOLD'});
 }catch(e){return safe('HOLD',e.code||'IO_OR_SCOPE_FAILURE');}
 finally{
  if(locked){
   // Never recursively remove unknown content or a substituted lock.
   try{
    if(readdirSync(lock).length===0){rmdirSync(lock);fsyncDir(root);}
   }catch{/* retain a lock -> future attempts HOLD, not a bypass */}
  }
 }
}
export function inspectTask25Lock(root){
 try{checkRoot(root);return safe(existsSync(join(root,'writer.lock'))?'HOLD':'UNLOCKED',
  existsSync(join(root,'writer.lock'))?'MANUAL_OWNER_REVIEW':'NO_LOCK');
 }catch(e){return safe('HOLD',e.code||'UNKNOWN');}
}
