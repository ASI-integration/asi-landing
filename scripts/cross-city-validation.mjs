/**
 * Cross-city live validation — mirrors gravity-scoring.ts + overpass.ts exactly.
 * Run: node scripts/cross-city-validation.mjs
 */

// ── Config (mirrors config.ts) ────────────────────────────────────────────────
const MAGNET_CATEGORIES = [
  { id: 'metro',           label: 'Метро',                 icon: 'М',  weight: 10,  permanenceType: 'permanent', scopeLevel: 'regional',  strengthClass: 'strong' },
  { id: 'attraction',      label: 'Достопримечательности', icon: '★',  weight: 7,   permanenceType: 'permanent', scopeLevel: 'city',      strengthClass: 'strong' },
  { id: 'university',      label: 'Университеты',           icon: 'У',  weight: 6,   permanenceType: 'permanent', scopeLevel: 'city',      strengthClass: 'strong' },
  { id: 'entertainment',   label: 'Развлечения',            icon: '▶',  weight: 4.5, permanenceType: 'semi',      scopeLevel: 'city',      strengthClass: 'medium' },
  { id: 'shopping_major',  label: 'ТЦ / универмаги',        icon: '⊞',  weight: 4.0, permanenceType: 'permanent', scopeLevel: 'city',      strengthClass: 'medium' },
  { id: 'railway_station', label: 'Ж/д станции',            icon: 'Ж',  weight: 3.5, permanenceType: 'permanent', scopeLevel: 'district',  strengthClass: 'medium' },
  { id: 'business',        label: 'Офисы / бизнес',         icon: 'Б',  weight: 2.0, permanenceType: 'permanent', scopeLevel: 'district',  strengthClass: 'medium' },
  { id: 'transport',       label: 'Остановки транспорта',   icon: 'А',  weight: 1.2, permanenceType: 'permanent', scopeLevel: 'local',     strengthClass: 'weak' },
  { id: 'shopping_local',  label: 'Супермаркеты',            icon: '⊡',  weight: 1.5, permanenceType: 'permanent', scopeLevel: 'local',     strengthClass: 'weak' },
  { id: 'food',            label: 'Кафе и рестораны',        icon: '◈',  weight: 1.5, permanenceType: 'semi',      scopeLevel: 'local',     strengthClass: 'weak' },
];

const CATEGORY_RADIUS = {
  metro: 1200, attraction: 1000, university: 1200,
  entertainment: 800, shopping_major: 800, railway_station: 1500,
  business: 700, transport: 600, shopping_local: 600, food: 500,
};
const CATEGORY_MAX_SHOW = {
  metro: 3, attraction: 3, university: 2, entertainment: 3,
  shopping_major: 3, railway_station: 2, business: 4,
  transport: 4, shopping_local: 3, food: 4,
};
const COMPETITOR_RADIUS = 800;
const PERMANENCE_MULTIPLIER = { permanent: 1.3, semi: 1.0, temporary: 0.65 };
const GC = {
  distanceDecayRefDist: 400, distanceDecayPower: 1.5,
  clusterRadius: 600, clusterMinMagnets: 3, clusterBonusMax: 15,
  weakContribCap: 8,
  strongContribThreshold: 4,
  peripheralPenaltyMedium: 0.75, peripheralPenaltyFactor: 0.45,
  competitorBaseWeight: 3, competitorDensityGain: 0.15, competitorDensityMax: 0.9,
  competitorCloseRadius: 500, competitorPressureMax: 18,
  demandNormBase: 12, scoreScale: 1.8,
  // Soft ceiling
  softCeilingThreshold:   55,
  softCeilingCompression: 0.55,
  // Attraction diversity discount
  attractionTwoItemMul:    0.85,
  attractionSingleItemMul: 0.70,
};

// ── Scoring helpers ───────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function distDecay(m) {
  return 1 / (1 + (m / GC.distanceDecayRefDist) ** GC.distanceDecayPower);
}

function magnetAttraction(weight, permanenceType, distance) {
  return weight * PERMANENCE_MULTIPLIER[permanenceType] * distDecay(distance);
}

function competitorPressure(competitors) {
  if (!competitors.length) return 0;
  let p = 0;
  for (const c of competitors) p += GC.competitorBaseWeight * distDecay(c.distance);
  const close = competitors.filter(c => c.distance <= GC.competitorCloseRadius).length;
  const density = 1 + Math.min(close * GC.competitorDensityGain, GC.competitorDensityMax);
  return Math.min(p * density, GC.competitorPressureMax);
}

function clusterBonus(magnets) {
  const q = magnets.filter(m => m.strengthClass !== 'weak');
  const nearby = q.filter(m => m.distance <= GC.clusterRadius);
  const sz = nearby.length;
  if (sz < GC.clusterMinMagnets) return { bonus: 0, clusterSize: sz };
  return { bonus: Math.min(GC.clusterBonusMax, (sz - GC.clusterMinMagnets + 1) * 2.5), clusterSize: sz };
}

function classifyDemandType(magnets) {
  const qualifying = magnets.filter(m => m.strengthClass !== 'weak');
  const buckets = { tourism: 0, business: 0, transport: 0 };
  for (const m of qualifying) {
    if (['attraction','entertainment','university','shopping_major'].includes(m.categoryId))
      buckets.tourism += m.attr;
    else if (m.categoryId === 'business')
      buckets.business += m.attr;
    else if (['metro','railway_station'].includes(m.categoryId))
      buckets.transport += m.attr;
  }
  const total = buckets.tourism + buckets.business + buckets.transport;
  if (total === 0) return 'mixed';
  const [leader] = Object.entries(buckets).sort((a,b) => b[1] - a[1]);
  const share = leader[1] / total;
  if (share >= 0.50) {
    if (leader[0] === 'tourism')   return 'tourism-led';
    if (leader[0] === 'business')  return 'business-led';
    if (leader[0] === 'transport') return 'transport-led';
  }
  return 'mixed';
}

function evergreenIndex(magnets, competitors) {
  // Attraction diversity multiplier
  const attrCount = magnets.filter(m => m.categoryId === 'attraction').length;
  const attrDivMul = attrCount >= 3 ? 1.0
    : attrCount === 2 ? GC.attractionTwoItemMul
    : attrCount === 1 ? GC.attractionSingleItemMul
    : 1.0;

  const weakAttr = magnets.filter(m => m.strengthClass === 'weak').reduce((s,m)=>s+m.attr,0);
  const smAttr   = magnets.filter(m => m.strengthClass !== 'weak').reduce((s,m) => {
    const mul = m.categoryId === 'attraction' ? attrDivMul : 1.0;
    return s + m.attr * mul;
  }, 0);
  const cappedWeak = Math.min(weakAttr, GC.weakContribCap);
  const effective = smAttr + cappedWeak;

  const strongContrib = magnets.filter(m => m.strengthClass === 'strong').reduce((s,m) => {
    const mul = m.categoryId === 'attraction' ? attrDivMul : 1.0;
    return s + m.attr * mul;
  }, 0);
  const periMul = strongContrib >= GC.strongContribThreshold ? 1.0
    : strongContrib > 0 ? GC.peripheralPenaltyMedium
    : GC.peripheralPenaltyFactor;

  const rawPress = competitorPressure(competitors);
  const demandFactor = Math.max(1, smAttr / GC.demandNormBase);
  const normPress = rawPress / demandFactor;

  const { bonus: cb, clusterSize } = clusterBonus(magnets);

  const attrContrib = effective * periMul * GC.scoreScale;
  const rawScore = attrContrib - normPress + cb;

  // Soft ceiling
  const thr = GC.softCeilingThreshold, comp = GC.softCeilingCompression;
  const ceiledScore = rawScore <= thr ? rawScore : thr + (rawScore - thr) * comp;
  const index = Math.max(5, Math.min(95, Math.round(ceiledScore)));

  const sorted = [...magnets].sort((a,b)=>b.attr-a.attr);
  const pressLevel = normPress < 5 ? 'низкое' : normPress < 11 ? 'среднее' : 'высокое';
  const band = index >= 70 ? 'strong' : index >= 45 ? 'medium' : index > 0 ? 'weak' : 'none';
  const bandLabel = { strong: 'STRONG ≥70', medium: 'MEDIUM 45–69', weak: 'WEAK 5–44', none: 'NONE' }[band];
  const demandType = classifyDemandType(magnets);

  return {
    index, band, bandLabel,
    attrContrib: Math.round(attrContrib),
    rawScore: Math.round(rawScore * 10) / 10,
    normPress: Math.round(normPress * 10) / 10,
    clusterBonus: Math.round(cb),
    clusterSize,
    periMul,
    attrDivMul,
    attrCount,
    strongContrib: Math.round(strongContrib * 10) / 10,
    pressLevel,
    demandType,
    top3: sorted.slice(0,3).map(m => `${m.name} [${m.categoryId} ${Math.round(m.attr*10)/10}]`),
  };
}

// ── OSM classification (mirrors classifyElement) ──────────────────────────────
function classifyElement(el) {
  const t = el.tags ?? {};
  if (t.railway === 'subway_entrance' || t.station === 'subway')
    return { categoryId: 'metro', name: t.name || 'Метро' };
  if (t.tourism === 'attraction' || t.tourism === 'museum' || t.tourism === 'gallery' || t.historic === 'monument')
    return { categoryId: 'attraction', name: t.name || 'Достопримечательность' };
  if (t.amenity === 'university' || t.amenity === 'college')
    return { categoryId: 'university', name: t.name || 'Университет' };
  if (t.railway === 'station' || t.railway === 'halt')
    return { categoryId: 'railway_station', name: t.name || 'Станция' };
  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub')
    return { categoryId: 'entertainment', name: t.name || t.amenity || 'Развлечение' };
  if (t.shop === 'mall' || t.shop === 'department_store')
    return { categoryId: 'shopping_major', name: t.name || 'ТЦ' };
  if (t.office || t.amenity === 'bank')
    return { categoryId: 'business', name: t.name || 'Офис' };
  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position' || t.public_transport === 'platform' || t.railway === 'tram_stop')
    return { categoryId: 'transport', name: t.name || 'Остановка' };
  if (t.shop === 'supermarket' || t.shop)
    return { categoryId: 'shopping_local', name: t.name || 'Магазин' };
  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'bar' || t.amenity === 'pub')
    return { categoryId: 'food', name: t.name || t.amenity || 'Кафе' };
  if (t.tourism === 'hotel' || t.tourism === 'apartment' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel')
    return { categoryId: 'competitor', name: t.name || t.tourism || 'Объект аренды' };
  return null;
}

// ── Overpass query builder (mirrors overpass.ts) ──────────────────────────────
function buildQuery(lat, lon, radiusScale, broad) {
  const selectors = [
    { filter: '"railway"="subway_entrance"', radius: CATEGORY_RADIUS.metro,           strict: true  },
    { filter: '"station"="subway"',          radius: CATEGORY_RADIUS.metro,           strict: true  },
    { filter: '"railway"="station"',         radius: CATEGORY_RADIUS.railway_station, strict: true  },
    { filter: '"railway"="halt"',            radius: CATEGORY_RADIUS.railway_station, strict: false },
    { filter: '"tourism"="attraction"',      radius: CATEGORY_RADIUS.attraction,      strict: true  },
    { filter: '"historic"="monument"',       radius: CATEGORY_RADIUS.attraction,      strict: true  },
    { filter: '"tourism"="museum"',          radius: CATEGORY_RADIUS.attraction,      strict: true  },
    { filter: '"tourism"="gallery"',         radius: CATEGORY_RADIUS.attraction,      strict: false },
    { filter: '"amenity"="university"',      radius: CATEGORY_RADIUS.university,      strict: true  },
    { filter: '"amenity"="college"',         radius: CATEGORY_RADIUS.university,      strict: false },
    { filter: '"amenity"="cinema"',          radius: CATEGORY_RADIUS.entertainment,   strict: true  },
    { filter: '"amenity"="theatre"',         radius: CATEGORY_RADIUS.entertainment,   strict: true  },
    { filter: '"amenity"="arts_centre"',     radius: CATEGORY_RADIUS.entertainment,   strict: true  },
    { filter: '"amenity"="nightclub"',       radius: CATEGORY_RADIUS.entertainment,   strict: false },
    { filter: '"shop"="mall"',               radius: CATEGORY_RADIUS.shopping_major,  strict: true  },
    { filter: '"shop"="department_store"',   radius: CATEGORY_RADIUS.shopping_major,  strict: true  },
    { filter: '"office"',                    radius: CATEGORY_RADIUS.business,        strict: true  },
    { filter: '"amenity"="bank"',            radius: CATEGORY_RADIUS.business,        strict: false },
    { filter: '"highway"="bus_stop"',        radius: CATEGORY_RADIUS.transport,       strict: true  },
    { filter: '"public_transport"="stop_position"', radius: CATEGORY_RADIUS.transport, strict: true },
    { filter: '"public_transport"="platform"',      radius: CATEGORY_RADIUS.transport, strict: false},
    { filter: '"railway"="tram_stop"',       radius: CATEGORY_RADIUS.transport,       strict: false },
    { filter: '"shop"="supermarket"',        radius: CATEGORY_RADIUS.shopping_local,  strict: true  },
    { filter: '"amenity"="restaurant"',      radius: CATEGORY_RADIUS.food,            strict: true  },
    { filter: '"amenity"="cafe"',            radius: CATEGORY_RADIUS.food,            strict: true  },
    { filter: '"amenity"="fast_food"',       radius: CATEGORY_RADIUS.food,            strict: true  },
    { filter: '"amenity"="bar"',             radius: CATEGORY_RADIUS.food,            strict: false },
    { filter: '"tourism"="hotel"',           radius: COMPETITOR_RADIUS,               strict: true  },
    { filter: '"tourism"="apartment"',       radius: COMPETITOR_RADIUS,               strict: true  },
    { filter: '"tourism"="guest_house"',     radius: COMPETITOR_RADIUS,               strict: true  },
    { filter: '"tourism"="hostel"',          radius: COMPETITOR_RADIUS,               strict: true  },
    { filter: '"tourism"="motel"',           radius: COMPETITOR_RADIUS,               strict: false },
  ];

  const parts = [];
  for (const s of selectors) {
    if (!broad && !s.strict) continue;
    const r = Math.max(150, Math.round(s.radius * radiusScale));
    parts.push(`node[${s.filter}](around:${r},${lat},${lon});`);
    if (broad) {
      parts.push(`way[${s.filter}](around:${r},${lat},${lon});`);
      parts.push(`relation[${s.filter}](around:${r},${lat},${lon});`);
    }
  }
  return `[out:json][timeout:25];(${parts.join('')});out center;`;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function fetchOverpass(query) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
  ];
  const body = `data=${encodeURIComponent(query)}`;
  for (const ep of endpoints) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'asi-validation/1.0' },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json();
      return json.elements ?? [];
    } catch { continue; }
  }
  return [];
}

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ru`;
  const res = await fetch(url, { headers: { 'User-Agent': 'asi-validation/1.0' } });
  const json = await res.json();
  if (!json[0]) throw new Error(`Geocode failed: ${address}`);
  return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon), display: json[0].display_name };
}

// ── Build analysis (mirrors buildAnalysis) ────────────────────────────────────
function buildAnalysis(elements, lat, lon) {
  const byCategory = {};
  const competitors = [];

  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (!elLat || !elLon) continue;
    const cl = classifyElement(el);
    if (!cl) continue;
    const dist = haversine(lat, lon, elLat, elLon);
    if (cl.categoryId === 'competitor') {
      competitors.push({ name: cl.name, distance: dist });
      continue;
    }
    const cat = MAGNET_CATEGORIES.find(c => c.id === cl.categoryId);
    if (!cat) continue;
    if (!byCategory[cl.categoryId]) byCategory[cl.categoryId] = [];
    byCategory[cl.categoryId].push({
      categoryId: cat.id,
      categoryLabel: cat.label,
      name: cl.name,
      distance: dist,
      weight: cat.weight,
      permanenceType: cat.permanenceType,
      strengthClass: cat.strengthClass,
      attr: magnetAttraction(cat.weight, cat.permanenceType, dist),
    });
  }

  const magnets = [];
  const countByCat = {};
  for (const cat of MAGNET_CATEGORIES) {
    const items = (byCategory[cat.id] ?? []).sort((a,b) => a.distance - b.distance);
    countByCat[cat.id] = items.length;
    magnets.push(...items.slice(0, CATEGORY_MAX_SHOW[cat.id] ?? 3));
  }
  competitors.sort((a,b) => a.distance - b.distance);

  return { magnets, competitors, countByCat, ...evergreenIndex(magnets, competitors) };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const ADDRESSES = [
  'Владивосток, Светланская улица, 22',
  'Екатеринбург, улица 8 Марта, 13',
  'Армавир, улица Мира, 24',
  'Новосибирск, Красный проспект, 25',
  'Псков, Октябрьский проспект, 14',
  'Гатчина, проспект 25 Октября, 21',
];

async function analyzeAddress(address) {
  process.stdout.write(`  geocoding… `);
  const geo = await geocode(address);
  process.stdout.write(`${geo.lat.toFixed(5)},${geo.lon.toFixed(5)}\n`);

  process.stdout.write(`  fetching OSM (strict)… `);
  const strictQ = buildQuery(geo.lat, geo.lon, 1, false);
  let elements = await fetchOverpass(strictQ);
  process.stdout.write(`${elements.length} elements\n`);

  if (elements.length < 12) {
    process.stdout.write(`  sparse — retrying broad… `);
    const broadQ = buildQuery(geo.lat, geo.lon, 1.4, true);
    const broad = await fetchOverpass(broadQ);
    const seen = new Set(elements.map(e => `${e.type}:${e.id}`));
    for (const e of broad) if (!seen.has(`${e.type}:${e.id}`)) elements.push(e);
    process.stdout.write(`${elements.length} elements total\n`);
  }

  return { address, geo, ...buildAnalysis(elements, geo.lat, geo.lon) };
}

function fmt(n) { return String(n).padStart(2); }
function bar(idx) {
  const filled = Math.round(idx / 95 * 20);
  return '[' + '█'.repeat(filled) + '░'.repeat(20 - filled) + ']';
}

(async () => {
  const results = [];
  for (const addr of ADDRESSES) {
    console.log(`\n► ${addr}`);
    try {
      const r = await analyzeAddress(addr);
      results.push(r);
      // small delay to respect Nominatim rate limit
      await new Promise(r => setTimeout(r, 1100));
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      results.push({ address: addr, error: e.message });
    }
  }

  console.log('\n\n══════════════════════════════════════════════════════════════════');
  console.log('  CROSS-CITY VALIDATION RESULTS');
  console.log('══════════════════════════════════════════════════════════════════\n');

  for (const r of results) {
    if (r.error) {
      console.log(`✗ ${r.address}\n  ERROR: ${r.error}\n`);
      continue;
    }
    const totalMagnets = r.magnets.length;
    const compCount    = r.competitors.length;
    const catSummary   = MAGNET_CATEGORIES
      .filter(c => (r.countByCat[c.id] ?? 0) > 0)
      .map(c => `${c.id}×${r.countByCat[c.id]}`)
      .join(' ');

    console.log(`┌─ ${r.address}`);
    console.log(`│  Coords : ${r.geo.lat.toFixed(5)}, ${r.geo.lon.toFixed(5)}`);
    console.log(`│  Magnets: ${totalMagnets} shown (${catSummary})`);
    console.log(`│  Compets: ${compCount}`);
    console.log(`│  Score  : ${bar(r.index)} ${fmt(r.index)} / 95  [${r.bandLabel}]`);
    console.log(`│  Band   : ${r.band.toUpperCase()}  │  Demand type: ${r.demandType}`);
    console.log(`│  Breakdown → rawScore ${r.rawScore} → ceiled → attrContrib ${r.attrContrib} | press −${r.normPress} | cluster +${r.clusterBonus} (sz ${r.clusterSize})`);
    console.log(`│  PeriMul: ×${r.periMul}  strongContrib: ${r.strongContrib}  attrDivMul: ×${r.attrDivMul} (${r.attrCount} attraction items)  pressLevel: ${r.pressLevel}`);
    console.log(`│  Top-3 magnets:`);
    r.top3.forEach((m,i) => console.log(`│    ${i+1}. ${m}`));
    console.log('└──────────────────────────────────────────────────────────────\n');
  }
})();
