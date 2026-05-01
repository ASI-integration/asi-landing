import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function repoPath(...parts: string[]) {
  return path.join(process.cwd(), ...parts);
}

describe('canonical magnet architecture (no raw bypasses)', () => {
  it('residential-location-rules.ts has no standalone Tier-1 attraction regex promotion', () => {
    const p = repoPath('src', 'lib', 'location', 'rules', 'residential-location-rules.ts');
    const s = read(p);

    expect(s).not.toContain('MAJOR_TOURIST_ATTRACTION_NAME_RE');

    // Guard against reintroducing raw museum/theater/tourist promotion regexes.
    expect(s).not.toMatch(/музей\|театр/i);
    expect(s).not.toMatch(/major\s+attraction/i);
  });

  it('audience-scoring.ts uses canonical classifier (no raw category bypass sets)', () => {
    const p = repoPath('src', 'lib', 'location', 'audience-scoring.ts');
    const s = read(p);
    expect(s).toContain('classifyCanonicalMagnet');
    expect(s).not.toContain('TOURIST_CATEGORY_IDS');
  });

  it('explanation.ts uses canonical family reasons (no raw category reason map)', () => {
    const p = repoPath('src', 'lib', 'location', 'explanation.ts');
    const s = read(p);
    expect(s).toContain('classifyCanonicalMagnet');
    expect(s).toContain('MAGNET_REASON_RU_BY_FAMILY');
    expect(s).not.toContain('MAGNET_REASON_RU: Record<string');
  });

  it('UI consumes canonical public labels (category_label_ru) and does not infer from raw OSM category', () => {
    const p = repoPath('src', 'components', 'location', 'LocationStandaloneFullReport.tsx');
    const s = read(p);
    // UI should render labels provided by report, not map from raw category ids.
    expect(s).toContain('category_label_ru');
    expect(s).not.toMatch(/switch\s*\(\s*m\.category_id/i);
  });
});

