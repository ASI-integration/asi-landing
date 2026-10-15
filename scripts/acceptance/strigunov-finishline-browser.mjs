import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { sealData } from 'iron-session';
assert.equal(process.env.CI, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY, 'YES');
const origin = process.env.LAB_BROWSER_ORIGIN;
assert.match(origin || '', /^http:\/\/172\.[0-9]+\.[0-9]+\.[0-9]+:33100$/);
const source = process.env.REVIEWED_SOURCE_SHA;
const results = []; let page; let browser; let stage = 'ready'; let status = 'FAIL';
const delay = ms => new Promise(r => setTimeout(r, ms));
const check = async (id, fn) => { stage = id; await fn(); results.push({ id, status: 'PASS' }); };
try {
  for (let i = 0; i < 240 && !existsSync('finishline-results/browser-ready.json'); i++) await delay(500);
  assert.equal(JSON.parse(readFileSync('finishline-results/browser-ready.json', 'utf8')).source, source);
  assert.ok(existsSync('/usr/bin/google-chrome'));
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', chromiumSandbox: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let blockedExternal = 0;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blockedExternal++; return route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  page = await context.newPage(); page.setDefaultTimeout(20000);
  await check('browser-no-session-401', async () => assert.equal((await page.goto(origin + '/api/dashboard/booking-ops')).status(), 401));
  const cookie = await sealData({ userId: '32000000-0000-4000-8000-000000000001', email: 'operator@example.invalid' }, { password: process.env.LAB_SESSION_SECRET, ttl: 600 });
  await context.addCookies([{ name: 'asi_session', value: cookie, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await check('browser-real-operator-ui', async () => {
    await page.goto(origin + '/dashboard/booking-ops');
    await page.getByRole('heading', { name: 'Операции по броням', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Добавить запись', exact: true }).waitFor();
  });
  let id;
  await check('browser-authenticated-reservation-intake', async () => {
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/dashboard/booking-ops/intake/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'admin', action: 'process', bookingReference: 'finishline-browser', guestName: 'ASI Browser Synthetic', guestEmail: 'browser@example.invalid', propertyId: '29300000-0000-4000-8000-000000000003', propertyLabel: 'Synthetic object', guestCount: 1, checkInAt: '2026-11-16T14:00:00Z', checkOutAt: '2026-11-18T11:00:00Z' }) });
      return { status: r.status, body: await r.json() };
    });
    assert.equal(r.status, 200); assert.equal(r.body.result.intakeStatus, 'processed'); id = r.body.result.bookingId; assert.ok(id);
  });
  await check('browser-operator-refresh-and-select', async () => {
    const refreshed = page.waitForResponse(r => r.url() === origin + '/api/dashboard/booking-ops' && r.request().method() === 'GET');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    const response = await refreshed; assert.equal(response.status(), 200);
    const body = await response.json(); assert.ok(body.records.some(r => r.id === id && r.guestName === 'ASI Browser Synthetic'));
    await page.getByText('ASI Browser Synthetic', { exact: true }).first().waitFor();
    await page.getByText('ASI Browser Synthetic', { exact: true }).first().click();
  });
  await check('browser-scoped-events-read', async () => {
    const code = await page.evaluate(async id => (await fetch('/api/dashboard/booking-ops/' + id + '/events')).status, id);
    assert.equal(code, 200);
  });
  await check('browser-reload-persistence', async () => {
    await page.reload(); await page.getByText('ASI Browser Synthetic', { exact: true }).first().waitFor();
  });
  await page.screenshot({ path: 'finishline-results/browser.png', fullPage: false });
  writeFileSync('finishline-results/browser-boundary.json', JSON.stringify({ source, chromium: browser.version(), outboundPolicy: 'browser HTTP routing only exact application origin; WebSockets blocked; host Chrome background networking not OS-isolated', blockedExternal, loginIssuance: 'NOT_RUN: synthetic sealed session', provider: 'NOT_RUN', actualUi: true }));
  status = 'PASS';
} catch (error) { results.push({ id: stage, status: 'FAIL', errorType: error?.name, diagnostic: String(error?.message || '').replaceAll(process.env.LAB_SESSION_SECRET || 'NO_SECRET', '[REDACTED]').slice(0,1200) }); if(page) await page.screenshot({path:'finishline-results/browser-failure.png'}).catch(()=>{}); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  writeFileSync('finishline-results/browser.json', JSON.stringify({ source, status, results, noExternalSend: true, limits: ['intake submitted through real browser fetch, not a public intake form', 'operator UI rendered/refreshed/selected; session sealed by fixture, no login issuance', 'browser reload is not physical host reboot'] }, null, 2));
}
