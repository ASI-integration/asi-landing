/**
 * ASI shared visual brand tokens.
 * Source of truth for appearance — mirrored in `tailwind.config.js` (`asi.*`).
 *
 * MUST NOT include market-specific content: merchant identity, legal, payment,
 * tariff, contacts, or country CTA destinations. Those live in RU/market layers.
 */

export const asiBrandColors = {
  ivory: '#F7F3EA',
  ivoryWarm: '#F1E9D8',
  paper: '#FBF9F4',
  navy: '#13151B',
  navy2: '#2A2D36',
  gold: '#A6813C',
  goldSoft: '#C9AD73',
  /** WCAG AA small-text gold on ivory/paper */
  goldText: '#806028',
  border: '#E5DCC6',
} as const;

export const asiBrandFonts = {
  serif: '"Iowan Old Style", "Palatino Linotype", Georgia, Cambria, serif',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

export const asiBrandLayout = {
  /** Shared content max width used by guestautopilot + RU shell */
  contentMaxClass: 'max-w-6xl',
  pagePadXClass: 'px-5 sm:px-8',
  sectionPadYClass: 'py-16 sm:py-24',
  headerHeightClass: 'h-16 sm:h-20',
  radiusClass: 'rounded-sm',
} as const;

export const asiBrandShiro = {
  assetPath: '/brand/shiro-badge.png',
  logoMarkPath: '/brand/asi-global-mark.png',
  defaultSize: 40,
  mobileSize: 32,
  footerSize: 40,
  alt: 'Shiro — официальный маскот бренда ASI Global',
} as const;

const asiBrandFocusVisibleClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asi-gold';

/** Tailwind class fragments for shared button look (visual only). */
export const asiBrandButtonClasses = {
  primary:
    `inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-asi-navy text-asi-ivory text-sm font-sans font-semibold tracking-wide rounded-sm border border-asi-navy hover:bg-asi-navy-2 transition-colors ${asiBrandFocusVisibleClass}`,
  secondary:
    `inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-transparent text-asi-navy text-sm font-sans font-semibold tracking-wide rounded-sm border border-asi-navy/70 hover:border-asi-navy transition-colors ${asiBrandFocusVisibleClass}`,
  headerOutline:
    `inline-flex items-center px-5 py-2.5 border border-asi-navy text-asi-navy text-sm font-sans font-semibold tracking-wide rounded-sm hover:bg-asi-navy hover:text-asi-ivory transition-colors ${asiBrandFocusVisibleClass}`,
} as const;

export const asiBrandCardClasses = {
  paper:
    'flex flex-col p-6 sm:p-7 bg-asi-paper border border-asi-border rounded-sm transition-colors hover:border-asi-gold',
} as const;
