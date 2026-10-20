#!/usr/bin/env node
import fs from 'node:fs/promises';

// Advisory only. The release JSON and owner/branch protection outrank this board.
export const REPO = 'ASI-integration/asi-landing';
const PROJECT = 'PVT_kwHODF-6DM4Bn3p1';
const GATE = 'PVTSSF_lAHODF-6DM4Bn3p1zhman2o';
const NEXT = 'PVTF_lAHODF-6DM4Bn3p1zhman4c';
const CHOICES = { BLOCKED:'9ba79cc1', PREPARATION_ONLY:'83d19152',
  OWNER_APPROVAL:'385aed59', ACCEPTED:'9a83ebe2' };
const ITEMS = [
  'PVTI_lAHODF-6DM4Bn3p1zhCD2EQ', 'PVTI_lAHODF-6DM4Bn3p1zhCD2Hc',
  'PVTI_lAHODF-6DM4Bn3p1zhCD2Kw', 'PVTI_lAHODF-6DM4Bn3p1zhCD2Mo',
  'PVTI_lAHODF-6DM4Bn3p1zhCD2QM', 'PVTI_lAHODF-6DM4Bn3p1zhCD2S0'
];
const SHA = /^[0-9a-f]{40}$/;
const REQUIRED = ['validate', 'channel-manager-recovery-postgres'];
function blocked(message) {
  return ITEMS.map((itemId,i)=>({itemId,gate:'BLOCKED',next:i===0?message:
    'Ждать физической приёмки S4-G'+i+'. Без автоматического допуска.'}));
}
export function calculate(s) {
  if (!s?.contract || s.contract.releaseId!=='STRIGUNOV4-READY-FOR-DEMO' ||
      s.contract.stages?.length!==6) return blocked('Карта релиза отсутствует в защищённой main. Сначала PR #510.');
  for(let i=0;i<6;i++) {
    const stage=s.contract.stages[i];
    if(stage?.id!=='S4-G'+(i+1) ||
       !['ACCEPTED','IN_PROGRESS','NOT_STARTED','BLOCKED'].includes(stage.status))
      return blocked('Карта релиза повреждена. Нужна независимая проверка.');
  }
  // An ACCEPTED string and an Actions URL alone do not prove physical acceptance.
  // Until independently verified SHA-bound staging evidence exists, do not advance.
  if(s.contract.stages[0].status==='ACCEPTED')
    return blocked('S4-G1 помечен ACCEPTED, но защищённый физический запуск, SHA и решение владельца не подтверждены.');
  if(!s.pr || s.pr.number!==510 || !SHA.test(s.pr.head_sha))
    return blocked('Не удалось проверить PR #510 на точном SHA.');
  const rows=blocked('Нет допуска к следующему этапу.');
  let gate='PREPARATION_ONLY';
  let next;
  if(!s.pr.merged) {
    if(s.pr.state!=='open') {
      gate='BLOCKED'; next='PR #510 закрыт без подтверждённого merge.';
    } else if(!Array.isArray(s.threads)) {
      gate='BLOCKED'; next='Не удалось проверить обсуждения CodeRabbit.';
    } else if(s.threads.some(t=>t.isResolved!==true)) {
      const count=s.threads.filter(t=>t.isResolved!==true).length;
      next='Исправить '+count+' незакрытых замечаний в PR #510; повторить CI и обзор. Без merge.';
    } else if(!Array.isArray(s.checks)) {
      gate='BLOCKED'; next='Недоступны точные результаты CI.';
    } else {
      const missing=REQUIRED.filter(name=>!s.checks.some(c=>c.name===name &&
        c.head_sha===s.pr.head_sha && c.status==='completed' &&
        c.conclusion==='success' && c.app?.slug==='github-actions'));
      if(missing.length) next='Дождаться/исправить CI на HEAD '+s.pr.head_sha.slice(0,12)+': '+missing.join(', ');
      else { gate='OWNER_APPROVAL';
        next='Только отдельное решение владельца на merge #510 HEAD '+s.pr.head_sha.slice(0,12)+'.'; }
    }
  } else {
    gate='OWNER_APPROVAL';
    next='Подтвердить, что release_governance обязателен в защищённой main, без admin bypass. Затем только отдельно разрешённый ремонт S4-G1.';
  }
  rows[0]={itemId:ITEMS[0],gate,next};
  return rows;
}
async function request(url,token,body) {
  if(!token) throw new Error('MISSING_TOKEN');
  const r=await fetch(url,{method:body?'POST':'GET',headers:{
    Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})
  },...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw new Error('GITHUB_HTTP_'+r.status);
  const x=await r.json();
  if(x.errors?.length) throw new Error('GRAPHQL_FAILED');
  return x;
}
async function snapshot(token) {
  let contract=null;
  try { contract=JSON.parse(await fs.readFile('docs/agent-os/releases/strigunov4-demo.json','utf8')); }
  catch(e) { if(e.code!=='ENOENT') throw e; }
  const pr=await request('https://api.github.com/repos/'+REPO+'/pulls/510',token);
  const checks=await request('https://api.github.com/repos/'+REPO+'/commits/'+pr.head.sha+'/check-runs?per_page=100',token);
  const result=await request('https://api.github.com/graphql',token,{query:
    'query { repository(owner:"ASI-integration",name:"asi-landing") { pullRequest(number:510) { reviewThreads(first:100) { pageInfo {hasNextPage} nodes {isResolved} } } } }'});
  const th=result.data?.repository?.pullRequest?.reviewThreads;
  if(!th || th.pageInfo.hasNextPage) throw new Error('INCOMPLETE_REVIEW_THREADS');
  return {contract,pr:{number:pr.number,state:pr.state,merged:pr.merged===true,head_sha:pr.head.sha},
    checks:checks.check_runs,threads:th.nodes};
}
async function update(rows,token) {
  if(!token) return 'NO_PROJECTS_TOKEN: read-only Actions summary only';
  for(const r of rows) {
    if(!ITEMS.includes(r.itemId) || !CHOICES[r.gate] ||
        typeof r.next!=='string' || r.next.length>380) throw new Error('INVALID_PROJECT_UPDATE');
    for(const [fieldId,value] of [[GATE,{singleSelectOptionId:CHOICES[r.gate]}],[NEXT,{text:r.next}]]) {
      const response=await request('https://api.github.com/graphql',token,{query:
        'mutation($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}',
        variables:{input:{projectId:PROJECT,itemId:r.itemId,fieldId,value}}});
      if(!response.data?.updateProjectV2ItemFieldValue?.projectV2Item?.id)
        throw new Error('PROJECT_FIELD_NOT_UPDATED');
    }
  }
  return 'PROJECT_FIELDS_UPDATED';
}
export async function main() {
  if(process.env.GITHUB_REPOSITORY!==REPO || process.env.GITHUB_REF!=='refs/heads/main')
    throw new Error('TRUSTED_MAIN_ONLY');
  let data=null;
  try { data=await snapshot(process.env.GITHUB_TOKEN); }
  catch(e) { console.error('READ_FAILED_CLOSED: '+e.message); }
  const rows=calculate(data);
  const summary=['## ASI: Следующий допустимый шаг','',
    ...rows.map((r,i)=>'- S4-G'+(i+1)+' · '+r.gate+' · '+r.next),'',
    'Информация не заменяет разрешение владельца, обязательные CI и физическую приёмку.',''];
  console.log(summary.join('\n'));
  if(process.env.GITHUB_STEP_SUMMARY)
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summary.join('\n'));
  console.log(await update(rows,process.env.ASI_ROADMAP_PROJECTS_TOKEN));
}
if(process.argv[1]?.endsWith('roadmap-next-action.mjs'))
  main().catch(e=>{console.error(e.message);process.exitCode=1;});
