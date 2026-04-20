/**
 * Control validation — 10 targeted cases for pass-1 tuning check.
 * Uses UPDATED config (airport 2000, competitorPressureMax 15, office *0.72, soft-cap 0.60).
 * Compares against stored BEFORE scores from validation-results.json.
 *
 * Usage: node scripts/validate-control-10.mjs
 */

import { writeFileSync, readFileSync } from 'fs';

// ── Config (TUNED — pass 1) ───────────────────────────────────────────────────
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
  metro:1200, airport:2000, attraction:1000, hospital:1000,       // ← airport 3500→2000
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
  competitorCloseRadius:500, competitorPressureMax:15,              // ← 20→15
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
function distanceDecay(m){
  return 1/(1+Math.pow(m/GRAVITY_CONFIG.distanceDecayRefDist,GRAVITY_CONFIG.distanceDecayPower));
}

// ── Classification (unchanged from production) ─────────────────────────────────
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
        headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'asi-location-control/1.0'},
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

// ── Scoring (TUNED — pass 1) ───────────────────────────────────────────────────
function effectiveBusinessWeight(baseWeight,subType){
  switch(subType){
    case 'office_anon': return baseWeight*0.45;
    case 'industrial': return baseWeight*0.55;
    case 'factory': return baseWeight*0.55;
    case 'commercial': return baseWeight*0.65;
    case 'bank': return baseWeight*0.55;
    default: return baseWeight*0.72;   // ← named office: was full weight
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
  // Soft cap above 80: compresses without flattening mid-range (pass-1 decompression)
  const rawCapped=rawScore<=80?rawScore:80+(rawScore-80)*0.60;
  const evergreenIndex=Math.max(5,Math.min(100,Math.round(rawCapped)));
  const scoreBand=evergreenIndex>=70?'strong':evergreenIndex>=45?'medium':'weak';
  const demandType=inferDemandType(magnets);
  const cpLevel=competitorPressure<6?'low':competitorPressure<14?'medium':'high';
  const hasMetro=magnets.some(m=>m.categoryId==='metro'&&m.distance<=1500);
  const sorted=[...magnets].sort((a,b)=>b.attractionScore-a.attractionScore);
  const topMagnets=sorted.slice(0,3).map(m=>({name:m.name,cat:m.categoryId,dist:Math.round(m.distance),score:+m.attractionScore.toFixed(2)}));

  return {
    evergreenIndex, scoreBand, demandType,
    totalMagnets:magnets.length,
    competitorCount:competitors.length,
    competitorPressureLevel:cpLevel,
    clusterDetected, clusterSize,
    demandDistribution, hasMetro,
    stopCount,
    rawScoreDebug: +rawScore.toFixed(1),
    rawCappedDebug: +rawCapped.toFixed(1),
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

// ── Control cases (10 hand-picked) ────────────────────────────────────────────
const CONTROL_CASES = [
  // Inflated: airport / transport noise
  {id:20, block:'stress', type:'weak_suburb',  country:'USA',       city:'Queens NY',       name:'Ozone Park',                 lat:40.6786, lon:-73.8464},
  {id:47, block:'stress', type:'remote',       country:'Norway',    city:'Tromsø',          name:'Tromsø city center',         lat:69.6492, lon:18.9553},
  // Inflated: office noise
  {id:12, block:'stress', type:'medium_urban', country:'Germany',   city:'Berlin',          name:'Prenzlauer Berg',            lat:52.5380, lon:13.4194},
  {id:45, block:'stress', type:'rural',        country:'Russia',    city:'Pereslavl-Zalessky', name:'Переславль-Залесский центр', lat:56.7387, lon:38.8552},
  {id:54, block:'market', type:'weak_urban',   country:'Germany',   city:'Berlin',          name:'Wedding district',           lat:52.5427, lon:13.3649},
  // Crushed by competitor pressure
  {id:44, block:'stress', type:'rural',        country:'Italy',     city:'Siena',           name:'Siena old town / Tuscany',   lat:43.3188, lon:11.3308},
  {id:91, block:'market', type:'medium_urban', country:'Colombia',  city:'Medellín',        name:'El Poblado',                 lat:6.2089,  lon:-75.5690},
  // Strong anchors — must not regress
  {id:1,  block:'stress', type:'strong_urban', country:'USA',       city:'New York',        name:'Times Square',               lat:40.7580, lon:-73.9855},
  {id:37, block:'stress', type:'beach_resort', country:'France',    city:'Cannes',          name:'Promenade de la Croisette',  lat:43.5505, lon:7.0178},
  {id:17, block:'stress', type:'medium_urban', country:'UK',        city:'London',          name:'Clapham Common',             lat:51.4614, lon:-0.1400},
];

// ── Runner ─────────────────────────────────────────────────────────────────────
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function runCase(c){
  console.log(`  [${c.id}] ${c.country} — ${c.name}`);
  let elements=[];
  try{
    elements=await fetchOsmData(c.lat,c.lon);
  }catch(e){
    console.error(`    ✗ fetch error: ${e.message}`);
    return {...c,evergreenIndex:null,scoreBand:'no_data',elementsCount:0};
  }
  const result={...c,elementsCount:elements.length};
  if(elements.length>0){
    try{
      const analysis=buildAnalysis(elements,c.lat,c.lon);
      Object.assign(result,analysis);
    }catch(e){
      result.analysisError=e.message;
      console.error(`    ✗ analysis error: ${e.message}`);
    }
  }
  console.log(`    → idx=${result.evergreenIndex??'–'} (${result.scoreBand??'?'}) raw=${result.rawScoreDebug??'–'} capped=${result.rawCappedDebug??'–'}`);
  return result;
}

async function main(){
  const BEFORE = JSON.parse(readFileSync('scripts/validation-results.json','utf8'));
  const beforeById = Object.fromEntries(BEFORE.map(x=>[x.id,x]));

  console.log('\n=== Location Model — Control Validation (pass 1) ===\n');
  console.log('Changes applied: airport 3500→2000m | competitorPressureMax 20→15 | named-office weight ×0.72 | soft-cap above 80\n');

  const afterResults=[];
  for(const c of CONTROL_CASES){
    const after=await runCase(c);
    afterResults.push(after);
    await sleep(2500);
  }

  // Print before/after table
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log(` ${'#'.padEnd(3)} ${'Name'.padEnd(30)} ${'Type'.padEnd(14)} ${'Before'.padEnd(12)} ${'After'.padEnd(12)} ${'Δ'.padEnd(6)} Note`);
  console.log('────────────────────────────────────────────────────────────────────────────────');
  for(const after of afterResults){
    const before=beforeById[after.id];
    const bIdx=before?.evergreenIndex??'?';
    const aIdx=after.evergreenIndex??'?';
    const bBand=before?.scoreBand??'?';
    const aBand=after.scoreBand??'?';
    const delta=(typeof bIdx==='number'&&typeof aIdx==='number')?aIdx-bIdx:'?';
    const deltaStr=(typeof delta==='number'?(delta>0?'+':'')+delta:'?').padEnd(6);
    const bandChange=bBand===aBand?'':` ${bBand}→${aBand}`;
    console.log(` ${String(after.id).padEnd(3)} ${after.name.padEnd(30)} ${after.type.padEnd(14)} ${String(bIdx).padEnd(4)}(${bBand.padEnd(6)}) ${String(aIdx).padEnd(4)}(${aBand.padEnd(6)}) ${deltaStr}${bandChange}`);
  }
  console.log('────────────────────────────────────────────────────────────────────────────────\n');

  const outPath='scripts/control-10-results.json';
  writeFileSync(outPath,JSON.stringify(afterResults,null,2),'utf8');
  console.log(`Results saved to ${outPath}\n`);
}

main().catch(e=>{console.error('Fatal:',e);process.exit(1);});
