import { ruComplianceRoutes } from '@/config/ruCompliance';

/**
 * Primary RU header destinations for closed-beta customer journey.
 * Commercial pilot is `/ru/early-access` — not the engineering `/pilot` console.
 */
export const ruNavMainLinks = [
  { href: '/ru', label: 'Главная' },
  { href: '/ru/early-access', label: 'Пилот' },
  { href: '/ru/how-it-works', label: 'Как это работает' },
  { href: '/ru/otchet-po-dohodnosti-obektov', label: 'Оценка локации' },
] as const;

/** Extra compliance destinations for the lightweight bottom quick-links strip. */
export const ruNavComplianceLinks = [
  { href: ruComplianceRoutes.payment, label: 'Оплата' },
  { href: ruComplianceRoutes.refund, label: 'Возврат' },
  { href: ruComplianceRoutes.privacy, label: 'Политика данных' },
  { href: ruComplianceRoutes.offer, label: 'Оферта' },
] as const;
