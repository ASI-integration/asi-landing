import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import HomeRu from '../page';
import { RU_CONNECT_HREF, RU_SPECIAL_OFFER_HREF } from '@/components/ru/ConnectCta';

vi.mock('next/navigation', () => ({ usePathname: () => '/ru' }));
const render = () => renderToStaticMarkup(React.createElement(HomeRu));

describe('RU owner connection journey — approved 2026-09-19', () => {
  it('puts product, action and four steps before the supporting articles', () => {
    const html = render();
    expect(html).toContain('ASI сама ведёт рутину ваших объектов. От и до.');
    expect(html.indexOf('data-testid="start-connection"')).toBeLessThan(html.indexOf('id="how-it-works"'));
    const sections = [
      'how-it-works',
      'special-offer',
      'coordination',
      'automation-gap',
      'guest-communication',
      'principle',
      'capabilities',
      'example',
      'pilot-form',
    ];
    const positions = sections.map((id) => html.indexOf(`id="${id}"`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const steps = html.slice(html.indexOf('id="how-it-works"'), html.indexOf('id="special-offer"'));
    expect(steps.match(/<h3/g)).toHaveLength(4);
    expect(steps).toContain('Bnovo');
    expect(steps).toContain('RealtyCalendar');
  });

  it('routes three wide CTAs to #special-offer and continue CTA to /ru/connect', () => {
    const html = render();
    const wideActions = html.match(/<a[^>]*data-testid="start-connection"[^>]*>/g) ?? [];
    expect(wideActions).toHaveLength(3);
    for (const action of wideActions) expect(action).toContain(`href="${RU_SPECIAL_OFFER_HREF}"`);

    expect(html).toContain('id="special-offer"');
    expect(html).toContain('href="/ru#special-offer"');
    expect(html).not.toContain('id="pricing"');
    expect(html).not.toContain('href="/ru#pricing"');

    const continueActions = html.match(/<a[^>]*data-testid="continue-connection"[^>]*>/g) ?? [];
    expect(continueActions).toHaveLength(1);
    expect(continueActions[0]).toContain(`href="${RU_CONNECT_HREF}"`);
    expect(html).toContain('ПРОДОЛЖИТЬ ПОДКЛЮЧЕНИЕ');
    expect(html).toContain('Вход или регистрация, затем настройка объекта.');

    expect(html).toContain(`href="${RU_CONNECT_HREF}"`);
    expect(html).toContain('Войти / подключить');
    expect(html).not.toContain('href="/dashboard');
  });

  it('states community terms with a readiness gate and optional continuation', () => {
    const html = render();
    for (const term of [
      'закрытой группы Ярослава Стригунова',
      '0 ₽',
      '14 дней',
      '1 000 ₽',
      '12 месяцев',
      'с момента перехода на платный режим',
      'Без автоматического перехода на платный тариф',
      'только после полной готовности',
    ])
      expect(html).toContain(term);
    expect(html.toLowerCase()).not.toContain('скидк');
  });

  it('retains truthful capability boundaries and the existing brand', () => {
    const html = render();
    expect(html).toContain('Сейчас — пилот');
    expect(html).toContain('Система сама ведёт повторяемую работу объекта');
    expect(html).not.toContain('Автоматический ответ остановлен');
    expect(html).toContain('ASI Global развивает и другие продукты.');
    expect(html).toContain('не публикуется на площадках автоматически');
    expect(html).toContain('система сразу передаёт диалог вам');
    expect(html).toContain('Shiro');
    expect(html).toContain('bg-asi-ivory');
    expect(html).not.toMatch(/95%|99%|полностью автономн|заменяет сотрудников|автоматическая синхронизация/);
  });

  it('preserves legal navigation and safe guest examples', () => {
    const html = render();
    for (const path of ['/ru/privacy', '/ru/offer', '/ru/contacts']) expect(html).toContain(`href="${path}"`);
    expect(html).toContain('Нестандартная просьба');
    expect(html).not.toContain('код от двери');
    expect(html).not.toContain('пароль от Wi-Fi');
    expect(html.match(/<footer/g)).toHaveLength(1);
  });

  it('requires an explicit community declaration and leaves the legacy intake available', () => {
    const flow = readFileSync('src/components/dashboard/RentalConnectionFlow.tsx', 'utf8');
    expect(flow).toContain('checked={draft.communityMember}');
    const model = readFileSync('src/lib/rental-connect/model.ts', 'utf8');
    expect(model).toContain('communityMember: false');
    const early = readFileSync('src/app/ru/early-access/page.tsx', 'utf8');
    expect(early).toContain('<EarlyAccessObjectForm />');
  });
});
