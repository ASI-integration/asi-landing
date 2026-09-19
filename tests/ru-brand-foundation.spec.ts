/**
 * Lightweight visual/conformance smoke for RU design foundation.
 * Asserts shared brand chrome classes — not brittle marketing copy.
 */
import { test, expect } from '@playwright/test';

test.describe('RU brand foundation shell', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('desktop header/footer use ASI brand chrome', async ({ page }) => {
    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    await expect(header).toHaveClass(/bg-asi-ivory/);
    await expect(page.getByRole('link', { name: 'Войти / подключить' }).first()).toBeVisible();
    await expect(page.locator('a[href="/pilot"]')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: /ASI сама ведёт рутину ваших объектов\. От и до\./i }).first(),
    ).toBeVisible();

    const footer = page.locator('footer').last();
    await expect(footer).toHaveClass(/bg-asi-navy/);
    await expect(page.getByAltText(/Shiro/i).first()).toBeVisible();
  });
});

test.describe('RU homepage editorial composition', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('hero, connection path and community terms are present', async ({ page }) => {
    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Один из продуктов ASI Global')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Как запустить ASI на вашем объекте/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Специальные условия для участников группы «Стрегуново»/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /НАЧАТЬ ПОДКЛЮЧЕНИЕ/i })).toHaveCount(3);
    await expect(page.getByText(/1\s*000|1000/)).toBeVisible();
  });
});

test.describe('RU brand foundation shell mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('375px header is compact without page overflow', async ({ page }) => {
    await page.goto('/ru', { waitUntil: 'domcontentloaded' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    const headerBox = await page.locator('header').first().boundingBox();
    expect(headerBox?.height ?? 999).toBeLessThan(120);

    await page.getByRole('button', { name: /меню/i }).click();
    await expect(page.getByRole('link', { name: 'Войти / подключить' }).last()).toBeVisible();
  });
});
