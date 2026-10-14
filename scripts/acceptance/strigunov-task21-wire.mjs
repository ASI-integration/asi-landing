// Task21: byte-framed PostgreSQL wire observers for a disposable synthetic lab.
// No I/O, client credentials, database calls, or authority issuance in this module.
const MAX_FRAME=16*1024*1024;
const requireFrame=(n,min)=>Number.isSafeInteger(n)&&n>=min&&n<=MAX_FRAME;
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
export class FrontendObserver {
 constructor(){this.buffer=Buffer.alloc(0);this.startup=true;this.commitCount=0;this.queriesAfterCommit=0;}
 feed(bytes){
  if(!Buffer.isBuffer(bytes))fail('FRONTEND_BYTES');
  this.buffer=Buffer.concat([this.buffer,bytes]);
  const observed=[];
  while(true){
   if(this.startup){
    if(this.buffer.length<4)break;
    const n=this.buffer.readUInt32BE(0);
    if(!requireFrame(n,8)||n>8192)fail('STARTUP_LENGTH');
    if(this.buffer.length<n)break;
    const request=this.buffer.subarray(4,n).readUInt32BE(0);
    if(request!==196608)fail('STARTUP_PROTOCOL'); // PostgreSQL v3; TLS/SSL negotiation forbidden here
    this.buffer=this.buffer.subarray(n);this.startup=false;
    observed.push({kind:'STARTUP'});continue;
   }
   if(this.buffer.length<5)break;
   const n=this.buffer.readUInt32BE(1);
   if(!requireFrame(n,4))fail('FRONTEND_LENGTH');
   if(this.buffer.length<1+n)break;
   const typ=String.fromCharCode(this.buffer[0]);
   const payload=this.buffer.subarray(5,1+n);
   if(typ==='Q'){
    if(payload.length<1||payload[payload.length-1]!==0)fail('QUERY_TERMINATOR');
    const sql=payload.subarray(0,-1).toString('utf8');
    if(this.commitCount>0)this.queriesAfterCommit++;
    if(/^COMMIT\s*;?$/i.test(sql.trim())){this.commitCount++;observed.push({kind:'COMMIT_SUBMITTED'});}
    else observed.push({kind:'QUERY'});
    if(this.commitCount>1||this.queriesAfterCommit>0)fail('SQL_REPLAY');
   }else if(typ==='P'||typ==='B'||typ==='E'||typ==='S'){
    if(this.commitCount>0)fail('AFTER_COMMIT_PROTOCOL');
   }
   this.buffer=this.buffer.subarray(1+n);
  }
  return observed;
 }
}
export class BackendFrames {
 constructor(){this.buffer=Buffer.alloc(0);}
 feed(bytes){
  if(!Buffer.isBuffer(bytes))fail('BACKEND_BYTES');
  this.buffer=Buffer.concat([this.buffer,bytes]);const frames=[];
  while(this.buffer.length>=5){
   const len=this.buffer.readUInt32BE(1);
   if(!requireFrame(len,4))fail('BACKEND_LENGTH');
   if(this.buffer.length<1+len)break;
   const raw=Buffer.from(this.buffer.subarray(0,1+len));
   frames.push({type:String.fromCharCode(raw[0]),payload:raw.subarray(5),raw});
   this.buffer=this.buffer.subarray(1+len);
  }
  return frames;
 }
}
export class CommitReplyFilter {
 constructor(){this.commandComplete=false;this.serverReady=false;this.forwardedCommitReply=false;}
 inspect(frame,commitSubmitted){
  if(!commitSubmitted)return {forward:true,finished:false};
  // ALL backend frames after COMMIT are suppressed; no COMMIT ACK may reach client.
  if(frame.type==='C'){
   if(this.commandComplete||frame.payload.toString('utf8')!=='COMMIT\0')fail('COMMIT_TAG');
   this.commandComplete=true;
   return {forward:false,finished:false};
  }
  if(frame.type==='Z'){
   if(!this.commandComplete||frame.payload.length!==1||frame.payload[0]!==73)fail('COMMIT_READY');
   this.serverReady=true;
   return {forward:false,finished:true};
  }
  fail('COMMIT_UNEXPECTED_REPLY');
 }
}
export const inspectClientUnknown=(observation,readback)=>{
 if(!observation||observation.commitCount!==1||observation.ackForwarded!==false||
    observation.serverCommitTag!==true||observation.serverReady!==true||
    observation.clientObservedSuccess!==false)
  return Object.freeze({status:'HOLD',persisted:'UNVERIFIED',canRetry:false,canSend:false});
 if(readback!==1)
  return Object.freeze({status:'HOLD',persisted:'NOT_EXACTLY_ONE',canRetry:false,canSend:false});
 return Object.freeze({status:'TECHNICAL_WIRE_RECONCILED',initial:'HOLD',
  persisted:'EXACTLY_ONE',canRetry:false,canApprove:false,canSend:false});
};
