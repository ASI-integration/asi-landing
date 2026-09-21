import type { Metadata } from 'next';
import { RU_PUBLIC_ORIGIN, EN_PUBLIC_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'ASI — операции посуточной аренды на автопилоте',
  description:
    'ASI берёт на себя рутинную коммуникацию с гостями и координацию операционных задач. Подключение бесплатно, 14 дней полноценной работы начинаются только после готовности объекта.',
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
