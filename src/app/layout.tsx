import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'ASI — Операционная инфраструктура на базе ИИ',
  description: 'Автономная ИИ-платформа для объектов недвижимости и гостиничного бизнеса. Коммуникация с гостями, платежи, бронирования и управление задачами — без найма дополнительного персонала.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
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
