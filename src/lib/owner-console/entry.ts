/** Relative Owner Console entry points. Shared hosting drops use the app subdomains. */
export const OWNER_CONSOLE_PATH = '/owner';

export const OWNER_CONSOLE_EN_HREF = `${OWNER_CONSOLE_PATH}?lang=en&vertical=hospitality`;
export const OWNER_CONSOLE_RU_HREF = `${OWNER_CONSOLE_PATH}?lang=ru&vertical=platform`;

export const OWNER_CONSOLE_EN_ORIGIN = 'https://app.guestautopilot.com';
export const OWNER_CONSOLE_RU_ORIGIN = 'https://app.asi-global.ru';

export const OWNER_CONSOLE_EN_ABSOLUTE = `${OWNER_CONSOLE_EN_ORIGIN}${OWNER_CONSOLE_EN_HREF}`;
export const OWNER_CONSOLE_RU_ABSOLUTE = `${OWNER_CONSOLE_RU_ORIGIN}${OWNER_CONSOLE_RU_HREF}`;
