// Imported only by the existing runner hook. No timer, second daemon or import I/O.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadHostAuthority,ENGINE_ROOT,LEGACY_STATE} from './host-authority.mjs';
import {createAppTokenProvider} from './host-github-app.mjs';
import {createHostChecks} from './host-checks.mjs';
import {createGitHubReader} from './github-readonly.mjs';
import {createPublisherTransport} from './publisher-transport.mjs';
import {createPublicationLoop} from './publication-loop.mjs';
import {digest,must,regular} from './state.mjs';
import {selectRoute} from '../ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs';
import {WORK_ORDERS,ENGINE_PILOT} from '../ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
const exec=promisify(execFile),REPO='ASI-integration/asi-landing';

export function createHostSnapshot({reader,contract,readProjectGates,baseSha}){
  return async()=>{
    const main=await reader.get('branches/main');
    must(main.protected===true&&main.commit?.sha===baseSha,'MAIN_CHANGED');
    const issue=await reader.get('issues/511');
    must(issue.number===511&&issue.state==='open'&&Array.isArray(issue.labels),'ISSUE_UNVERIFIED');
    must(selectRoute(contract,issue).stage==='S4-G1','PILOT_STAGE_CLOSED');
    const project=await readProjectGates();
    must(project.source==='github-projects-v2'&&Date.now()-Date.parse(project.checkedAt)>=0&&
      Date.now()-Date.parse(project.checkedAt)<30000,'PROJECT_SNAPSHOT_STALE');
    const gate=project.items.filter(i=>i.issue===511&&i.stage==='S4-G1');must(gate.length===1,'PROJECT_CARD');
    const prs={};
    for(const ticket of WORK_ORDERS.filter(w=>w.kind==='review-pr')){
      const p=await reader.get('pulls/'+ticket.pr);
      must(p.number===ticket.pr&&p.head?.repo?.full_name===REPO&&p.base?.repo?.full_name===REPO&&p.base.ref==='main','DEPENDENCY_IDENTITY');
      prs[ticket.pr]={number:p.number,head:p.head.sha,state:p.state,merged:p.merged};
    }
    // Missing exact-head review evidence stays WAIT_CI, never fabricated PASS.
    // The pilot's prerequisite #509 is already merged and pinned in WORK_ORDERS.
    return {mainSha:baseSha,contract,issues:{511:{number:511,state:issue.state,
      labels:issue.labels.map(l=>l.name).sort()}},prs,checks:{},reviews:{},ledger:{},project:{511:gate[0].gate}};
  };
}

let active;
async function construct({readProjectGates}){
  const authority=await loadHostAuthority(),{payload,catalog}=authority;
  must(os.hostname()===payload.host,'HOST_NOT_ADMITTED');
  // A fresh, explicitly signed bounded stage catalog may contain several
  // already-approved product work orders. Native Publisher's single shared lock
  // and durable receipts still enforce one task at a time and prohibit replay.
  // No workflow rights, arbitrary paths, or unknown work orders are granted.
  for(const t of catalog){
    const work=[...WORK_ORDERS,ENGINE_PILOT].find(w=>w.id===t.workOrderId);
    must(work?.kind==='prepare-source'&&work.stage==='S4-G1'&&
      t.changes.every(c=>work.paths.includes(c.path)), 'SIGNED_WORK_ORDER_SCOPE');
  }
  const task=catalog[0];
  const runner='/home/project_ayfaar/asi-strigunov-agent/bin/runner.mjs';await regular(runner);
  must(digest(await fs.readFile(runner))===payload.runnerSha256,'RUNNER_NOT_ADMITTED');
  const seed=path.join(ENGINE_ROOT,'scratchpads',task.id);
  const {stdout}=await exec('/usr/bin/git',['-c','core.hooksPath=/dev/null','show',payload.baseSha+':docs/agent-os/releases/strigunov4-demo.json'],
    {cwd:seed,timeout:5000,maxBuffer:1000000,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  const contract=JSON.parse(stdout),app=createAppTokenProvider(payload.githubApp);
  const reader=createGitHubReader({token:app.token}),remote=createPublisherTransport({token:app.token});
  const checks=createHostChecks({root:ENGINE_ROOT,catalog,
    codexHome:'/home/project_ayfaar/asi-strigunov-agent/codex-home',reviewDirectory:path.join(ENGINE_ROOT,'review')});
  const fetchSnapshot=createHostSnapshot({reader,contract,readProjectGates,baseSha:payload.baseSha});
  const loop=await createPublicationLoop({root:ENGINE_ROOT,legacyStateDir:LEGACY_STATE,catalog,fetchSnapshot,
    reader,remote,authorize:authority.authorize,...checks,ciPolicies:payload.ciPolicies,
    liveAdmission:authority.admission,enginePilot:true,timeoutMs:30000});
  return {authority,loop};
}
export async function engineIteration(ports){
  // Rejected construction stays rejected until operator restart: no silent
  // fallback to the legacy publisher and no repeated authentication attempts.
  active??=construct(ports);
  try{const {authority,loop}=await active;await authority.revalidate();
    const r=await loop.poll({execute:true});
    return {event:'engine_tick',mode:r.mode,reason:r.reason??null,pr:r.pr??null,head:r.head??null};
  }catch{return {event:'engine_tick',mode:'BLOCKED',reason:'HOST_ACTIVATION_OR_PORT_UNVERIFIED'};}
}
