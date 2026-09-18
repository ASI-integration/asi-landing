import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';
import { HOMEPAGE_LEAD_SOURCE_MARKER } from '@/components/early-access/EarlyAccessObjectForm';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('RU homepage one-page client flow', () => {
  it('uses shared brand primitives and guestautopilot visual grammar', () => {
    const home = readSrc('src/app/ru/page.tsx');
    expect(home).toContain('BrandHeadline');
    expect(home).toContain('BrandSection');
    expect(home).toContain('BrandPrimaryCta');
    expect(home).toContain('BrandShiro');
    expect(home).toContain('BrandLogoMark');
    expect(home).toContain('bg-asi-ivory');
    expect(home).toContain('font-serif');
    expect(home).not.toContain('HeroSection');
    expect(home).not.toContain('rounded-2xl');
    expect(home).not.toContain('Japan');
    expect(home).not.toContain('Micro Hotels');
    expect(home).not.toContain('Hong Kong');
  });

  it('delivers the complete one-page client journey on /ru', () => {
    const home = readSrc('src/app/ru/page.tsx');
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(home).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(home).toContain('ASI отвечает гостям вашего объекта');
    expect(home).toContain('id="how-it-works"');
    expect(home).toContain('id="example"');
    expect(home).toContain('id="pricing"');
    expect(home).toContain('EarlyAccessObjectForm');
    expect(home).toContain('variant="compact"');
    expect(home).toContain('#pilot-form');
    expect(home).toContain('Подключить объект бесплатно');

    expect(home).toContain('Вы оставляете заявку');
    expect(home).toContain('Мы бесплатно настраиваем объект');
    expect(home).toContain('Запуск 14 дней реальной работы');
    expect(home).toContain('Итоговый разбор пилота');
    expect(home).toContain('Вы принимаете решение');
    expect(home.indexOf('Вы оставляете заявку')).toBeLessThan(home.indexOf('Мы бесплатно настраиваем объект'));
    expect(home.indexOf('Мы бесплатно настраиваем объект')).toBeLessThan(
      home.indexOf('Запуск 14 дней реальной работы'),
    );
    expect(home.indexOf('Запуск 14 дней реальной работы')).toBeLessThan(
      home.indexOf('Итоговый разбор пилота'),
    );
    expect(home.indexOf('Итоговый разбор пилота')).toBeLessThan(home.indexOf('Вы принимаете решение'));

    expect(home).toContain('Подключение и настройка — 0');
    expect(home).toContain('14 дней работы на объекте — 0');
    expect(home).toContain('только после полной готовности');
    expect(home).toContain('14 дней пилота ещё НЕ начались');
    expect(home).toContain('автоматических продлений');
    expect(home).toContain('продолжать и платить не нужно');

    expect(home).toContain('Типовой запрос → Ответ по данным объекта');
    expect(home).toContain('во сколько заезд и где парковаться');
    expect(home).toContain('заезд — после 15:00');
    expect(home).toContain('Нетиповая ситуация или бизнес-решение → Передача человеку');
    expect(home).not.toContain('пароль от Wi-Fi');
    expect(home).not.toContain('Wi-Fi доступны');
    expect(home).not.toContain('бронирования');
    expect(home).not.toContain('код от');
    expect(home).not.toContain('пароль');

    expect(home).toContain("variant=\"compact\"");
    expect(home).toMatch(/<footer[\s>][\s\S]*RuComplianceFooter/);
    expect(home).not.toContain('ASI Global © 2026');
    expect(home).not.toContain('Операции посуточной аренды на автопилоте');

    const footer = readSrc('src/components/ru/RuComplianceFooter.tsx');
    expect(footer).toContain("variant === 'compact'");
    expect(footer).toContain('ASI Global © 2026');
    expect(footer).toContain('Автоматизация гостевых коммуникаций в посуточной аренде');
    expect(footer).toContain('@ASI_Support_Bot');
    expect(footer).toContain('support@asi-global.ru');
    expect(footer).toContain('Политика конфиденциальности');
    expect(footer).toContain('ruComplianceRoutes.offer');
    expect(footer).toContain('ruComplianceRoutes.privacy');
    expect(footer).toContain('ruComplianceRoutes.contacts');
    expect(footer).toContain('ruCompliance.fullName');
    expect(footer).toContain('ruCompliance.inn');

    const compliance = readSrc('src/config/ruCompliance.ts');
    expect(compliance).toContain("offer: '/ru/offer'");
    expect(compliance).toContain("privacy: '/ru/privacy'");
    expect(compliance).toContain("contacts: '/ru/contacts'");

    expect(home).not.toMatch(/google\./i);
    expect(home).not.toContain('Работает вместе с вашим менеджером каналов');
    expect(home).not.toContain('Оценка локации — отдельный инструмент');
    expect(home).not.toContain('Обычные ситуации vs Исключения');
    expect(home).not.toContain('Точность коммуникации и базы знаний');
    expect(home).not.toContain('Кому подходит ASI');
    expect(home).not.toContain('операционный контур');
    expect(home).not.toContain('операционный слой');
    expect(home).not.toContain('динамическ');
    expect(home).not.toContain('репутац');
    expect(home).not.toContain('финансово');
    expect(home).not.toContain('Channel Manager');
    expect(home).not.toContain('[REQUIRES RUNTIME CONFIRMATION]');
    expect(home).not.toContain('90%');
    expect(home).not.toContain('галлюцин');
  });

  it('keeps homepage header minimal with same-page anchors only', () => {
    const home = readSrc('src/app/ru/page.tsx');
    const header = readSrc('src/components/ru/RuPublicNavHeader.tsx');

    expect(home).toContain("href: '/ru#how-it-works'");
    expect(home).toContain("href: '/ru#example'");
    expect(home).toContain("href: '/ru#pricing'");
    expect(home).toContain("href: FORM_HREF");
    expect(home).toContain("const FORM_HREF = '/ru#pilot-form'");
    expect(home).toContain('brandLabel="ASI Global"');
    expect(home).toContain('showContacts={false}');
    expect(home).toContain('showLogin={false}');
    expect(header).toContain('showLogin = true');
    expect(header).toContain('showContacts = true');
    expect(header).toContain('/ru/early-access');
    expect(header).toContain('mainLinks');
    expect(header).toContain('primaryCta');
  });

  it('uses compact form mode without silent community membership tagging', () => {
    const home = readSrc('src/app/ru/page.tsx');
    const form = readSrc('src/components/early-access/EarlyAccessObjectForm.tsx');
    const early = readSrc('src/app/ru/early-access/page.tsx');

    expect(home).toContain('variant="compact"');
    expect(home).not.toContain('Участник группы Ярослава Стригунова');
    expect(home).not.toContain('Участник группы Анатолия Брагина');
    expect(home).not.toContain('Условия участия');

    expect(form).toContain("fetch('/api/early-access/objects'");
    expect(form).toContain('id="pilot-form"');
    expect(form).toContain('Подключить объект бесплатно');
    expect(form).toContain('Количество объектов в управлении');
    expect(form).toContain("variant === 'compact'");
    expect(form).toContain('HOMEPAGE_LEAD_SOURCE_MARKER');
    expect(form).toContain(HOMEPAGE_LEAD_SOURCE_MARKER);
    expect(form).toContain('Источник заявки: главная страница ASI.');
    expect(HOMEPAGE_LEAD_SOURCE_MARKER).not.toContain('community_member');
    expect(HOMEPAGE_LEAD_SOURCE_MARKER).not.toContain('Стригунова');

    // Compact path must not append community membership labels.
    expect(form).toMatch(/isCompact[\s\S]*HOMEPAGE_LEAD_SOURCE_MARKER/);
    expect(form).toContain('Участник группы Ярослава Стригунова');
    expect(form).toContain('Участник группы Анатолия Брагина');
    expect(form).toContain('Другая рекомендация или источник');

    // Early-access keeps default full form (community selector).
    expect(early).toContain('<EarlyAccessObjectForm />');
    expect(early).not.toContain('variant="compact"');
  });
});
