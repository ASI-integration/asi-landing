import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release artifact: location PDF production checks', () => {
  it('packages chromium check and production cases into deploy workflow', () => {
    const deployYml = readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'deploy.yml'),
      'utf8',
    );
    expect(deployYml).toContain('scripts/check-location-pdf-chromium.mjs');
    expect(deployYml).toContain('scripts/verify-location-report-pdf-production.mjs');
    expect(deployYml).toContain('tests/location-report-production-cases.json');
  });

  it('exposes npm run location-pdf:check-chromium against the release script', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['location-pdf:check-chromium']).toBe(
      'node scripts/check-location-pdf-chromium.mjs',
    );
  });
});
