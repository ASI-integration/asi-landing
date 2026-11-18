import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Loading from '../loading';

describe('Russian owner reports loading state', () => {
  it('renders an accessible pending status and hides decorative placeholders', () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('<main lang="ru"');
    expect(html).toMatch(/<h1[^>]*>Прогресс и отчёты<\/h1>/);
    expect(html).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*aria-busy="true"[^>]*>Загружаем страницу отчётов…<\/p>/);
    expect(html).toMatch(/<div aria-hidden="true"[^>]*motion-safe:animate-pulse/);
  });

  it('keeps unavailable evidence distinct from completed work during the pilot', () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('Пилот · Только просмотр');
    expect(html).toContain('Подтверждённые данные о прогрессе и отчётах пока недоступны на этой странице.');
    expect(html).toContain('Отсутствие данных не означает, что работы не начались или завершены.');
    expect(html).not.toMatch(/<button|<form|<script|₽|\d+%/);
  });
});
