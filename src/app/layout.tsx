import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import Script from 'next/script';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { FooterGate } from '@/components/FooterGate';
import { LocalePathSync } from '@/components/LocalePathSync';
import { hostnameFromHostHeader, isRuRuntimeHost } from '@/lib/runtimeHost';

export const metadata: Metadata = {
  title: 'ASI — Full operational automation',
  description: 'Full operational automation for real estate and hospitality: guest comms, listings, pricing, bookings, and execution — replaces the ops layer, not another tool.',
  alternates: {
    languages: {
      en: 'https://asi-global.com',
      ru: 'https://asi-global.ru',
    },
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const raw =
    h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  const isRuHost = isRuRuntimeHost(hostnameFromHostHeader(raw));

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
            <FooterGate isRuHost={isRuHost} />
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
