import { expect, test, type Page } from '@playwright/test';

const BROWSER_ZOOM = 1.2;
const DESKTOP_VIEWPORT = {
  width: Math.floor(1280 / BROWSER_ZOOM),
  height: Math.floor(600 / BROWSER_ZOOM),
};
const MOBILE_VIEWPORT = {
  width: Math.floor(390 / BROWSER_ZOOM),
  height: Math.floor(640 / BROWSER_ZOOM),
};
const SUCCESS_MARKER = 'DASHBOARD_INDEPENDENT_SIDEBAR_SCROLL_BROWSER_PASSED';

async function openDashboard(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'browser-test-user', email: 'browser-test@asi.invalid' },
        subscription: { status: 'active' },
        account: {
          id: 'browser-test-account',
          name: 'Browser test account',
          plan_code: 'growth',
          subscription_status: 'active',
          trial_started_at: null,
          trial_ends_at: null,
        },
        isCrmOperator: true,
        isDevelopmentOwner: true,
      }),
    });
  });
  await page.route('**/api/dashboard/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'ASI', exact: true })).toBeVisible();
}

test.describe('Dashboard independent sidebar scroll', () => {
  test('desktop nav scroll is independent at a short 120%-zoom-equivalent viewport', async ({ page }) => {
    await openDashboard(page, DESKTOP_VIEWPORT);

    const nav = page.locator('aside nav');
    const main = page.locator('main');
    const logo = page.getByRole('link', { name: 'ASI', exact: true });
    const finalMenuItem = nav.getByRole('link').last();

    const navSize = await nav.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(navSize.scrollHeight).toBeGreaterThan(navSize.clientHeight);

    const mainSize = await main.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(mainSize.scrollHeight).toBeGreaterThan(mainSize.clientHeight);

    await main.evaluate((element) => element.scrollTo({ top: 160, behavior: 'instant' }));
    const rightScrollBefore = await main.evaluate((element) => element.scrollTop);
    expect(rightScrollBefore).toBeGreaterThan(0);
    const documentScrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    const logoTopBefore = await logo.evaluate((element) => element.getBoundingClientRect().top);

    await nav.hover({ position: { x: 40, y: Math.min(navSize.clientHeight - 20, 180) } });
    await page.mouse.wheel(0, 480);

    await expect.poll(() => nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await main.evaluate((element) => element.scrollTop)).toBe(rightScrollBefore);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(documentScrollBefore);
    expect(await logo.evaluate((element) => element.getBoundingClientRect().top)).toBe(logoTopBefore);

    await page.mouse.wheel(0, 2_000);
    await expect.poll(() => nav.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(
      navSize.scrollHeight - navSize.clientHeight - 1,
    );
    await expect(finalMenuItem).toBeInViewport();
    const [navBox, finalItemBox] = await Promise.all([nav.boundingBox(), finalMenuItem.boundingBox()]);
    expect(navBox).not.toBeNull();
    expect(finalItemBox).not.toBeNull();
    expect(finalItemBox!.y).toBeGreaterThanOrEqual(navBox!.y - 1);
    expect(finalItemBox!.y + finalItemBox!.height).toBeLessThanOrEqual(navBox!.y + navBox!.height + 1);

    const documentSize = await page.evaluate(() => ({
      clientHeight: document.scrollingElement?.clientHeight ?? 0,
      scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
    }));
    expect(documentSize.scrollHeight).toBeLessThanOrEqual(documentSize.clientHeight);

    console.info(SUCCESS_MARKER);
  });

  test('mobile drawer keeps overlay and item-click close behavior with scrollable nav', async ({ page }) => {
    await openDashboard(page, MOBILE_VIEWPORT);

    const menuButton = page.getByRole('button', { name: 'Menu' });
    const sidebar = page.locator('aside');
    const nav = sidebar.locator('nav');
    const overlay = page.locator('[aria-hidden="true"]');

    await menuButton.click();
    await expect(overlay).toBeVisible();
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().left)).toBe(0);

    const navSize = await nav.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      touchAction: getComputedStyle(element).touchAction,
    }));
    expect(navSize.scrollHeight).toBeGreaterThan(navSize.clientHeight);
    expect(navSize.touchAction).toContain('pan-y');

    await overlay.click({ position: { x: MOBILE_VIEWPORT.width - 10, y: 20 } });
    await expect(overlay).toBeHidden();
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);

    await menuButton.click();
    await nav.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
    const finalMenuItem = nav.getByRole('link').last();
    await expect(finalMenuItem).toBeInViewport();
    await finalMenuItem.click();
    await expect(page).toHaveURL(/\/dashboard\/settings$/);
    await expect(overlay).toBeHidden();
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  });
});

test('development readiness panel blocks only hard failures and safely retries', async ({ page }) => {
  let readinessCalls = 0;
  let releaseReady = false;
  const component = (
    state: 'ready' | 'blocked' | 'degraded',
    reasonCode: string,
    message: string,
    blockingLaunch: boolean,
  ) => ({ state, reasonCode, message, blockingLaunch });
  const readyComponents = {
    bridge: component('ready', 'bridge_ready', 'Связь с Runtime Bridge готова.', false),
    checkouts: component('ready', 'runtime_checkouts_ready', 'Оба рабочих каталога Runtime готовы.', false),
    baseline: component('ready', 'baseline_ready', 'Текущая версия main определена.', false),
    executor: component('ready', 'runtime_executor_ready', 'Исполнитель задач готов.', false),
    github: component('ready', 'github_provider_ready', 'GitHub подключён и доступен.', false),
  };

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'browser-test-owner', email: 'owner@asi.invalid' },
        subscription: { status: 'active' },
        account: null,
        isCrmOperator: false,
        isDevelopmentOwner: true,
      }),
    });
  });
  await page.route('**/api/dashboard/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/dashboard/development/tasks', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        repositories: [{ id: 'asi-landing', label: 'ASI-integration/asi-landing', fullName: 'ASI-integration/asi-landing' }],
      }),
    });
  });
  await page.route('**/api/dashboard/development/readiness', async (route) => {
    readinessCalls += 1;
    const blocked = !releaseReady;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        readiness: {
          schemaVersion: 'asi.owner-console.readiness.v1',
          overallState: blocked ? 'blocked' : 'ready',
          canLaunch: !blocked,
          checkedAt: '2026-08-01T00:00:00.000Z',
          components: blocked
            ? {
                ...readyComponents,
                checkouts: component(
                  'blocked',
                  'runtime_checkout_dirty',
                  'В одном из рабочих каталогов Runtime есть несохранённые изменения.',
                  true,
                ),
              }
            : readyComponents,
        },
      }),
    });
  });

  await page.goto('/dashboard/development', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Готовность к запуску' })).toBeVisible();
  await expect(page.getByText('runtime_checkout_dirty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запуск пока недоступен' })).toBeDisabled();
  await expect(page.getByLabel('Что нужно сделать?')).toBeVisible();
  await expect(page.getByText('Расширенные настройки')).toBeVisible();

  releaseReady = true;
  await page.getByRole('button', { name: 'Проверить готовность' }).click();
  await expect(page.getByText('Система готова к запуску задачи.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запустить задачу' })).toBeEnabled();
  await expect(page.locator('body')).not.toContainText('ASI_RUNTIME_BRIDGE_CHECKOUTS_JSON');
  await expect(page.locator('body')).not.toContainText('/runtime/primary');
  expect(readinessCalls).toBeGreaterThanOrEqual(2);
});
