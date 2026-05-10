/**
 * Smoke suite for asi-global.ru public pages.
 *
 * Covers:
 *   A. Pages load without 404 / 5xx
 *   B. RU header structure and no duplicates
 *   C. Basic navigation flows (click-through)
 *   D. No obviously broken / empty links on key pages
 *
 * Run: npm run test:smoke
 */

import { test, expect } from '@playwright/test';

// Key public pages to check
const SMOKE_PAGES = [
  { path: '/', label: 'Home (/)' },
  { path: '/ru', label: 'RU home (/ru)' },
  { path: '/ru/otchet-po-dohodnosti-obektov', label: 'Revenue report' },
  { path: '/ru/kak-my-ocenivaem-dohodnost-obektov', label: 'Methodology' },
] as const;

// Pages that use RuPublicNavHeader with density="landing"
const RU_NAV_PAGES = [
  '/ru',
  '/ru/otchet-po-dohodnosti-obektov',
  '/ru/kak-my-ocenivaem-dohodnost-obektov',
] as const;

// ────────────────────────────────────────────────────────────
// A. Pages load — no 404 / 5xx
// ────────────────────────────────────────────────────────────
test.describe('A. Pages — no 4xx/5xx', () => {
  for (const { path, label } of SMOKE_PAGES) {
    test(`${label}`, async ({ page }) => {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(
        response?.status() ?? 0,
        `${path} must not return 4xx or 5xx`,
      ).toBeLessThan(400);

      // Must have a visible body — catches blank/error pages
      await expect(page.locator('body')).toBeVisible();
    });
  }
});

// ────────────────────────────────────────────────────────────
// B. Header / navigation
// ────────────────────────────────────────────────────────────
test.describe('B. Header — structure and correctness', () => {
  for (const path of RU_NAV_PAGES) {
    test.describe(path, () => {
      test('header element is present', async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('header')).toBeVisible();
      });

      test('logo link is present', async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        // Logo is <a href="/">ASI</a> — filtered by text to avoid strict-mode clash
        // with: (1) support email whose accessible name contains "ASI",
        //        (2) nav "Главная" link which also has href="/"
        const logo = page.locator('header a[href="/"]').filter({ hasText: /^ASI$/ });
        await expect(logo).toBeVisible();
      });

      test('nav link "Оценка доходности" is present and clickable', async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        const link = page
          .locator('header nav')
          .getByRole('link', { name: /Оценка доходности/i });
        await expect(link).toBeVisible();
        // Must have a non-empty, non-hash href
        const href = await link.getAttribute('href');
        expect(href, 'Оценка доходности href must not be "#" or empty').toBeTruthy();
        expect(href).not.toBe('#');
      });

      test('login button is present', async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        const loginBtn = page.locator('header').getByRole('link', { name: /Войти/i });
        await expect(loginBtn).toBeVisible();
      });

      test('no duplicate "Контакты" in header', async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        const contactLinks = page
          .locator('header')
          .getByRole('link', { name: /Контакты/i });
        const count = await contactLinks.count();
        expect(count, 'Header must not contain duplicate "Контакты" links').toBeLessThanOrEqual(1);
      });

      test('header elements do not visually overlap (bounding boxes)', async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });

        // Collect all direct-child elements of the header rows
        const headerLinks = page.locator('header a');
        const count = await headerLinks.count();
        // Gather bounding boxes for visible links
        const boxes: Array<{ x: number; y: number; width: number; height: number; text: string }> =
          [];
        for (let i = 0; i < count; i++) {
          const el = headerLinks.nth(i);
          if (!(await el.isVisible())) continue;
          const box = await el.boundingBox();
          if (!box) continue;
          const text = await el.textContent();
          boxes.push({ ...box, text: text?.trim() ?? '' });
        }

        // Check that no two visible links overlap significantly (> 4 px overlap in both axes)
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            if (xOverlap > 4 && yOverlap > 4) {
              throw new Error(
                `Header links overlap: "${a.text}" and "${b.text}" overlap by ${xOverlap}×${yOverlap}px`,
              );
            }
          }
        }
      });
    });
  }
});

// ────────────────────────────────────────────────────────────
// C. Navigation flows
// ────────────────────────────────────────────────────────────
test.describe('C. Navigation flows', () => {
  test('Home → Revenue report (via header nav)', async ({ page }) => {
    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    await page
      .locator('header nav')
      .getByRole('link', { name: /Оценка доходности/i })
      .click();
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('otchet-po-dohodnosti-obektov');
    await expect(page.locator('header')).toBeVisible();
  });

  test('Revenue report → Methodology (via in-page link)', async ({ page }) => {
    await page.goto('/ru/otchet-po-dohodnosti-obektov', { waitUntil: 'domcontentloaded' });
    // The link text is "Как мы оцениваем доходность объектов" (not "Методология")
    // "Методология" is the section heading above it
    const methodLink = page.locator('a[href="/ru/kak-my-ocenivaem-dohodnost-obektov"]').first();
    await expect(methodLink).toBeVisible();
    await methodLink.click();
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('kak-my-ocenivaem-dohodnost-obektov');
  });

  test('Methodology → back to Revenue report (via header nav)', async ({ page }) => {
    await page.goto('/ru/kak-my-ocenivaem-dohodnost-obektov', {
      waitUntil: 'domcontentloaded',
    });
    await page
      .locator('header nav')
      .getByRole('link', { name: /Оценка доходности/i })
      .click();
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('otchet-po-dohodnosti-obektov');
  });

  test('Contacts link in header navigates correctly', async ({ page }) => {
    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    const contactLink = page.locator('header').getByRole('link', { name: /Контакты/i });
    await expect(contactLink).toBeVisible();
    const href = await contactLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).not.toBe('#');
    // Visit the contacts href and expect a valid page
    const response = await page.goto(href!, { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 0).toBeLessThan(400);
  });
});

// ────────────────────────────────────────────────────────────
// D. No obviously broken links
// ────────────────────────────────────────────────────────────
test.describe('D. Links — no empty or "#" hrefs', () => {
  for (const { path, label } of SMOKE_PAGES) {
    test(`${label} has no empty or "#" links`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const links = page.locator('a[href]');
      const count = await links.count();
      const broken: string[] = [];

      for (let i = 0; i < count; i++) {
        const href = await links.nth(i).getAttribute('href');
        const text = (await links.nth(i).textContent())?.trim() ?? '';
        if (href === '#' || href === '' || href === null) {
          broken.push(`"${text || '(no text)'}" href="${href}"`);
        }
      }

      expect(
        broken,
        `Found broken/empty links on ${path}:\n  ${broken.join('\n  ')}`,
      ).toHaveLength(0);
    });
  }

  test('all RU nav header links return < 400', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000); // 6 sequential HTTP requests × up to 15s each
    // Playwright baseURL from playwright.config.ts (e.g. https://asi-global.ru)
    const origin = (baseURL ?? 'https://asi-global.ru').replace(/\/$/, '');

    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    const navLinks = page.locator('header nav a');
    const count = await navLinks.count();

    // Collect hrefs + labels before any navigation
    const links: Array<{ href: string; text: string }> = [];
    for (let i = 0; i < count; i++) {
      const href = (await navLinks.nth(i).getAttribute('href')) ?? '';
      const text = (await navLinks.nth(i).textContent())?.trim() ?? '';
      links.push({ href, text });
    }

    // Use API-level requests — skip hash-only anchors and external URLs.
    for (const { href, text } of links) {
      if (!href || href.startsWith('#') || href.includes('://')) continue;

      // Strip hash fragment; keep the path portion only
      const path = href.split('#')[0];
      if (!path) continue;

      const url = `${origin}${path}`;
      const response = await request.get(url, { timeout: 15000 });
      expect(
        response.status(),
        `Nav link "${text}" (${href}) returned ${response.status()}`,
      ).toBeLessThan(400);
    }
  });
});
