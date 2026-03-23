import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'ASI — Объект недвижимости на автопилоте',
  description: 'Платформа автоматизации объектов недвижимости. Коммуникация с гостями, сбор платежей, управление бронированиями и контроль задач — без найма дополнительного персонала.',
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
