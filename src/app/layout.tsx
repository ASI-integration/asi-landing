import type { Metadata } from 'next';
import './globals.css';
import Script from 'next/script';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { LegalFooter } from '@/components/LegalFooter';
import { LocalePathSync } from '@/components/LocalePathSync';

export const metadata: Metadata = {
  title: 'ASI — Full operational automation',
  description: 'Full operational automation for real estate and hospitality: guest comms, listings, pricing, bookings, and execution — replaces the ops layer, not another tool.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" style={{ scrollBehavior: 'smooth' }}>
      <body className="antialiased">
        <LanguageProvider>
          <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`}
            strategy="beforeInteractive"
          />
          <LocalePathSync />
          <div className="flex flex-col min-h-screen">
            <div className="flex-1">{children}</div>
            <LegalFooter />
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
