/**
 * Hermetic crash/CAS specification checker, NOT a storage implementation or authority.
 * Both journal and external anchor arguments are UNIT_ONLY fixtures. No runtime imports it.
 * A real service must source time/evidence internally and persist CAS outside the journal.
 */
import { canonical, check, digest, exact, object, parseCanonical, HEX, UUID } from '../protocol';
import { SCENARIOS } from '../../strigunov-public-lead-postgres-contract';
import type { ObjectJson } from '../protocol';
const hex = (x: unknown) => typeof x === 'string' && HEX.test(x);
const id = (x: unknown) => typeof x === 'string' && UUID.test(x);
const whole = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const ZERO = '0'.repeat(64);
type Operation = { scenario: string; phase: string; crmId: string | null; consentDigest: string | null };
const TYPES: Record<string,string[]> = {
  CLAIM: [], START: [], STOP: [], REVOKE: [], FINALIZE: [],
  INTENT: ['operationId','scenario','role'],
  IDENTIFIED: ['operationId','crmId','consentDigest'],
  COMMIT_UNKNOWN: ['operationId'], COMMIT_ACK: ['operationId'], ROLLBACK_ACK: ['operationId'],
  EVIDENCE: ['operationId','scenario','observationDigest'],
  CLEANUP_INTENT: ['crmId','consentDigest'], CLEANUP_ACK: ['crmId','consentDigest','deleted','remaining'],
};
export function inspectAnchoredJournalModel(journalText: unknown, anchorText: unknown) {
  try {
    const j = parseCanonical(journalText, 262144), a = parseCanonical(anchorText, 4096);
    exact(j, ['authorityClass','scope','records']);
    check(j.authorityClass === 'UNIT_ONLY');
    const s = object(j.scope);
    exact(s, ['nonce','envelopeDigest','hostDigest','targetDigest','appSha','sqlSha256','rootIdentity',
      'bootDigest','notBeforeMs','expiresAtMs','maxDurationMs','maxQueries','maxWrites','maxRows','scenarios','roles']);
    for (const k of ['nonce','envelopeDigest','hostDigest','targetDigest','sqlSha256','rootIdentity','bootDigest']) check(hex(s[k]));
    check(typeof s.appSha === 'string' && /^[0-9a-f]{40}$/.test(s.appSha));
    for (const k of ['notBeforeMs','expiresAtMs','maxDurationMs','maxQueries','maxWrites','maxRows']) check(whole(s[k]) && Number(s[k]) > 0);
    check(Number(s.expiresAtMs) > Number(s.notBeforeMs) && Number(s.expiresAtMs)-Number(s.notBeforeMs)<=600000 &&
      Number(s.maxDurationMs)<=600000 && Number(s.maxQueries)<=20000 && Number(s.maxWrites)<=2000 && Number(s.maxRows)<=1000);
    check(Array.isArray(s.scenarios) && s.scenarios.length>0 &&
      s.scenarios.every(x=>SCENARIOS.some(v=>v.id===x)) &&
      canonical(s.scenarios)===canonical([...new Set(s.scenarios)].sort()));
    check(Array.isArray(s.roles) && s.roles.length>0 &&
      s.roles.every(x=>['observer','service-a','service-b','anon','authenticated'].includes(String(x))) &&
      canonical(s.roles)===canonical([...new Set(s.roles)].sort()));
    exact(a,['authorityClass','scopeDigest','rootIdentity','sequence','head','nonceConsumed','revoked','recoveryLatched','durability']);
    check(a.authorityClass === 'UNIT_ONLY' && a.scopeDigest === digest(canonical(s)) &&
      a.rootIdentity === s.rootIdentity && a.nonceConsumed === true && a.revoked === false &&
      a.recoveryLatched === false && a.durability === 'MODEL_ONLY');
    check(Array.isArray(j.records) && j.records.length>0 && j.records.length<=256 &&
      a.sequence === j.records.length && hex(a.head), 'ANCHOR_REGRESSION');
    let head=ZERO, phase='ISSUED', lastWall=Number(s.notBeforeMs), lastElapsed=0, started:number|null=null;
    let queries=0,writes=0,rows=0,cleanup:Operation|null=null;
    const operations: Record<string,Operation> = Object.create(null);
    const evidence = new Set<string>();
    for (let index=0; index<j.records.length; index++) {
      const r=object(j.records[index]);
      exact(r,['sequence','previous','scopeDigest','event','hash','ack']);
      const body: ObjectJson={sequence:r.sequence,previous:r.previous,scopeDigest:r.scopeDigest,event:r.event};
      check(r.sequence===index+1 && r.previous===head && r.scopeDigest===a.scopeDigest &&
        r.hash===digest(canonical(body)) && r.ack===r.hash, 'JOURNAL_ACK_UNKNOWN');
      head=String(r.hash);
      const e=object(r.event);
      check(typeof e.op==='string' && Object.hasOwn(TYPES,e.op));
      exact(e,['op','atMs','elapsedMs','bootDigest',...TYPES[e.op]]);
      check(!['BLOCKED','RECOVERY_REQUIRED','EVIDENCE_REVIEW_REQUIRED'].includes(phase), 'TERMINAL');
      check(whole(e.atMs) && whole(e.elapsedMs) && e.atMs>=lastWall && e.elapsedMs>=lastElapsed &&
        Math.abs((e.atMs-lastWall)-(e.elapsedMs-lastElapsed))<=2000 &&
        e.atMs<Number(s.expiresAtMs) && e.bootDigest===s.bootDigest &&
        (started===null || e.elapsedMs-started<=Number(s.maxDurationMs)), 'TIME_OR_BOOT');
      lastWall=e.atMs;lastElapsed=e.elapsedMs;
      if(e.op==='CLAIM') { check(phase==='ISSUED' && index===0,'NONCE_REPLAY');phase='CLAIMED';continue; }
      if(e.op==='START') { check(phase==='CLAIMED');phase='RUNNING';started=e.elapsedMs;continue; }
      if(e.op==='STOP') { check(phase!=='ISSUED');phase='STOPPING';continue; }
      if(e.op==='REVOKE') throw Error('REVOKED');
      if(e.op==='INTENT') {
        check(phase==='RUNNING' && id(e.operationId) && typeof e.operationId==='string' &&
          !Object.hasOwn(operations,e.operationId) && typeof e.scenario==='string' &&
          s.scenarios.includes(e.scenario) && s.roles.includes(e.role), 'SCOPE');
        // Client cannot choose zero rows or resource counts: conservative per-operation model reservation.
        queries+=4;writes+=2;rows+=1;
        check(queries<=Number(s.maxQueries) && writes<=Number(s.maxWrites) && rows<=Number(s.maxRows),'BUDGET');
        operations[e.operationId]={scenario:e.scenario,phase:'INTENT',crmId:null,consentDigest:null};continue;
      }
      if(['IDENTIFIED','COMMIT_UNKNOWN','COMMIT_ACK','ROLLBACK_ACK','EVIDENCE'].includes(e.op)) {
        check(['RUNNING','STOPPING'].includes(phase) && typeof e.operationId==='string' && Object.hasOwn(operations,e.operationId));
        const item=operations[String(e.operationId)];
        if(e.op==='IDENTIFIED') {
          check(item.phase==='INTENT' && id(e.crmId) && hex(e.consentDigest) &&
            !Object.values(operations).some(v=>v.crmId===e.crmId));
          item.crmId=String(e.crmId);item.consentDigest=String(e.consentDigest);item.phase='IDENTIFIED';
        } else if(e.op==='COMMIT_UNKNOWN') { check(item.phase==='IDENTIFIED');item.phase='COMMIT_UNKNOWN'; }
        else if(e.op==='COMMIT_ACK') { check(item.phase==='COMMIT_UNKNOWN');item.phase='COMMITTED'; }
        else if(e.op==='ROLLBACK_ACK') { check(['INTENT','IDENTIFIED'].includes(item.phase));item.phase='ROLLED_BACK'; }
        else {
          check(['COMMITTED','ROLLED_BACK'].includes(item.phase) && item.scenario===e.scenario && hex(e.observationDigest));
          check(!evidence.has(item.scenario));evidence.add(item.scenario);
        }
        continue;
      }
      if(e.op==='CLEANUP_INTENT') {
        check(['RUNNING','STOPPING'].includes(phase) && cleanup===null &&
          Object.values(operations).every(v=>['COMMITTED','ROLLED_BACK','CLEANED'].includes(v.phase)), 'UNKNOWN_COMMIT');
        const item=Object.values(operations).find(v=>v.phase==='COMMITTED' && v.crmId===e.crmId && v.consentDigest===e.consentDigest);
        check(item && id(e.crmId) && hex(e.consentDigest),'CLEANUP_OWNERSHIP');
        queries+=2;writes++;
        check(queries<=Number(s.maxQueries) && writes<=Number(s.maxWrites),'BUDGET');
        cleanup=item;continue;
      }
      if(e.op==='CLEANUP_ACK') {
        check(cleanup!==null && e.crmId===cleanup.crmId && e.consentDigest===cleanup.consentDigest &&
          e.deleted===1 && e.remaining===0,'DISPUTED_CLEANUP');
        cleanup.phase='CLEANED';cleanup=null;continue;
      }
      if(e.op==='FINALIZE') {
        check(['RUNNING','STOPPING'].includes(phase) && cleanup===null && Object.keys(operations).length>0 &&
          s.scenarios.every(v=>evidence.has(String(v))) &&
          Object.values(operations).every(v=>['ROLLED_BACK','CLEANED'].includes(v.phase)), 'EVIDENCE_INCOMPLETE');
        // A digest is not scenario semantics, backend evidence or independent acceptance.
        phase='EVIDENCE_REVIEW_REQUIRED';continue;
      }
      throw Error('UNSUPPORTED');
    }
    check(head===a.head,'ANCHOR_REGRESSION');
    check(!cleanup && !Object.values(operations).some(v=>['INTENT','IDENTIFIED','COMMIT_UNKNOWN'].includes(v.phase)), 'UNKNOWN_COMMIT');
    return Object.freeze({state:'UNIT_ONLY',phase,executionAuthorized:false,durableAck:false,
      realEvidenceAccepted:false,queries,writes,rows,sequence:j.records.length,journalHead:head});
  } catch {
    return Object.freeze({state:'RECOVERY_REQUIRED',executionAuthorized:false,durableAck:false,
      realEvidenceAccepted:false,reason:'ANCHOR_OR_JOURNAL_UNVERIFIED'});
  }
}
