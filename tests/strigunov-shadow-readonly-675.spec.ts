import { test, expect } from '@playwright/test';

/** Read-only only. VPS process environment and isolated PostgREST DB must be verified independently. */
const url = process.env.ASI_SHADOW_URL;
const buildId = process.env.ASI_SHADOW_BUILD_ID;
if (
  url !== 'http://127.0.0.1:13002' ||
  !buildId ||
  !/^[A-Za-z0-9_-]{10,40}$/.test(buildId) ||
  process.env.ASI_SHADOW_DB !== 'asi_shadow_migrations_test' ||
  process.env.ASI_SHADOW_NO_SEND !== 'YES'
) {
  throw new Error('SHADOW_ONLY: localhost tunnel 13002, pinned build, shadow DB and no-send required; staging forbidden');
}

test.use({ baseURL: url });

test('shadow build identity and health, read-only', async ({ request }) => {
  const build = await request.get('/_next/static/' + buildId + '/_buildManifest.js');
  expect(build.status()).toBe(200);
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect((await health.json()).ok).toBe(true);
});

test('shadow login renders in Chromium, no authentication', async ({ page }) => {
  const response = await page.goto('/login?redirect=%2Fdashboard%2Fbooking-ops', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('anonymous booking-ops API denies data even when page shell is public', async ({ page }) => {
  await page.goto('/dashboard/booking-ops', { waitUntil: 'domcontentloaded' });
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/guest passport|owner_payout_cents|bank_account_number/i);
  const response = await page.request.get('/api/dashboard/booking-ops');
  expect([401, 403]).toContain(response.status());
});
