/** Canonical origin for the Russian public site. */
export const RU_PUBLIC_ORIGIN = 'https://asi-global.ru';

/**
 * Canonical origin for the international ASI Global marketing site
 * (homepage, market pages, media, rental autopilot).
 *
 * `www` is the canonical host. The apex (guestautopilot.com) is
 * redirect-only (301 → www) at the nginx layer — see
 * deploy/nginx/guestautopilot.com.conf.
 */
export const GUEST_AUTOPILOT_ORIGIN = 'https://www.guestautopilot.com';

/**
 * English/x-default public origin.
 * Keep this alias aligned with the real international canonical host.
 * asi-global.com is intentionally out of scope / nonexistent.
 */
export const EN_PUBLIC_ORIGIN = GUEST_AUTOPILOT_ORIGIN;
