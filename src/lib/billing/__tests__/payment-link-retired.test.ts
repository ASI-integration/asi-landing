import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scenario Q: the old $10 Stripe Payment Link must not be reachable as an
 * active checkout path anywhere on guestautopilot.com — it would let a new
 * customer bypass signup -> card_verified -> integration -> trial entirely
 * by completing a one-shot Stripe Checkout session with no account, no
 * integration, and no trial. This is a static-analysis test (rather than a
 * rendered-component test) because it needs to prove an absence across the
 * whole set of pages that used to reference it.
 */
const PAGES_THAT_USED_TO_LINK_TO_PAYMENT_LINK = [
  'src/app/rental-autopilot/page.tsx',
  'src/app/features/communication/page.tsx',
  'src/app/features/location-analysis/page.tsx',
  'src/app/ota/page.tsx',
];

describe('scenario Q: the $10 Payment Link cannot bypass the canonical onboarding lifecycle', () => {
  it.each(PAGES_THAT_USED_TO_LINK_TO_PAYMENT_LINK)('%s no longer imports or renders STRIPE_PAYMENT_LINK', (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
    expect(source).not.toMatch(/STRIPE_PAYMENT_LINK/);
    expect(source).not.toMatch(/buy\.stripe\.com/);
  });

  it.each(PAGES_THAT_USED_TO_LINK_TO_PAYMENT_LINK)('%s repoints its primary CTA at the new signup entry point (/connect)', (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
    expect(source).toMatch(/\/connect/);
  });
});
