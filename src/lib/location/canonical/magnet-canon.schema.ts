import fs from 'node:fs';
import path from 'node:path';

export type CanonicalMagnetRole = 'primary' | 'secondary' | 'tertiary';
export type AnchorStrength = 'tier1' | 'tier2' | 'weak' | 'noise' | 'negative';

export type AllowedTaxonomyType =
  | 'transport'
  | 'business'
  | 'tourist'
  | 'medical'
  | 'education'
  | 'industrial'
  | 'hospitality'
  | 'retail'
  | 'civic'
  | 'residential_support';

export type CanonicalMagnetType =
  | 'railway_station'
  | 'metro_station'
  | 'transport_hub'
  | 'airport'
  | 'port'
  | 'industrial_anchor'
  | 'industrial_zone'
  | 'business_center'
  | 'office_cluster'
  | 'hospital'
  | 'medical_cluster'
  | 'university'
  | 'shopping_mall'
  | 'park'
  | 'beach'
  | 'waterfront'
  | 'resort_area'
  | 'stadium'
  | 'event_venue'
  | 'cultural_landmark'
  | 'museum'
  | 'theater'
  | 'tourist_attraction'
  | 'hotel_cluster'
  | 'residential_density'
  | 'weak_amenity'
  | 'tertiary_local_amenity';

export type AudienceEligibility = Readonly<{
  business: boolean;
  corporate: boolean;
  tourist: boolean;
  family: boolean;
  medical: boolean;
  student: boolean;
  industrialWorker: boolean;
}>;

export type MagnetCanonEntry = Readonly<{
  canonicalType: CanonicalMagnetType;
  publicLabel: { ru: string; en: string };
  aliases: ReadonlyArray<string>;
  rawCategories: ReadonlyArray<string>;
  allowedTaxonomyTypes: ReadonlyArray<AllowedTaxonomyType>;
  role: CanonicalMagnetRole;
  residentialEligibility: { maxTier: 1 | 2 | 3; primeEligible: boolean };
  audienceEligibility: AudienceEligibility;
  anchorStrength: AnchorStrength;
  maxTier: 1 | 2 | 3;
  distanceBands: { mustSurfaceRadiusM: number; softenTier2AfterM: number };
  scoringCaps: { audienceFitMax: number; tier1CreditMax: number };
  antiSignals: ReadonlyArray<{ id: string; kind: string; pattern: string; effect: string }>;
  downgradeRules: ReadonlyArray<any>;
  notes: string;
}>;

export type MagnetCanonFile = Readonly<{
  schemaVersion: number;
  magnets: ReadonlyArray<MagnetCanonEntry>;
}>;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`magnet-canon validation: ${message}`);
}

const CANONICAL_TYPES: ReadonlySet<string> = new Set<CanonicalMagnetType>([
  'railway_station',
  'metro_station',
  'transport_hub',
  'airport',
  'port',
  'industrial_anchor',
  'industrial_zone',
  'business_center',
  'office_cluster',
  'hospital',
  'medical_cluster',
  'university',
  'shopping_mall',
  'park',
  'beach',
  'waterfront',
  'resort_area',
  'stadium',
  'event_venue',
  'cultural_landmark',
  'museum',
  'theater',
  'tourist_attraction',
  'hotel_cluster',
  'residential_density',
  'weak_amenity',
  'tertiary_local_amenity',
]);

const AUDIENCE_KEYS: ReadonlyArray<keyof AudienceEligibility> = [
  'business',
  'corporate',
  'tourist',
  'family',
  'medical',
  'student',
  'industrialWorker',
];

export function loadMagnetCanonJson(absPath: string): unknown {
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

export function validateMagnetCanon(data: unknown): MagnetCanonFile {
  assert(isObject(data), 'root must be an object');
  assert(typeof data.schemaVersion === 'number', '`schemaVersion` must be a number');
  assert(Array.isArray(data.magnets), '`magnets` must be an array');

  const magnets = data.magnets as unknown[];
  const seenTypes = new Set<string>();
  const aliasToType = new Map<string, { type: string; ambiguous: boolean }>();
  const allRawCategories = new Set<string>();

  const out: MagnetCanonEntry[] = [];

  for (const [idx, rawEntry] of magnets.entries()) {
    assert(isObject(rawEntry), `magnets[${idx}] must be an object`);

    const canonicalType = rawEntry.canonicalType;
    assert(typeof canonicalType === 'string', `magnets[${idx}].canonicalType must be a string`);
    assert(CANONICAL_TYPES.has(canonicalType), `magnets[${idx}].canonicalType is invalid: ${canonicalType}`);
    assert(!seenTypes.has(canonicalType), `duplicate canonicalType: ${canonicalType}`);
    seenTypes.add(canonicalType);

    const publicLabel = rawEntry.publicLabel;
    assert(isObject(publicLabel), `magnets[${idx}].publicLabel must be an object`);
    assert(typeof publicLabel.ru === 'string' && publicLabel.ru.trim().length > 0, `magnets[${idx}].publicLabel.ru is required`);
    assert(typeof publicLabel.en === 'string' && publicLabel.en.trim().length > 0, `magnets[${idx}].publicLabel.en is required`);

    const aliases = rawEntry.aliases;
    assert(Array.isArray(aliases), `magnets[${idx}].aliases must be an array`);
    for (const a of aliases) {
      assert(typeof a === 'string' && a.trim().length > 0, `magnets[${idx}].aliases contains invalid value`);
      const norm = a.toLowerCase().trim();
      if (!aliasToType.has(norm)) {
        aliasToType.set(norm, { type: canonicalType, ambiguous: false });
      } else {
        // The canon format supports ambiguity only when explicitly tagged.
        // If we ever need it, we will extend schema with `aliasesAmbiguous: []`.
        const existing = aliasToType.get(norm)!;
        assert(existing.type === canonicalType, `alias '${a}' maps to multiple canonicalTypes (${existing.type} vs ${canonicalType})`);
      }
    }

    const rawCategories = rawEntry.rawCategories;
    assert(Array.isArray(rawCategories), `magnets[${idx}].rawCategories must be an array`);
    for (const c of rawCategories) {
      assert(typeof c === 'string' && c.trim().length > 0, `magnets[${idx}].rawCategories contains invalid value`);
      allRawCategories.add(c);
    }

    assert(typeof rawEntry.role === 'string', `magnets[${idx}].role is required`);
    assert(rawEntry.role === 'primary' || rawEntry.role === 'secondary' || rawEntry.role === 'tertiary', `magnets[${idx}].role invalid`);

    assert(isObject(rawEntry.residentialEligibility), `magnets[${idx}].residentialEligibility is required`);
    assert([1, 2, 3].includes(rawEntry.residentialEligibility.maxTier as any), `magnets[${idx}].residentialEligibility.maxTier must be 1|2|3`);
    assert(typeof rawEntry.residentialEligibility.primeEligible === 'boolean', `magnets[${idx}].residentialEligibility.primeEligible must be boolean`);

    assert(isObject(rawEntry.audienceEligibility), `magnets[${idx}].audienceEligibility is required`);
    for (const k of AUDIENCE_KEYS) {
      assert(typeof (rawEntry.audienceEligibility as any)[k] === 'boolean', `magnets[${idx}].audienceEligibility.${k} must be boolean`);
    }

    assert(typeof rawEntry.anchorStrength === 'string', `magnets[${idx}].anchorStrength is required`);
    assert(
      rawEntry.anchorStrength === 'tier1' ||
        rawEntry.anchorStrength === 'tier2' ||
        rawEntry.anchorStrength === 'weak' ||
        rawEntry.anchorStrength === 'noise' ||
        rawEntry.anchorStrength === 'negative',
      `magnets[${idx}].anchorStrength invalid`,
    );

    assert([1, 2, 3].includes(rawEntry.maxTier as any), `magnets[${idx}].maxTier must be 1|2|3`);

    assert(isObject(rawEntry.scoringCaps), `magnets[${idx}].scoringCaps is required`);
    assert(typeof rawEntry.scoringCaps.audienceFitMax === 'number', `magnets[${idx}].scoringCaps.audienceFitMax is required`);
    assert(typeof rawEntry.scoringCaps.tier1CreditMax === 'number', `magnets[${idx}].scoringCaps.tier1CreditMax is required`);

    // Tier caps: museum/theater/tourist_attraction cannot have unrestricted Tier-1 access.
    if (canonicalType === 'museum' || canonicalType === 'theater' || canonicalType === 'tourist_attraction') {
      assert((rawEntry.maxTier as any) !== 1, `${canonicalType} must not have maxTier=1 (contextual promotion only)`);
      assert((rawEntry.residentialEligibility.maxTier as any) !== 1, `${canonicalType} must not be residential Tier-1 by default`);
      assert((rawEntry.scoringCaps.tier1CreditMax as any) === 0, `${canonicalType} must have tier1CreditMax=0 by default`);
    }

    // Weak / tertiary amenities cannot become prime magnets.
    if (canonicalType === 'weak_amenity' || canonicalType === 'tertiary_local_amenity') {
      assert(rawEntry.residentialEligibility.primeEligible === false, `${canonicalType} must not be primeEligible`);
      assert((rawEntry.residentialEligibility.maxTier as any) === 3, `${canonicalType} must be capped at tier3`);
      assert((rawEntry.maxTier as any) === 3, `${canonicalType} must have maxTier=3`);
      assert((rawEntry.scoringCaps.tier1CreditMax as any) === 0, `${canonicalType} must have tier1CreditMax=0`);
    }

    out.push(rawEntry as MagnetCanonEntry);
  }

  // Ensure canon covers the expected raw categories referenced anywhere else.
  // We treat "mapped" as "present in at least one entry.rawCategories".
  // (Empty sets are allowed for name-based families like park/beach/etc.)
  // If the upstream taxonomy adds new raw categories, this forces canon updates.
  assert(allRawCategories.has('railway_station'), 'rawCategory railway_station must be mapped');
  assert(allRawCategories.has('metro'), 'rawCategory metro must be mapped');
  assert(allRawCategories.has('airport'), 'rawCategory airport must be mapped');
  assert(allRawCategories.has('business'), 'rawCategory business must be mapped');
  assert(allRawCategories.has('hospital'), 'rawCategory hospital must be mapped');
  assert(allRawCategories.has('university'), 'rawCategory university must be mapped');
  assert(allRawCategories.has('shopping_major'), 'rawCategory shopping_major must be mapped');
  assert(allRawCategories.has('attraction'), 'rawCategory attraction must be mapped');

  return {
    schemaVersion: data.schemaVersion as number,
    magnets: out,
  };
}

export function magnetCanonPathFromRepoRoot(): string {
  return path.join(
    process.cwd(),
    'src',
    'lib',
    'location',
    'canonical',
    'magnet-canon.json',
  );
}

