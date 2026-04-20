/**
 * A/B control validation — scores the SAME fresh OSM data with OLD and NEW model.
 * Fetches once per case, scores twice. Eliminates OSM data drift from comparison.
 *
 * Old model: airport=3500, competitorPressureMax=20, office=full weight, no soft cap
 * New model: airport=2000, competitorPressureMax=15, office×0.72, soft cap above 80
 *
 * Usage: node scripts/validate-control-ab.mjs
 */

import { writeFileSync } from 'fs';

// ── Shared helpers ─────────────────────────────────────────────────────────────
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

const CATEGORY_MAX_SHOW = {
  metro:3, airport:2, attraction:3, hospital:2, major_hotel:2,
  convention:2, university:3, business:5, railway_station:3, entertainment:3,
  shopping_major:3, stadium:2, education_local:1, shopping_local:1, food:3,
};
const COMPETITOR_RADIUS = 800;
const PERMANENCE_MULTIPLIER = { permanent:1.25, semi:1.0, temporary:0.65 };
const BASE_GRAVITY = {
  distanceDecayRefDist:520, distanceDecayPower:1.55,
  clusterRadius:520, clusterMinMagnets:3, clusterBonusMax:8,
  competitorBaseWeight:2.8, competitorDensityGain:0.14, competitorDensityMax:0.85,
  competitorCloseRadius:500,
  accessibilityBonusMax:3.2, accessibilityBonusScale:1.05,
  foodClusterRadius:220, foodClusterMinCount:5, foodClusterWeight:3.2,
  scoreScale:1.94,
};
const FOOT_TRAFFIC_CONFIG = { boostCap:7.5, plausibilityHalfAt:26 };

function haversine(lat1,lon1,lat2,lon2){
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function clamp01(x){return Math.max(0,Math.min(1,x));}
function distanceDecay(m){return 1/(1+Math.pow(m/520,1.55));}

const LUXURY_CHAINS = ['marriott','hilton','hyatt','sheraton','radisson','intercontinental',
  'four seasons','ritz','pullman','doubletree','crowne plaza','holiday inn','ramada',
  'wyndham','novotel','mercure','westin','sofitel','renaissance','kempinski',
  'swissôtel','swissotel','shangri-la','fairmont','waldorf','mandarin oriental',
  'okura','lotte hotel','azimut','cosmos hotel','national hotel','metropol','savoy','astoria','lotte'];

function isMajorHotel(t){
  if(parseInt(t.stars??'0',10)>=4) return true;
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

// ── Scoring engine (configurable) ─────────────────────────────────────────────
function makeScorer(cfg){
  const {airportRadius, competitorPressureMax, officeWeightMul, useSoftCap} = cfg;
  const GC = {...BASE_GRAVITY, competitorPressureMax};

  function effectiveBW(bw,subType){
    switch(subType){
      case 'office_anon': return bw*0.45;
      case 'industrial':  return bw*0.55;
      case 'factory':     return bw*0.55;
      case 'commercial':  return bw*0.65;
      case 'bank':        return bw*0.55;
      default:            return bw*officeWeightMul;
    }
  }

  function calcMagnetAttr(weight,permanenceType,dist){
    return weight*PERMANENCE_MULTIPLIER[permanenceType]*distanceDecay(dist);
  }

  function calcCP(competitors){
    if(!competitors.length) return 0;
    let p=0;
    for(const c of competitors) p+=GC.competitorBaseWeight*distanceDecay(c.distance);
    const close=competitors.filter(c=>c.distance<=GC.competitorCloseRadius).length;
    const dm=1+Math.min(close*GC.competitorDensityGain,GC.competitorDensityMax);
    return Math.min(p*dm,GC.competitorPressureMax);
  }

  function isDestMagnet(m){return m.strengthClass==='strong'||m.strengthClass==='medium';}

  function calcCluster(magnets){
    const nearby=magnets.filter(m=>m.distance<=GC.clusterRadius&&isDestMagnet(m));
    const sz=nearby.length;
    if(sz<GC.clusterMinMagnets) return {bonus:0,clusterSize:0};
    return {bonus:Math.min(GC.clusterBonusMax,(sz-GC.clusterMinMagnets+1)*1.9),clusterSize:sz};
  }

  function detectDD(magnets){
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

  function calcAB(n){
    if(n<=0) return 0;
    return Math.min(GC.accessibilityBonusMax,Math.log1p(n)*GC.accessibilityBonusScale);
  }

  function computeFT(magnets,stopCount,clusterDetected,clusterSize,demandDistribution,baseAttrScaled){
    if(!magnets.length) return {boostPoints:0};
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
    const ds=dest/sum;
    let stab=(clusterDetected?0.38:0.12)+(demandDistribution==='concentrated'?0.34:demandDistribution==='split'?0.18:0.08);
    stab=clamp01(stab+Math.min(0.2,clusterSize*0.04));
    const plaus=clamp01(baseAttrScaled/FOOT_TRAFFIC_CONFIG.plausibilityHalfAt);
    const ia=clamp01(0.28+0.72*ds);
    const at=clamp01(0.35+0.65*(ds/(transit/sum+0.35)));
    let mt='weak';
    if(ds>=0.5&&plaus>=0.18&&(clusterDetected||demandDistribution==='concentrated')) mt='strong';
    else if(ds>=0.36&&plaus>=0.12) mt='moderate';
    const tc=mt==='strong'?6.2:mt==='moderate'?3.5:1.1;
    let boost=tc*plaus*ia*at*(0.55+0.45*stab);
    boost=Math.min(boost,FOOT_TRAFFIC_CONFIG.boostCap);
    if(plaus<0.06) boost=0;
    return {boostPoints:Math.round(boost)};
  }

  function score(elements, lat, lon) {
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

      // Airport: filter by model-specific radius
      if(cls.categoryId==='airport' && dist>airportRadius) continue;

      if(cls.categoryId==='competitor'){competitors.push({name:cls.name,distance:dist});continue;}
      if(cls.categoryId==='accessibility_stop'){stopCount++;continue;}
      if(cls.categoryId==='major_hotel') competitors.push({name:cls.name,distance:dist});
      const cat=MAGNET_CATEGORIES.find(c=>c.id===cls.categoryId);
      if(!cat) continue;
      if(!byCategory[cls.categoryId]) byCategory[cls.categoryId]=[];
      const ew=cls.categoryId==='business'?effectiveBW(cat.weight,cls.subType):cat.weight;
      byCategory[cls.categoryId].push({
        categoryId:cat.id,name:cls.name,subType:cls.subType,
        distance:dist,weight:ew,permanenceType:cat.permanenceType,
        scopeLevel:cat.scopeLevel,strengthClass:cat.strengthClass,
        attractionScore:calcMagnetAttr(ew,cat.permanenceType,dist),
      });
    }

    const foodItems=byCategory.food;
    if(foodItems?.length){
      const clustered=foodItems.filter(f=>f.distance<=GC.foodClusterRadius).length;
      if(clustered>=GC.foodClusterMinCount){
        const w=GC.foodClusterWeight;
        for(const f of foodItems){
          if(f.distance>GC.foodClusterRadius+90) continue;
          f.weight=w; f.strengthClass='medium'; f.scopeLevel='district';
          f.attractionScore=calcMagnetAttr(w,f.permanenceType,f.distance);
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
    const competitorPressure=calcCP(competitors);
    const {bonus:clusterBonus,clusterSize}=calcCluster(magnets);
    const accessBonus=calcAB(stopCount);
    const rawBase=totalAttr*GC.scoreScale-competitorPressure+clusterBonus+accessBonus;
    const demandDistribution=detectDD(magnets);
    const clusterDetected=clusterSize>=GC.clusterMinMagnets;
    const baseAttrScaled=totalAttr*GC.scoreScale;
    const ft=computeFT(magnets,stopCount,clusterDetected,clusterSize,demandDistribution,baseAttrScaled);
    const rawScore=rawBase+ft.boostPoints;
    const rawCapped = useSoftCap ? (rawScore<=80?rawScore:80+(rawScore-80)*0.60) : rawScore;
    const idx=Math.max(5,Math.min(100,Math.round(rawCapped)));
    const band=idx>=70?'strong':idx>=45?'medium':'weak';

    return {
      idx, band,
      rawScore:+rawScore.toFixed(1),
      rawCapped:+rawCapped.toFixed(1),
      breakdown:{
        attraction:Math.round(baseAttrScaled),
        competitorPressure:Math.round(competitorPressure),
        clusterBonus:Math.round(clusterBonus),
        trafficBoost:ft.boostPoints,
      },
      competitorCount:competitors.length,
      totalMagnets:magnets.length,
      magnetCountByCategory,
    };
  }

  return score;
}

const scoreOld = makeScorer({ airportRadius:3500, competitorPressureMax:20, officeWeightMul:1.0,  useSoftCap:false });
const scoreNew = makeScorer({ airportRadius:2000, competitorPressureMax:15, officeWeightMul:0.72, useSoftCap:true  });

// ── Overpass fetch ─────────────────────────────────────────────────────────────
const ENDPOINTS=['https://overpass-api.de/api/interpreter','https://z.overpass-api.de/api/interpreter'];

// Fetch with BROADER radius to make sure both models see all relevant elements
const FETCH_RADIUS = {
  metro:1200, airport:3500, attraction:1000, hospital:1000,
  major_hotel:800, convention:1000, university:1000, business:1200,
  railway_station:1400, entertainment:800, shopping_major:900, stadium:1500,
  education_local:650, shopping_local:450, food:450, accessibility_stop:550,
};

function makeAround(filter,radius,lat,lon,all){
  if(!all) return [`node[${filter}](around:${radius},${lat},${lon});`];
  return [`node[${filter}](around:${radius},${lat},${lon});`,
          `way[${filter}](around:${radius},${lat},${lon});`,
          `relation[${filter}](around:${radius},${lat},${lon});`];
}

function buildClauses(lat,lon,rScale,broad){
  const sel=[
    {f:'"railway"="subway_entrance"',r:FETCH_RADIUS.metro,s:true},
    {f:'"station"="subway"',r:FETCH_RADIUS.metro,s:true},
    {f:'"aeroway"="aerodrome"',r:FETCH_RADIUS.airport,s:true},   // always fetch full 3500m
    {f:'"aeroway"="terminal"',r:FETCH_RADIUS.airport,s:false},
    {f:'"tourism"="attraction"',r:FETCH_RADIUS.attraction,s:true},
    {f:'"historic"="monument"',r:FETCH_RADIUS.attraction,s:true},
    {f:'"tourism"="museum"',r:FETCH_RADIUS.attraction,s:true},
    {f:'"tourism"="gallery"',r:FETCH_RADIUS.attraction,s:false},
    {f:'"amenity"="hospital"',r:FETCH_RADIUS.hospital,s:true},
    {f:'"healthcare"="hospital"',r:FETCH_RADIUS.hospital,s:false},
    {f:'"tourism"="hotel"',r:FETCH_RADIUS.major_hotel,s:true},
    {f:'"amenity"="conference_centre"',r:FETCH_RADIUS.convention,s:true},
    {f:'"amenity"="exhibition_centre"',r:FETCH_RADIUS.convention,s:false},
    {f:'"amenity"="convention_centre"',r:FETCH_RADIUS.convention,s:false},
    {f:'"amenity"="university"',r:FETCH_RADIUS.university,s:true},
    {f:'"amenity"="college"',r:FETCH_RADIUS.education_local,s:false},
    {f:'"office"',r:FETCH_RADIUS.business,s:true},
    {f:'"amenity"="bank"',r:FETCH_RADIUS.business,s:false},
    {f:'"landuse"="industrial"',r:FETCH_RADIUS.business,s:false},
    {f:'"man_made"="works"',r:FETCH_RADIUS.business,s:false},
    {f:'"building"="industrial"',r:FETCH_RADIUS.business,s:false},
    {f:'"landuse"="commercial"',r:FETCH_RADIUS.business,s:false},
    {f:'"railway"="station"',r:FETCH_RADIUS.railway_station,s:true},
    {f:'"railway"="halt"',r:FETCH_RADIUS.railway_station,s:false},
    {f:'"amenity"="bus_station"',r:FETCH_RADIUS.railway_station,s:true},
    {f:'"amenity"="cinema"',r:FETCH_RADIUS.entertainment,s:true},
    {f:'"amenity"="theatre"',r:FETCH_RADIUS.entertainment,s:true},
    {f:'"amenity"="arts_centre"',r:FETCH_RADIUS.entertainment,s:true},
    {f:'"amenity"="nightclub"',r:FETCH_RADIUS.entertainment,s:false},
    {f:'"shop"="mall"',r:FETCH_RADIUS.shopping_major,s:true},
    {f:'"shop"="department_store"',r:FETCH_RADIUS.shopping_major,s:true},
    {f:'"leisure"="stadium"',r:FETCH_RADIUS.stadium,s:true},
    {f:'"leisure"="sports_centre"',r:FETCH_RADIUS.stadium,s:false},
    {f:'"highway"="bus_stop"',r:FETCH_RADIUS.accessibility_stop,s:true},
    {f:'"public_transport"="stop_position"',r:FETCH_RADIUS.accessibility_stop,s:true},
    {f:'"public_transport"="platform"',r:FETCH_RADIUS.accessibility_stop,s:false},
    {f:'"railway"="tram_stop"',r:FETCH_RADIUS.accessibility_stop,s:false},
    {f:'"shop"="supermarket"',r:FETCH_RADIUS.shopping_local,s:true},
    {f:'"amenity"="restaurant"',r:FETCH_RADIUS.food,s:true},
    {f:'"amenity"="cafe"',r:FETCH_RADIUS.food,s:true},
    {f:'"amenity"="fast_food"',r:FETCH_RADIUS.food,s:true},
    {f:'"amenity"="bar"',r:FETCH_RADIUS.food,s:false},
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

function chunk(arr,size){const out=[];for(let i=0;i<arr.length;i+=size)out.push(arr.slice(i,i+size));return out;}
function dedupeElements(els){const m=new Map();for(const e of els)m.set(`${e.type}:${e.id}`,e);return[...m.values()];}

async function fetchQuery(query){
  for(const ep of ENDPOINTS){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),25000);
    try{
      const res=await fetch(ep,{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'asi-location-ab/1.0'},
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
    all.push(...await fetchQuery(q));
    await sleep(300);
  }
  return dedupeElements(all);
}

async function fetchOsmData(lat,lon){
  const strictEls=await fetchByBatches(buildClauses(lat,lon,1,false));
  if(strictEls.length>=12) return strictEls;
  const broadEls=await fetchByBatches(buildClauses(lat,lon,1.4,true));
  return dedupeElements([...strictEls,...broadEls]);
}

// ── Control cases ──────────────────────────────────────────────────────────────
const CONTROL_CASES = [
  {id:20, expect:'drop',   type:'weak_suburb',  name:'Ozone Park',              lat:40.6786, lon:-73.8464, note:'airport/metro noise'},
  {id:47, expect:'drop',   type:'remote',       name:'Tromsø city center',      lat:69.6492, lon:18.9553,  note:'airport noise'},
  {id:12, expect:'drop',   type:'medium_urban', name:'Prenzlauer Berg',         lat:52.5380, lon:13.4194,  note:'office noise'},
  {id:45, expect:'drop',   type:'rural',        name:'Переславль центр',        lat:56.7387, lon:38.8552,  note:'office noise'},
  {id:54, expect:'drop',   type:'weak_urban',   name:'Wedding Berlin',          lat:52.5427, lon:13.3649,  note:'metro+office noise'},
  {id:44, expect:'rise',   type:'rural',        name:'Siena old town',          lat:43.3188, lon:11.3308,  note:'competitor pressure crushed'},
  {id:91, expect:'rise',   type:'medium_urban', name:'El Poblado',              lat:6.2089,  lon:-75.5690, note:'competitor pressure crushed'},
  {id:1,  expect:'stable', type:'strong_urban', name:'Times Square',            lat:40.7580, lon:-73.9855, note:'anchor — must stay 100'},
  {id:37, expect:'stable', type:'beach_resort', name:'Cannes Croisette',        lat:43.5505, lon:7.0178,   note:'strong — must stay ≥70'},
  {id:17, expect:'stable', type:'medium_urban', name:'Clapham Common',          lat:51.4614, lon:-0.1400,  note:'medium — must not regress'},
];

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function main(){
  console.log('\n=== Location Model A/B — Pass-1 Tuning (same OSM data) ===\n');
  console.log('OLD: airport=3500m, competitorMax=20, office=full, no softcap');
  console.log('NEW: airport=2000m, competitorMax=15, office×0.72, softcap@80×0.6\n');

  const rows=[];
  for(const c of CONTROL_CASES){
    process.stdout.write(`  [${c.id}] ${c.name} ... `);
    let elements=[];
    try{ elements=await fetchOsmData(c.lat,c.lon); }
    catch(e){ console.error('fetch error:',e.message); rows.push({...c,old:null,new:null}); continue; }
    const old=scoreOld(elements,c.lat,c.lon);
    const nw=scoreNew(elements,c.lat,c.lon);
    const delta=nw.idx-old.idx;
    console.log(`old=${old.idx}(${old.band}) new=${nw.idx}(${nw.band}) Δ=${delta>0?'+':''}${delta}`);
    rows.push({...c,elements:elements.length,old,new:nw});
    await sleep(2500);
  }

  console.log('\n─────────────────────────────────────────────────────────────────────────────────────');
  console.log(` ${'#'.padEnd(3)} ${'Name'.padEnd(28)} ${'Expect'.padEnd(7)} ${'OLD idx'.padEnd(10)} ${'NEW idx'.padEnd(10)} ${'Δ'.padEnd(6)} breakdown-diff`);
  console.log('─────────────────────────────────────────────────────────────────────────────────────');
  for(const r of rows){
    if(!r.old||!r.new){console.log(` ${r.id} ${r.name} — NO DATA`);continue;}
    const delta=r.new.idx-r.old.idx;
    const dStr=(delta>0?'+':'')+delta;
    const okDrop  = r.expect==='drop'   && r.new.idx < r.old.idx;
    const okRise  = r.expect==='rise'   && r.new.idx > r.old.idx;
    const okStab  = r.expect==='stable' && Math.abs(delta)<=10;
    const flag = (okDrop||okRise||okStab)?'✓':'✗';
    const attrDiff = r.new.breakdown.attraction-r.old.breakdown.attraction;
    const cpDiff   = r.new.breakdown.competitorPressure-r.old.breakdown.competitorPressure;
    console.log(` ${String(r.id).padEnd(3)} ${r.name.padEnd(28)} ${r.expect.padEnd(7)} ${String(r.old.idx).padEnd(4)}(${r.old.band.padEnd(6)}) ${String(r.new.idx).padEnd(4)}(${r.new.band.padEnd(6)}) ${dStr.padEnd(6)} ${flag} attr${attrDiff>0?'+':''}${attrDiff} cp${cpDiff>0?'+':''}${cpDiff}`);
  }
  console.log('─────────────────────────────────────────────────────────────────────────────────────\n');

  writeFileSync('scripts/control-ab-results.json',JSON.stringify(rows,null,2),'utf8');
  console.log('Saved to scripts/control-ab-results.json\n');
}

main().catch(e=>{console.error('Fatal:',e);process.exit(1);});
