import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Page from '../page';

// Resolve the async server child directly: React 18's static renderer does not
// execute async server components. Keep the actual route shell and fallback.
async function renderPage(params: Promise<{ reportId: string }>) {
  const page = Page({ params });
  const children = React.Children.toArray(page.props.children) as React.ReactElement[];
  const boundary = children[1];
  const details = boundary.props.children;
  const content = await details.type(details.props);
  children[1] = React.cloneElement(boundary, {}, content);
  return renderToStaticMarkup(React.cloneElement(page, {}, ...children));
}

describe('Russian owner report detail', () => {
  it('renders an honest read-only report without treating an ID as evidence', async () => {
    const html = await renderPage(Promise.resolve({ reportId: 'paid-completed-123' }));
    expect(html).toContain('lang="ru"');
    expect(html).toContain('Отчёт по объекту');
    expect(html).toContain('Пилот · Только просмотр');
    expect(html).toContain('Отчёт пока недоступен');
    expect(html).toContain('Статус оплаты и суммы не подтверждены');
    expect(html).toContain('Нет подтверждённых данных о выполненных задачах');
    expect(html).toContain('Нет подтверждённых данных для оценки изменений');
    expect(html).toContain('href="/ru/dashboard/reports"');
    expect(html).not.toMatch(/paid-completed-123|<button|<form|<script|₽|\d+%/);
  });

  it('renders an accessible missing identifier state', async () => {
    const html = await renderPage(Promise.resolve({ reportId: '  ' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('Не указан отчёт');
    expect(html).not.toContain('Оплата и начисления');
  });

  it('contains parameter failures without exposing internal details', async () => {
    const html = await renderPage(Promise.reject(new Error('private failure')));
    expect(html).toContain('role="status"');
    expect(html).toContain('Не удалось открыть отчёт');
    expect(html).not.toContain('private failure');
    expect(html).toContain('href="/ru/dashboard/reports"');
  });

  it('provides an accessible loading fallback while route parameters resolve', () => {
    const page = Page({ params: new Promise(() => {}) });
    const boundary = React.Children.toArray(page.props.children)[1] as React.ReactElement;
    const html = renderToStaticMarkup(boundary.props.fallback);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Загрузка отчёта');
  });
});
