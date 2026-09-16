import { productSupportEmail } from './contact';
import { telegramSupportBotUrl } from './telegramBots';

/**
 * RU legal / merchant compliance data for public pages.
 * `email` follows public support (`productSupportEmail` / NEXT_PUBLIC_CONTACT_EMAIL).
 *
 * Phone and postal address are omitted until the owner supplies verified values.
 * Do not publish placeholders on merchant-facing pages.
 */
export const ruCompliance = {
  fullName: 'Реутова Юлия Игоревна',
  inn: '235307941957',
  email: productSupportEmail,
  telegram: telegramSupportBotUrl,
  /** Owner input required — null until a real public phone is confirmed. */
  phone: null as string | null,
  /** Owner input required — null until a real correspondence address is confirmed. */
  address: null as string | null,
};

export const ruComplianceRoutes = {
  contacts: '/ru/contacts',
  payment: '/ru/payment',
  refund: '/ru/refund',
  privacy: '/ru/privacy',
  offer: '/ru/offer',
} as const;
