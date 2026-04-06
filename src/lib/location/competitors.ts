/**
 * lib/location/competitors.ts
 *
 * Competitor market data extraction — Airbnb, Booking.com, VRBO.
 *
 * Strategy:
 *  1. Fire all three scrapers concurrently with an 8 s timeout each.
 *  2. Parse price values from embedded JSON / display text in the HTML.
 *  3. Normalize all prices to RUB (USD/EUR values < 800 are multiplied by ~90).
 *  4. Aggregate into avg ADR, min/max, listing count, density score.
 *  5. Estimate RevPAR = ADR × occupancy (modulated by competition + location score).
 *  6. If live scraping yields < 3 prices, blend/replace with rent-based fallback ADR.
 *
 * Scraping is best-effort. All three platforms use anti-bot defenses and
 * may return empty results, especially for Russian addresses (Airbnb has
 * ceased operations in Russia). The fallback always applies when needed.
 *
 * Server-side only — do NOT import from client components.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MarketListing {
  price: number;          // RUB nightly rate
  type: string;           // 'apartment' | 'hotel' | 'vacation_rental'
  source: 'airbnb' | 'booking' | 'vrbo';
  title?: string;
}

export interface CompetitorMarketData {
  competitors:  number;   // total detected competitor units
  avgADR:       number;   // average daily rate, RUB
  minPrice:     number;   // lowest nightly rate seen, RUB
  maxPrice:     number;   // highest nightly rate seen, RUB
  revpar:       number;   // ADR × estimated occupancy, RUB
  densityScore: number;   // 0–1 (saturates at 30 competitors)
  /** How the result was produced */
  source: 'live' | 'partial' | 'fallback';
  listings: MarketListing[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

/** Per-scraper HTTP timeout in milliseconds */
const FETCH_TIMEOUT_MS = 8_000;

/** Approximate 1 km offset in degrees for bbox around a point */
const KM_LAT = 0.009;
const KM_LNG = 0.013; // wider to compensate for high-latitude compression

/** Competitor count at which densityScore saturates to 1.0 */
const DENSITY_SATURATION = 30;

// ── Low-level helpers ─────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<string | null> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal:  ctrl.signal,
      redirect: 'follow',
      cache:   'no-store',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract all integer matches from a set of regex patterns within an HTML string.
 * Each pattern MUST have exactly one capture group for the numeric portion.
 */
function extractRawNumbers(html: string, patterns: RegExp[]): number[] {
  const out: number[] = [];
  for (const re of patterns) {
    // Always search globally regardless of how the caller defined the flag
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = global.exec(html)) !== null) {
      const raw = m[1]?.replace(/[\s,_]/g, '');
      const n   = parseInt(raw ?? '', 10);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
  }
  return out;
}

/**
 * Normalize a raw extracted number to a plausible RUB nightly rate.
 * Values in foreign-currency range (< 800) are multiplied by 90 (rough RUB rate).
 * Values outside the plausible STR nightly range are discarded (return null).
 */
function toRubNightly(raw: number): number | null {
  // RUB range — 500 to 80 000 ₽/night
  if (raw >= 500 && raw <= 80_000) return raw;
  // USD/EUR range — 5 to 800 → convert at 90
  if (raw >= 5 && raw < 500) return Math.round(raw * 90);
  return null; // too small or too large to be a plausible nightly rate
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Platform scrapers ─────────────────────────────────────────────────────────

/**
 * Airbnb: bbox search around the given coordinates.
 * Attempts to extract price amounts from the __NEXT_DATA__ / embedded JSON
 * and from visible display text.
 *
 * NOTE: Airbnb exited Russia in 2022; most Russian addresses will return no results.
 */
async function scrapeAirbnb(lat: number, lng: number): Promise<MarketListing[]> {
  const neLat = lat + KM_LAT;
  const neLng = lng + KM_LNG;
  const swLat = lat - KM_LAT;
  const swLng = lng - KM_LNG;

  const url =
    `https://www.airbnb.com/s/homes` +
    `?query=${lat},${lng}` +
    `&ne_lat=${neLat}&ne_lng=${neLng}` +
    `&sw_lat=${swLat}&sw_lng=${swLng}`;

  const html = await fetchWithTimeout(url);
  if (!html) return [];

  const raws = extractRawNumbers(html, [
    // Embedded JSON — various schema versions
    /"amount"\s*:\s*(\d+)/,
    /"price"\s*:\s*\{\s*"amount"\s*:\s*(\d+)/,
    /"localizedPrice"\s*:\s*"[^\d"]*(\d[\d\s,]+)/,
    /"displayPrice"\s*:\s*"[^\d"]*(\d[\d\s,]+)/,
    // Display text (USD markets)
    /\$\s*(\d+)\s*(?:per\s+night|\/\s*night|night)/i,
    // data-attributes
    /data-price="(\d+)"/,
  ]);

  return raws
    .map(toRubNightly)
    .filter((p): p is number => p !== null)
    .map(price => ({ price, type: 'apartment', source: 'airbnb' as const }));
}

/**
 * Booking.com: SSR search results — prices appear in the initial HTML.
 */
async function scrapeBooking(address: string): Promise<MarketListing[]> {
  const url =
    `https://www.booking.com/searchresults.html` +
    `?ss=${encodeURIComponent(address)}&sb=1&src=index&src_elem=sb`;

  const html = await fetchWithTimeout(url);
  if (!html) return [];

  const raws = extractRawNumbers(html, [
    /"price"\s*:\s*(\d+)/,
    /"averagePrice"\s*:\s*(\d+)/,
    /data-price="(\d+)"/,
    // Structured data / JSON-LD
    /"priceSpecification"\s*:\s*\{\s*"price"\s*:\s*"?(\d+)/,
    // Display text — "₽ 3 500" / "RUB 3500" / "€45"
    /₽\s*(\d[\d\s]+)/,
    /RUB\s*(\d[\d\s]+)/i,
    /€\s*(\d+)/,
    /\$\s*(\d+)/,
    /priceValue\D{0,10}(\d+)/,
  ]);

  return raws
    .map(toRubNightly)
    .filter((p): p is number => p !== null)
    .map(price => ({ price, type: 'hotel', source: 'booking' as const }));
}

/**
 * VRBO: keyword-based search. Extracts from embedded JSON state or JSON-LD.
 * Primarily a US/EU platform — few Russian results expected.
 */
async function scrapeVrbo(address: string): Promise<MarketListing[]> {
  const url = `https://www.vrbo.com/search/keywords:${encodeURIComponent(address)}`;

  const html = await fetchWithTimeout(url);
  if (!html) return [];

  const raws = extractRawNumbers(html, [
    /"averageNightlyRate"\s*:\s*(\d+)/,
    /"nightly"\s*:\s*(\d+)/,
    /"amount"\s*:\s*(\d+)/,
    /"total"\s*:\s*\{\s*"amount"\s*:\s*(\d+)/,
    /\$\s*(\d+)\s*(?:avg|per|\/)\s*night/i,
    /"localizedPrice"\s*:\s*"[^\d"]*(\d[\d\s,]+)/,
  ]);

  return raws
    .map(toRubNightly)
    .filter((p): p is number => p !== null)
    .map(price => ({ price, type: 'vacation_rental', source: 'vrbo' as const }));
}

// ── Aggregation ───────────────────────────────────────────────────────────────

interface Aggregate {
  avgADR:       number;
  minPrice:     number;
  maxPrice:     number;
  competitors:  number;
  densityScore: number;
}

function buildAggregate(listings: MarketListing[], osmCount: number): Aggregate {
  const prices = listings.map(l => l.price);

  const avgADR    = prices.length > 0
    ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length)
    : 0;
  const minPrice  = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice  = prices.length > 0 ? Math.max(...prices) : 0;
  const competitors = Math.max(listings.length, osmCount);
  const densityScore = clamp(competitors / DENSITY_SATURATION, 0, 1);

  return { avgADR, minPrice, maxPrice, competitors, densityScore };
}

// ── RevPAR estimation ─────────────────────────────────────────────────────────

/**
 * Estimate RevPAR = ADR × occupancy rate.
 *
 * Base occupancy: 65 %.
 * Adjustments:
 *  - High competition (density > 0.6)  → −10 pp
 *  - Medium competition (0.3–0.6)      → −5 pp
 *  - High demand location (score ≥ 70) → +10 pp
 *  - Medium demand location (≥ 45)     → +5 pp
 */
function estimateRevpar(adr: number, densityScore: number, locationScore: number): number {
  const compPenalty = densityScore > 0.6 ? -0.10
                    : densityScore > 0.3 ? -0.05
                    : 0;
  const demandBonus = locationScore >= 70 ? +0.10
                    : locationScore >= 45 ? +0.05
                    : 0;
  const occupancy   = clamp(0.65 + demandBonus + compPenalty, 0.45, 0.82);
  return Math.round(adr * occupancy);
}

// ── Fallback: rent-based ADR estimation ──────────────────────────────────────

/**
 * When live scraping yields < 3 price points, estimate ADR from location
 * quality tier. Values are calibrated for the Russian STR market (₽).
 *
 * Formula: monthly fair-market rent ÷ 20 (typical STR fill days) × 1.3 (STR premium).
 * Tiers approximate Moscow/SPb vs. regional cities.
 */
function fallbackADR(
  locationScore: number,
  osmCount: number,
): { avgADR: number; minPrice: number; maxPrice: number } {
  const base   = locationScore >= 70 ? 4_500
               : locationScore >= 45 ? 3_000
               :                       2_000;
  const spread = base * 0.4;

  return {
    avgADR:   base,
    minPrice: Math.round(base - spread * 0.5),
    maxPrice: Math.round(base + spread * 0.7 + osmCount * 60),
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export interface CompetitorFetchOptions {
  lat:     number;
  lng:     number;
  address: string;
  /** OSM-derived competitor count from the gravity engine (optional) */
  osmCompetitorCount?: number;
  /** 0–100 location score — drives RevPAR and fallback ADR tier */
  locationScore?: number;
}

/**
 * Fetch competitor market data for a location.
 *
 * Fires Airbnb, Booking.com, and VRBO scrapers concurrently.
 * Falls back to rent-based ADR estimation when scraping is blocked.
 *
 * Always resolves — never throws.
 */
export async function fetchCompetitorData(
  opts: CompetitorFetchOptions,
): Promise<CompetitorMarketData> {
  const {
    lat,
    lng,
    address,
    osmCompetitorCount = 0,
    locationScore      = 50,
  } = opts;

  // Run all scrapers in parallel — individual failures are absorbed
  const [airbnb, booking, vrbo] = await Promise.all([
    scrapeAirbnb(lat, lng).catch((): MarketListing[] => []),
    scrapeBooking(address).catch((): MarketListing[] => []),
    scrapeVrbo(address).catch((): MarketListing[] => []),
  ]);

  const allListings = [...airbnb, ...booking, ...vrbo];
  const liveCount   = allListings.length;

  let avgADR:   number;
  let minPrice: number;
  let maxPrice: number;
  let source:   CompetitorMarketData['source'];

  if (liveCount >= 3) {
    // Enough live data — use it directly
    const agg = buildAggregate(allListings, osmCompetitorCount);
    ({ avgADR, minPrice, maxPrice } = agg);
    source = 'live';
  } else if (liveCount > 0) {
    // Sparse live data — blend with fallback (weighted by live count)
    const agg = buildAggregate(allListings, osmCompetitorCount);
    const fb  = fallbackADR(locationScore, osmCompetitorCount);
    const lw  = liveCount / (liveCount + 5); // live weight 0.17–0.37
    avgADR   = Math.round(agg.avgADR   * lw + fb.avgADR   * (1 - lw));
    minPrice = Math.round(agg.minPrice * lw + fb.minPrice * (1 - lw));
    maxPrice = Math.round(agg.maxPrice * lw + fb.maxPrice * (1 - lw));
    source   = 'partial';
  } else {
    // No live data — full fallback
    ({ avgADR, minPrice, maxPrice } = fallbackADR(locationScore, osmCompetitorCount));
    source = 'fallback';
  }

  const competitors  = Math.max(liveCount, osmCompetitorCount);
  const densityScore = clamp(competitors / DENSITY_SATURATION, 0, 1);
  const revpar       = estimateRevpar(avgADR, densityScore, locationScore);

  return {
    competitors,
    avgADR,
    minPrice,
    maxPrice,
    revpar,
    densityScore,
    source,
    listings: allListings,
  };
}
