import { test, expect } from '@playwright/test';

/**
 * Read-only browser preflight. Never fallback to public BASE_URL.
 * No sign-in, fixture creation, POST, messages, deposits or bookings here.
 */
const url = process.env.ASI_SHADOW_URL;
const expectedSha = process.env.ASI_SHADOW_SHA;
if (url !== 'http://127.0.0.1:13001' || !expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
  throw new Error('SHADOW_IDENTITY_REQUIRED: pinned localhost SSH tunnel and exact SHA');
}

test.use({ baseURL: url });

test('read-only shadow identity and health', async ({ request }) => {
  const versionResponse = await request.get('/api/version');
  expect(versionResponse.status()).toBe(200);
  const version = await versionResponse.json();
  expect(version.environment).toBe('staging');
  expect(version.sha).toBe(expectedSha);
  const healthResponse = await request.get('/api/health');
  expect(healthResponse.status()).toBe(200);
  expect((await healthResponse.json()).ok).toBe(true);
});

test('login page renders in real browser, no authentication', async ({ page }) => {
  const response = await page.goto('/login?redirect=%2Fdashboard%2Fbooking-ops', {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status()).toBe(200);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('unauthenticated staff route cannot show privileged booking data', async ({ page }) => {
  await page.goto('/dashboard/booking-ops', { waitUntil: 'domcontentloaded' });
  const state = await page.locator('body').innerText();
  expect(state).not.toMatch(/guest passport|owner_payout_cents|bank_account_number/i);
});
