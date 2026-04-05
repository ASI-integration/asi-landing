import { productSupportEmail } from './contact';

/**
 * Shared legal/entity data for footer, legal, offer, and privacy pages.
 * `email` is the legal / official contact-of-record (not product support).
 */
export const legalConfig = {
  name: 'ASI Integrations',
  email: productSupportEmail,
  status: 'Individual service provider',
} as const;

/** One-line legal footer text */
export const legalFooterLine = `${legalConfig.name}`;
