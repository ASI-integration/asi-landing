import {sign} from 'node:crypto';
import {rootOwned,AUTHORITY_DIR} from './host-authority.mjs';
import {must} from './state.mjs';

export const APP_PERMISSIONS=Object.freeze({metadata:'read',contents:'write',pull_requests:'write',actions:'read',checks:'read',issues:'read'});
const REPO='ASI-integration/asi-landing',REPO_ID=1167177589;
export function verifyAppPermissions(actual){
  must(actual&&Object.keys(actual).length===Object.keys(APP_PERMISSIONS).length&&
    Object.entries(APP_PERMISSIONS).every(([k,v])=>actual[k]===v),'APP_PERMISSION_SCOPE');
}
async function api(method,route,token,body){
  try{
    const r=await fetch('https://api.github.com/'+route,{method,redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
        ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    must(r.ok,'APP_REQUEST');if(r.status===204)return null;
    const chunks=[];let n=0;
    for await(const chunk of r.body){n+=chunk.length;must(n<=1000000,'APP_RESPONSE_SIZE');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw Error('APP_AUTHENTICATION_UNVERIFIED');}
}
/** Fixed app/repository scope. Key remains on the server; no gh/PAT fallback. */
export function createAppTokenProvider({appId,installationId}, {beforeRequest=async()=>{}}={}){
  must(Number.isSafeInteger(appId)&&appId>0&&Number.isSafeInteger(installationId)&&installationId>0,'APP_ID_REQUIRED');
  const call=async(...args)=>{await beforeRequest({mutation:false});return api(...args);};
  let cached=null,pending=null;
  async function issue(){
    const privateKey=await rootOwned(AUTHORITY_DIR+'/github-app.pem',20000,{secret:true});
    const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const input=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iat:now-60,exp:now+480,iss:String(appId)});
    const jwt=input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
    const installation=await call('GET',`app/installations/${installationId}`,jwt);
    must(installation.id===installationId&&installation.app_id===appId&&installation.account?.login==='ASI-integration'&&
      installation.repository_selection==='selected'&&installation.suspended_at===null,'APP_INSTALLATION_SCOPE');
    verifyAppPermissions(installation.permissions);
    const token=await call('POST',`app/installations/${installationId}/access_tokens`,jwt,
      {repository_ids:[REPO_ID],permissions:APP_PERMISSIONS});
    verifyAppPermissions(token.permissions);
    must(typeof token.token==='string'&&token.token.length>20&&Date.parse(token.expires_at)>Date.now()+300000,'APP_TOKEN_SCHEMA');
    const repositories=await call('GET','installation/repositories?per_page=100',token.token);
    must(repositories.total_count===1&&repositories.repositories?.length===1&&
      repositories.repositories[0].id===REPO_ID&&repositories.repositories[0].full_name===REPO,'APP_REPOSITORIES_SCOPE');
    cached={value:token.token,expiresAt:Date.parse(token.expires_at)};
    return cached.value;
  }
  return Object.freeze({async token(){
    if(cached&&cached.expiresAt>Date.now()+300000)return cached.value;
    if(!pending)pending=issue().finally(()=>{pending=null;});return pending;
  },async revoke(){
    must(!pending&&cached,'NO_TOKEN_TO_REVOKE');const value=cached.value;cached=null;
    await call('DELETE','installation/token',value);
  }});
}
