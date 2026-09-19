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
    expect(home).toContain('BrandEyebrow');
    expect(home).toContain('BrandCard');
    expect(home).toContain('bg-asi-ivory');
    expect(home).toContain('font-serif');
    expect(home).not.toContain('HeroSection');
    expect(home).not.toContain('rounded-2xl');
    expect(home).not.toContain('Japan');
    expect(home).not.toContain('Micro Hotels');
    expect(home).not.toContain('Hong Kong');
  });

  it('follows the approved RU_SITE_ARCHITECTURE.md narrative order (WEB-EDITOR-03)', () => {
    const home = readSrc('src/app/ru/page.tsx');

    // Nine-section order: hero -> coordination -> automation gap -> guest
    // communication -> principle -> capabilities today -> example -> pilot
    // steps -> pricing -> CTA form. Each id must exist and appear in order.
    const sectionIds = [
      'coordination',
      'automation-gap',
      'guest-communication',
      'principle',
      'capabilities',
      'example',
      'how-it-works',
      'pricing',
      'pilot-form-section',
    ];
    for (const id of sectionIds) {
      expect(home).toContain(`id="${id}"`);
    }
    const positions = sectionIds.map((id) => home.indexOf(`id="${id}"`));
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i - 1]).toBeLessThan(positions[i]);
    }

    // Hero: names ASI + current capability + the broader coordination
    // principle, without being Telegram-centric or overclaiming.
    expect(home).toContain('ASI отвечает гостям и проверяет объект к заезду');
    expect(home).toContain('снижается ручная координация в управлении объектом');
    expect(home.indexOf('ASI отвечает гостям и проверяет объект к заезду')).toBeLessThan(
      home.indexOf('id="coordination"'),
    );

    // Section 2 — scaling problem: qualitative only, matches the approved
    // safe wording (JSX source text wraps across lines, so match with
    // flexible whitespace rather than a literal multi-line string).
    expect(home).toMatch(
      /Рост количества объектов и сотрудников не\s+гарантирует пропорционального роста чистой\s+прибыли/,
    );
    // No percentage/statistic inside the scaling section specifically (the
    // 30% figure elsewhere on the page is the pre-existing, approved
    // atypical-guest-request example, unrelated to this claim).
    const coordinationSection = home.slice(
      home.indexOf('id="coordination"'),
      home.indexOf('id="automation-gap"'),
    );
    expect(coordinationSection).not.toMatch(/\d+\s*%/);
    expect(home).not.toContain('Рингельман');
    expect(home).not.toContain('Ringelmann');

    // Section 3 — existing automation does not compete on capability; no
    // named-competitor capability attack.
    expect(home).toContain('Отдельные сервисы автоматизируют отдельные действия');
    expect(home).not.toContain('Bnovo');
    expect(home).not.toContain('RealtyCalendar');
    expect(home).not.toContain('TravelLine');

    // Section 5 — principle: none of the four forbidden overclaim phrasings.
    expect(home).toContain('Принцип ASI');
    expect(home).not.toContain('связывает все процессы');
    expect(home).not.toContain('заменяет PMS');
    expect(home).not.toContain('заменяет сотрудников');
    expect(home).not.toContain('заменяет все сервисы');

    // Section 6 — current capability groups, customer language only.
    expect(home).toContain('Ответы гостям по данным объекта');
    expect(home).toContain('Проверка готовности перед заездом');
    expect(home).toContain('Рекомендованная цена с учётом объекта');
    expect(home).toContain('Личный кабинет');
    // Readiness gate must read as a checklist, never as ASI itself filing
    // with МВД, collecting a deposit, or verifying documents. Mentioning
    // "депозит" as a checklist item is explicitly allowed wording per
    // CLAIMS_REGISTER.md claim #7 ("чек-лист для оператора"); only
    // language implying ASI itself files or actively collects is banned.
    expect(home).not.toContain('МВД');
    expect(home).not.toContain('подаём');
    expect(home).not.toContain('собирает депозит');
    expect(home).not.toContain('собираем депозит');
    // Pricing must stay a recommendation; no live feed/auto-publish claim.
    expect(home).toContain('Это рекомендация');
    expect(home).toContain('не публикуется на площадках автоматически');
    expect(home).not.toContain('динамическ');
    expect(home).not.toContain('погод');
    expect(home).not.toContain('событи');
  });

  it('never states a roadmap-only capability as a current feature (RU_SITE_ARCHITECTURE.md §11)', () => {
    const home = readSrc('src/app/ru/page.tsx');
    // Locks/access.
    expect(home).not.toContain('замок');
    expect(home).not.toContain('код от двери');
    // OTA payout/commission reconciliation.
    expect(home).not.toContain('сверка выплат');
    expect(home).not.toContain('реконсиляц');
    // Guest CRM / loyalty / repeat-guest incentives.
    expect(home).not.toContain('программа лояльности');
    expect(home).not.toContain('CRM');
    // Upsell execution, direct booking, owner statements, fiscal receipts.
    expect(home).not.toContain('допродаж');
    expect(home).not.toContain('прямое бронирование');
    expect(home).not.toContain('отчёт для владельца');
    expect(home).not.toContain('54-ФЗ');
    expect(home).not.toContain('онлайн-касс');
    // Security/sensors.
    expect(home).not.toContain('датчик');
    expect(home).not.toContain('охрана');
    // WhatsApp / automatic OTA sync.
    expect(home).not.toContain('WhatsApp');
    expect(home).not.toContain('синхронизация с площадками');
    // English startup vocabulary flagged in ROADMAP_PUBLIC_BOUNDARY.md.
    expect(home).not.toContain('Runtime');
    expect(home).not.toContain('runtime');
    expect(home).not.toContain('Orchestration');
    expect(home).not.toContain('orchestration');
    expect(home).not.toContain('end-to-end');
    expect(home).not.toContain('full-stack');
    expect(home).not.toContain('autopilot');
    expect(home).not.toContain('operations on autopilot');
  });

  it('delivers the complete one-page client journey on /ru', () => {
    const home = readSrc('src/app/ru/page.tsx');
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(home).toContain('COMMUNICATION_PILOT_PRICE_RUB');
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

    // Commercial model preserved exactly (WEB-EDITOR-03 "pilot and
    // commercial terms" requirement): setup free before pilot, 14-day
    // pilot only after full readiness, 1000₽/object/month continuation
    // only on client decision, no automatic paid transition.
    expect(home).toContain('Подключение и настройка — 0');
    expect(home).toContain('14 дней работы на объекте — 0');
    expect(home).toContain('только после полной готовности');
    expect(home).toContain('14 дней пилота ещё НЕ начались');
    expect(home).toContain('автоматических продлений');
    expect(home).toContain('продолжать и платить не нужно');
    expect(home).toContain('Только если клиент увидел результат и решил продолжить');

    expect(home).toContain('Типовой вопрос → Ответ по данным объекта');
    expect(home).toContain('во сколько заезд и где парковаться');
    expect(home).toContain('заезд — после 15:00');
    expect(home).toContain('Данные для заезда → Проверка готовности');
    expect(home).toContain('Нестандартная просьба → Передача человеку');
    expect(home).not.toContain('пароль от Wi-Fi');
    expect(home).not.toContain('Wi-Fi доступны');
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

    expect(home).toContain("href: '/ru#capabilities'");
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
