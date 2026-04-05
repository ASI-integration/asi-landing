import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { LegalFooter } from '@/components/LegalFooter';
import { LocalePathSync } from '@/components/LocalePathSync';

export const metadata: Metadata = {
  title: 'ASI — AI-powered operational infrastructure',
  description: 'Autonomous AI platform for real estate and hospitality operations. Guest communication, payments, reservations, and task control — without additional headcount.',
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
