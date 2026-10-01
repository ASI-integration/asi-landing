import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

const rental = read('src/app/rental-autopilot/page.tsx');
const communication = read('src/app/features/communication/page.tsx');
const faq = read('src/components/FaqAccordion.tsx');
const offer = read('src/app/offer/page.tsx');
const globalHome = read('src/app/page.tsx');
const rootLayout = read('src/app/layout.tsx');
const publicOrigins = read('src/config/publicOrigins.ts');
const ruHome = read('src/app/ru/page.tsx');
const ruPayment = read('src/app/ru/payment/page.tsx');

const publicEnglish = [rental, communication, faq, offer, globalHome, rootLayout].join('\n').toLowerCase();

describe('public launch truth contracts', () => {
  it('does not publish unsupported autonomy, staffing, billing, or SLA claims', () => {
    for (const forbidden of [
      '99% automation',
      'automated end to end',
      'runs itself',
      'replaces your ops team',
      'replaces your operational team',
      'no ops team required',
      'all guest messaging end to end',
      'channel decisions execute automatically',
      'automated pricing and channel mix',
      'trial converts',
      'availability of at least 99%',
      'support within 1 business day',
      'maintenance at least 24 hours in advance',
      'full operational automation',
      'replaces the ops layer',
      'handles most routine operations',
      'pricing is published on the website',
      'a valid payment method must be attached before integration/setup work begins',
      'at least 7 calendar days',
    ]) {
      expect(publicEnglish).not.toContain(forbidden);
    }
  });

  it('states integration and human-exception boundaries explicitly', () => {
    expect(rental).toContain('Humans stay on exceptions');
    expect(rental).toContain('required integration is enabled and accepted');
    expect(communication).toContain('Sensitive, ambiguous, payment, legal, or unsupported');
    expect(communication).toContain('policy, data, and the configured integration allow it');
    expect(faq).toContain('Direct API sync or publishing is enabled only for providers whose integration has been accepted');
    expect(faq).toContain('There is no guaranteed payback period');
  });
  it('uses the real international canonical host rather than the retired EN domain', () => {
    expect(publicOrigins).toContain("GUEST_AUTOPILOT_ORIGIN = 'https://www.guestautopilot.com'");
    expect(publicOrigins).toContain('EN_PUBLIC_ORIGIN = GUEST_AUTOPILOT_ORIGIN');
    expect(rootLayout).toContain("'x-default': 'https://www.guestautopilot.com'");
    expect(rootLayout).toContain("en: 'https://www.guestautopilot.com'");
    expect(publicOrigins).not.toContain("EN_PUBLIC_ORIGIN = 'https://asi-global.com'");
  });

  it('keeps the global brand promise qualified by supported workflows and integrations', () => {
    expect(globalHome).toContain('Supported workflows can move');
    expect(globalHome).toContain('unsupported external steps');
    expect(globalHome).toContain('with automation enabled where the required integration is available');
    expect(globalHome).toContain('Supported routine work moves automatically');
  });

  it('keeps payment activation opt-in across EN and RU public surfaces', () => {
    expect(rental).toContain('No paid plan is activated automatically');
    expect(ruHome).toContain('Никакого автоматического перехода на оплату');
    expect(ruPayment).toContain('Никакого автоматического перехода на оплату');
    expect(offer).toContain('No paid subscription is currently offered');
  });

  it('does not invent a contractual SLA before a paid service plan defines one', () => {
    expect(offer).toContain('Any formal uptime SLA is agreed and published separately');
    expect(offer).toContain('fixed response-time commitments apply only when separately stated');
    expect(offer).toContain('When practical, notify users in advance of planned maintenance');
  });

  it('keeps pricing positioned as a recommendation until a provider integration is accepted', () => {
    expect(faq).toContain('Those recommendations are not automatically published');
    expect(rental).toContain('pricing recommendations');
    expect(rental).not.toContain('automated pricing and channel mix');
  });
});
