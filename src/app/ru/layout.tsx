import type { Metadata } from 'next';
import { RU_PUBLIC_ORIGIN, EN_PUBLIC_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'ASI — операции посуточной аренды на автопилоте',
  description:
    'ASI берёт на себя рутинную коммуникацию с гостями и координацию операционных задач. Бесплатное подключение, 14 дней пилота после готовности объекта, затем 1 000 ₽ за объект в месяц.',
  alternates: {
    canonical: `${RU_PUBLIC_ORIGIN}/`,
    languages: {
      'x-default': EN_PUBLIC_ORIGIN,
      en: EN_PUBLIC_ORIGIN,
      ru: `${RU_PUBLIC_ORIGIN}/`,
    },
  },
};

export default function RuLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
