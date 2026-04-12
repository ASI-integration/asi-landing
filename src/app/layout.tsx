import type { Metadata } from 'next';
import Script from 'next/script';
import { headers } from 'next/headers';
import './globals.css';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { FooterGate } from '@/components/FooterGate';
import { LocalePathSync } from '@/components/LocalePathSync';
import { hostnameFromHostHeader, isRuRuntimeHost } from '@/lib/runtimeHost';

export const metadata: Metadata = {
  title: 'ASI — Full operational automation',
  description: 'Full operational automation for real estate and hospitality: guest comms, listings, pricing, bookings, and execution — replaces the ops layer, not another tool.',
  alternates: {
    languages: {
      'x-default': 'https://asi-global.com',
      en: 'https://asi-global.com',
      ru: 'https://asi-global.ru/',
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

  const isProd = process.env.NODE_ENV === 'production';

  return (
    <html lang={isRuHost ? 'ru' : 'en'} style={{ scrollBehavior: 'smooth' }}>
      <body className="antialiased">
        {isProd ? (
          <Script id="microsoft-clarity" strategy="afterInteractive">
            {`
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "wapp7pwvd6");
`}
          </Script>
        ) : null}
        <LanguageProvider>
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
