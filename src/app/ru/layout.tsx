import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ASI — Объект недвижимости на автопилоте',
  description: 'Платформа автоматизации объектов недвижимости. Коммуникация с гостями, сбор платежей, управление бронированиями и контроль задач — без найма дополнительного персонала.',
};

export default function RuLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
