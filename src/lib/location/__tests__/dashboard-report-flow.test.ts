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

  it('dashboard reports index shows free and paid report choices by default', () => {
    const html = renderToStaticMarkup(React.createElement(ReportsPageClient));

    expect(html).toContain('Отчёты по объектам');
    expect(html).toContain('Сначала можно получить бесплатный краткий отчёт по адресу');
    expect(html).toContain('Бесплатный отчёт по локации');
    expect(html).toContain('Быстрый общий вывод по адресу');
    expect(html).toContain('Получить бесплатный отчёт');
    expect(html).toContain('/ru/location-analysis?mode=residential#location-check');
    expect(html).toContain('Подробный платный отчёт');
    expect(html).toContain('Расширенный разбор объекта');
    expect(html).toContain('Заказать подробный отчёт');
    expect(html).toContain('Мои сохранённые отчёты');
    expect(html).toContain('Пока нет сохранённых отчётов.');
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
    expect(reportsSrc).toContain('Заказать подробный отчёт');
    expect(reportsSrc).toContain('Получить бесплатный отчёт');
    expect(reportsSrc).toContain('/ru/location-analysis?mode=residential#location-check');
    expect(reportsSrc).toContain('Генерируется');
    expect(reportsSrc).toContain('Готов');
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
