// Source-only, read-only GitHub snapshot adapter for the Strigunov 4 runner.
// External API and project read are injected; repository/issue text is never
// interpreted as an instruction or a permission to execute operations.
const REPO='ASI-integration/asi-landing';
const SHA=/^[a-f0-9]{40}$/;
const ISSUES=[511,512,513,514,515,516];
const PRS=[509,508,520];
const BOT=new Set(['coderabbitai[bot]','coderabbitai']);
function must(v,reason){if(!v)throw Error(reason)}
function trustTime(s){const t=Date.parse(s||'');return Number.isFinite(t)?t:0;}
export function lastCheck(checks,head,name){
  must(Array.isArray(checks)&&checks.length<=100&&SHA.test(head),'CHECKS_UNTRUSTED');
  const a=checks.filter(x=>x?.name===name&&x.head_sha===head)
    .sort((x,y)=>trustTime(y.completed_at||y.started_at)-trustTime(x.completed_at||x.started_at));
  return a[0]?.status==='completed'&&a[0].conclusion==='success'?'success':'unknown';
}
export function independentCodeRabbit(comments,head){
  must(Array.isArray(comments)&&comments.length<=100&&SHA.test(head),'REVIEWS_UNTRUSTED');
  // Review text is advisory. Only current-HEAD clean summary can be used;
  // malformed or ambiguous bodies must be treated as unreviewed.
  const sorted=comments.filter(x=>BOT.has(x?.user?.login)&&typeof x.body==='string')
    .sort((x,y)=>trustTime(y.updated_at||y.created_at)-trustTime(x.updated_at||x.created_at));
  const current=sorted.find(x=>x.body.includes(head)&&
    (/No actionable comments were generated in the recent review/i.test(x.body)||
     /Actionable comments posted:\s*[1-9]/i.test(x.body)));
  return {head,completed:!!current,actionable:current?
    !/No actionable comments were generated in the recent review/i.test(current.body):null};
}
export async function fetchVerifiedSnapshot({api,readProjects}={}){
  must(typeof api==='function'&&typeof readProjects==='function','READ_PORTS_REQUIRED');
  const branch=await api('branches/main');
  const mainSha=branch?.commit?.sha;
  must(SHA.test(mainSha)&&branch.protected===true,'MAIN_IDENTITY_UNVERIFIED');
  const file=await api(`contents/docs/agent-os/releases/strigunov4-demo.json?ref=${mainSha}`);
  must(file?.type==='file'&&file.encoding==='base64'&&typeof file.content==='string',
    'RELEASE_CONTENT_UNTRUSTED');
  let contract;try{contract=JSON.parse(Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8'));}
  catch{throw Error('RELEASE_JSON_UNTRUSTED')}
  const issues={};
  for(const number of ISSUES){
    const issue=await api(`issues/${number}`);
    must(issue?.number===number&&Array.isArray(issue.labels)&&
      ['open','closed'].includes(issue.state),
      'ISSUE_IDENTITY_UNTRUSTED');
    issues[number]={number,state:issue.state,labels:issue.labels.map(x=>x.name)};
  }
  const project={};
  const verified=await readProjects();
  must(Array.isArray(verified?.items)&&verified.items.length===6,
    'PROJECT_GATES_UNVERIFIED');
  for(const x of verified.items){
    must(Number.isInteger(x.issue)&&ISSUES.includes(x.issue)&&
      x.stage==='S4-G'+(x.issue-510)&&
      ['BLOCKED','PREPARATION_ONLY','OWNER_APPROVAL','ACCEPTED'].includes(x.gate)&&
      project[x.issue]===undefined,'PROJECT_GATE_IDENTITY_INVALID');
    project[x.issue]=x.gate;
  }
  const prs={},checks={},reviews={};
  for(const number of PRS){
    const pr=await api(`pulls/${number}`),head=pr?.head?.sha;
    must(pr?.number===number&&SHA.test(head)&&pr.head.repo?.full_name===REPO&&
      (pr.state==='open'||pr.state==='closed'),'PR_IDENTITY_UNTRUSTED');
    const [c,notes]=await Promise.all([
      api(`commits/${head}/check-runs?per_page=100`),
      api(`issues/${number}/comments?per_page=100`)
    ]);
    must(Number.isInteger(c?.total_count)&&Array.isArray(c.check_runs)&&
      c.total_count===c.check_runs.length&&c.total_count<=100,
      'CHECKS_PAGINATION_UNTRUSTED');
    must(Array.isArray(notes)&&notes.length<=100,'COMMENTS_PAGINATION_UNTRUSTED');
    prs[number]={number,head,state:pr.state,merged:pr.merged===true};
    checks[number]={head,validate:lastCheck(c.check_runs,head,'validate'),
      release_governance:lastCheck(c.check_runs,head,'release_governance')};
    reviews[number]=independentCodeRabbit(notes,head);
  }
  const current=await api('branches/main');
  must(current?.commit?.sha===mainSha&&current.protected===true,'MAIN_MOVED_DURING_READ');
  return {mainSha,contract,issues,prs,checks,reviews,project,ledger:{}};
}
