import type { Metadata } from 'next';
import { RU_PUBLIC_ORIGIN, EN_PUBLIC_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'ASI — AI-ответы гостям для посуточной аренды',
  description:
    'Закрытый пилот AI-коммуникаций с гостями для посуточной аренды. Оценка локации — отдельный инструмент.',
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
