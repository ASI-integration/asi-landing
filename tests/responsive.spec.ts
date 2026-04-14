/**
 * Responsive smoke checks.
 *
 * Runs on desktop / tablet / mobile (configured via playwright.config.ts projects).
 * Catches: horizontal overflow, header visible, key content accessible.
 *
 * Run: npm run test:responsive
 */

import { test, expect } from '@playwright/test';

const PAGES = [
  { path: '/', label: 'Home' },
  { path: '/ru', label: 'RU home' },
  { path: '/ru/otchet-po-dohodnosti-obektov', label: 'Revenue report' },
  { path: '/ru/kak-my-ocenivaem-dohodnost-obektov', label: 'Methodology' },
] as const;

for (const { path, label } of PAGES) {
  test.describe(`${label} (${path})`, () => {
    test('no horizontal scroll / overflow', async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      expect(hasOverflow, `${path} has unexpected horizontal overflow`).toBe(false);
    });

    test('header is visible', async ({ page }) => {
      // Only RU pages have the sticky RuPublicNavHeader
      if (path === '/') {
        test.skip(); // EN homepage uses different layout
        return;
      }
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('header')).toBeVisible();
    });

    test('no elements visibly extend beyond right edge of viewport', async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const viewportWidth = page.viewportSize()?.width ?? 1280;

      const offenders = await page.evaluate((vpWidth) => {
        // Returns true if any ancestor clips horizontal overflow
        // (overflow-x: hidden / auto / scroll), meaning the element
        // is intentionally contained and won't cause a viewport scrollbar.
        function isClippedHorizontally(el: Element): boolean {
          let parent = el.parentElement;
          while (parent && parent !== document.documentElement) {
            const ox = window.getComputedStyle(parent).overflowX;
            if (ox === 'hidden' || ox === 'auto' || ox === 'scroll') return true;
            parent = parent.parentElement;
          }
          return false;
        }

        const elements = document.querySelectorAll('*');
        const results: string[] = [];
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          // Skip invisible or zero-size elements
          if (rect.width === 0 || rect.height === 0) continue;
          // Allow a 1px tolerance for sub-pixel rendering
          if (rect.right > vpWidth + 1) {
            // Skip elements that are clipped by a scrollable container —
            // those are intentional (e.g. overflow-x:auto nav on mobile)
            if (isClippedHorizontally(el)) continue;

            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const cls = el.className
              ? `.${String(el.className).split(' ').slice(0, 2).join('.')}`
              : '';
            results.push(`<${tag}${id}${cls}> right=${Math.round(rect.right)}`);
          }
        }
        return results.slice(0, 10); // cap output
      }, viewportWidth);

      expect(
        offenders,
        `Elements extend beyond viewport width (${viewportWidth}px) on ${path}:\n  ${offenders.join('\n  ')}`,
      ).toHaveLength(0);
    });

    test('main content area is visible', async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // At least one of these should be present and visible
      const main = page.locator('main, [role="main"], article, section').first();
      await expect(main).toBeVisible();
    });
  });
}
