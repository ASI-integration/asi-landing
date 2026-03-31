/**
 * Pskov standalone probe — uses kumi.systems endpoint which confirmed live data.
 */
const MAGNET_CATEGORIES = [
  { id: 'metro',           weight: 10, permanenceType: 'permanent', strengthClass: 'strong', maxShow: 3 },
  { id: 'attraction',      weight: 7,  permanenceType: 'permanent', strengthClass: 'strong', maxShow: 3 },
  { id: 'university',      weight: 6,  permanenceType: 'permanent', strengthClass: 'strong', maxShow: 2 },
  { id: 'entertainment',   weight: 4.5,permanenceType: 'semi',      strengthClass: 'medium', maxShow: 3 },
  { id: 'shopping_major',  weight: 4.0,permanenceType: 'permanent', strengthClass: 'medium', maxShow: 3 },
  { id: 'railway_station', weight: 3.5,permanenceType: 'permanent', strengthClass: 'medium', maxShow: 2 },
  { id: 'business',        weight: 2.0,permanenceType: 'permanent', strengthClass: 'medium', maxShow: 4 },
  { id: 'transport',       weight: 1.2,permanenceType: 'permanent', strengthClass: 'weak',   maxShow: 4 },
  { id: 'shopping_local',  weight: 1.5,permanenceType: 'permanent', strengthClass: 'weak',   maxShow: 3 },
  { id: 'food',            weight: 1.5,permanenceType: 'semi',      strengthClass: 'weak',   maxShow: 4 },
];
const CATEGORY_RADIUS = {
  metro:1200,attraction:1000,university:1200,entertainment:800,
  shopping_major:800,railway_station:1500,business:700,
  transport:600,shopping_local:600,food:500,
};
const COMPETITOR_RADIUS = 800;
const PERMANENCE = { permanent:1.3, semi:1.0, temporary:0.65 };
const GC = {
  refDist:400, power:1.5,
  clusterR:600, clusterMin:3, clusterMax:15,
  weakCap:8, strongThresh:4,
  periMed:0.75, periFact:0.45,
  compBase:3, compDGain:0.15, compDMax:0.9, compCloseR:500, compPressMax:18,
  demandNormBase:12, scoreScale:1.8,
};

function haversine(la1,lo1,la2,lo2) {
  const R=6371000, dLa=(la2-la1)*Math.PI/180, dLo=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(dLa/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function decay(m) { return 1/(1+(m/GC.refDist)**GC.power); }
function attr(w,p,d) { return w*PERMANENCE[p]*decay(d); }

function classify(el) {
  const t = el.tags ?? {};
  if (t.railway==='subway_entrance'||t.station==='subway') return ['metro', t.name||'Метро'];
  if (t.tourism==='attraction'||t.tourism==='museum'||t.tourism==='gallery'||t.historic==='monument') return ['attraction', t.name||'Достопримечательность'];
  if (t.amenity==='university'||t.amenity==='college') return ['university', t.name||'Университет'];
  if (t.railway==='station'||t.railway==='halt') return ['railway_station', t.name||'Станция'];
  if (['cinema','theatre','arts_centre','nightclub'].includes(t.amenity)) return ['entertainment', t.name||t.amenity||'Развлечение'];
  if (t.shop==='mall'||t.shop==='department_store') return ['shopping_major', t.name||'ТЦ'];
  if (t.office||t.amenity==='bank') return ['business', t.name||'Офис'];
  if (t.highway==='bus_stop'||t.public_transport==='stop_position'||t.public_transport==='platform'||t.railway==='tram_stop') return ['transport', t.name||'Остановка'];
  if (t.shop==='supermarket'||t.shop) return ['shopping_local', t.name||'Магазин'];
  if (['restaurant','cafe','fast_food','bar','pub'].includes(t.amenity)) return ['food', t.name||t.amenity||'Кафе'];
  if (['hotel','apartment','guest_house','hostel','motel'].includes(t.tourism)) return ['competitor', t.name||t.tourism||'Объект'];
  return null;
}

function buildQ(lat, lon, rs, broad) {
  const sels = [
    ['"railway"="subway_entrance"', CATEGORY_RADIUS.metro, true],
    ['"station"="subway"', CATEGORY_RADIUS.metro, true],
    ['"railway"="station"', CATEGORY_RADIUS.railway_station, true],
    ['"railway"="halt"', CATEGORY_RADIUS.railway_station, false],
    ['"tourism"="attraction"', CATEGORY_RADIUS.attraction, true],
    ['"historic"="monument"', CATEGORY_RADIUS.attraction, true],
    ['"tourism"="museum"', CATEGORY_RADIUS.attraction, true],
    ['"tourism"="gallery"', CATEGORY_RADIUS.attraction, false],
    ['"amenity"="university"', CATEGORY_RADIUS.university, true],
    ['"amenity"="college"', CATEGORY_RADIUS.university, false],
    ['"amenity"="cinema"', CATEGORY_RADIUS.entertainment, true],
    ['"amenity"="theatre"', CATEGORY_RADIUS.entertainment, true],
    ['"amenity"="arts_centre"', CATEGORY_RADIUS.entertainment, true],
    ['"amenity"="nightclub"', CATEGORY_RADIUS.entertainment, false],
    ['"shop"="mall"', CATEGORY_RADIUS.shopping_major, true],
    ['"shop"="department_store"', CATEGORY_RADIUS.shopping_major, true],
    ['"office"', CATEGORY_RADIUS.business, true],
    ['"amenity"="bank"', CATEGORY_RADIUS.business, false],
    ['"highway"="bus_stop"', CATEGORY_RADIUS.transport, true],
    ['"public_transport"="stop_position"', CATEGORY_RADIUS.transport, true],
    ['"public_transport"="platform"', CATEGORY_RADIUS.transport, false],
    ['"railway"="tram_stop"', CATEGORY_RADIUS.transport, false],
    ['"shop"="supermarket"', CATEGORY_RADIUS.shopping_local, true],
    ['"amenity"="restaurant"', CATEGORY_RADIUS.food, true],
    ['"amenity"="cafe"', CATEGORY_RADIUS.food, true],
    ['"amenity"="fast_food"', CATEGORY_RADIUS.food, true],
    ['"amenity"="bar"', CATEGORY_RADIUS.food, false],
    ['"tourism"="hotel"', COMPETITOR_RADIUS, true],
    ['"tourism"="apartment"', COMPETITOR_RADIUS, true],
    ['"tourism"="guest_house"', COMPETITOR_RADIUS, true],
    ['"tourism"="hostel"', COMPETITOR_RADIUS, true],
    ['"tourism"="motel"', COMPETITOR_RADIUS, false],
  ];
  const parts = [];
  for (const [f, r, strict] of sels) {
    if (!broad && !strict) continue;
    const rad = Math.max(150, Math.round(r * rs));
    parts.push(`node[${f}](around:${rad},${lat},${lon});`);
    if (broad) parts.push(`way[${f}](around:${rad},${lat},${lon});`);
  }
  return `[out:json][timeout:30];(${parts.join('')});out center;`;
}

async function fetchQ(q) {
  const ep = 'https://overpass.kumi.systems/api/interpreter';
  const r = await fetch(ep, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'asi-diag/1.0' },
    body: 'data=' + encodeURIComponent(q),
    signal: AbortSignal.timeout(32000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.elements ?? [];
}

async function run() {
  const lat = 57.8165, lon = 28.3376;
  console.log(`Псков, Октябрьский проспект, 14 — ${lat}, ${lon}\n`);

  let els = await fetchQ(buildQ(lat, lon, 1, false));
  console.log(`Strict fetch: ${els.length} elements`);
  if (els.length < 12) {
    const broad = await fetchQ(buildQ(lat, lon, 1.4, true));
    const seen = new Set(els.map(e => `${e.type}:${e.id}`));
    for (const e of broad) if (!seen.has(`${e.type}:${e.id}`)) els.push(e);
    console.log(`After broad fallback: ${els.length} elements`);
  }

  const byC = {};
  const comps = [];
  for (const el of els) {
    const eLat = el.lat ?? el.center?.lat;
    const eLon = el.lon ?? el.center?.lon;
    if (!eLat || !eLon) continue;
    const cl = classify(el);
    if (!cl) continue;
    const d = haversine(lat, lon, eLat, eLon);
    if (cl[0] === 'competitor') { comps.push({ name: cl[1], distance: d }); continue; }
    const cat = MAGNET_CATEGORIES.find(c => c.id === cl[0]);
    if (!cat) continue;
    if (!byC[cl[0]]) byC[cl[0]] = [];
    byC[cl[0]].push({ ...cat, name: cl[1], distance: d, a: attr(cat.weight, cat.permanenceType, d) });
  }

  const mags = [];
  const cnt = {};
  for (const cat of MAGNET_CATEGORIES) {
    const items = (byC[cat.id] ?? []).sort((a,b) => a.distance - b.distance);
    cnt[cat.id] = items.length;
    mags.push(...items.slice(0, cat.maxShow));
  }
  comps.sort((a,b) => a.distance - b.distance);

  // Score
  const weakA = mags.filter(m => m.strengthClass === 'weak').reduce((s,m) => s+m.a, 0);
  const smA   = mags.filter(m => m.strengthClass !== 'weak').reduce((s,m) => s+m.a, 0);
  const cappedW = Math.min(weakA, GC.weakCap);
  const eff = smA + cappedW;
  const strongC = mags.filter(m => m.strengthClass === 'strong').reduce((s,m) => s+m.a, 0);
  const periMul = strongC >= GC.strongThresh ? 1.0 : strongC > 0 ? GC.periMed : GC.periFact;

  let rawP = 0;
  for (const c of comps) rawP += GC.compBase * decay(c.distance);
  const closeN = comps.filter(c => c.distance <= GC.compCloseR).length;
  const densM = 1 + Math.min(closeN * GC.compDGain, GC.compDMax);
  rawP = Math.min(rawP * densM, GC.compPressMax);
  const df = Math.max(1, smA / GC.demandNormBase);
  const normP = rawP / df;

  const qMags = mags.filter(m => m.strengthClass !== 'weak');
  const nearby = qMags.filter(m => m.distance <= GC.clusterR);
  const clSz = nearby.length;
  const clBonus = clSz >= GC.clusterMin ? Math.min(GC.clusterMax, (clSz - GC.clusterMin + 1) * 2.5) : 0;

  const attrC = eff * periMul * GC.scoreScale;
  const rawScore = attrC - normP + clBonus;
  const idx = Math.max(5, Math.min(96, Math.round(rawScore)));
  const band = idx >= 70 ? 'STRONG' : idx >= 45 ? 'MEDIUM' : 'WEAK';
  const filled = Math.round(idx / 96 * 20);
  const barStr = '[' + '█'.repeat(filled) + '░'.repeat(20-filled) + ']';

  console.log('\n── RESULTS ──────────────────────────────────────────────');
  console.log(`Magnets: ${mags.length}  |  Competitors: ${comps.length}`);
  console.log('Category counts:');
  for (const cat of MAGNET_CATEGORIES) if ((cnt[cat.id]??0) > 0) console.log(`  ${cat.id} × ${cnt[cat.id]}`);
  console.log(`\nScore: ${barStr} ${idx} / 96  [${band}]`);
  console.log(`Breakdown: attraction ${Math.round(attrC)} | press −${Math.round(normP*10)/10} | cluster +${Math.round(clBonus)} (sz ${clSz})`);
  console.log(`PeriMul: ×${periMul}  |  strongContrib: ${Math.round(strongC*10)/10}  |  weakAttr (capped): ${Math.round(cappedW*10)/10}`);

  const top3 = [...mags].sort((a,b) => b.a - a.a).slice(0, 3);
  console.log('\nTop-3 magnets:');
  top3.forEach((m,i) => console.log(`  ${i+1}. ${m.name} [${m.id}  score=${Math.round(m.a*10)/10}  dist=${Math.round(m.distance)}m]`));

  console.log('\nCompetitors (all):');
  comps.slice(0, 8).forEach(c => console.log(`  ${c.name} @ ${Math.round(c.distance)}m`));
}

run().catch(e => console.error('FATAL:', e.message));
