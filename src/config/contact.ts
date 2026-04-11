/**
 * Public support email for mailto links and legal copy.
 * `NEXT_PUBLIC_*` is inlined at build time; set it on the server and rebuild to override.
 */
const fromEnv = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim();
export const productSupportEmail = fromEnv || 'support@asi-global.ru';
