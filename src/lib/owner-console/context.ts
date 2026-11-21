export const OWNER_LANGS = ['en', 'ru'] as const;
export const OWNER_VERTICALS = ['hospitality', 'real_estate', 'industrial', 'marketplaces'] as const;

export type OwnerLang = (typeof OWNER_LANGS)[number];
export type OwnerMarket = 'ru' | 'international';
export type OwnerVertical = (typeof OWNER_VERTICALS)[number];

export interface OwnerConsoleContext {
  lang: OwnerLang;
  /** Commercial market is determined by the entry host, NOT language toggle. */
  market: OwnerMarket;
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
      market: 'international',
      vertical: 'hospitality',
      showVerticalSwitcher: false,
      hostname,
    };
  }

  if (kind === 'asi-global') {
    return {
      lang: queryLang ?? 'ru',
      market: 'ru',
      vertical: queryVertical && queryVertical !== 'platform' ? queryVertical : null,
      showVerticalSwitcher: true,
      hostname,
    };
  }

  const lang = queryLang ?? 'en';
  const switcher = lang === 'ru' || queryVertical === 'platform' || (queryVertical !== null && queryVertical !== 'hospitality');
  if (!switcher) {
    return { lang, market: 'international', vertical: 'hospitality', showVerticalSwitcher: false, hostname };
  }
  return {
    lang,
    market: lang === 'ru' ? 'ru' : 'international',
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


/**
 * Marketing presentation only. Never treats a user as eligible for a
 * community offer, activates a trial, changes billing, or creates a discount.
 * Eligibility and final terms must be confirmed in the onboarding process.
 */
export interface OwnerCommercialOffer {
  heading: string;
  intro: string;
  facts: ReadonlyArray<{ label: string; value: string; detail: string }>;
  note: string;
  ctaLabel: string;
  ctaHref: string;
}

export function ownerCommercialOffer(market: OwnerMarket, lang: OwnerLang): OwnerCommercialOffer {
  if (market === 'ru') {
    if (lang === 'en') {
      return {
        heading: 'Yaroslav Strigunov community — conditional pilot offer',
        intro: 'For eligible community members, subject to confirmation during onboarding. This offer is not automatically applied to every Russian visitor.',
        facts: [
          { label: 'Setup', value: '0 ₽', detail: 'Property connection and initial setup.' },
          { label: 'Property pilot', value: '14 days', detail: 'Free test starts only once the property is fully ready.' },
          { label: 'After the pilot', value: '1,000 ₽ / property', detail: 'Only if the owner explicitly chooses to continue.' },
          { label: 'Price commitment', value: '12 months', detail: 'The stated price is fixed for 12 months for eligible participants.' },
        ],
        note: 'No automatic billing. Participation, eligibility and the applicable offer are confirmed before activation. The demo sandbox is separate from this property pilot.',
        ctaLabel: 'Confirm eligibility and connect a property',
        ctaHref: 'https://www.asi-global.ru/ru/connect',
      };
    }
    return {
      heading: 'Спецусловия для сообщества Ярослава Стригунова',
      intro: 'Для участников сообщества после подтверждения права на предложение при подключении. Условия не применяются автоматически ко всем посетителям.',
      facts: [
        { label: 'Настройка', value: '0 ₽', detail: 'Подключение и первичная настройка объекта.' },
        { label: 'Пилот на объекте', value: '14 дней', detail: 'Бесплатный тест начинается после полной готовности объекта.' },
        { label: 'После пилота', value: '1 000 ₽/объект', detail: 'Только если владелец решает продолжить работу.' },
        { label: 'Фиксация цены', value: '12 месяцев', detail: 'Цена фиксируется на 12 месяцев для участников программы.' },
      ],
      note: 'Никакого автоматического перехода на оплату. Участие и условия подтверждаются перед подключением. Демо-песочница и пилот на реальном объекте — разные этапы.',
      ctaLabel: 'Уточнить условия и подключить объект',
      ctaHref: 'https://www.asi-global.ru/ru/connect',
    };
  }
  if (lang === 'ru') {
    return {
      heading: 'Международная программа подключения',
      intro: 'Попробуйте бесплатную демонстрационную песочницу. Условия реального пилота и коммерческое предложение обсуждаются для конкретного рынка.',
      facts: [
        { label: 'Демонстрация', value: 'Песочница', detail: 'Учебный сценарий на тестовых данных.' },
        { label: 'Платные LLM', value: '0 вызовов', detail: 'Демо не запускает платные модели.' },
      ],
      note: 'Условия, цены и скидки для международного рынка не обещаются без отдельного согласования. Никаких автоматических платежей.',
      ctaLabel: 'Обсудить международное подключение',
      ctaHref: 'https://www.guestautopilot.com/#partner',
    };
  }
  return {
    heading: 'International onboarding',
    intro: 'Explore the free sandbox. Property-pilot pricing and commercial terms are discussed for the specific market and project.',
    facts: [
      { label: 'Demo environment', value: 'Sandbox', detail: 'A walkthrough using example data.' },
      { label: 'Paid model usage', value: '0 calls', detail: 'The demo does not invoke paid LLM providers.' },
    ],
    note: 'No unverified international price, discount or trial is promised. No automatic payments.',
    ctaLabel: 'Discuss international onboarding',
    ctaHref: 'https://www.guestautopilot.com/#partner',
  };
}
