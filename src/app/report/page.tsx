import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LOCATION_REPORT_PRODUCT_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Location report product moved | ASI',
  description:
    'The legacy /report page has moved to the canonical RU location report product page.',
  robots: { index: false, follow: false },
};

export default function LegacyReportLandingPage() {
  redirect(LOCATION_REPORT_PRODUCT_PATH);
}
