import { ruComplianceRoutes } from '@/config/ruCompliance';

/** Primary RU header destinations (landing sections match `src/app/ru/page.tsx`).
 *  On asi-global.ru, `/` is served via a rewrite to `app/ru/page.tsx`, so all
 *  in-site links use `/` (not `/ru`) as the home anchor. */
export const ruNavMainLinks = [
  { href: '/', label: 'Главная' },
  { href: '/ru/otchet-po-dohodnosti-obektov', label: 'Доходность объектов' },
  { href: '/ru/how-it-works', label: 'Как это работает' },
  { href: '/#pricing', label: 'Тарифы' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/connect', label: 'Подключение' },
] as const;

/** Extra compliance destinations for the lightweight bottom quick-links strip. */
export const ruNavComplianceLinks = [
  { href: ruComplianceRoutes.payment, label: 'Оплата' },
  { href: ruComplianceRoutes.refund, label: 'Возврат' },
  { href: ruComplianceRoutes.privacy, label: 'Политика данных' },
  { href: ruComplianceRoutes.offer, label: 'Оферта' },
] as const;
