import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Legacy report comparison deprecated | ASI',
  description:
    'Legacy local report comparisons are deprecated. Canonical reports are persisted under /ru/location-report/[reportId].',
  robots: { index: false, follow: false },
};

export default function LegacyComparePage() {
  redirect(LOCATION_REPORT_SAMPLE_PATH);
}
