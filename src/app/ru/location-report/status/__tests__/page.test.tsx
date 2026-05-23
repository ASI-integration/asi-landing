import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Page from '../page';

describe('/ru/location-report/status', () => {
  it('renders mock async report stages and hides ready links while forming', () => {
    const html = renderToStaticMarkup(<Page searchParams={{ stage: 'report_forming' }} />);

    expect(html).toContain('Оплата прошла');
    expect(html).toContain('Ссылка появится в личном кабинете и придёт на e-mail');
    expect(html).toContain('data-location-report-stage="report_forming"');
    expect(html).toContain('Отчёт формируется');
    expect(html).toContain('Предварительная версия готова');
    expect(html).toContain('Полная веб-версия готова');
    expect(html).toContain('PDF готов');
    expect(html).not.toContain('data-location-report-poll-path');
    expect(html).not.toContain('Открыть предварительный отчёт');
    expect(html).not.toContain('Открыть финальный отчёт');
    expect(html).not.toContain('Открыть PDF');
  });

  it('reveals preliminary, final, and PDF actions as stages become ready', () => {
    const preliminaryHtml = renderToStaticMarkup(<Page searchParams={{ stage: 'preliminary_ready' }} />);
    const finalHtml = renderToStaticMarkup(<Page searchParams={{ stage: 'final_ready' }} />);
    const pdfHtml = renderToStaticMarkup(<Page searchParams={{ stage: 'pdf_ready' }} />);

    expect(preliminaryHtml).toContain('Открыть предварительный отчёт');
    expect(preliminaryHtml).not.toContain('Открыть финальный отчёт');
    expect(finalHtml).toContain('Открыть финальный отчёт');
    expect(finalHtml).not.toContain('Открыть PDF');
    expect(pdfHtml).toContain('Открыть PDF');
  });

  it('uses requestId polling mode instead of mock stage fallback when requestId is present', () => {
    const html = renderToStaticMarkup(<Page searchParams={{ requestId: 'request-1', stage: 'pdf_ready' }} />);

    expect(html).toContain('data-location-report-request-id="request-1"');
    expect(html).toContain('data-location-report-poll-path="/api/location-full-report/request/request-1/status"');
    expect(html).toContain('data-location-report-stage="report_forming"');
    expect(html).toContain('Статус обновляется автоматически.');
    expect(html).not.toContain('Открыть PDF');
  });
});
