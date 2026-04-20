/**
 * Location Intelligence — 100-case international validation
 * Self-contained ESM script (Node ≥ 18 required for built-in fetch).
 * Queries Overpass directly, runs the full scoring pipeline, writes results to JSON.
 *
 * Usage:  node scripts/validate-locations.mjs
 * Output: scripts/validation-results.json
 */

import { writeFileSync } from 'fs';

// ── Config (from config.ts) ────────────────────────────────────────────────────
const MAGNET_CATEGORIES = [
  { id:'metro',           weight:9,   permanenceType:'permanent', scopeLevel:'regional', strengthClass:'strong' },
  { id:'airport',         weight:8,   permanenceType:'permanent', scopeLevel:'regional', strengthClass:'strong' },
  { id:'attraction',      weight:8,   permanenceType:'permanent', scopeLevel:'city',     strengthClass:'strong' },
  { id:'hospital',        weight:7,   permanenceType:'permanent', scopeLevel:'city',     strengthClass:'strong' },
  { id:'major_hotel',     weight:6,   permanenceType:'permanent', scopeLevel:'district', strengthClass:'strong' },
  { id:'convention',      weight:6,   permanenceType:'permanent', scopeLevel:'city',     strengthClass:'strong' },
  { id:'university',      weight:6,   permanenceType:'permanent', scopeLevel:'city',     strengthClass:'medium' },
  { id:'business',        weight:5.5, permanenceType:'permanent', scopeLevel:'district', strengthClass:'medium' },
  { id:'railway_station', weight:5,   permanenceType:'permanent', scopeLevel:'district', strengthClass:'medium' },
  { id:'entertainment',   weight:5,   permanenceType:'semi',      scopeLevel:'city',     strengthClass:'medium' },
  { id:'shopping_major',  weight:5,   permanenceType:'permanent', scopeLevel:'city',     strengthClass:'medium' },
  { id:'stadium',         weight:5,   permanenceType:'semi',      scopeLevel:'city',     strengthClass:'medium' },
  { id:'education_local', weight:1.5, permanenceType:'permanent', scopeLevel:'local',    strengthClass:'weak'   },
  { id:'shopping_local',  weight:1.2, permanenceType:'permanent', scopeLevel:'local',    strengthClass:'weak'   },
  { id:'food',            weight:1,   permanenceType:'semi',      scopeLevel:'local',    strengthClass:'weak'   },
];

const CATEGORY_RADIUS = {
  metro:1200, airport:2000, attraction:1000, hospital:1000,
  major_hotel:800, convention:1000, university:1000, business:1200,
  railway_station:1400, entertainment:800, shopping_major:900, stadium:1500,
  education_local:650, shopping_local:450, food:450, accessibility_stop:550,
};
const CATEGORY_MAX_SHOW = {
  metro:3, airport:2, attraction:3, hospital:2, major_hotel:2,
  convention:2, university:3, business:5, railway_station:3, entertainment:3,
  shopping_major:3, stadium:2, education_local:1, shopping_local:1, food:3,
};
const COMPETITOR_RADIUS = 800;
const PERMANENCE_MULTIPLIER = { permanent:1.25, semi:1.0, temporary:0.65 };
const GRAVITY_CONFIG = {
  distanceDecayRefDist:520, distanceDecayPower:1.55,
  clusterRadius:520, clusterMinMagnets:3, clusterBonusMax:8,
  competitorBaseWeight:2.8, competitorDensityGain:0.14, competitorDensityMax:0.85,
  competitorCloseRadius:500, competitorPressureMax:15,
  accessibilityBonusMax:3.2, accessibilityBonusScale:1.05,
  foodClusterRadius:220, foodClusterMinCount:5, foodClusterWeight:3.2,
  scoreScale:1.94,
};
const FOOT_TRAFFIC_CONFIG = { boostCap:7.5, plausibilityHalfAt:26, neighborRadiusM:380 };

// ── Distance helpers ───────────────────────────────────────────────────────────
function haversine(lat1,lon1,lat2,lon2){
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function clamp01(x){return Math.max(0,Math.min(1,x));}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function distanceDecay(m){
  return 1/(1+Math.pow(m/GRAVITY_CONFIG.distanceDecayRefDist,GRAVITY_CONFIG.distanceDecayPower));
}

// ── Classification ─────────────────────────────────────────────────────────────
const LUXURY_CHAINS = ['marriott','hilton','hyatt','sheraton','radisson','intercontinental',
  'four seasons','ritz','pullman','doubletree','crowne plaza','holiday inn','ramada',
  'wyndham','novotel','mercure','westin','sofitel','renaissance','kempinski',
  'swissôtel','swissotel','shangri-la','fairmont','waldorf','mandarin oriental',
  'okura','lotte hotel','azimut','cosmos hotel','national hotel','metropol','savoy','astoria','lotte'];

function isMajorHotel(t){
  const stars=parseInt(t.stars??'0',10);
  if(stars>=4) return true;
  const n=(t.name??'').toLowerCase();
  return LUXURY_CHAINS.some(c=>n.includes(c));
}

function classifyElement(el){
  const t=el.tags??{};
  if(t.railway==='subway_entrance'||t.station==='subway') return {categoryId:'metro',name:t.name||'Metro'};
  if(t.aeroway==='helipad') return null;
  if(t.aeroway==='aerodrome'||t.aeroway==='terminal'){
    const n=(t.name??'').toLowerCase();
    if(t.aerodrome==='helipad'||/heliport|helipad|\bheli pad\b/i.test(n)) return null;
    return {categoryId:'airport',name:t.name||'Airport'};
  }
  if(t.tourism==='attraction'||t.tourism==='museum'||t.tourism==='gallery'||t.historic==='monument')
    return {categoryId:'attraction',name:t.name||'Attraction'};
  if(t.amenity==='hospital'||t.healthcare==='hospital') return {categoryId:'hospital',name:t.name||'Hospital'};
  if(t.tourism==='hotel'){
    if(isMajorHotel(t)) return {categoryId:'major_hotel',name:t.name||'Major Hotel'};
    return {categoryId:'competitor',name:t.name||'Hotel'};
  }
  if(t.amenity==='conference_centre'||t.amenity==='exhibition_centre'||t.amenity==='convention_centre')
    return {categoryId:'convention',name:t.name||'Convention Centre'};
  if(t.amenity==='university') return {categoryId:'university',name:t.name||'University'};
  if(t.amenity==='college') return {categoryId:'education_local',name:t.name||'College'};
  if(t.amenity==='bus_station') return {categoryId:'railway_station',name:t.name||'Bus Station'};
  if(t.railway==='station'||t.railway==='halt') return {categoryId:'railway_station',name:t.name||'Station'};
  if(t.amenity==='cinema'||t.amenity==='theatre'||t.amenity==='arts_centre'||t.amenity==='nightclub')
    return {categoryId:'entertainment',name:t.name||t.amenity||'Entertainment'};
  if(t.shop==='mall'||t.shop==='department_store') return {categoryId:'shopping_major',name:t.name||'Mall'};
  if(t.leisure==='stadium') return {categoryId:'stadium',name:t.name||'Stadium'};
  if(t.leisure==='sports_centre'&&t.name) return {categoryId:'stadium',name:t.name,subType:'sports_centre'};
  if(t.man_made==='works') return {categoryId:'business',name:t.name||'Works',subType:'factory'};
  if(t.landuse==='industrial') return {categoryId:'business',name:t.name||'Industrial Zone',subType:'industrial'};
  if(t.building==='industrial') return {categoryId:'business',name:t.name||'Industrial Building',subType:'factory'};
  if(t.landuse==='commercial') return {categoryId:'business',name:t.name||'Commercial Zone',subType:'commercial'};
  if(t.amenity==='bank') return {categoryId:'business',name:t.name||'Bank',subType:'bank'};
  if(t.office){
    const hasName=Boolean(t.name&&t.name.trim());
    return {categoryId:'business',name:t.name||'Office',subType:hasName?'office':'office_anon'};
  }
  if(t.highway==='bus_stop'||t.public_transport==='stop_position'||t.public_transport==='platform'||t.railway==='tram_stop')
    return {categoryId:'accessibility_stop',name:t.name||'Stop'};
  if(t.shop==='supermarket'||t.shop==='convenience') return {categoryId:'shopping_local',name:t.name||'Supermarket'};
  if(t.amenity==='restaurant'||t.amenity==='cafe'||t.amenity==='fast_food'||t.amenity==='bar'||t.amenity==='pub')
    return {categoryId:'food',name:t.name||t.amenity||'Cafe'};
  if(t.tourism==='apartment'||t.tourism==='guest_house'||t.tourism==='hostel'||t.tourism==='motel')
    return {categoryId:'competitor',name:t.name||t.tourism||'STR'};
  return null;
}

// ── Overpass fetch ─────────────────────────────────────────────────────────────
const ENDPOINTS=['https://overpass-api.de/api/interpreter','https://z.overpass-api.de/api/interpreter'];

function makeAround(filter,radius,lat,lon,all){
  if(!all) return [`node[${filter}](around:${radius},${lat},${lon});`];
  return [`node[${filter}](around:${radius},${lat},${lon});`,
          `way[${filter}](around:${radius},${lat},${lon});`,
          `relation[${filter}](around:${radius},${lat},${lon});`];
}

function buildClauses(lat,lon,rScale,broad){
  const sel=[
    {f:'"railway"="subway_entrance"',r:CATEGORY_RADIUS.metro,s:true},
    {f:'"station"="subway"',r:CATEGORY_RADIUS.metro,s:true},
    {f:'"aeroway"="aerodrome"',r:CATEGORY_RADIUS.airport,s:true},
    {f:'"aeroway"="terminal"',r:CATEGORY_RADIUS.airport,s:false},
    {f:'"tourism"="attraction"',r:CATEGORY_RADIUS.attraction,s:true},
    {f:'"historic"="monument"',r:CATEGORY_RADIUS.attraction,s:true},
    {f:'"tourism"="museum"',r:CATEGORY_RADIUS.attraction,s:true},
    {f:'"tourism"="gallery"',r:CATEGORY_RADIUS.attraction,s:false},
    {f:'"amenity"="hospital"',r:CATEGORY_RADIUS.hospital,s:true},
    {f:'"healthcare"="hospital"',r:CATEGORY_RADIUS.hospital,s:false},
    {f:'"tourism"="hotel"',r:CATEGORY_RADIUS.major_hotel,s:true},
    {f:'"amenity"="conference_centre"',r:CATEGORY_RADIUS.convention,s:true},
    {f:'"amenity"="exhibition_centre"',r:CATEGORY_RADIUS.convention,s:false},
    {f:'"amenity"="convention_centre"',r:CATEGORY_RADIUS.convention,s:false},
    {f:'"amenity"="university"',r:CATEGORY_RADIUS.university,s:true},
    {f:'"amenity"="college"',r:CATEGORY_RADIUS.education_local,s:false},
    {f:'"office"',r:CATEGORY_RADIUS.business,s:true},
    {f:'"amenity"="bank"',r:CATEGORY_RADIUS.business,s:false},
    {f:'"landuse"="industrial"',r:CATEGORY_RADIUS.business,s:false},
    {f:'"man_made"="works"',r:CATEGORY_RADIUS.business,s:false},
    {f:'"building"="industrial"',r:CATEGORY_RADIUS.business,s:false},
    {f:'"landuse"="commercial"',r:CATEGORY_RADIUS.business,s:false},
    {f:'"railway"="station"',r:CATEGORY_RADIUS.railway_station,s:true},
    {f:'"railway"="halt"',r:CATEGORY_RADIUS.railway_station,s:false},
    {f:'"amenity"="bus_station"',r:CATEGORY_RADIUS.railway_station,s:true},
    {f:'"amenity"="cinema"',r:CATEGORY_RADIUS.entertainment,s:true},
    {f:'"amenity"="theatre"',r:CATEGORY_RADIUS.entertainment,s:true},
    {f:'"amenity"="arts_centre"',r:CATEGORY_RADIUS.entertainment,s:true},
    {f:'"amenity"="nightclub"',r:CATEGORY_RADIUS.entertainment,s:false},
    {f:'"shop"="mall"',r:CATEGORY_RADIUS.shopping_major,s:true},
    {f:'"shop"="department_store"',r:CATEGORY_RADIUS.shopping_major,s:true},
    {f:'"leisure"="stadium"',r:CATEGORY_RADIUS.stadium,s:true},
    {f:'"leisure"="sports_centre"',r:CATEGORY_RADIUS.stadium,s:false},
    {f:'"highway"="bus_stop"',r:CATEGORY_RADIUS.accessibility_stop,s:true},
    {f:'"public_transport"="stop_position"',r:CATEGORY_RADIUS.accessibility_stop,s:true},
    {f:'"public_transport"="platform"',r:CATEGORY_RADIUS.accessibility_stop,s:false},
    {f:'"railway"="tram_stop"',r:CATEGORY_RADIUS.accessibility_stop,s:false},
    {f:'"shop"="supermarket"',r:CATEGORY_RADIUS.shopping_local,s:true},
    {f:'"amenity"="restaurant"',r:CATEGORY_RADIUS.food,s:true},
    {f:'"amenity"="cafe"',r:CATEGORY_RADIUS.food,s:true},
    {f:'"amenity"="fast_food"',r:CATEGORY_RADIUS.food,s:true},
    {f:'"amenity"="bar"',r:CATEGORY_RADIUS.food,s:false},
    {f:'"tourism"="apartment"',r:COMPETITOR_RADIUS,s:true},
    {f:'"tourism"="guest_house"',r:COMPETITOR_RADIUS,s:true},
    {f:'"tourism"="hostel"',r:COMPETITOR_RADIUS,s:true},
    {f:'"tourism"="motel"',r:COMPETITOR_RADIUS,s:false},
  ];
  const parts=[];
  for(const s of sel){
    if(!broad&&!s.s) continue;
    const r=Math.max(150,Math.round(s.r*rScale));
    parts.push(...makeAround(s.f,r,lat,lon,broad));
  }
  return parts;
}

function chunk(arr,size){
  const out=[];
  for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out;
}

function dedupeElements(els){
  const m=new Map();
  for(const e of els) m.set(`${e.type}:${e.id}`,e);
  return [...m.values()];
}

async function fetchQuery(query){
  for(const ep of ENDPOINTS){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),25000);
    try{
      const res=await fetch(ep,{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'asi-location-validation/1.0'},
        body:`data=${encodeURIComponent(query)}`,
        signal:ctrl.signal,
      });
      if(!res.ok) continue;
      const j=await res.json();
      return j.elements??[];
    }catch{continue;}
    finally{clearTimeout(timer);}
  }
  return [];
}

async function fetchByBatches(clauses){
  const all=[];
  for(const part of chunk(clauses,10)){
    const q=`[out:json][timeout:20];(${part.join('')});out center;`;
    const els=await fetchQuery(q);
    all.push(...els);
    await sleep(300);
  }
  return dedupeElements(all);
}

async function fetchOsmData(lat,lon){
  const strict=buildClauses(lat,lon,1,false);
  const strictEls=await fetchByBatches(strict);
  if(strictEls.length>=12) return strictEls;
  const broad=buildClauses(lat,lon,1.4,true);
  const broadEls=await fetchByBatches(broad);
  return dedupeElements([...strictEls,...broadEls]);
}

// ── Scoring ────────────────────────────────────────────────────────────────────
function effectiveBusinessWeight(baseWeight,subType){
  switch(subType){
    case 'office_anon': return baseWeight*0.45;
    case 'industrial': return baseWeight*0.55;
    case 'factory': return baseWeight*0.55;
    case 'commercial': return baseWeight*0.65;
    case 'bank': return baseWeight*0.55;
    default: return baseWeight*0.72;
  }
}

function calcMagnetAttraction(weight,permanenceType,dist){
  return weight*PERMANENCE_MULTIPLIER[permanenceType]*distanceDecay(dist);
}

function calcCompetitorPressure(competitors){
  if(!competitors.length) return 0;
  let p=0;
  for(const c of competitors) p+=GRAVITY_CONFIG.competitorBaseWeight*distanceDecay(c.distance);
  const close=competitors.filter(c=>c.distance<=GRAVITY_CONFIG.competitorCloseRadius).length;
  const dm=1+Math.min(close*GRAVITY_CONFIG.competitorDensityGain,GRAVITY_CONFIG.competitorDensityMax);
  return Math.min(p*dm,GRAVITY_CONFIG.competitorPressureMax);
}

function isDestinationMagnet(m){return m.strengthClass==='strong'||m.strengthClass==='medium';}

function calcClusterBonus(magnets){
  const nearby=magnets.filter(m=>m.distance<=GRAVITY_CONFIG.clusterRadius&&isDestinationMagnet(m));
  const sz=nearby.length;
  if(sz<GRAVITY_CONFIG.clusterMinMagnets) return {bonus:0,clusterSize:0};
  const bonus=Math.min(GRAVITY_CONFIG.clusterBonusMax,(sz-GRAVITY_CONFIG.clusterMinMagnets+1)*1.9);
  return {bonus,clusterSize:sz};
}

function detectDemandDistribution(magnets){
  if(magnets.length<2) return 'weak';
  const total=magnets.reduce((s,m)=>s+m.attractionScore,0);
  if(total===0) return 'weak';
  const byC={};
  for(const m of magnets) byC[m.categoryId]=(byC[m.categoryId]??0)+m.attractionScore;
  const maxShare=Math.max(...Object.values(byC))/total;
  if(maxShare>=0.55) return 'concentrated';
  if(Object.keys(byC).length>=3) return 'split';
  return 'weak';
}

function inferDemandType(magnets){
  if(!magnets.length) return 'mixed';
  const byC={};
  for(const m of magnets) byC[m.categoryId]=(byC[m.categoryId]??0)+(Number.isFinite(m.attractionScore)?m.attractionScore:0);
  const total=Object.values(byC).reduce((s,v)=>s+v,0);
  if(total<=0) return 'mixed';
  const ap=byC.airport??0;
  if(ap>0&&(ap/total>=0.11||ap>=9)) return 'transport-led';
  const transport=(byC.metro??0)+(byC.railway_station??0);
  const business=(byC.business??0)+(byC.hospital??0)*0.6+(byC.convention??0)*0.8+(byC.major_hotel??0)*0.4;
  const tourism=(byC.attraction??0)+(byC.entertainment??0)+(byC.shopping_major??0)+(byC.stadium??0)*0.5;
  const sh={transport:transport/total,business:business/total,tourism:tourism/total};
  if(sh.transport>=0.45&&sh.transport>=sh.business+0.10&&sh.transport>=sh.tourism+0.10) return 'transport-led';
  if(sh.business>=0.48&&sh.business>=sh.transport+0.08&&sh.business>=sh.tourism+0.08) return 'business-led';
  if(sh.tourism>=0.48&&sh.tourism>=sh.transport+0.08&&sh.tourism>=sh.business+0.08) return 'tourism-led';
  return 'mixed';
}

function calcAccessibilityBonus(n){
  if(n<=0) return 0;
  return Math.min(GRAVITY_CONFIG.accessibilityBonusMax,Math.log1p(n)*GRAVITY_CONFIG.accessibilityBonusScale);
}

// Foot traffic (simplified)
function computeFootTraffic(magnets,stopCount,clusterDetected,clusterSize,demandDistribution,baseAttractionScaled){
  if(!magnets.length) return {modifierTier:'weak',boostPoints:0};
  const FLOW={
    metro:{t:0.45,l:0.1,d:0.45}, airport:{t:0.65,l:0.05,d:0.30},
    railway_station:{t:0.4,l:0.05,d:0.55}, hospital:{t:0.08,l:0.22,d:0.70},
    major_hotel:{t:0.10,l:0.25,d:0.65}, convention:{t:0.10,l:0.10,d:0.80},
    attraction:{t:0.05,l:0.10,d:0.85}, university:{t:0.05,l:0.10,d:0.85},
    shopping_major:{t:0.05,l:0.10,d:0.85}, stadium:{t:0.20,l:0.15,d:0.65},
    entertainment:{t:0.08,l:0.22,d:0.70}, food:{t:0.12,l:0.68,d:0.20},
    shopping_local:{t:0.12,l:0.68,d:0.20}, education_local:{t:0.12,l:0.68,d:0.20},
    business:{t:0.18,l:0.52,d:0.30},
  };
  let transit=clamp01(Math.sqrt(stopCount/10));
  let local=0,dest=0;
  const maxA=Math.max(...magnets.map(m=>m.attractionScore),1e-6);
  for(const m of magnets){
    const w=FLOW[m.categoryId]??{t:0.20,l:0.50,d:0.30};
    const n=m.attractionScore/maxA;
    transit+=w.t*n*0.85; local+=w.l*n; dest+=w.d*n;
  }
  transit=clamp01(transit); local=clamp01(local*0.95); dest=clamp01(dest);
  const sum=transit+local+dest+1e-4;
  const destinationShare=dest/sum;
  let stability=(clusterDetected?0.38:0.12)+(demandDistribution==='concentrated'?0.34:demandDistribution==='split'?0.18:0.08);
  stability=clamp01(stability+Math.min(0.2,clusterSize*0.04));
  const plausibility=clamp01(baseAttractionScaled/FOOT_TRAFFIC_CONFIG.plausibilityHalfAt);
  const intentAlign=clamp01(0.28+0.72*destinationShare);
  const antiTransit=clamp01(0.35+0.65*(destinationShare/(transit/sum+0.35)));
  let modifierTier='weak';
  if(destinationShare>=0.5&&plausibility>=0.18&&(clusterDetected||demandDistribution==='concentrated')) modifierTier='strong';
  else if(destinationShare>=0.36&&plausibility>=0.12) modifierTier='moderate';
  const tierCore=modifierTier==='strong'?6.2:modifierTier==='moderate'?3.5:1.1;
  let boost=tierCore*plausibility*intentAlign*antiTransit*(0.55+0.45*stability);
  boost=Math.min(boost,FOOT_TRAFFIC_CONFIG.boostCap);
  if(plausibility<0.06) boost=0;
  return {modifierTier,boostPoints:Math.round(boost),stability01:stability,destinationShare};
}

function buildAnalysis(elements,lat,lon){
  const byCategory={};
  const competitors=[];
  let stopCount=0;

  for(const el of elements){
    const elLat=el.lat??el.center?.lat;
    const elLon=el.lon??el.center?.lon;
    if(!elLat||!elLon) continue;
    const cls=classifyElement(el);
    if(!cls) continue;
    const dist=haversine(lat,lon,elLat,elLon);
    if(cls.categoryId==='competitor'){competitors.push({name:cls.name,distance:dist});continue;}
    if(cls.categoryId==='accessibility_stop'){stopCount++;continue;}
    if(cls.categoryId==='major_hotel') competitors.push({name:cls.name,distance:dist});
    const cat=MAGNET_CATEGORIES.find(c=>c.id===cls.categoryId);
    if(!cat) continue;
    if(!byCategory[cls.categoryId]) byCategory[cls.categoryId]=[];
    const ew=cls.categoryId==='business'?effectiveBusinessWeight(cat.weight,cls.subType):cat.weight;
    byCategory[cls.categoryId].push({
      categoryId:cat.id,name:cls.name,subType:cls.subType,
      distance:dist,weight:ew,permanenceType:cat.permanenceType,
      scopeLevel:cat.scopeLevel,strengthClass:cat.strengthClass,
      attractionScore:calcMagnetAttraction(ew,cat.permanenceType,dist),
    });
  }

  // Food cluster upgrade
  const foodItems=byCategory.food;
  if(foodItems?.length){
    const clustered=foodItems.filter(f=>f.distance<=GRAVITY_CONFIG.foodClusterRadius).length;
    if(clustered>=GRAVITY_CONFIG.foodClusterMinCount){
      const w=GRAVITY_CONFIG.foodClusterWeight;
      for(const f of foodItems){
        if(f.distance>GRAVITY_CONFIG.foodClusterRadius+90) continue;
        f.weight=w; f.strengthClass='medium'; f.scopeLevel='district';
        f.attractionScore=calcMagnetAttraction(w,f.permanenceType,f.distance);
      }
    }
  }

  const magnets=[];
  const magnetCountByCategory={};
  for(const cat of MAGNET_CATEGORIES){
    const items=(byCategory[cat.id]??[]).sort((a,b)=>a.distance-b.distance);
    magnetCountByCategory[cat.id]=items.length;
    magnets.push(...items.slice(0,CATEGORY_MAX_SHOW[cat.id]??3));
  }
  competitors.sort((a,b)=>a.distance-b.distance);

  const totalAttr=magnets.reduce((s,m)=>s+m.attractionScore,0);
  const competitorPressure=calcCompetitorPressure(competitors);
  const {bonus:clusterBonus,clusterSize}=calcClusterBonus(magnets);
  const accessBonus=calcAccessibilityBonus(stopCount);
  const rawBase=totalAttr*GRAVITY_CONFIG.scoreScale-competitorPressure+clusterBonus+accessBonus;
  const demandDistribution=detectDemandDistribution(magnets);
  const clusterDetected=clusterSize>=GRAVITY_CONFIG.clusterMinMagnets;
  const baseAttrScaled=totalAttr*GRAVITY_CONFIG.scoreScale;
  const ft=computeFootTraffic(magnets,stopCount,clusterDetected,clusterSize,demandDistribution,baseAttrScaled);
  const rawScore=rawBase+ft.boostPoints;
  const rawCapped=rawScore<=80?rawScore:80+(rawScore-80)*0.60;
  const evergreenIndex=Math.max(5,Math.min(100,Math.round(rawCapped)));
  const scoreBand=evergreenIndex>=70?'strong':evergreenIndex>=45?'medium':'weak';
  const demandType=inferDemandType(magnets);
  const cpLevel=competitorPressure<6?'low':competitorPressure<14?'medium':'high';
  const hasMetro=magnets.some(m=>m.categoryId==='metro'&&m.distance<=1500);
  const sorted=[...magnets].sort((a,b)=>b.attractionScore-a.attractionScore);
  const topMagnets=sorted.slice(0,3).map(m=>({name:m.name,cat:m.categoryId,dist:Math.round(m.distance),score:+m.attractionScore.toFixed(2)}));

  return {
    evergreenIndex,scoreBand,demandType,
    totalMagnets:magnets.length,
    competitorCount:competitors.length,
    competitorPressureLevel:cpLevel,
    clusterDetected,clusterSize,
    demandDistribution,hasMetro,
    stopCount,
    scoreBreakdown:{
      attraction:Math.round(baseAttrScaled),
      competitorPressure:Math.round(competitorPressure),
      clusterBonus:Math.round(clusterBonus),
      trafficBoost:ft.boostPoints,
    },
    footTrafficTier:ft.modifierTier,
    topMagnets,
    magnetCountByCategory,
  };
}

// ── Test cases ─────────────────────────────────────────────────────────────────
const CASES = [
  // ═══════════════════════════════════════════════════════════════════════════
  //  БЛОК 1 — СТРЕСС-ПРОВЕРКА (50 кейсов)
  // ═══════════════════════════════════════════════════════════════════════════

  // -- Сильный городской центр (10) --
  {id:1,  block:'stress', type:'strong_urban',    country:'USA',         city:'New York',        name:'Times Square',                          lat:40.7580, lon:-73.9855},
  {id:2,  block:'stress', type:'strong_urban',    country:'Japan',       city:'Tokyo',           name:'Shinjuku Station area',                  lat:35.6896, lon:139.6994},
  {id:3,  block:'stress', type:'strong_urban',    country:'UK',          city:'London',          name:'Covent Garden',                          lat:51.5118, lon:-0.1240},
  {id:4,  block:'stress', type:'strong_urban',    country:'France',      city:'Paris',           name:'Opéra / Grands Boulevards',              lat:48.8716, lon:2.3297},
  {id:5,  block:'stress', type:'strong_urban',    country:'Russia',      city:'Moscow',          name:'Старый Арбат',                           lat:55.7485, lon:37.5952},
  {id:6,  block:'stress', type:'strong_urban',    country:'Brazil',      city:'São Paulo',       name:'Praça da Sé',                            lat:-23.5505, lon:-46.6333},
  {id:7,  block:'stress', type:'strong_urban',    country:'Turkey',      city:'Istanbul',        name:'Taksim Meydanı',                         lat:41.0369, lon:28.9850},
  {id:8,  block:'stress', type:'strong_urban',    country:'HongKong',    city:'Hong Kong',       name:'Causeway Bay',                           lat:22.2800, lon:114.1838},
  {id:9,  block:'stress', type:'strong_urban',    country:'UK',          city:'London',          name:'Canary Wharf financial district',        lat:51.5054, lon:-0.0235},
  {id:10, block:'stress', type:'strong_urban',    country:'UAE',         city:'Dubai',           name:'Dubai Marina',                           lat:25.0819, lon:55.1407},

  // -- Средний городской район (8) --
  {id:11, block:'stress', type:'medium_urban',    country:'Russia',      city:'Moscow',          name:'Хамовники',                              lat:55.7299, lon:37.5757},
  {id:12, block:'stress', type:'medium_urban',    country:'Germany',     city:'Berlin',          name:'Prenzlauer Berg',                        lat:52.5380, lon:13.4194},
  {id:13, block:'stress', type:'medium_urban',    country:'USA',         city:'Brooklyn NY',     name:'Williamsburg',                           lat:40.7128, lon:-73.9638},
  {id:14, block:'stress', type:'medium_urban',    country:'Turkey',      city:'Istanbul',        name:'Kadıköy',                                lat:40.9905, lon:29.0237},
  {id:15, block:'stress', type:'medium_urban',    country:'China',       city:'Beijing',         name:'Chaoyang Park area',                     lat:39.9332, lon:116.4669},
  {id:16, block:'stress', type:'medium_urban',    country:'Argentina',   city:'Buenos Aires',    name:'Palermo',                                lat:-34.5763, lon:-58.4244},
  {id:17, block:'stress', type:'medium_urban',    country:'UK',          city:'London',          name:'Clapham Common',                         lat:51.4614, lon:-0.1400},
  {id:18, block:'stress', type:'medium_urban',    country:'Spain',       city:'Barcelona',       name:'Eixample',                               lat:41.3951, lon:2.1589},

  // -- Слабая окраина / пригород (5) --
  {id:19, block:'stress', type:'weak_suburb',     country:'Russia',      city:'Moscow Oblast',   name:'Люберцы',                                lat:55.6769, lon:37.8942},
  {id:20, block:'stress', type:'weak_suburb',     country:'USA',         city:'Queens NY',       name:'Ozone Park',                             lat:40.6786, lon:-73.8464},
  {id:21, block:'stress', type:'weak_suburb',     country:'France',      city:'Paris suburb',    name:'Évry-Courcouronnes',                     lat:48.6273, lon:2.4355},
  {id:22, block:'stress', type:'weak_suburb',     country:'India',       city:'Mumbai suburb',   name:'Mira Road',                              lat:19.2855, lon:72.8622},
  {id:23, block:'stress', type:'weak_suburb',     country:'Turkey',      city:'Yalova',          name:'Yalova city center',                     lat:40.6515, lon:29.2742},

  // -- Транспортная локация (4) --
  {id:24, block:'stress', type:'transport',       country:'Germany',     city:'Frankfurt',       name:'Frankfurt Airport vicinity',             lat:50.0333, lon:8.5706},
  {id:25, block:'stress', type:'transport',       country:'UK',          city:'London',          name:"King's Cross St Pancras",                lat:51.5308, lon:-0.1238},
  {id:26, block:'stress', type:'transport',       country:'Russia',      city:'Moscow',          name:'Внуково (зона аэропорта)',                lat:55.5985, lon:37.2627},
  {id:27, block:'stress', type:'transport',       country:'UAE',         city:'Dubai',           name:'Dubai Airport vicinity',                 lat:25.2532, lon:55.3657},

  // -- Медицинская локация (3) --
  {id:28, block:'stress', type:'medical',         country:'UK',          city:'London',          name:'Royal London Hospital area',             lat:51.5194, lon:-0.0604},
  {id:29, block:'stress', type:'medical',         country:'Russia',      city:'Moscow',          name:'Сеченовский медицинский кластер',        lat:55.7356, lon:37.5654},
  {id:30, block:'stress', type:'medical',         country:'USA',         city:'Baltimore',       name:'Johns Hopkins Medical Campus',           lat:39.2965, lon:-76.5927},

  // -- Выставочная / конгресс-зона (3) --
  {id:31, block:'stress', type:'convention',      country:'UK',          city:'London',          name:'ExCeL London',                           lat:51.5074, lon:0.0328},
  {id:32, block:'stress', type:'convention',      country:'Russia',      city:'Moscow',          name:'Экспоцентр',                             lat:55.7488, lon:37.5341},
  {id:33, block:'stress', type:'convention',      country:'USA',         city:'Las Vegas',       name:'Las Vegas Convention Center',            lat:36.1293, lon:-115.1523},

  // -- Промышленная / логистическая зона (3) --
  {id:34, block:'stress', type:'industrial',      country:'Germany',     city:'Stuttgart',       name:'Stuttgart industrial zone (Bad Cannstatt)',lat:48.8073, lon:9.2269},
  {id:35, block:'stress', type:'industrial',      country:'Russia',      city:'Moscow',          name:'Печатники (промзона)',                   lat:55.6882, lon:37.6984},
  {id:36, block:'stress', type:'industrial',      country:'China',       city:'Zhengzhou',       name:'Zhengzhou Logistics Hub',                lat:34.7472, lon:113.6249},

  // -- Пляжная / курортная (4) --
  {id:37, block:'stress', type:'beach_resort',    country:'France',      city:'Cannes',          name:'Promenade de la Croisette',              lat:43.5505, lon:7.0178},
  {id:38, block:'stress', type:'beach_resort',    country:'Thailand',    city:'Pattaya',         name:'Pattaya Beach',                          lat:12.9435, lon:100.8825},
  {id:39, block:'stress', type:'beach_resort',    country:'Brazil',      city:'Rio de Janeiro',  name:'Copacabana beach',                       lat:-22.9715, lon:-43.1822},
  {id:40, block:'stress', type:'beach_resort',    country:'Greece',      city:'Mykonos',         name:'Mykonos Town',                           lat:37.4452, lon:25.3281},

  // -- Горная / ski-курортная (3) --
  {id:41, block:'stress', type:'ski_mountain',    country:'France',      city:'Courchevel',      name:'Courchevel 1850',                        lat:45.4155, lon:6.6343},
  {id:42, block:'stress', type:'ski_mountain',    country:'Switzerland', city:'Davos',           name:'Davos Platz',                            lat:46.8026, lon:9.8354},
  {id:43, block:'stress', type:'ski_mountain',    country:'Russia',      city:'Sochi / Krasnaya Polyana', name:'Красная Поляна',               lat:43.6855, lon:40.2477},

  // -- Сельская / rural (3) --
  {id:44, block:'stress', type:'rural',           country:'Italy',       city:'Siena',           name:'Siena old town / Tuscany',               lat:43.3188, lon:11.3308},
  {id:45, block:'stress', type:'rural',           country:'Russia',      city:'Pereslavl-Zalessky', name:'Переславль-Залесский центр',          lat:56.7387, lon:38.8552},
  {id:46, block:'stress', type:'rural',           country:'France',      city:'Beaune',          name:'Beaune / Burgundy wine region',          lat:47.0260, lon:4.8397},

  // -- Удалённая / low-density (3) --
  {id:47, block:'stress', type:'remote',          country:'Norway',      city:'Tromsø',          name:'Tromsø city center',                     lat:69.6492, lon:18.9553},
  {id:48, block:'stress', type:'remote',          country:'Mongolia',    city:'Ulaanbaatar',     name:'Ulaanbaatar outskirts (ger district)',   lat:47.8864, lon:106.9057},
  {id:49, block:'stress', type:'remote',          country:'Australia',   city:'Alice Springs',   name:'Alice Springs center',                   lat:-23.7000, lon:133.8816},

  // -- Небольшой слабый город (1) --
  {id:50, block:'stress', type:'small_weak_city', country:'Russia',      city:'Kostroma',        name:'Кострома центр',                         lat:57.7679, lon:40.9272},

  // ═══════════════════════════════════════════════════════════════════════════
  //  БЛОК 2 — РЕАЛИСТИЧНАЯ РЫНОЧНАЯ ВЫБОРКА (50 кейсов)
  // ═══════════════════════════════════════════════════════════════════════════

  // -- Европа (12) --
  {id:51,  block:'market', type:'medium_urban',   country:'Sweden',      city:'Stockholm',       name:'Södermalm',                              lat:59.3162, lon:18.0710},
  {id:52,  block:'market', type:'medium_urban',   country:'France',      city:'Paris',           name:"20ème arrondissement (Père Lachaise)",   lat:48.8652, lon:2.4014},
  {id:53,  block:'market', type:'medium_urban',   country:'Poland',      city:'Łódź',            name:'Łódź city center (Piotrkowska St)',       lat:51.7592, lon:19.4553},
  {id:54,  block:'market', type:'weak_urban',     country:'Germany',     city:'Berlin',          name:'Wedding district',                        lat:52.5427, lon:13.3649},
  {id:55,  block:'market', type:'medium_urban',   country:'Italy',       city:'Naples',          name:'Quartieri Spagnoli',                      lat:40.8518, lon:14.2463},
  {id:56,  block:'market', type:'medium_urban',   country:'Slovakia',    city:'Bratislava',      name:'Staré Mesto',                             lat:48.1486, lon:17.1077},
  {id:57,  block:'market', type:'strong_urban',   country:'Lithuania',   city:'Vilnius',         name:'Vilnius Old Town',                        lat:54.6872, lon:25.2797},
  {id:58,  block:'market', type:'weak_urban',     country:'Montenegro',  city:'Podgorica',       name:'Podgorica city center',                   lat:42.4414, lon:19.2629},
  {id:59,  block:'market', type:'medium_urban',   country:'Romania',     city:'Bucharest',       name:'Floreasca',                               lat:44.4662, lon:26.0988},
  {id:60,  block:'market', type:'medium_urban',   country:'Malta',       city:'Valletta',        name:'Valletta (Triq ir-Repubblika)',            lat:35.8989, lon:14.5145},
  {id:61,  block:'market', type:'medium_urban',   country:'Belarus',     city:'Minsk',           name:'Prospekt Nezavisimosti center',           lat:53.9006, lon:27.5590},
  {id:62,  block:'market', type:'medium_urban',   country:'Croatia',     city:'Zagreb',          name:'Zagreb city center',                      lat:45.8150, lon:15.9819},

  // -- Россия / СНГ (8) --
  {id:63,  block:'market', type:'strong_urban',   country:'Russia',      city:'Kazan',           name:'Казань центр (Баумана)',                  lat:55.7963, lon:49.1088},
  {id:64,  block:'market', type:'medium_urban',   country:'Russia',      city:'Novosibirsk',     name:'Новосибирск центр (Красный проспект)',    lat:54.9890, lon:82.9040},
  {id:65,  block:'market', type:'medium_urban',   country:'Russia',      city:'Yekaterinburg',   name:'Екатеринбург центр (Ленина)',             lat:56.8389, lon:60.6057},
  {id:66,  block:'market', type:'medium_urban',   country:'Kazakhstan',  city:'Almaty',          name:'Алматы центр (Арбат / Панфилова)',        lat:43.2551, lon:76.9126},
  {id:67,  block:'market', type:'medium_urban',   country:'Uzbekistan',  city:'Tashkent',        name:'Ташкент центр (Бродвей)',                 lat:41.2995, lon:69.2401},
  {id:68,  block:'market', type:'medium_urban',   country:'Azerbaijan',  city:'Baku',            name:'Baku Icherisheher',                       lat:40.4093, lon:49.8671},
  {id:69,  block:'market', type:'medium_urban',   country:'Georgia',     city:'Tbilisi',         name:'Тбилиси Старый Город',                    lat:41.6941, lon:44.8000},
  {id:70,  block:'market', type:'beach_resort',   country:'Russia',      city:'Sochi',           name:'Сочи центр (Морвокзал)',                  lat:43.5992, lon:39.7257},

  // -- Азия (8) --
  {id:71,  block:'market', type:'medium_urban',   country:'India',       city:'Delhi',           name:'Paharganj (Old Delhi tourist)',           lat:28.6450, lon:77.2090},
  {id:72,  block:'market', type:'strong_urban',   country:'Vietnam',     city:'Hanoi',           name:'Hanoi Old Quarter',                       lat:21.0285, lon:105.8542},
  {id:73,  block:'market', type:'beach_resort',   country:'S.Korea',     city:'Busan',           name:'Haeundae Beach area',                     lat:35.1587, lon:129.1600},
  {id:74,  block:'market', type:'strong_urban',   country:'Malaysia',    city:'Kuala Lumpur',    name:'KLCC / Bukit Bintang',                    lat:3.1578,  lon:101.7116},
  {id:75,  block:'market', type:'medium_urban',   country:'Sri Lanka',   city:'Colombo',         name:'Colombo Fort',                            lat:6.9349,  lon:79.8428},
  {id:76,  block:'market', type:'medium_urban',   country:'Nepal',       city:'Kathmandu',       name:'Thamel tourist district',                 lat:27.7156, lon:85.3103},
  {id:77,  block:'market', type:'medium_urban',   country:'Thailand',    city:'Chiang Mai',      name:'Chiang Mai Old City',                     lat:18.7880, lon:98.9860},
  {id:78,  block:'market', type:'medium_urban',   country:'Georgia',     city:'Tbilisi',         name:'Tbilisi Vake district',                   lat:41.7045, lon:44.7741},

  // -- Ближний Восток (4) --
  {id:79,  block:'market', type:'medium_urban',   country:'Jordan',      city:'Amman',           name:'Abdoun (West Amman)',                     lat:31.9539, lon:35.9106},
  {id:80,  block:'market', type:'medium_urban',   country:'Lebanon',     city:'Beirut',          name:'Hamra Street',                            lat:33.8937, lon:35.4837},
  {id:81,  block:'market', type:'medium_urban',   country:'Oman',        city:'Muscat',          name:'Muscat city center (Ruwi)',               lat:23.5880, lon:58.3829},
  {id:82,  block:'market', type:'strong_urban',   country:'Saudi Arabia',city:'Riyadh',          name:'Olaya business district',                 lat:24.6877, lon:46.6855},

  // -- Северная Америка (6) --
  {id:83,  block:'market', type:'strong_urban',   country:'USA',         city:'Chicago',         name:'River North',                             lat:41.8919, lon:-87.6342},
  {id:84,  block:'market', type:'strong_urban',   country:'USA',         city:'Miami',           name:'Brickell',                                lat:25.7551, lon:-80.1934},
  {id:85,  block:'market', type:'medium_urban',   country:'USA',         city:'Austin TX',       name:'Downtown Austin',                         lat:30.2672, lon:-97.7431},
  {id:86,  block:'market', type:'medium_urban',   country:'Canada',      city:'Montreal',        name:'Plateau-Mont-Royal',                      lat:45.5249, lon:-73.5781},
  {id:87,  block:'market', type:'strong_urban',   country:'USA',         city:'Las Vegas',       name:'Las Vegas Strip (main)',                  lat:36.1185, lon:-115.1729},
  {id:88,  block:'market', type:'medium_urban',   country:'USA',         city:'Denver CO',       name:'Cherry Creek',                            lat:39.7175, lon:-104.9520},

  // -- Латинская Америка (4) --
  {id:89,  block:'market', type:'medium_urban',   country:'Peru',        city:'Lima',            name:'Miraflores',                              lat:-12.1210, lon:-77.0280},
  {id:90,  block:'market', type:'medium_urban',   country:'Mexico',      city:'Mexico City',     name:'Zona Rosa / Cuauhtémoc',                  lat:19.4284, lon:-99.1676},
  {id:91,  block:'market', type:'medium_urban',   country:'Colombia',    city:'Medellín',        name:'El Poblado',                              lat:6.2089,  lon:-75.5690},
  {id:92,  block:'market', type:'weak_urban',     country:'Uruguay',     city:'Montevideo',      name:'Ciudad Vieja',                            lat:-34.9033, lon:-56.1882},

  // -- Африка (4) --
  {id:93,  block:'market', type:'strong_urban',   country:'South Africa',city:'Johannesburg',    name:'Sandton CBD',                             lat:-26.1076, lon:28.0567},
  {id:94,  block:'market', type:'medium_urban',   country:'Kenya',       city:'Nairobi',         name:'Westlands',                               lat:-1.2670,  lon:36.8085},
  {id:95,  block:'market', type:'medium_urban',   country:'Egypt',       city:'Cairo',           name:'Zamalek',                                 lat:30.0612, lon:31.2195},
  {id:96,  block:'market', type:'medium_urban',   country:'Nigeria',     city:'Lagos',           name:'Victoria Island',                         lat:6.4300,  lon:3.4229},

  // -- Океания (4) --
  {id:97,  block:'market', type:'medium_urban',   country:'Australia',   city:'Sydney',          name:'Surry Hills',                             lat:-33.8862, lon:151.2099},
  {id:98,  block:'market', type:'medium_urban',   country:'Australia',   city:'Melbourne',       name:'Fitzroy',                                 lat:-37.7978, lon:144.9793},
  {id:99,  block:'market', type:'medium_urban',   country:'New Zealand', city:'Wellington',      name:'Wellington CBD',                          lat:-41.2865, lon:174.7762},
  {id:100, block:'market', type:'ski_mountain',   country:'New Zealand', city:'Queenstown',      name:'Queenstown center',                       lat:-45.0312, lon:168.6626},
];

// ── Runner ─────────────────────────────────────────────────────────────────────
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function runCase(c){
  console.log(`[${c.id}/100] ${c.country} — ${c.name} (${c.lat.toFixed(4)}, ${c.lon.toFixed(4)})`);
  let elements=[];
  let fetchError=null;
  try{
    elements=await fetchOsmData(c.lat,c.lon);
  }catch(e){
    fetchError=e.message;
    console.error(`  ✗ fetch error: ${e.message}`);
  }
  const result={...c,elementsCount:elements.length,fetchError};
  if(elements.length>0){
    try{
      const analysis=buildAnalysis(elements,c.lat,c.lon);
      Object.assign(result,analysis);
    }catch(e){
      result.analysisError=e.message;
      console.error(`  ✗ analysis error: ${e.message}`);
    }
  } else {
    result.evergreenIndex=null;
    result.scoreBand='no_data';
  }
  const band=result.scoreBand??'?';
  const idx=result.evergreenIndex??'–';
  console.log(`  → band=${band} idx=${idx} magnets=${result.totalMagnets??0} elements=${elements.length}`);
  return result;
}

async function main(){
  console.log(`\n=== Location Intelligence Validation — 100 cases ===\n`);
  const results=[];
  for(const c of CASES){
    const r=await runCase(c);
    results.push(r);
    // Rate limit: Overpass allows ~2 req/s per IP; we're doing multiple queries per case, so be polite
    await sleep(2500);
  }
  const outPath='scripts/validation-results.json';
  writeFileSync(outPath,JSON.stringify(results,null,2),'utf8');
  console.log(`\n✓ Done. Results saved to ${outPath}`);

  // Quick summary
  const bands={strong:0,medium:0,weak:0,no_data:0};
  for(const r of results) bands[r.scoreBand]=(bands[r.scoreBand]??0)+1;
  console.log('\nScore distribution:');
  console.log(`  strong  (≥70): ${bands.strong}`);
  console.log(`  medium (45-69): ${bands.medium}`);
  console.log(`  weak   (<45):  ${bands.weak}`);
  console.log(`  no_data:       ${bands.no_data}`);
}

main().catch(e=>{console.error('Fatal:',e);process.exit(1);});
