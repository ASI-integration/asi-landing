import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ASI — Полная операционная автоматизация',
  description: 'Автоматизация операций для недвижимости и гостеприимства: коммуникации, объявления, цены, брони и исполнение — замена операционного слоя, а не очередной инструмент.',
};

export default function RuLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
