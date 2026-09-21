import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RuCapabilitiesPage, { metadata } from '../capabilities/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/ru/capabilities' }));

const render = () => renderToStaticMarkup(React.createElement(RuCapabilitiesPage));

describe('RU capabilities and ecosystem page', () => {
  it('publishes the approved metadata and page hierarchy', () => {
    const html = render();
    expect(metadata.title).toBe('Экосистема и дорожная карта ASI Global');
    expect(html).toContain('Экосистема и дорожная карта ASI Global');

    const sections = ['residential', 'roadmap', 'micro-lux', 'intellectual-property'];
    const positions = sections.map((id) => html.indexOf(`id="${id}"`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('keeps the residential vertical, roadmap, Micro Lux, and IP content explicit', () => {
    const html = render();
    for (const copy of [
      'Автономное общение с гостями 24/7',
      'Bnovo, RealtyCalendar',
      '50–100+ объектов',
      'Динамическое ценообразование в реальном времени',
      'Встроенный бесплатный Channel Manager',
      'OTA Reconciliation',
      'ASI Micro Lux',
      '10–12 м²',
      'Поданы заявки в Роспатент',
      'международная процедура PCT',
    ]) {
      expect(html).toContain(copy);
    }
  });

  it('labels future technology as roadmap rather than current pilot functionality', () => {
    const html = render();
    const roadmap = html.slice(html.indexOf('id="roadmap"'), html.indexOf('id="micro-lux"'));
    expect(roadmap).toContain('направления развития ASI Global');
    expect(roadmap).toContain('не являются обещанием конкретных сроков запуска');
    expect(html).toContain('Текущие возможности пилота остаются отделены от долгосрочной дорожной карты');
  });
});
