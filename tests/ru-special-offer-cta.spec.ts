/**
 * Read-only staging click-through for RU homepage special-offer CTA flow.
 * Does not submit forms, create users, log in, pay, or send messages.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

async function expectStatusOk(
  request: APIRequestContext,
  origin: string,
  href: string,
  label: string,
) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
  if (href.includes('://') && !href.startsWith(origin)) return;
  const path = href.replace(origin, '').split('#')[0];
  if (!path || path.startsWith('http')) return;
  const url = path.startsWith('/') ? `${origin}${path}` : `${origin}/${path}`;
  const response = await request.get(url, { timeout: 20_000 });
  expect(response.status(), `${label} (${href}) returned ${response.status()}`).toBeLessThan(400);
}

async function assertSpecialOfferInView(page: Page) {
  const section = page.locator('#special-offer');
  await expect(section).toBeVisible();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const el = document.getElementById('special-offer');
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      });
    })
    .toBe(true);
}

test.describe('RU homepage special-offer CTA click-through (read-only)', () => {
  test('wide CTAs scroll to special-offer; continue reaches /ru/connect', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const origin = (baseURL ?? 'https://staging.asi-global.ru').replace(/\/$/, '');

    const home = await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    expect(home?.status() ?? 0).toBeLessThan(400);

    const wideCtas = page.locator('[data-testid="start-connection"]');
    await expect(wideCtas).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      await page.goto('/ru', { waitUntil: 'domcontentloaded' });
      const cta = page.locator('[data-testid="start-connection"]').nth(i);
      await expect(cta).toHaveAttribute('href', '#special-offer');
      await cta.click();
      await assertSpecialOfferInView(page);
      expect(page.url()).toMatch(/#special-offer$/);
    }

    const continueCta = page.locator('[data-testid="continue-connection"]');
    await expect(continueCta).toBeVisible();
    await expect(continueCta).toHaveAttribute('href', '/ru/connect');
    await continueCta.click();
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/ru/connect');
    expect((await page.goto('/ru/connect', { waitUntil: 'domcontentloaded' }))?.status() ?? 0).toBeLessThan(
      400,
    );

    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    const headerCta = page.locator('header').getByRole('link', { name: /Войти \/ подключить/i });
    await expect(headerCta.first()).toBeVisible();
    await expect(headerCta.first()).toHaveAttribute('href', '/ru/connect');

    const footer = page.locator('footer');
    for (const label of ['Оферта', 'Политика конфиденциальности', 'Контакты']) {
      await expect(footer.getByRole('link', { name: label })).toBeVisible();
    }

    await page.goto('/ru/how-it-works', { waitUntil: 'domcontentloaded' });
    const journeyNav = page.locator('header nav[aria-label="Основная навигация"]');
    for (const label of ['Пилот', 'Как это работает', 'Оценка локации']) {
      const link = journeyNav.getByRole('link', { name: label });
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      await expectStatusOk(request, origin, href!, `nav ${label}`);
    }

    const locationLanding = page
      .locator('header nav')
      .getByRole('link', { name: /Оценка локации/i });
    await locationLanding.click();
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/ru/otchet-po-dohodnosti-obektov');
    expect(
      (await page.goto('/ru/otchet-po-dohodnosti-obektov', { waitUntil: 'domcontentloaded' }))
        ?.status() ?? 0,
    ).toBeLessThan(400);
    expect(
      (await page.goto('/ru/location-analysis', { waitUntil: 'domcontentloaded' }))?.status() ?? 0,
    ).toBeLessThan(400);
    expect(
      (await page.goto('/ru/kak-my-ocenivaem-dohodnost-obektov', { waitUntil: 'domcontentloaded' }))
        ?.status() ?? 0,
    ).toBeLessThan(400);

    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    const internalHrefs = await page.locator('a[href]').evaluateAll((anchors) =>
      anchors
        .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((href) => href.startsWith('/') && !href.startsWith('//')),
    );
    const unique = [...new Set(internalHrefs.map((href) => href.split('#')[0]).filter(Boolean))];
    for (const href of unique) {
      await expectStatusOk(request, origin, href, `homepage internal ${href}`);
    }
  });
});
