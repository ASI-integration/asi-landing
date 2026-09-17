/** Canonical origin for the Russian public site. */
export const RU_PUBLIC_ORIGIN = 'https://asi-global.ru';

/** Canonical origin for the English/global public site. */
export const EN_PUBLIC_ORIGIN = 'https://asi-global.com';

/**
 * Canonical origin for the international ASI Global marketing site
 * (homepage, market pages, media). This is a separate property with no
 * legal, contact, or corporate-data relationship to asi-global.ru — do not
 * reuse RU_PUBLIC_ORIGIN, RU contact addresses, or RU legal/footer content
 * on pages that use this origin.
 *
 * `www` is the canonical host, not the apex. The apex (guestautopilot.com)
 * is redirect-only (301 → www) at the nginx layer — see
 * deploy/nginx/guestautopilot.com.conf. Every canonical/OG/public-origin
 * reference in the app must point at `www` so nothing advertises the
 * redirect-only apex as if it were the real address.
 */
export const GUEST_AUTOPILOT_ORIGIN = 'https://www.guestautopilot.com';
