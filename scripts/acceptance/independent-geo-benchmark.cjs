'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function inside(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')) throw Error('invalid artifact path');
  const full = path.resolve(root, relative);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw Error('artifact path escape');
  const real = fs.realpathSync(full);
  if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw Error('artifact symlink escape');
  return full;
}
function pointValid(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0);
}
/** Independent unit-vector central angle, mean-earth sphere. NOT walking or ellipsoidal distance. */
function sphericalDistance(a,b) {
  if (!pointValid(a) || !pointValid(b)) throw Error('invalid geographic point');
  const v=p=>{const lat=p.lat*Math.PI/180,lon=p.lon*Math.PI/180;return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];};
  const x=v(a),y=v(b); const cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  return 6371008.8*Math.atan2(Math.hypot(...cross),x.reduce((sum,n,i)=>sum+n*y[i],0));
}
function validateBenchmark(b, root) {
  const errors=[];const requireThat=(ok,message)=>{if(!ok)errors.push(message);};
  if (!b || b.schemaVersion !== 'asi.independent-geo.v1' || !Array.isArray(b.subjects) || !Array.isArray(b.sources)) return {integrity:'FAIL',errors:['invalid benchmark shape'],geographicAcceptance:'HOLD'};
  const sources=new Map(), artifacts=new Map();
  for(const s of b.sources){
    requireThat(typeof s.id==='string'&&!sources.has(s.id),'duplicate/invalid source ID');sources.set(s.id,s);
    requireThat(typeof s.url==='string'&&/^https:\/\//.test(s.url),'source URL required');
    requireThat(Number.isFinite(Date.parse(s.observedAt)),'source date required');
    requireThat(typeof s.rights==='string'&&s.rights.length>0,'source rights required');
    try { const bytes=fs.readFileSync(inside(root,s.artifact)); const content=bytes.toString('utf8'); artifacts.set(s.id,content); requireThat(hash(s.digestMode==='lf-normalized-utf8'?content.replace(/\r\n/g,'\n'):bytes)===s.sha256,'source digest mismatch:'+s.id); } catch { errors.push('source artifact unavailable/unsafe:'+s.id); }
  }
  const refs=(ids,label)=>requireThat(Array.isArray(ids)&&ids.length>0&&ids.every(id=>sources.has(id)), 'missing source references:'+label);
  const samePoint=(a,b)=>pointValid(a)&&pointValid(b)&&Math.abs(a.lat-b.lat)<1e-10&&Math.abs(a.lon-b.lon)<1e-10;
  const sameOsm=(a,b)=>a&&b&&a.type===b.type&&a.id===b.id;
  const parse=id=>{try{return JSON.parse(artifacts.get(id));}catch{return null;}};
  const boundPoint=(point,osm,sourceRefs,primary=false)=>(sourceRefs||[]).some(id=>{
    const artifact=parse(id);
    if(primary)return sources.get(id)?.tier.startsWith('primary_')&&samePoint(point,artifact?.pointEvidence);
    return Array.isArray(artifact)&&artifact.some(row=>sameOsm(osm,{type:row.osm_type,id:row.osm_id})&&samePoint(point,{lat:Number(row.lat),lon:Number(row.lon)}));
  });
  const ids=new Set();
  requireThat(b.subjects.length===11,'exactly11 subjects required');
  let supportedIdentity=0,corroboratedCoordinates=0;
  for(const s of b.subjects){
    requireThat(typeof s.id==='string'&&!ids.has(s.id),'duplicate subject ID');ids.add(s.id);
    requireThat(typeof s.canonicalAddress==='string'&&s.canonicalAddress.length>0,'exact canonical address required');
    refs(s.sourceRefs,s.id);
    requireThat(['SUPPORTED','AMBIGUOUS','UNVERIFIED'].includes(s.identity?.status),'invalid identity status');
    requireThat(['high','medium','low'].includes(s.identity?.confidence),'invalid identity confidence');
    requireThat(s.audience?.basis==='independent_evidence'&&s.audience?.numericScore===null,'model-derived or numeric ground truth forbidden');
    requireThat(s.audience?.accommodationDemand==='UNVERIFIED','unmeasured demand must remain unverified');
    requireThat(s.legalPropertyUse==='UNVERIFIED'&&s.monthlyDemand==='UNVERIFIED'&&s.profitability==='UNVERIFIED','unsupported commercial claims');
    requireThat(Array.isArray(s.gaps)&&s.gaps.length>0,'explicit evidence gaps required');
    const pts=s.geometry?.candidates;
    requireThat(s.geometry?.crs==='EPSG:4326'&&Array.isArray(pts),'WGS84 candidates required');
    for(const p of pts||[]) {requireThat(pointValid(p),'invalid/synthetic subject coordinate:'+s.id);refs(p.sourceRefs,s.id+':coordinate');requireThat(boundPoint(p,p.osm,p.sourceRefs,p.role==='primary-source-pin'),'coordinate/source identity mismatch:'+s.id);}
    if(s.geometry?.status==='CORROBORATED_POINT') {corroboratedCoordinates++;requireThat(s.identity?.status==='SUPPORTED','ambiguous subject cannot have adjudicated point');requireThat(pts?.some(p=>p.role==='primary-source-pin'),'independent coordinate evidence required');}
    const primary=pts?.find(p=>p.role==='primary-source-pin');
    const compared=primary?(pts||[]).filter(p=>p.role==='cached-geocoder-candidate'):[];
    const comparisons=s.geometry?.pinComparisons||[];
    requireThat(comparisons.length===compared.length,'pin comparison count mismatch:'+s.id);
    requireThat(new Set(comparisons.map(p=>p.osm?.type+':'+p.osm?.id)).size===comparisons.length,'duplicate pin comparison:'+s.id);
    for(const c of comparisons){const p=compared.find(p=>sameOsm(p.osm,c.osm));requireThat(p&&pointValid(primary)&&Math.abs(sphericalDistance(primary,p)-c.metres)<=0.6,'pin comparison mismatch:'+s.id);}
    const polygon=s.geometry?.polygon;
    if(polygon){
      refs(polygon.sourceRefs,s.id+':polygon');
      const matches=(polygon.sourceRefs||[]).some(id=>{const raw=parse(id);const elements=raw?.elements;if(!Array.isArray(elements))return false;const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));return elements.some(w=>w.type==='way'&&(pts||[]).some(p=>sameOsm(p.osm,{type:'way',id:w.id}))&&w.nodes?.every(id=>nodes.has(id))&&JSON.stringify([w.nodes.map(id=>[nodes.get(id).lon,nodes.get(id).lat])])===JSON.stringify(polygon.coordinates));});
      requireThat(polygon.type==='Polygon'&&matches,'polygon/source identity mismatch:'+s.id);
    }
    if(s.identity?.status==='SUPPORTED')supportedIdentity++;
    requireThat(s.walking?.status==='UNVERIFIED'&&s.walking?.metres===null&&s.walking?.minutes===null,'no verified route in this benchmark');
    for(const p of s.magnets||[]){refs(p.sourceRefs,s.id+':magnet');requireThat(typeof p.category==='string'&&p.category.length>0,'magnet category required');if(p.point!==null){requireThat(pointValid(p.point),'invalid magnet coordinate');requireThat(boundPoint(p.point,p.osm,p.sourceRefs),'magnet/source identity mismatch:'+s.id);}if(p.osm!==null)requireThat(['node','way','relation'].includes(p.osm.type)&&Number.isSafeInteger(p.osm.id)&&p.osm.id>0,'invalid OSM identity');requireThat(p.observedMonthlyDemand===false,'POI is not monthly demand');}
    requireThat(s.evaluator?.beforeModelOutputs===true&&typeof s.evaluator?.id==='string','independent blind evaluator required');
    refs(s.evaluator?.sourceRefs,s.id+':review');
    const reviewIds=s.evaluator?.sourceRefs||[];
    requireThat(reviewIds.some(id=>{try{const r=JSON.parse(artifacts.get(id)||'null');return sources.get(id)?.tier==='independent_blind_review'&&r.beforeModelOutputs===true&&r.addresses.some(a=>a.address===s.canonicalAddress);}catch{return false;}}),'review/address mismatch:'+s.id);
    requireThat((artifacts.get('canonical-fixture')||'').includes("address: '"+s.canonicalAddress+"'"),'address not in canonical fixture:'+s.id);
    for(const d of s.distances||[]){
      try{requireThat(Math.abs(sphericalDistance(d.from,d.to)-d.metres)<=0.6,'distance mismatch:'+s.id);}catch{errors.push('invalid distance:'+s.id);}
      requireThat(d.method==='unit-vector-mean-earth-sphere'&&d.walking===false,'distance method misrepresented');
      refs(d.sourceRefs,s.id+':distance');
      requireThat((pts||[]).some(p=>samePoint(p,d.from)&&p.sourceRefs.every(id=>d.sourceRefs.includes(id)))&&(s.magnets||[]).some(p=>p.name===d.toName&&samePoint(p.point,d.to)&&p.sourceRefs.every(id=>d.sourceRefs.includes(id))),'distance endpoint/source mismatch:'+s.id);
    }
  }
  const rec=b.reconciliation;
  requireThat(Array.isArray(rec)&&rec.length===12,'twelve assertion reconciliations required');
  requireThat(new Set((rec||[]).map(r=>r.caseId)).size===12,'duplicate assertion identity');
  for(const r of rec||[]){requireThat(r.subjectId===null||ids.has(r.subjectId),'unknown reconciled subject');requireThat(r.numericExpectation==='NOT_GROUNDED'&&r.calibrationStatus==='FAIL','unsupported expectation cannot be promoted');requireThat(r.modelError==='NOT_PROVEN','no proven scoring bug in this benchmark');}
  return {integrity:errors.length?'FAIL':'PASS',errors,subjects:b.subjects.length,supportedIdentity,corroboratedCoordinates,geographicAcceptance:'HOLD',commercialRelease:'HOLD'};
}
module.exports={hash,inside,pointValid,sphericalDistance,validateBenchmark};
if(require.main===module){const root=process.cwd();const file=process.argv[2]||'docs/location/independent-benchmark/v1/benchmark.json';try{const result=validateBenchmark(JSON.parse(fs.readFileSync(inside(root,file),'utf8')),root);console.log(JSON.stringify(result,null,2));process.exitCode=result.integrity==='PASS'?0:1;}catch(e){console.error(String(e));process.exitCode=1;}}
