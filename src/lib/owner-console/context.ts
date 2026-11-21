export const OWNER_LANGS = ['en', 'ru'] as const;
export const OWNER_VERTICALS = ['hospitality', 'real_estate', 'industrial', 'marketplaces'] as const;

export type OwnerLang = (typeof OWNER_LANGS)[number];
export type OwnerVertical = (typeof OWNER_VERTICALS)[number];

export interface OwnerConsoleContext {
  lang: OwnerLang;
  /** Null is the multi-vertical platform home (no single vertical chosen yet). */
  vertical: OwnerVertical | null;
  showVerticalSwitcher: boolean;
  hostname: string;
}

const GUEST_HOSTS = new Set(['guestautopilot.com', 'www.guestautopilot.com', 'app.guestautopilot.com']);
const ASI_HOSTS = new Set(['asi-global.ru', 'www.asi-global.ru', 'app.asi-global.ru']);

export function ownerHostKind(hostname: string): 'guestautopilot' | 'asi-global' | 'unknown' {
  const host = hostname.trim().toLowerCase();
  if (GUEST_HOSTS.has(host)) return 'guestautopilot';
  if (ASI_HOSTS.has(host)) return 'asi-global';
  return 'unknown';
}

function asLang(value: string | null | undefined): OwnerLang | null {
  return value === 'en' || value === 'ru' ? value : null;
}

function asVertical(value: string | null | undefined): OwnerVertical | 'platform' | null {
  if (value === 'platform') return 'platform';
  return (OWNER_VERTICALS as readonly string[]).includes(value ?? '') ? (value as OwnerVertical) : null;
}

export function resolveOwnerConsoleContext(input: {
  hostname?: string | null;
  lang?: string | null;
  vertical?: string | null;
}): OwnerConsoleContext {
  const hostname = (input.hostname ?? '').trim().toLowerCase();
  const kind = ownerHostKind(hostname);
  const queryLang = asLang(input.lang);
  const queryVertical = asVertical(input.vertical);

  if (kind === 'guestautopilot') {
    return {
      lang: queryLang ?? 'en',
      vertical: 'hospitality',
      showVerticalSwitcher: false,
      hostname,
    };
  }

  if (kind === 'asi-global') {
    return {
      lang: queryLang ?? 'ru',
      vertical: queryVertical && queryVertical !== 'platform' ? queryVertical : null,
      showVerticalSwitcher: true,
      hostname,
    };
  }

  const lang = queryLang ?? 'en';
  const switcher = lang === 'ru' || queryVertical === 'platform' || (queryVertical !== null && queryVertical !== 'hospitality');
  if (!switcher) {
    return { lang, vertical: 'hospitality', showVerticalSwitcher: false, hostname };
  }
  return {
    lang,
    vertical: queryVertical && queryVertical !== 'platform' ? queryVertical : null,
    showVerticalSwitcher: true,
    hostname,
  };
}

export function ownerConsoleSearch(context: Pick<OwnerConsoleContext, 'lang' | 'vertical'>, section?: string | null): string {
  const params = new URLSearchParams();
  params.set('lang', context.lang);
  params.set('vertical', context.vertical ?? 'platform');
  if (section && section !== 'main') params.set('section', section);
  return params.toString();
}
