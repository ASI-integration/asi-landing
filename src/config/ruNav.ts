import { ruComplianceRoutes } from '@/config/ruCompliance';

/** Primary RU header destinations (landing sections match `src/app/ru/page.tsx`). */
export const ruNavMainLinks = [
  { href: '/', label: 'Главная' },
  { href: '/#platform-modules', label: 'Платформа' },
  { href: '/#faq', label: 'Как это работает' },
  { href: '/#pricing', label: 'Тарифы' },
  { href: '/connect', label: 'Подключение' },
  { href: ruComplianceRoutes.contacts, label: 'Контакты' },
] as const;

/** Extra compliance destinations for the lightweight bottom quick-links strip. */
export const ruNavComplianceLinks = [
  { href: ruComplianceRoutes.payment, label: 'Оплата' },
  { href: ruComplianceRoutes.refund, label: 'Возврат' },
  { href: ruComplianceRoutes.privacy, label: 'Политика данных' },
  { href: ruComplianceRoutes.offer, label: 'Оферта' },
] as const;
