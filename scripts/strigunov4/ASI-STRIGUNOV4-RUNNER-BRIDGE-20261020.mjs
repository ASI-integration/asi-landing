// Strigunov 4 — source-only, read-only runner integration seam.
// Deliberately no execution path until a real SHA-bound authorizer/dispatcher,
// state reconciliation, and independent publication verifier are reviewed.
import {createOrchestrator} from './ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
import {verifyRelease} from './ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';

const DEFAULT_INTERVAL_MS = 180_000;
const SHA = /^[a-f0-9]{40}$/;
function must(ok,reason){if(!ok)throw Error(reason);}

// Unlike the historic runner's S4-G1 guard, this validates the *current*
// first unaccepted stage; it never treats a later stage as owner-accepted.
export function selectRoute(contract,issue){
  const index=verifyRelease(contract);
  if(index===6)return {stage:null,issue:null,mode:'WAIT_FINAL_OWNER_ACCEPTANCE'};
  const stage=`S4-G${index+1}`,number=511+index;
  must(issue?.number===number && issue.state==='open' &&
       typeof issue.title==='string' && issue.title.startsWith(`[${stage}]`),
       'ACTIVE_ISSUE_NOT_VERIFIED');
  return {stage,issue:number,mode:'ACTIVE'};
}

// Single-flight scheduler: every 30s runner tick can call this safely;
// read-only orchestration occurs no faster than the retained 180s cadence.
// No ability to change execute from false is exposed in this bridge.
export function createReadOnlyRunnerBridge({stateDir,fetchSnapshot,clock=()=>Date.now(),
  intervalMs=DEFAULT_INTERVAL_MS}={}){
  must(typeof fetchSnapshot==='function','LIVE_SNAPSHOT_READER_REQUIRED');
  must(typeof clock==='function'&&Number.isSafeInteger(intervalMs)&&intervalMs>=180_000,
    'INVALID_POLL_INTERVAL');
  const orchestrator=createOrchestrator({
    stateDir,fetchSnapshot,
    authorize:async()=>({approved:false}),
    dispatch:async()=>{throw Error('DISPATCH_NOT_AUTHORIZED');},
    verifyPublication:async()=>false
  });
  let lastAt=null,previous=null,inFlight=null;
  return {
    async poll(){
      if(inFlight)return inFlight;
      let now;
      try{now=clock();}catch{return {mode:'WAIT_RECONCILIATION',reason:'CLOCK_INVALID'};}
      if(!Number.isFinite(now))return {mode:'WAIT_RECONCILIATION',reason:'CLOCK_INVALID'};
      if(lastAt!==null&&now>=lastAt&&now-lastAt<intervalMs)return previous;
      // If wall-clock moves backwards, fail closed until human reconciliation.
      if(lastAt!==null&&now<lastAt)return {mode:'WAIT',reason:'CLOCK_MOVED_BACKWARDS'};
      inFlight=(async()=>{
        try{
          const result=await orchestrator.iteration({execute:false});
          previous={mode:result.mode,reason:result.reason??null,
            stage:result.stage??null,job:result.job??null};
        }catch(e){
          previous={mode:'WAIT_RECONCILIATION',reason:'READ_ONLY_BRIDGE_ERROR'};
        }finally{
          lastAt=now;
          try{
            const finalNow=clock();
            if(Number.isFinite(finalNow)&&finalNow>=now)lastAt=finalNow;
            else previous={mode:'WAIT_RECONCILIATION',reason:'CLOCK_INVALID'};
          }catch{previous={mode:'WAIT_RECONCILIATION',reason:'CLOCK_INVALID'};}
          finally{inFlight=null;}
        }
        return previous;
      })();
      return inFlight;
    },
    // Explicitly expose no execute method; a later reviewed capability-checked
    // executor adapter must be a separate change.
    status(){return previous??{mode:'WAIT',reason:'FIRST_POLL_NOT_COMPLETED'};}
  };
}


// Explicit isolated acceptance seam; the observing bridge above remains read-only.
export {createIsolatedAcceptanceLoop} from './execution-adapters/isolated-loop.mjs';
