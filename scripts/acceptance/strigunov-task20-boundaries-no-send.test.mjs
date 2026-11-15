import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPhysicalAcceptanceBoundaries} from './strigunov-task20-boundaries.mjs';

const sha='a'.repeat(40);
const fixture=()=>({
 stagingSha:sha,operatorIdentity:'synthetic-human-operator',
 effectiveFlags:{EMAIL_AUTO_SEND:'false',EMAIL_DRAFT_ONLY:'true',
  DRY_RUN_TELEGRAM_OUTBOUND:'true',ALLOW_REAL_TELEGRAM_SYNTHETIC:'false',
  YOOKASSA_ENABLED:'false',ASI_SYNTHETIC_NO_SEND:'YES',
  ASI_APP_ROOT:'/var/www/asi-staging/current'}
});
function inspect(e,expectedSha=sha){
 const result=inspectPhysicalAcceptanceBoundaries(e,expectedSha);
 assert.equal(result.scope,'SOURCE_ONLY_NON_AUTHORIZING');
 for(const key of ['canApprove','canSend','accepted','readyForDemo'])
  assert.equal(result[key],false);
 assert.deepEqual(result.gates,Object.fromEntries(['G2','G3','G4','G5','G6']
  .map(gate=>[gate,'NOT_ACCEPTED'])));
 return result;
}
test('complete synthetic report remains structural evidence only',()=>{
 const e=fixture();
 const before=structuredClone(e);
 assert.equal(inspect(e).status,'STRUCTURE_MATCH_ONLY');
 assert.deepEqual(e,before);
});
test('absent effective settings cannot be replaced by config intent or flag count',()=>{
 for(const effectiveFlags of [undefined,null,7,[],{},true]){
  const e={...fixture(),effectiveFlags,configuredFlags:fixture().effectiveFlags};
  assert.ok(inspect(e).reasons.includes('EFFECTIVE_NO_SEND_NOT_PROVEN'));
 }
});
for(const key of Object.keys(fixture().effectiveFlags)){
 test(`${key} must be present with its exact effective value`,()=>{
  for(const value of [undefined,null,true,false,'','unsafe']){
   const e=fixture();
   if(value===undefined)delete e.effectiveFlags[key];
   else e.effectiveFlags[key]=value;
   const result=inspect(e);
   assert.equal(result.status,'HOLD');
   assert.ok(result.reasons.includes('EFFECTIVE_NO_SEND_NOT_PROVEN'));
  }
 });
}
test('inherited flags do not prove effective settings',()=>{
 const e=fixture();
 e.effectiveFlags=Object.create(e.effectiveFlags);
 assert.ok(inspect(e).reasons.includes('EFFECTIVE_NO_SEND_NOT_PROVEN'));
});
test('missing or malformed operator identity holds every gate',()=>{
 for(const operatorIdentity of [undefined,null,'',' \n ',true,{},[]]){
  assert.ok(inspect({...fixture(),operatorIdentity}).reasons.includes('OPERATOR_IDENTITY_MISSING'));
 }
});
test('stale, absent and malformed staging or expected SHA hold every gate',()=>{
 for(const value of [undefined,null,'b'.repeat(40),'a'.repeat(39),true]){
  assert.ok(inspect({...fixture(),stagingSha:value}).reasons.includes('STAGING_SHA_MISMATCH'));
 }
 for(const value of [null,'',true,'a'.repeat(39)]){
  assert.ok(inspect(fixture(),value).reasons.includes('STAGING_SHA_MISMATCH'));
 }
});
test('untrusted acceptance claims cannot override missing prerequisites',()=>{
 for(const e of [undefined,null,[],false,{},
  {accepted:true,canApprove:true,canSend:true,readyForDemo:true,
   gates:{G2:'ACCEPTED',G3:'ACCEPTED',G4:'ACCEPTED',G5:'ACCEPTED',G6:'ACCEPTED'}}]){
  const result=inspect(e);
  assert.equal(result.status,'HOLD');
  assert.equal(result.reasons.length,3);
 }
});
