import { productSupportEmail } from './contact';

/**
 * RU legal / Robokassa compliance data.
 * `email` follows public support (`productSupportEmail` / NEXT_PUBLIC_CONTACT_EMAIL).
 */
export const ruCompliance = {
  fullName: 'Реутова, Ю. И',
  inn: '235307941957',
  email: productSupportEmail,
  telegram: 'https://t.me/ASI_core_bot',
  phone: 'сделаем позже',
  address: 'сделаем позже',
};

export const ruComplianceRoutes = {
  contacts: '/contacts',
  payment: '/payment',
  refund: '/refund',
  privacy: '/privacy',
  offer: '/offer',
} as const;
