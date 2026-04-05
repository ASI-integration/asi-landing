import type { Metadata } from 'next';
import './globals.css';
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
    <html lang="en">
      <body className="antialiased">
        <LanguageProvider>
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
