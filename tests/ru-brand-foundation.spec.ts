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
    await expect(page.getByRole('link', { name: 'Подключить пилот' }).first()).toBeVisible();
    await expect(page.locator('a[href="/pilot"]')).toHaveCount(0);

    const footer = page.locator('footer').last();
    await expect(footer).toHaveClass(/bg-asi-navy/);
    await expect(page.getByAltText(/Shiro/i).first()).toBeVisible();
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
    await expect(page.getByRole('link', { name: 'Подключить пилот' }).last()).toBeVisible();
  });
});
