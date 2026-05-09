import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LEGACY_REPORT_REDIRECT_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Legacy report route deprecated | ASI',
  description:
    'This legacy generated report route is deprecated. Canonical location reports are persisted and served from /ru/location-report/[reportId].',
  robots: { index: false, follow: false },
};

export default function LegacyReportByIdPage() {
  redirect(LEGACY_REPORT_REDIRECT_PATH);
}
