import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
const images={pg:'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3',rest:'postgrest/postgrest:v12.2.8@sha256:e5978740a590628f2114730bb942f35342ea70b8b7a86697a3df283c0caea109',node:'node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392'};
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
const sha=git('rev-parse','HEAD');
if(process.argv.includes('--plan')){console.log(JSON.stringify({sha,images,network:'internal',production:false,send:false,credentials:'fresh in-memory CI-only; none during plan'}));process.exit(0);}
assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY,'YES');
assert.equal(process.env.GITHUB_REPOSITORY,'ASI-integration/asi-landing');
assert.equal(process.env.REVIEWED_SOURCE_SHA,sha);assert.match(sha,/^[a-f0-9]{40}$/);
assert.equal(git('status','--porcelain','--untracked-files=no'),'');
assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
assert.equal(process.env.GITHUB_ACTOR,'ASI-integration');assert.equal(process.env.GITHUB_ACTOR_ID,'207600140');assert.equal(process.env.GITHUB_TRIGGERING_ACTOR,'ASI-integration');
assert.ok(!process.env.DOCKER_HOST&&!process.env.DOCKER_CONTEXT);
assert.equal(execFileSync('docker',['context','show'],{encoding:'utf8'}).trim(),'default');
assert.ok(['pull_request','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME));
if(process.env.GITHUB_EVENT_NAME==='pull_request'){
 const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 assert.equal(event.pull_request.head.repo.full_name,'ASI-integration/asi-landing');assert.equal(event.pull_request.head.ref,'asi/strigunov4-g0-integration-20261016');assert.equal(event.pull_request.head.sha,sha);
}
for(const p of ['.env','.env.local','.env.production','.env.production.local'])assert.equal(existsSync(p),false);
const id='strigfin-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
assert.match(id,/^strigfin-[0-9]+-1$/);
const secrets={LAB_ADMIN_PASSWORD:randomBytes(32).toString('hex'),LAB_AUTH_PASSWORD:randomBytes(32).toString('hex'),LAB_JWT_SECRET:randomBytes(32).toString('hex'),LAB_SESSION_SECRET:randomBytes(32).toString('hex')};
const env={...process.env,...secrets,POSTGRES_PASSWORD:secrets.LAB_ADMIN_PASSWORD,PGRST_DB_URI:'postgres://task32_authenticator:'+secrets.LAB_AUTH_PASSWORD+'@'+id+'-pg:5432/task32',PGRST_JWT_SECRET:secrets.LAB_JWT_SECRET};
const docker=(a,timeout=90000)=>{try{return execFileSync('docker',a,{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout}).trim();}catch{throw Error('DOCKER_OPERATION_FAILED:'+a[0]);}};
const owned=[];let network=false;let status='FAIL';let cleanup='NOT_RUN';mkdirSync('finishline-results',{recursive:true});
const run=(name,image,opts,cmd=[])=>{assert.equal(docker(['ps','-aq','--filter','name=^/'+name+'$']),'');const containerId=docker(['create','--name',name,'--label','asi.g0='+id,'--network',id,...opts.filter(x=>x!=='-d'),image,...cmd]);owned.push({name,id:containerId});return docker(['start',...(opts.includes('-d')?[]:['-a']),containerId],600000);};
const common=['--workdir','/work','-v',process.cwd()+':/work','-e','CI=true','-e','STRIGUNOV_SYNTHETIC_ONLY=YES','-e','LAB_NETWORK='+id,'-e','REVIEWED_SOURCE_SHA='+sha,...Object.keys(secrets).flatMap(k=>['-e',k])];
try{
 for(const img of Object.values(images))docker(['pull',img],180000);
 docker(['network','create','--internal','--label','asi.g0='+id,id]);network=true;
 assert.equal(docker(['network','inspect','--format','{{.Internal}}',id]),'true');
 run(id+'-pg',images.pg,['-d','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_DB=task32','-e','POSTGRES_USER=postgres','-e','POSTGRES_PASSWORD']);
 run(id+'-bootstrap',images.node,common,['node','scripts/acceptance/strigunov-finishline-worker.mjs','--bootstrap']);
 run(id+'-rest',images.rest,['-d','-e','PGRST_DB_URI','-e','PGRST_JWT_SECRET','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=task32_authenticator','-e','PGRST_SERVER_PORT=33000']);
 run(id+'-accept',images.node,common,['node','scripts/acceptance/strigunov-g0-worker.mjs']);
 const result=JSON.parse(readFileSync('finishline-results/native.json','utf8'));
 assert.equal(result.source,sha);assert.equal(result.run,id);assert.equal(result.completed,true);assert.equal(result.unexpectedFailures,0);assert.equal(result.rowsAfterCleanup,0);
 status=result.status;assert.equal(status,'PASS');
}catch(e){writeFileSync('finishline-results/host-error.json',JSON.stringify({status:'FAIL',code:String(e.message).split('\n')[0].slice(0,100)}));process.exitCode=1;}
finally{
 let clean=true;
 for(const container of owned.reverse()){const {name}=container;
  try{
   const found=docker(['ps','-aq','--filter','name=^/'+name+'$']);
   if(found){if(container.id)assert.equal(docker(['inspect','--format','{{.Id}}',name]),container.id);assert.equal(docker(['inspect','--format','{{index .Config.Labels "asi.g0"}}',name]),id);docker(['rm','-f',name]);}
   assert.equal(docker(['ps','-aq','--filter','name=^/'+name+'$']),'');
  }catch{clean=false;}
 }
 if(network){try{assert.equal(docker(['network','inspect','--format','{{index .Labels "asi.g0"}}',id]),id);docker(['network','rm',id]);assert.equal(docker(['network','ls','-q','--filter','name=^'+id+'$']),'');}catch{clean=false;}}
 cleanup=clean?'PASS':'FAIL';if(!clean)process.exitCode=1;
 writeFileSync('finishline-results/host.json',JSON.stringify({source:sha,status,cleanup,network:'internal',noExternalSend:true,images},null,2));
 console.log('TASK32_NATIVE='+status+' CLEANUP='+cleanup);
}
