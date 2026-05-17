import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDashboardReportRequestHref,
  pendingLocationReportFromSearchParams,
} from '../pending-location-report';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/reports',
  redirect: vi.fn(),
}));

import { ReportsPageClient } from '@/app/dashboard/reports/ReportsPageClient';
import { ReportPlaceholderClient } from '@/app/dashboard/reports/[reportId]/ReportPlaceholderClient';

const repoRoot = path.join(__dirname, '../../..', '..');
const dashboardReportsPath = path.join(repoRoot, 'src/app/dashboard/reports/ReportsPageClient.tsx');
const dashboardReportRoutePath = path.join(repoRoot, 'src/app/dashboard/reports/[reportId]/page.tsx');
const ruDashboardReportRoutePath = path.join(repoRoot, 'src/app/ru/dashboard/reports/[reportId]/page.tsx');
const ruLocationReportRoutePath = path.join(repoRoot, 'src/app/ru/location-report/[reportId]/page.tsx');
const authGuardPath = path.join(repoRoot, 'src/components/DashboardAuthGuard.tsx');
const onboardingPath = path.join(repoRoot, 'src/components/OnboardingPageContent.tsx');

describe('dashboard report acquisition flow', () => {
  it('encodes selected free report context for the dashboard handoff', () => {
    const href = buildDashboardReportRequestHref({
      address: 'Санкт-Петербург, Невский проспект, 88',
      lat: 59.93,
      lon: 30.36,
      freeReportId: 'free-1',
      freeReportPermalink: '/ru/location-report/free-1',
      mode: 'residential',
      createdAt: '2026-05-15T10:00:00.000Z',
    });

    const params = new URLSearchParams(href.split('?')[1]);
    const parsed = pendingLocationReportFromSearchParams(params);

    expect(href).toContain('/dashboard/reports?');
    expect(parsed).toMatchObject({
      address: 'Санкт-Петербург, Невский проспект, 88',
      lat: 59.93,
      lon: 30.36,
      freeReportId: 'free-1',
      freeReportPermalink: '/ru/location-report/free-1',
      mode: 'residential',
      createdAt: '2026-05-15T10:00:00.000Z',
    });
  });

  it('dashboard reports index shows preview and paid report choices by default', () => {
    const html = renderToStaticMarkup(React.createElement(ReportsPageClient));
    const previewCardHtml = html.split('Полный отчёт по объекту')[0] ?? html;
    const paidCardHtml = html.split('Полный отчёт по объекту')[1] ?? '';

    expect(html).toContain('Отчёты по объектам');
    expect(html).toContain(
      'Сначала покажем короткое превью по адресу: общий вывод, сильная сторона и главный риск.',
    );
    expect(html).toContain('Полный отчёт с доходностью, рисками, развитием района и PDF доступен после оплаты.');
    expect(html).toContain('Превью отчёта по локации');
    expect(html).toContain('Короткий обзор по адресу');
    expect(html).toContain('Адрес объекта');
    expect(html).toContain('Город, улица, дом');
    expect(html).toContain('Посмотреть превью');
    expect(html).not.toMatch(/бесплатн/i);
    expect(previewCardHtml).not.toContain('/ru/location-analysis');
    expect(html).toContain('Полный отчёт по объекту');
    expect(html).toContain('Получить полный отчёт');
    expect(paidCardHtml).toContain('/ru/location-analysis?mode=residential#location-check');
    expect(html).toContain('Мои сохранённые отчёты');
    expect(html).toContain('Пока нет сохранённых отчётов.');
  });

  it('labels saved reports as Превью or Полный отчёт without free-report wording', () => {
    const reportsSrc = fs.readFileSync(dashboardReportsPath, 'utf8');

    expect(reportsSrc).toContain("'Превью' | 'Полный отчёт'");
    expect(reportsSrc).toContain("? 'Полный отчёт' : 'Превью'");
    expect(reportsSrc).not.toMatch(/бесплатн/i);
  });

  it('dashboard preview action creates or opens the canonical preview report page', () => {
    const reportsSrc = fs.readFileSync(dashboardReportsPath, 'utf8');
    const ruLocationReportRouteSrc = fs.readFileSync(ruLocationReportRoutePath, 'utf8');

    expect(reportsSrc).toContain("fetch('/api/location-report'");
    expect(reportsSrc).toContain('is_paid: false');
    expect(reportsSrc).toContain("locale: 'ru'");
    expect(reportsSrc).toContain("router.push(permalink)");
    expect(reportsSrc).toContain('/ru/location-report/');
    expect(reportsSrc).not.toContain("const FREE_REPORT_HREF = '/ru/location-analysis");
    expect(ruLocationReportRouteSrc).toContain('LocationReportPublicPreview');
    expect(ruLocationReportRouteSrc).toContain("entity.report.reportMode === 'free'");
  });

  it('dashboard reports index does not show pending payment placeholders by default', () => {
    const html = renderToStaticMarkup(React.createElement(ReportsPageClient));

    expect(html).not.toContain('Ожидает оплаты');
    expect(html).not.toContain('Платёжная ссылка');
    expect(html).not.toContain('Закрыто до оплаты и генерации');
  });

  it('specific dashboard report page can still show the pending paid report state', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportPlaceholderClient, { reportId: 'request-1' }),
    );

    expect(html).toContain('Ожидает оплаты');
    expect(html).toContain('Платёжная ссылка');
    expect(html).toContain('Закрыто до оплаты и генерации');
    expect(html).toContain('Скачать PDF');
  });

  it('dashboard report routes preserve paid request and auth-gate behavior', () => {
    const reportsSrc = fs.readFileSync(dashboardReportsPath, 'utf8');
    const routeSrc = fs.readFileSync(dashboardReportRoutePath, 'utf8');
    const ruRouteSrc = fs.readFileSync(ruDashboardReportRoutePath, 'utf8');
    const authGuardSrc = fs.readFileSync(authGuardPath, 'utf8');

    expect(reportsSrc).toContain("fetch('/api/location-full-report/request'");
    expect(reportsSrc).toContain("router.push(data.loginUrl)");
    expect(reportsSrc).toContain('Получить полный отчёт');
    expect(reportsSrc).toContain('Посмотреть превью');
    expect(reportsSrc).not.toMatch(/бесплатн/i);
    expect(reportsSrc).toContain("const PAID_REPORT_START_HREF = '/ru/location-analysis?mode=residential#location-check'");
    expect(reportsSrc).toContain('Генерируется');
    expect(reportsSrc).toContain('Готов');
    expect(routeSrc).toContain('LocationStandaloneFullReport');
    expect(routeSrc).toContain('ReportPlaceholderClient');
    expect(ruRouteSrc).toContain("redirect(`/dashboard/reports/");
    expect(authGuardSrc).toContain('redirect=${encodeURIComponent(redirect)}');
  });

  it('auth redirects preserve report context through login/signup', () => {
    const authGuardSrc = fs.readFileSync(authGuardPath, 'utf8');
    const onboardingSrc = fs.readFileSync(onboardingPath, 'utf8');

    expect(authGuardSrc).toContain('redirect=${encodeURIComponent(redirect)}');
    expect(onboardingSrc).toContain('afterAuthRedirect');
    expect(onboardingSrc).toContain('redirect=${encodeURIComponent(afterAuthRedirect)}');
  });
});
