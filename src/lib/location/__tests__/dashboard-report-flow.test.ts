import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildDashboardReportRequestHref,
  pendingLocationReportFromSearchParams,
} from '../pending-location-report';

const repoRoot = path.join(__dirname, '../../..', '..');
const dashboardReportsPath = path.join(repoRoot, 'src/app/dashboard/reports/ReportsPageClient.tsx');
const dashboardReportPlaceholderPath = path.join(repoRoot, 'src/app/dashboard/reports/[reportId]/ReportPlaceholderClient.tsx');
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

  it('dashboard pages expose pending status, order CTA, and locked placeholder route', () => {
    const reportsSrc = fs.readFileSync(dashboardReportsPath, 'utf8');
    const placeholderSrc = fs.readFileSync(dashboardReportPlaceholderPath, 'utf8');
    const routeSrc = fs.readFileSync(dashboardReportRoutePath, 'utf8');
    const ruRouteSrc = fs.readFileSync(ruDashboardReportRoutePath, 'utf8');

    expect(reportsSrc).toContain('Мои отчёты');
    expect(reportsSrc).toContain('Ожидает оплаты');
    expect(reportsSrc).toContain('Готовим отчёт');
    expect(reportsSrc).toContain('Готов');
    expect(reportsSrc).toContain('Ошибка, попробовать снова');
    expect(reportsSrc).toContain('Заказать подробный отчёт');
    expect(placeholderSrc).toContain('Детальный расчёт появится после оплаты');
    expect(placeholderSrc).toContain('Скачать PDF');
    expect(routeSrc).toContain('ReportPlaceholderClient');
    expect(ruRouteSrc).toContain("redirect(`/dashboard/reports/");
  });

  it('auth redirects preserve report context through login/signup', () => {
    const authGuardSrc = fs.readFileSync(authGuardPath, 'utf8');
    const onboardingSrc = fs.readFileSync(onboardingPath, 'utf8');

    expect(authGuardSrc).toContain('redirect=${encodeURIComponent(redirect)}');
    expect(onboardingSrc).toContain('afterAuthRedirect');
    expect(onboardingSrc).toContain('redirect=${encodeURIComponent(afterAuthRedirect)}');
  });
});
