import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'ASI — Autonomous Property Management',
  description: 'Run your property autonomously. 14-day free trial. No staff. No chaos. No OTA dependency.',
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
          <div className="flex flex-col min-h-screen">
            <div className="flex-1">{children}</div>
            <LegalFooter />
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
