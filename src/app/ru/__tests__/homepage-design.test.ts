import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import HomeRu from '../page';
import { RU_CONNECT_HREF } from '@/components/ru/ConnectCta';

vi.mock('next/navigation', () => ({ usePathname: () => '/ru' }));
const render = () => renderToStaticMarkup(React.createElement(HomeRu));

describe('RU owner connection journey — approved 2026-09-21', () => {
  it('renders the approved problem-to-action flow in order', () => {
    const html = render();
    expect(html).toContain('ASI сама ведёт рутину ваших объектов. От и до.');
    const sections = [
      'coordination',
      'quick-connect-1',
      'how-it-works',
      'quick-connect-2',
      'automation-gap',
      'capabilities',
      'special-offer',
      'pilot-form',
    ];
    const positions = sections.map((id) => html.indexOf(`id="${id}"`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    const steps = html.slice(html.indexOf('id="how-it-works"'), html.indexOf('id="quick-connect-2"'));
    expect(steps.match(/<h3/g)).toHaveLength(4);
    expect(steps).toContain('Bnovo');
    expect(steps).toContain('RealtyCalendar');
    for (const n of ['>1<', '>2<', '>3<', '>4<']) expect(steps).toContain(n);
  });

  it('keeps scaling and comparison hierarchy consistent and highlights the staffing outcome', () => {
    const html = render();
    expect(html).toContain('Больше объектов не значит больше чистой прибыли');
    expect(html).toContain('Почему обычных сервисов уже недостаточно');
    expect(html).toContain('1–2 человека вместо раздутого штата');
    expect(html).toContain('управление 100+ объектами');
    expect(html).toContain('эффектом Рингельмана');
  });

  it('keeps the hero CTA microcopy concise, readable, and close to scaling', () => {
    const html = render();
    const hero = html.slice(0, html.indexOf('id="coordination"'));
    expect(hero).toContain(
      'Сейчас — пилот: настраиваем доступные функции под ваш объект. Подключение и настройка — 0 ₽.',
    );
    expect(hero).not.toContain('Здесь — ASI для жилой и посуточной недвижимости');
    expect(hero).toContain('text-[16px] sm:text-[18px]');
    expect(hero).toContain('pb-2 sm:pb-3');
    expect(html).toContain('!pt-4 sm:!pt-5');
  });

  it('routes all four wide CTAs directly to the connection flow', () => {
    const html = render();
    const wideActions = html.match(/<a[^>]*data-testid="start-connection"[^>]*>/g) ?? [];
    expect(wideActions).toHaveLength(4);
    for (const action of wideActions) expect(action).toContain(`href="${RU_CONNECT_HREF}"`);

    expect(html).toContain('id="special-offer"');
    expect(html).not.toContain('id="pricing"');
    expect(html).not.toContain('href="/ru#pricing"');
    expect(html).toContain('Войти / подключить');
    expect(html).not.toContain('href="/dashboard');
  });

  it('states the special Strigunov terms exactly and keeps payment opt-in', () => {
    const html = render();
    for (const term of [
      'Условия для сообщества Ярослава Стригунова',
      '0 ₽',
      '14 дней',
      '1 000 ₽/объект',
      '12 месяцев',
      'Никакого автоматического перехода на оплату',
      'полной готовности объекта',
    ])
      expect(html).toContain(term);
  });

  it('retains truthful capability boundaries and combines capabilities with examples', () => {
    const html = render();
    expect(html).toContain('Сейчас — пилот');
    expect(html).toContain('Система сама ведёт повторяемую работу объекта');
    expect(html).toContain('не публикуется на площадках автоматически');
    expect(html).toContain('система сразу передаёт диалог вам');
    expect(html).toContain('Как это выглядит на практике');
    expect(html).not.toContain('id="guest-communication"');
    expect(html).not.toContain('id="principle"');
    expect(html).not.toContain('id="example"');
    expect(html).toContain('Shiro');
    expect(html).toContain('bg-asi-ivory');
    expect(html).not.toMatch(/95%|99%|полностью автономн|заменяет сотрудников|автоматическая синхронизация/);
  });

  it('links the pilot capabilities to the ASI Global ecosystem roadmap', () => {
    const html = render();
    const capabilities = html.slice(html.indexOf('id="capabilities"'), html.indexOf('id="special-offer"'));
    for (const title of ['Ответы гостям', 'Готовность перед заездом', 'Рекомендация цены']) {
      expect(capabilities).toContain(title);
    }
    expect(capabilities).toContain('href="/ru/capabilities"');
    expect(capabilities).toContain('Посмотреть все технологии, вертикали и дорожную карту ASI Global');
  });

  it('preserves legal navigation and safe guest examples', () => {
    const html = render();
    for (const path of ['/ru/privacy', '/ru/offer', '/ru/contacts']) expect(html).toContain(`href="${path}"`);
    expect(html).toContain('Нестандартная просьба');
    expect(html).not.toContain('код от двери');
    expect(html).not.toContain('пароль от Wi-Fi');
    expect(html.match(/<footer/g)).toHaveLength(1);
  });

  it('removes public community entitlement fields and leaves the legacy intake available', () => {
    const flow = readFileSync('src/components/dashboard/RentalConnectionFlow.tsx', 'utf8');
    expect(flow).not.toContain('communityMember');
    const model = readFileSync('src/lib/rental-connect/model.ts', 'utf8');
    expect(model).not.toContain('communityMember');
    const early = readFileSync('src/app/ru/early-access/page.tsx', 'utf8');
    expect(early).toContain('<EarlyAccessObjectForm />');
  });
});
