import fs from 'node:fs';
import path from 'node:path';

import {
  magnetCanonPathFromRepoRoot,
  loadMagnetCanonJson,
  validateMagnetCanon,
  type CanonicalMagnetType,
  type MagnetCanonEntry,
} from '../src/lib/location/canonical/magnet-canon.schema';

function q(s: string): string {
  return JSON.stringify(s);
}

function stableSort<T>(arr: readonly T[], key: (t: T) => string): T[] {
  return [...arr].sort((a, b) => key(a).localeCompare(key(b)));
}

function toRegistryObject(entries: readonly MagnetCanonEntry[]): string {
  const lines: string[] = [];
  lines.push('export const GENERATED_MAGNET_REGISTRY = {');
  for (const e of stableSort(entries, x => x.canonicalType)) {
    lines.push(`  ${e.canonicalType}: {`);
    lines.push(`    canonicalType: ${q(e.canonicalType)},`);
    lines.push(`    publicLabel: { ru: ${q(e.publicLabel.ru)}, en: ${q(e.publicLabel.en)} },`);
    lines.push(`    aliases: [${e.aliases.map(a => q(a)).join(', ')}],`);
    lines.push(`    rawCategories: [${e.rawCategories.map(c => q(c)).join(', ')}],`);
    lines.push(`    allowedTaxonomyTypes: [${e.allowedTaxonomyTypes.map(t => q(t)).join(', ')}],`);
    lines.push(`    role: ${q(e.role)},`);
    lines.push(`    residentialEligibility: { maxTier: ${e.residentialEligibility.maxTier}, primeEligible: ${e.residentialEligibility.primeEligible} },`);
    lines.push(
      `    audienceEligibility: { business: ${e.audienceEligibility.business}, corporate: ${e.audienceEligibility.corporate}, tourist: ${e.audienceEligibility.tourist}, family: ${e.audienceEligibility.family}, medical: ${e.audienceEligibility.medical}, student: ${e.audienceEligibility.student}, industrialWorker: ${e.audienceEligibility.industrialWorker} },`,
    );
    lines.push(`    anchorStrength: ${q(e.anchorStrength)},`);
    lines.push(`    maxTier: ${e.maxTier},`);
    lines.push(`    distanceBands: { mustSurfaceRadiusM: ${e.distanceBands.mustSurfaceRadiusM}, softenTier2AfterM: ${e.distanceBands.softenTier2AfterM} },`);
    lines.push(`    scoringCaps: { audienceFitMax: ${e.scoringCaps.audienceFitMax}, tier1CreditMax: ${e.scoringCaps.tier1CreditMax} },`);
    lines.push(`    antiSignals: [${e.antiSignals.map(s => `{ id: ${q(s.id)}, kind: ${q(s.kind)}, pattern: ${q(s.pattern)}, effect: ${q(s.effect)} }`).join(', ')}],`);
    lines.push(`    downgradeRules: ${JSON.stringify(e.downgradeRules, null, 2).split('\n').map((l, i) => (i === 0 ? l : `    ${l}`)).join('\n')},`);
    lines.push(`    notes: ${q(e.notes)},`);
    lines.push('  },');
  }
  lines.push('} as const;');
  return lines.join('\n');
}

function generate(entries: readonly MagnetCanonEntry[]): string {
  const types = stableSort(entries.map(e => e.canonicalType), x => x) as CanonicalMagnetType[];

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source of truth: src/lib/location/canonical/magnet-canon.json

/* eslint-disable */

export type CanonicalMagnetType = ${types.map(t => q(t)).join(' | ')};

export const CANONICAL_MAGNET_TYPES = [
${types.map(t => `  ${q(t)},`).join('\n')}
] as const;

${toRegistryObject(entries)}

export function getCanonicalMagnetByType(type: CanonicalMagnetType) {
  return GENERATED_MAGNET_REGISTRY[type];
}

export function getCanonicalPublicLabel(type: CanonicalMagnetType) {
  return GENERATED_MAGNET_REGISTRY[type].publicLabel;
}

export function getCanonicalAudienceEligibility(type: CanonicalMagnetType) {
  return GENERATED_MAGNET_REGISTRY[type].audienceEligibility;
}

export function getCanonicalScoringCaps(type: CanonicalMagnetType) {
  return GENERATED_MAGNET_REGISTRY[type].scoringCaps;
}

// Runtime classifier remains executable TS logic, but MUST read constraints/labels from the registry.
// (This re-export makes the generated file the single runtime entrypoint as required by contract.)
export { classifyCanonicalMagnet } from './magnet-classifier';
export { mustSurfaceRadiusMForFamily, isPersonNameOfficePoi } from './magnet-classifier';
`;
}

function writeIfChanged(absPath: string, content: string) {
  const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null;
  if (existing === content) return;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

function main() {
  const canonPath = magnetCanonPathFromRepoRoot();
  const json = loadMagnetCanonJson(canonPath);
  const canon = validateMagnetCanon(json);

  const outPath = path.join(
    process.cwd(),
    'src',
    'lib',
    'location',
    'canonical',
    'generated-magnet-registry.ts',
  );

  const content = generate(canon.magnets);
  writeIfChanged(outPath, content);
}

main();

