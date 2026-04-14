/**
 * Accessibility checks using @axe-core/playwright.
 *
 * Catches: missing labels, ARIA issues, duplicate IDs, critical violations.
 * Reports violations without failing on "minor" issues — only critical/serious.
 *
 * Run: npm run test:a11y
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = [
  { path: '/', label: 'Home' },
  { path: '/ru', label: 'RU home' },
  { path: '/ru/otchet-po-dohodnosti-obektov', label: 'Revenue report' },
  { path: '/ru/kak-my-ocenivaem-dohodnost-obektov', label: 'Methodology' },
] as const;

for (const { path, label } of PAGES) {
  test(`${label} (${path}) — no critical/serious a11y violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const results = await new AxeBuilder({ page })
      // Focus on the most impactful rules
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze();

    // Separate by impact
    const critical = results.violations.filter((v) => v.impact === 'critical');
    const serious = results.violations.filter((v) => v.impact === 'serious');

    const formatViolations = (
      violations: typeof results.violations,
    ): string => {
      if (violations.length === 0) return '(none)';
      return violations
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.description}\n` +
            v.nodes
              .slice(0, 3)
              .map((n) => `    • ${n.html.slice(0, 120)}`)
              .join('\n'),
        )
        .join('\n');
    };

    const message =
      `Axe violations on ${path}:\n` +
      `Critical:\n${formatViolations(critical)}\n` +
      `Serious:\n${formatViolations(serious)}`;

    expect(
      [...critical, ...serious],
      message,
    ).toHaveLength(0);
  });

  test(`${label} (${path}) — log moderate/minor violations (informational)`, async ({
    page,
  }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze();

    const moderate = results.violations.filter((v) => v.impact === 'moderate');
    const minor = results.violations.filter((v) => v.impact === 'minor');

    if (moderate.length > 0 || minor.length > 0) {
      console.log(`\n[a11y informational] ${path}:`);
      [...moderate, ...minor].forEach((v) => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} nodes)`);
      });
    }

    // This test always passes — it's a visibility-only check
    expect(true).toBe(true);
  });
}
