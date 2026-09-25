import type { Metadata } from 'next';

import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, GoldRule } from '@/components/site/primitives';
import { MarketCard } from '@/components/site/MarketCard';
import { LogoMark } from '@/components/site/LogoMark';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

const title = 'ASI Global Markets — Autonomous Operations Around the World';
const description =
  'ASI Global adapts one autonomous operating engine to different markets and physical businesses, from hospitality in Japan to industrial operations in Europe.';
const url = `${GUEST_AUTOPILOT_ORIGIN}/markets`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: {
    title,
    description,
    url,
    siteName: 'ASI Global',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
};

const NEXT_MARKETS = [
  'Taiwan',
  'South Korea',
  'Hong Kong',
  'Singapore',
  'Malaysia',
  'Chile',
  'Spain',
  'Azerbaijan',
] as const;

export default function MarketsPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />

      <main>
        <section className="px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 bg-asi-ivory">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3">
              <LogoMark size={32} />
              <span className="font-serif text-xl">ASI Global</span>
            </div>
            <p className="mt-2 text-xs uppercase tracking-[0.22em] text-asi-navy/65">
              Global Markets
            </p>
            <Headline as="h1" className="mt-7 text-4xl sm:text-6xl max-w-4xl">
              One operating engine.
              <br />
              <span className="text-asi-gold">Adapted to different real-world businesses.</span>
            </Headline>
            <GoldRule className="mt-7 mb-6" />
            <p className="max-w-2xl text-lg text-asi-navy/70 leading-relaxed">
              ASI is designed globally and localized where the operating model, partners and
              physical market make sense.
            </p>
          </div>
        </section>

        <Section variant="paper">
          <Eyebrow>Current expansion tracks</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            Different markets. Same principle.
          </Headline>
          <p className="mt-5 max-w-2xl text-asi-navy/65 leading-relaxed">
            Operations on autopilot. Humans on exceptions.
          </p>

          <div className="mt-12 grid md:grid-cols-2 gap-6">
            <MarketCard
              country="jp"
              name="Japan — Autonomous Hospitality"
              line="ASI Micro Hotels + autonomous booking, access, guest communication, cleaning and daily operations. Target program: Open Network Lab 32nd."
              href="/markets/japan"
              status="active"
            />
            <MarketCard
              country="nl"
              name="Netherlands / Europe — Industrial Operations"
              line="Construction, field work, contractors, SLAs and operational decisions. Target program: LANDCROS Innovation Studios Europe Challenge 2026."
              href="/markets/netherlands"
              status="active"
            />
          </div>
        </Section>

        <Section variant="ivory">
          <Eyebrow>Next markets</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            We expand where the operating model fits.
          </Headline>
          <div className="mt-10 flex flex-wrap gap-3">
            {NEXT_MARKETS.map((market) => (
              <span
                key={market}
                className="px-4 py-2.5 border border-asi-border bg-asi-paper text-sm text-asi-navy/70 rounded-sm"
              >
                {market}
              </span>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-sm text-asi-navy/60 leading-relaxed">
            These are exploration markets, not announced launches. New country pages appear only
            when there is a concrete pilot, partner or market-entry track to explain.
          </p>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
