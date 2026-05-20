import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression: internal/technical RU must not leak into location demo public copy sources.
 * Scans only designated modules (not tests, comments in other languages, or scoring internals elsewhere).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

const PUBLIC_RU_COPY_SOURCE_FILES_RELATIVE = [
  '../location-public-summary.ts',
  '../location-public-claims.ts',
  '../location-decision-rules.ts',
  '../demo-public-copy.ts',
  '../neighborhood-environment.ts',
  '../location-decision-kernel.ts',
  '../explanation.ts',
  '../audience-scoring.ts',
  '../location-score.ts',
  '../../../components/location-intelligence-locale.tsx',
  '../../../components/location/LocationStandaloneFullReport.tsx',
] as const;

const FORBIDDEN_SUBSTRINGS = [
  'якорь',
  'якоря',
  'драйверы',
  'публичный сигнал',
  'устойчивым публичным',
  'сценарий дохода',
  'прокси',
  'по данным карты',
] as const;

describe('RU location demo public copy — forbidden internal wording', () => {
  it('designated source files do not contain forbidden RU substrings', () => {
    for (const rel of PUBLIC_RU_COPY_SOURCE_FILES_RELATIVE) {
      const abs = join(__dirname, rel);
      const src = readFileSync(abs, 'utf8');
      const lower = src.toLowerCase();
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        expect(lower, `${rel} must not contain «${bad}»`).not.toContain(bad.toLowerCase());
      }
    }
  });

  it('does not expose generic strong-commercial environment claims in residential demo copy sources', () => {
    for (const rel of PUBLIC_RU_COPY_SOURCE_FILES_RELATIVE) {
      const abs = join(__dirname, rel);
      const src = readFileSync(abs, 'utf8');
      expect(src, `${rel} must not contain generic commercial-profile claim`).not.toContain('Коммерческий профиль сильный');
      expect(src, `${rel} must not contain generic industrial/logistics claim`).not.toContain(
        'Рядом отмечены промышленные или логистические зоны',
      );
    }
  });
});
