import { productSupportEmail } from './contact';
import { telegramSupportBotUrl } from './telegramBots';

/**
 * RU legal / merchant compliance data for public pages.
 * Values below are owner-verified for Russian customer-facing surfaces.
 * Do not invent postal index, apartment, or OGRN/OGRNIP.
 */
export const ruCompliance = {
  fullName: 'Реутова Юлия Игоревна',
  inn: '235307941957',
  email: productSupportEmail,
  telegram: telegramSupportBotUrl,
  /** Owner-verified public phone. */
  phone: '+7 995 889-49-03',
  /** tel: href without spaces/dashes. */
  phoneTel: '+79958894903',
  /** Owner-verified correspondence/contact address (no invented index/apartment). */
  address: 'Ленинградская область, г. Мурино, ул. Оборонная, д. 37, корп. 1',
  /** Self-employed: OGRN/OGRNIP not applicable / not provided. */
  ogrn: null as string | null,
};

export const ruComplianceRoutes = {
  contacts: '/ru/contacts',
  payment: '/ru/payment',
  refund: '/ru/refund',
  privacy: '/ru/privacy',
  offer: '/ru/offer',
  personalDataConsent: '/ru/personal-data-consent',
} as const;
