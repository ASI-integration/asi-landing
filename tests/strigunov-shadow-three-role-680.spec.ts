import { test, expect } from '@playwright/test';

const BASE = process.env.ASI_SHADOW_E2E_URL;
const BUILD = process.env.ASI_SHADOW_E2E_BUILD;
const PASS = process.env.ASI_SHADOW_E2E_PASSWORD;
const ACCOUNT = '00000000-0000-4000-8000-000000006801';
const PROPERTY = '00000000-0000-4000-8000-000000006821';
const BOOKING = '00000000-0000-4000-8000-000000006831';
const OTHER_ACCOUNT = '00000000-0000-4000-8000-000000006802';
const OTHER_PROPERTY = '00000000-0000-4000-8000-000000006822';
const OTHER_BOOKING = '00000000-0000-4000-8000-000000006832';
const WORKER_TASK = '00000000-0000-4000-8000-000000006851';
const MANAGER_TASK = '00000000-0000-4000-8000-000000006853';
const actors = [
  { role: 'owner', email: 'e2e680-owner@example.invalid', tasks: 4, finance: 200 },
  { role: 'manager', email: 'e2e680-manager@example.invalid', tasks: 4, finance: 403 },
  { role: 'operator', email: 'e2e680-worker@example.invalid', tasks: 2, finance: 403 },
] as const;

if (
  BASE !== 'http://127.0.0.1:13003' ||
  BUILD !== 'SVvobnGRZ3HxpK1rDXqqS' ||
  process.env.ASI_SHADOW_E2E_DB !== 'asi_shadow_migrations_test' ||
  process.env.ASI_SHADOW_E2E_NO_SEND !== 'YES' ||
  !PASS || PASS.length < 24
) throw new Error('E2E_SHADOW_ONLY: pinned build, internal isolated DB, no-send, disposable credentials required');
test.use({ baseURL: BASE, trace: 'retain-on-failure' });
test.describe.configure({ mode: 'serial' });

test('new main build and no-login protected task API', async ({ request }) => {
  expect((await request.get('/_next/static/' + BUILD + '/_buildManifest.js')).status()).toBe(200);
  expect((await request.get('/api/health')).status()).toBe(200);
  expect((await request.get('/api/dashboard/property-tasks?accountId=' + ACCOUNT + '&propertyId=' + PROPERTY)).status()).toBe(401);
});

for (const actor of actors) {
  test(actor.role + ' browser login, scoped tasks and owner finance', async ({ page }) => {
    await page.goto('/login?redirect=%2Fdashboard', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(actor.email);
    await page.locator('input[type="password"]').fill(PASS);
    const login = page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST');
    await page.locator('button[type="submit"]').click();
    const result = await login;
    expect(result.status(), actor.role + ' login status').toBe(200);
    const params = new URLSearchParams({ accountId: ACCOUNT, propertyId: PROPERTY });
    const tasksResponse = await page.request.get('/api/dashboard/property-tasks?' + params);
    expect(tasksResponse.status(), actor.role + ' tasks GET').toBe(200);
    const tasks = await tasksResponse.json() as { ok: boolean; tasks: { id: string; property_id: string; assigned_to: string }[] };
    expect(tasks.ok).toBe(true);
    expect(tasks.tasks).toHaveLength(actor.tasks);
    expect(tasks.tasks.every((t) => t.property_id === PROPERTY)).toBe(true);
    if (actor.role === 'operator') {
      expect(tasks.tasks.map((t) => t.id).sort()).toEqual([
        '00000000-0000-4000-8000-000000006851',
        '00000000-0000-4000-8000-000000006852',
      ]);
      expect(tasks.tasks.every((t) => t.assigned_to === '00000000-0000-4000-8000-000000006813')).toBe(true);
    }
    const financeParams = new URLSearchParams({ accountId: ACCOUNT, propertyId: PROPERTY, bookingOpsRecordId: BOOKING });
    const finance = await page.request.get('/api/dashboard/owner-payout-report?' + financeParams);
    expect(finance.status(), actor.role + ' owner finance').toBe(actor.finance);
    if (actor.role === 'owner') {
      const json = await finance.json() as { ok: boolean; settlementStatus: string };
      expect(json.ok).toBe(true);
      expect(json.settlementStatus).toBe('CALCULATED_NOT_BANK_VERIFIED');
      const foreign = new URLSearchParams({ accountId: OTHER_ACCOUNT, propertyId: OTHER_PROPERTY, bookingOpsRecordId: OTHER_BOOKING });
      expect((await page.request.get('/api/dashboard/owner-payout-report?' + foreign)).status()).toBe(403);
    }
    if (actor.role === 'operator') {
      const foreignUpdate = await page.request.patch('/api/dashboard/property-tasks?' + params + '&taskId=' + MANAGER_TASK);
      expect([403, 404]).toContain(foreignUpdate.status());
      const ownUpdate = await page.request.patch('/api/dashboard/property-tasks?' + params + '&taskId=' + WORKER_TASK);
      expect(ownUpdate.status()).toBe(200);
      const ownPayload = await ownUpdate.json() as { task: { task_status: string } };
      expect(ownPayload.task.task_status).toBe('resolved');
    }
  });
}
