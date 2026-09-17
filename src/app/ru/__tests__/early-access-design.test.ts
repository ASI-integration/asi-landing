import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('RU-DESIGN-03 early-access visual migration', () => {
  it('uses shared brand primitives and ASI editorial grammar', () => {
    const page = readSrc('src/app/ru/early-access/page.tsx');
    expect(page).toContain('BrandHeadline');
    expect(page).toContain('BrandSection');
    expect(page).toContain('BrandPrimaryCta');
    expect(page).toContain('BrandSecondaryCta');
    expect(page).toContain('BrandShiro');
    expect(page).toContain('BrandLogoMark');
    expect(page).toContain('bg-asi-ivory');
    expect(page).toContain('variant="navy"');
    expect(page).toContain('font-serif');
    expect(page).not.toContain('ThemeProvider');
    expect(page).not.toContain('rounded-2xl');
    expect(page).not.toContain('Japan');
    expect(page).not.toContain('Micro Hotels');
    expect(page).not.toContain('Hong Kong');
  });

  it('preserves pilot tariff, anchors, and current-vs-roadmap distinction', () => {
    const page = readSrc('src/app/ru/early-access/page.tsx');
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(page).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(page).toContain('COMMUNICATION_PILOT_SERVICE_TITLE');
    expect(page).toContain('COMMUNICATION_PILOT_PAYMENT_DESCRIPTION');
    expect(COMMUNICATION_PILOT_SERVICE_TITLE).toContain('AI-коммуникации');
    expect(COMMUNICATION_PILOT_PAYMENT_DESCRIPTION).toContain('1 объект');
    expect(page).toContain('Подключить пилот');
    expect(page).toContain('#pilot-form');
    expect(page).toContain('id="pilot-tariff"');
    expect(page).toContain("label: 'Сейчас в пилоте'");
    expect(page).toContain("label: 'Дорожная карта'");
    expect(page).toContain('Дальше в ASI');
    expect(page).toContain('Отдельный инструмент');
    expect(page).toContain('EarlyAccessObjectForm');
    expect(page).toContain('PilotCheckoutCta');
    expect(page).toContain('ruCompliance.fullName');
    expect(page).toContain('ruCompliance.inn');
    expect(page).toContain('/ru/payment');
    expect(page).toContain('/ru/offer');
    expect(page).toContain('/ru/refund');
    expect(page).toContain('/ru/privacy');
    expect(page).toContain('/ru/contacts');
    expect(page).not.toMatch(/['"]\/pilot['"]/);
    expect(page).not.toContain('Уже можно подключить');
    expect(page).not.toContain('Автоматические цены на ночь');
  });

  it('keeps application form contract and community routing labels', () => {
    const form = readSrc('src/components/early-access/EarlyAccessObjectForm.tsx');
    expect(form).toContain("fetch('/api/early-access/objects'");
    expect(form).toContain("id=\"pilot-form\"");
    expect(form).toContain("'community_member'");
    expect(form).toContain("'standard_terms'");
    expect(form).toContain("'community_info'");
    expect(form).toContain('Участник группы Ярослава Стригунова');
    expect(form).toContain('Участник группы Анатолия Брагина');
    expect(form).toContain('Другая рекомендация или источник');
    expect(form).toContain('ownerContact');
    expect(form).toContain('additionalFeatures');
    expect(form).toContain('bg-asi-paper');
    expect(form).not.toContain('rounded-lg');
  });

  it('keeps checkout fail-closed with ASI presentation', () => {
    const checkout = readSrc('src/components/ru/PilotCheckoutCta.tsx');
    expect(checkout).toContain("fetch('/api/yookassa/create-payment'");
    expect(checkout).toContain('COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE');
    expect(checkout).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(checkout).toContain('paymentUrl');
    expect(checkout).toContain('window.location.assign');
    expect(checkout).toContain('bg-asi-navy');
    expect(checkout).toContain('модерации');
    expect(checkout).not.toContain('rounded-lg');
  });
});
