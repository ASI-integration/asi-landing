import { productSupportEmail } from './contact';
import { buildAsiFeedbackTelegramLink } from './publicTelegram';

/**
 * RU legal / Robokassa compliance data.
 * `email` follows public support (`productSupportEmail` / NEXT_PUBLIC_CONTACT_EMAIL).
 */
export const ruCompliance = {
  fullName: 'Реутова Юлия Игоревна',
  inn: '235307941957',
  email: productSupportEmail,
  telegram: buildAsiFeedbackTelegramLink('site'),
  phone: 'сделаем позже',
  address: 'сделаем позже',
};

export const ruComplianceRoutes = {
  contacts: '/ru/contacts',
  payment: '/ru/payment',
  refund: '/ru/refund',
  privacy: '/ru/privacy',
  offer: '/ru/offer',
} as const;
