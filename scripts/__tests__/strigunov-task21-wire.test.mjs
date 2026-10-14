import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FrontendObserver,BackendFrames,CommitReplyFilter,inspectClientUnknown} from '../acceptance/strigunov-task21-wire.mjs';
const frame=(type,bytes)=>{const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);const z=Buffer.alloc(5+b.length);z[0]=type.charCodeAt(0);z.writeUInt32BE(4+b.length,1);b.copy(z,5);return z;};
const startup=()=>{const b=Buffer.alloc(8);b.writeUInt32BE(8,0);b.writeUInt32BE(196608,4);return b;};
const q=sql=>frame('Q',sql+'\0');
const backendAck=()=>[frame('C','COMMIT\0'),frame('Z',Buffer.from([73]))];
test('frontend detects one COMMIT across arbitrary packet boundaries',()=>{
 const o=new FrontendObserver();const packets=Buffer.concat([startup(),q('BEGIN'),q('COMMIT')]);
 const seen=[];for(const byte of packets)seen.push(...o.feed(Buffer.from([byte])));
 assert.equal(o.commitCount,1);assert.equal(o.queriesAfterCommit,0);
 assert.deepEqual(seen.map(x=>x.kind),['STARTUP','QUERY','COMMIT_SUBMITTED']);
});
test('frontend accepts case and whitespace of COMMIT',()=>{
 const o=new FrontendObserver();o.feed(Buffer.concat([startup(),q('  CoMmIt ;  ')]));
 assert.equal(o.commitCount,1);
});
test('frontend rejects a repeated SQL statement after COMMIT',()=>{
 const o=new FrontendObserver();o.feed(Buffer.concat([startup(),q('COMMIT')]));
 assert.throws(()=>o.feed(q('COMMIT')),/SQL_REPLAY/);
});
test('frontend rejects a new business mutation after COMMIT',()=>{
 const o=new FrontendObserver();o.feed(Buffer.concat([startup(),q('COMMIT')]));
 assert.throws(()=>o.feed(q('INSERT INTO task21_wire_events VALUES (1)')),/SQL_REPLAY/);
});
test('frontend rejects extended protocol after COMMIT',()=>{
 const o=new FrontendObserver();o.feed(Buffer.concat([startup(),q('COMMIT')]));
 assert.throws(()=>o.feed(frame('P','\0')),/AFTER_COMMIT_PROTOCOL/);
});
test('frontend rejects invalid startup version, SSL negotiation and bad lengths',()=>{
 const o=new FrontendObserver();const b=startup();b.writeUInt32BE(80877103,4);
 assert.throws(()=>o.feed(b),/STARTUP_PROTOCOL/);
 const v=new FrontendObserver();const bad=Buffer.alloc(8);bad.writeUInt32BE(0,0);
 assert.throws(()=>v.feed(bad),/STARTUP_LENGTH/);
});
test('frontend rejects unterminated query',()=>{
 const o=new FrontendObserver();o.feed(startup());
 assert.throws(()=>o.feed(frame('Q','COMMIT')),/QUERY_TERMINATOR/);
});
test('backend fully reassembles split COMMIT ACK and ReadyForQuery frames',()=>{
 const o=new BackendFrames(),all=[];for(const byte of Buffer.concat(backendAck()))all.push(...o.feed(Buffer.from([byte])));
 assert.equal(all.length,2);assert.equal(all[0].type,'C');assert.equal(all[1].type,'Z');
 assert.equal(all[0].payload.toString('utf8'),'COMMIT\0');
});
test('backend rejects tiny frames and huge lengths',()=>{
 let o=new BackendFrames();let b=Buffer.alloc(5);b[0]=67;b.writeUInt32BE(0,1);
 assert.throws(()=>o.feed(b),/BACKEND_LENGTH/);
 o=new BackendFrames();b.writeUInt32BE(0xffffffff,1);assert.throws(()=>o.feed(b),/BACKEND_LENGTH/);
});
test('reply gate passes startup traffic before submitted COMMIT',()=>{
 const f=new CommitReplyFilter();const p=new BackendFrames().feed(frame('Z',Buffer.from([73])))[0];
 assert.equal(f.inspect(p,false).forward,true);
});
test('reply gate drops server COMMIT tag and Z so client never gets ACK',()=>{
 const f=new CommitReplyFilter(),events=new BackendFrames().feed(Buffer.concat(backendAck()));
 const a=f.inspect(events[0],true),b=f.inspect(events[1],true);
 assert.equal(a.forward,false);assert.equal(a.finished,false);
 assert.equal(b.forward,false);assert.equal(b.finished,true);
 assert.equal(f.commandComplete,true);assert.equal(f.serverReady,true);assert.equal(f.forwardedCommitReply,false);
});
test('reply gate rejects ReadyForQuery without COMMIT completion',()=>{
 const f=new CommitReplyFilter(),p=new BackendFrames().feed(frame('Z',Buffer.from([73])))[0];
 assert.throws(()=>f.inspect(p,true),/COMMIT_READY/);
});
test('reply gate rejects malformed COMMIT tag',()=>{
 const f=new CommitReplyFilter(),p=new BackendFrames().feed(frame('C','INSERT 0 1\0'))[0];
 assert.throws(()=>f.inspect(p,true),/COMMIT_TAG/);
});
test('reply gate rejects duplicate COMMIT acknowledgements',()=>{
 const f=new CommitReplyFilter(),p=new BackendFrames().feed(frame('C','COMMIT\0'))[0];
 f.inspect(p,true);assert.throws(()=>f.inspect(p,true),/COMMIT_TAG/);
});
test('reply gate rejects unexpected server responses',()=>{
 const f=new CommitReplyFilter(),p=new BackendFrames().feed(frame('E','ERROR\0'))[0];
 assert.throws(()=>f.inspect(p,true),/COMMIT_UNEXPECTED_REPLY/);
});
test('reply gate rejects non-idle ReadyForQuery',()=>{
 const f=new CommitReplyFilter();let [a]=new BackendFrames().feed(frame('C','COMMIT\0'));
 f.inspect(a,true);const b=new BackendFrames().feed(frame('Z',Buffer.from([84])))[0];
 assert.throws(()=>f.inspect(b,true),/COMMIT_READY/);
});
const observed={commitCount:1,serverCommitTag:true,serverReady:true,ackForwarded:false,clientObservedSuccess:false};
test('unknown outcome starts HOLD, retry forbidden before readback',()=>{
 const r=inspectClientUnknown(observed,null);
 assert.equal(r.status,'HOLD');assert.equal(r.canRetry,false);assert.equal(r.canSend,false);
});
test('after genuine read-only persisted-one proof result is technical only',()=>{
 const r=inspectClientUnknown(observed,1);
 assert.equal(r.status,'TECHNICAL_WIRE_RECONCILED');
 assert.equal(r.initial,'HOLD');assert.equal(r.persisted,'EXACTLY_ONE');
 assert.equal(r.canRetry,false);assert.equal(r.canSend,false);assert.equal(r.canApprove,false);
});
for(const [name,ob] of [
 ['repeated COMMIT',{...observed,commitCount:2}],
 ['no COMMIT',{...observed,commitCount:0}],
 ['missing server COMMIT tag',{...observed,serverCommitTag:false}],
 ['server no ReadyForQuery',{...observed,serverReady:false}],
 ['ACK accidentally forwarded',{...observed,ackForwarded:true}],
 ['client observed success',{...observed,clientObservedSuccess:true}],
 ['no evidence',null]
])test('cannot reconcile '+name,()=>{
 assert.equal(inspectClientUnknown(ob,1).status,'HOLD');
});
test('readback missing or duplicated remains HOLD',()=>{
 for(const count of [0,2,-1,'1',NaN])assert.equal(inspectClientUnknown(observed,count).status,'HOLD');
});
test('manual workflow must never run on push or receive production credentials',()=>{
 const wf=readFileSync('.github/workflows/strigunov-task21-pg-wire-manual.yml','utf8');
 assert.match(wf,/workflow_dispatch:/);
 assert.doesNotMatch(wf,/^  (push|pull_request|schedule|workflow_run|workflow_call):/m);
 assert.match(wf,/contents: read/);
 assert.match(wf,/persist-credentials: false/);
 assert.match(wf,/GITHUB_ACTOR_ID/);
 assert.match(wf,/GITHUB_RUN_ATTEMPT/);
 assert.doesNotMatch(wf,/environment:|secrets\.|self-hosted/);
});
test('wire lab has exact source checks, owned cleanup, no live sends',()=>{
 const lab=readFileSync('scripts/acceptance/strigunov-task21-wire-lab.mjs','utf8');
 assert.match(lab,/SOURCE_BYTES/);assert.match(lab,/sourcePreflight\(process.env\)/);
 assert.match(lab,/FRONTEND|FrontendObserver/);
 assert.match(lab,/serverCommitTag:filter.commandComplete/);
 assert.match(lab,/cleanup\(expected\)/);
 assert.match(lab,/canSend:false/);
 assert.doesNotMatch(lab,/https?:\/\/|sendGuest|sendTelegram|guestEmail|productionDb/);
});

test('early proxy rejection is handled before the later wire-evidence await',()=>{
 const lab=readFileSync('scripts/acceptance/strigunov-task21-wire-lab.mjs','utf8');
 const created=lab.indexOf('const evidence=new Promise(');
 const handler=lab.indexOf('evidence.catch(()=>{})');
 const later=lab.indexOf('withDeadline(proxy.evidence,');
 assert.ok(created>=0 && handler>created && later>handler);
 assert.match(lab,/clients=clients\.filter\(c=>c!==abortClient\)/);
});
