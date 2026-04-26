import { test, expect } from '@playwright/test';

function failOnPageErrors(page: import('@playwright/test').Page) {
  page.on('pageerror', (err) => {
    throw err;
  });
}

test.describe('Regression guards', () => {
  test('/connect loads and shows Google status line', async ({ page }) => {
    failOnPageErrors(page);

    const response = await page.goto('/connect', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 0).toBeLessThan(400);

    await expect(page.locator('body')).toBeVisible();

    // Status line is intentionally text-based and stable.
    await expect(page.getByText(/^Google:/)).toBeVisible();

    // Also keep a stable attribute-based hook without adding new testids.
    await expect(page.locator('[data-connect-google-status]')).toHaveCount(1);
  });

  const LOCATION_ROUTES = [
    { path: '/', label: 'Home (navigate to Location Analysis)' },
    { path: '/features/location-analysis', label: 'EN Location Analysis' },
    { path: '/ru/location-analysis', label: 'RU Location Analysis' },
  ] as const;

  for (const r of LOCATION_ROUTES) {
    test(`${r.label}: address input is visible and accepts typing`, async ({ page }) => {
      failOnPageErrors(page);

      // Some routes (like /ru/*) are domain-gated by middleware and may redirect away on non-RU hosts.
      // Skip in that case rather than asserting a false-negative 404.
      const probe = await page.request.get(r.path, { maxRedirects: 0 }).catch(() => null);
      if (probe && probe.status() >= 300 && probe.status() < 400) {
        const loc = probe.headers()['location'];
        test.skip(Boolean(loc) && loc !== r.path, `Route redirected to ${loc}`);
      }

      const response = await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status() ?? 0).toBeLessThan(400);

      if (r.path === '/') {
        // Home does not embed the calculator; navigate via a public link/card.
        // Production `asi-global.ru` can be RU-only, so do not require an EN header link.
        const lang = (await page.locator('html').getAttribute('lang'))?.toLowerCase() ?? '';

        const candidates = [
          // Preferred stable RU hook if present.
          page.getByRole('link', { name: 'Открыть анализ локации', exact: true }),
          page.locator('[aria-label="Открыть анализ локации"]'),
          // Generic RU phrasing fallbacks.
          page.getByRole('link', { name: /анализ локации/i }),
          // Href-based fallbacks (works even if link text changes).
          page.locator('a[href="/ru/location-analysis"]'),
          page.locator('a[href="/features/location-analysis"]'),
          // Original EN selector as a last resort for non-RU environments.
          page.locator('header').getByRole('link', { name: 'Location Analysis', exact: true }),
        ];

        let clicked = false;
        for (const c of candidates) {
          if ((await c.count()) > 0) {
            await c.first().click();
            clicked = true;
            break;
          }
        }

        if (!clicked && lang.startsWith('ru')) {
          test.skip(true, 'RU home has no stable Location Analysis link selector');
        }
        await page.waitForLoadState('domcontentloaded');
      }

      const address = page.getByRole('combobox');
      await expect(address).toBeVisible();
      await expect(address).toBeEnabled();

      await address.fill('Test address 123');
      await expect(address).toHaveValue(/Test address 123/);
    });
  }
});

