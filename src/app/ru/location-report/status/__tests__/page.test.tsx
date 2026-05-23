import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { REPORT_ARTIFACT_STATUS } from '@/lib/location/report-artifact';
import Page from '../page';
import { StatusProgressClient } from '../StatusProgressClient';

describe('/ru/location-report/status', () => {
  it('renders friendly invalid state when requestId is missing', () => {
    const html = renderToStaticMarkup(<Page searchParams={{}} />);

    expect(html).toContain('data-location-report-invalid-request="true"');
    expect(html).toContain('Не удалось найти заявку на отчёт');
    expect(html).toContain('Вернуться к форме');
    expect(html).not.toContain('data-location-report-stage=');
    expect(html).not.toContain('data-location-report-poll-path');
    expect(html).not.toContain('в процессе');
  });

  it('renders friendly invalid state when requestId format is invalid', () => {
    const html = renderToStaticMarkup(<Page searchParams={{ requestId: '!!!' }} />);

    expect(html).toContain('data-location-report-invalid-request="true"');
    expect(html).not.toContain('data-location-report-poll-path');
  });

  it('renders stage labels with separated copy blocks for a valid requestId', () => {
    const html = renderToStaticMarkup(<Page searchParams={{ requestId: 'request-1' }} />);

    expect(html).toContain('data-location-report-poll-path="/api/location-full-report/request/request-1/status"');
    expect(html).toContain('data-location-report-stage="report_forming"');
    expect(html).toContain('Текущий этап');
    expect(html).toContain('Отчёт формируется');
    expect(html).toContain('Предварительная версия готова');
    expect(html).toContain('Можно открыть первую версию и проверить основные выводы.');
    expect(html).toContain('Полная веб-версия готова');
    expect(html).toContain('Отчёт доступен по ссылке');
    expect(html).toContain('PDF готов');
    expect(html).toContain('Можно открыть файл или скачать его на устройство.');
    expect(html).not.toContain('Предварительная версия готова. Можно открыть');
    expect(html).not.toContain('Полная веб-версия готова. Полная веб-версия');
    expect(html).not.toContain('PDF готов. PDF можно');
    expect(html).not.toContain('Открыть PDF');
  });

  it('shows report and PDF buttons only when artifact URLs exist', () => {
    const formingHtml = renderToStaticMarkup(
      <StatusProgressClient requestId="request-1" />,
    );
    expect(formingHtml).not.toContain('data-location-report-actions="true"');
    expect(formingHtml).not.toContain('Открыть отчёт');
    expect(formingHtml).not.toContain('Скачать PDF');

    const preliminaryHtml = renderToStaticMarkup(
      <StatusProgressClient
        requestId="request-1"
        initialArtifact={{
          request_id: 'request-1',
          status: REPORT_ARTIFACT_STATUS.preliminaryReady,
          preliminary_report_url: '/ru/report/prelim-1',
          final_report_url: null,
          pdf_url: null,
          generated_at: null,
          expires_at: null,
          cleanup_ready: false,
          metadata: {},
          created_at: '2026-05-20T09:00:00.000Z',
          updated_at: '2026-05-20T09:00:00.000Z',
        }}
      />,
    );
    expect(preliminaryHtml).toContain('data-location-report-actions="true"');
    expect(preliminaryHtml).toContain('Открыть отчёт');
    expect(preliminaryHtml).toContain('href="/ru/report/prelim-1"');
    expect(preliminaryHtml).not.toContain('Скачать PDF');

    const pdfHtml = renderToStaticMarkup(
      <StatusProgressClient
        requestId="request-1"
        initialArtifact={{
          request_id: 'request-1',
          status: REPORT_ARTIFACT_STATUS.pdfReady,
          preliminary_report_url: '/ru/report/prelim-1',
          final_report_url: '/ru/report/final-1',
          pdf_url: '/ru/report/final-1/pdf',
          generated_at: null,
          expires_at: null,
          cleanup_ready: false,
          metadata: {},
          created_at: '2026-05-20T09:00:00.000Z',
          updated_at: '2026-05-20T09:00:00.000Z',
        }}
      />,
    );
    expect(pdfHtml).toContain('href="/ru/report/final-1"');
    expect(pdfHtml).toContain('Скачать PDF');
    expect(pdfHtml).toContain('href="/ru/report/final-1/pdf"');
    expect(pdfHtml.match(/Открыть отчёт/g)?.length).toBe(1);
  });
});
