// Task17 pure validation: no IO and no authority granted by these values.
export const IMAGE='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
export const CONFIRM='SYNTHETIC_PG17_ONLY_NO_GUEST_SEND';
export const DATABASE='strigunov_task11_isolated_lab';
export const DOMAINS=['booking','physical','cleaning','policy','legal','checkout'];
export const ORDER=['docs/ops/strigunov-task12-fixture.sql','docs/ops/strigunov-task08-private-schema-DRAFT.sql','docs/ops/strigunov-task11-canonical-fences-DRAFT.sql','docs/ops/strigunov-task13-bootstrap.sql'];
export const fail=code=>{throw Object.assign(Error(code),{code});};
export function admission(e,platform){
 ownerGate(e);
 if(platform!=='linux'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_ENVIRONMENT!=='github-hosted'||e.RUNNER_OS!=='Linux')fail('PROVIDER');
 if(e.GITHUB_REPOSITORY!=='ASI-integration/asi-landing'||e.GITHUB_EVENT_NAME!=='workflow_dispatch'||e.GITHUB_REF!=='refs/heads/main')fail('EVENT');
 if(e.CONFIRM!==CONFIRM)fail('CONFIRM');
 if(!/^[a-f0-9]{40}$/.test(e.REVIEWED_SHA||'')||e.REVIEWED_SHA!==e.GITHUB_SHA||e.REVIEWED_SHA!==e.GITHUB_WORKFLOW_SHA)fail('SHA');
 if(e.PG_IMAGE!==IMAGE)fail('IMAGE');
 if(!/^[1-9][0-9]*$/.test(e.GITHUB_RUN_ID||'')||!/^[1-9][0-9]*$/.test(e.GITHUB_RUN_ATTEMPT||''))fail('RUN');
 return 'strig-t17-'+e.GITHUB_RUN_ID+'-'+e.GITHUB_RUN_ATTEMPT;
}
export function ownerGate(e){
 if(e?.GITHUB_ACTOR!=='ASI-integration'||e.GITHUB_ACTOR_ID!=='207600140'||e.GITHUB_TRIGGERING_ACTOR!=='ASI-integration'||e.GITHUB_RUN_ATTEMPT!=='1')fail('OWNER_MANUAL_ONLY');
 return true;
}
export function peers(a,b,host){
 for(const [i,p] of [a,b].entries())if(!p||p.session_user!==['task12_login_a','task12_login_b'][i]||p.current_user!==p.session_user||!Number.isSafeInteger(p.pid)||p.pid<=0||p.database!==DATABASE||p.host!==host||p.port!==55442||p.isolation!=='serializable'||p.privileged!==false)fail('PEER');
 if(a.pid===b.pid)fail('PEER');
 return true;
}
export function owned(expected,actual){if(!expected?.id||expected.id!==actual?.id||expected.name!==actual.name||expected.label!==actual.label||expected.image!==actual.image)fail('CLEANUP_IDENTITY');return true;}
export function commitOutcome(ack){return ack==='COMMIT'?{status:'ACK',retry:false}:{status:'HOLD',retry:false};}
