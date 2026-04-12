import type { Metadata } from 'next';
import { RU_PUBLIC_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'ASI — Полная операционная автоматизация',
  description: 'Автоматизация операций для недвижимости и гостеприимства: коммуникации, объявления, цены, брони и исполнение — замена операционного слоя, а не очередной инструмент.',
  alternates: {
    canonical: `${RU_PUBLIC_ORIGIN}/`,
    languages: {
      'x-default': 'https://asi-global.com',
      en: 'https://asi-global.com',
      ru: `${RU_PUBLIC_ORIGIN}/`,
    },
  },
};

export default function RuLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
