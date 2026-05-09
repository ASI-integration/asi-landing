import { ruComplianceRoutes } from '@/config/ruCompliance';

/** Primary RU header destinations (landing sections match `src/app/ru/page.tsx`). */
export const ruNavMainLinks = [
  { href: '/ru', label: 'Главная' },
  { href: '/ru/otchet-po-dohodnosti-obektov', label: 'Оценка доходности' },
  { href: '/ru/how-it-works', label: 'Как это работает' },
  { href: '/ru#pricing', label: 'Тарифы' },
  { href: '/ru#faq', label: 'Вопросы' },
  { href: '/connect', label: 'Подключение' },
] as const;

/** Extra compliance destinations for the lightweight bottom quick-links strip. */
export const ruNavComplianceLinks = [
  { href: ruComplianceRoutes.payment, label: 'Оплата' },
  { href: ruComplianceRoutes.refund, label: 'Возврат' },
  { href: ruComplianceRoutes.privacy, label: 'Политика данных' },
  { href: ruComplianceRoutes.offer, label: 'Оферта' },
] as const;
