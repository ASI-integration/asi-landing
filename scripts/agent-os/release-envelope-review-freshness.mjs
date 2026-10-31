/**
 * Source-only adjunct to the existing protected-base GitHub evidence reader.
 * Compare two COMPLETE, independently fetched GitHub review inventories before
 * the verifier considers a current-head review. Neither the arrays nor a GitHub
 * user identity authenticate human independence; protected issuer/reviewer
 * configuration and the existing Publisher lock remain separate requirements.
 * NEVER authorizes, signs, or fetches anything.
 */
const SHA = /^[0-9a-f]{40}$/;
const REPO = 'ASI-integration/asi-landing';
const STATES = new Set(['APPROVED','CHANGES_REQUESTED','DISMISSED','COMMENTED','PENDING']);
const deny = reason => Object.freeze({status:'BLOCKED',reason,authorized:false});

function data(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(o))) throw Error('SHAPE');
  const descriptors = Object.getOwnPropertyDescriptors(o);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' ||
      !Object.hasOwn(descriptors[key],'value'))) throw Error('SHAPE');
  return descriptors;
}
function own(descriptors,key) {
  const d=descriptors[key];
  if (!d || !Object.hasOwn(d,'value')) throw Error('SHAPE');
  return d.value;
}
function inventory(input) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input)!==Array.prototype ||
      input.length>300) throw Error('SHAPE');
  const a=Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(a).length!==input.length+1 ||
      Reflect.ownKeys(a).some(k=>!Object.hasOwn(a[k],'value'))) throw Error('SHAPE');
  const rows=[];
  for(let i=0;i<input.length;i++) {
    const d=data(own(a,String(i)));
    const u=data(own(d,'user'));
    const id=own(d,'id'),state=own(d,'state'),userId=own(u,'id');
    const commit=own(d,'commit_id'),time=own(d,'submitted_at');
    if (!Number.isSafeInteger(id) || id<=0 ||
        !Number.isSafeInteger(userId) || userId<=0 ||
        typeof state!=='string' || !STATES.has(state) ||
        !(commit===null || typeof commit==='string' && SHA.test(commit)) ||
        !(time===null || typeof time==='string' &&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(time) &&
          Number.isFinite(Date.parse(time)))) throw Error('SHAPE');
    rows.push({id,userId,state,commit,time});
  }
  rows.sort((a,b)=>a.id-b.id);
  if (rows.some((x,i)=>i>0 && x.id===rows[i-1].id)) throw Error('SHAPE');
  return rows;
}

export function inspectFreshIndependentReview({before,after,expected,now}={}) {
  let pin,prior,fresh;
  try {
    const e=data(expected);
    pin={repository:own(e,'repository'),headSha:own(e,'headSha'),
      independentReviewerId:own(e,'independentReviewerId'),
      authorId:own(e,'authorId'),ownerId:own(e,'ownerId')};
    if (pin.repository!==REPO || typeof pin.headSha!=='string' ||
        !SHA.test(pin.headSha) || !Number.isSafeInteger(now) || now<0 ||
        ![pin.independentReviewerId,pin.authorId,pin.ownerId].every(x=>
          Number.isSafeInteger(x)&&x>0) ||
        pin.independentReviewerId===pin.authorId ||
        pin.independentReviewerId===pin.ownerId) return deny('REVIEW_CONTEXT');
    prior=inventory(before);fresh=inventory(after);
  } catch {return deny('REVIEW_SNAPSHOT_SHAPE');}
  // Reordered API pages are fine, but new/removed/changed decisions are not.
  if (JSON.stringify(prior)!==JSON.stringify(fresh)) return deny('REVIEW_SNAPSHOT_DRIFT');
  const decisions=fresh.filter(r=>r.userId===pin.independentReviewerId &&
    ['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state));
  if (!decisions.length || decisions.some(r=>r.time===null ||
      Date.parse(r.time)>now)) return deny('REVIEW_NOT_APPROVED');
  decisions.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||b.id-a.id);
  const latest=decisions[0];
  if (latest.state!=='APPROVED' || latest.commit!==pin.headSha ||
      now-Date.parse(latest.time)>3600000) return deny('REVIEW_NOT_APPROVED');
  return Object.freeze({status:'REVIEW_SNAPSHOT_UNCHANGED',authorized:false,
    reviewId:latest.id,headSha:pin.headSha});
}
