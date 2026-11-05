import type { Metadata } from 'next';

import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, GoldRule, PrimaryCta } from '@/components/site/primitives';
import { LogoMark } from '@/components/site/LogoMark';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

const title = 'Worldwide Opportunity | ASI Cabins';
const description = 'ASI Cabins is designed as a repeatable indoor modular hospitality concept for suitable commercial premises across the world.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${GUEST_AUTOPILOT_ORIGIN}/markets` },
};

export default function MarketsPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />
      <main>
        <section className="px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3">
              <LogoMark size={32} />
              <span className="font-serif text-xl">ASI Global</span>
            </div>
            <Eyebrow>Worldwide opportunity</Eyebrow>
            <Headline as="h1" className="mt-7 text-4xl sm:text-6xl max-w-4xl">
              One cabin concept. <span className="text-asi-gold">A world of locations.</span>
            </Headline>
            <GoldRule className="mt-7 mb-6" />
            <p className="max-w-2xl text-lg text-asi-navy/70 leading-relaxed">
              ASI Cabins is conceived as a modular indoor accommodation system. Standardized design
              and operations could be localized to suitable commercial buildings anywhere there
              is demand, a viable operating partner and regulatory permission.
            </p>
          </div>
        </section>
        <Section variant="paper">
          <Headline className="text-3xl sm:text-5xl">Designed to be repeated.</Headline>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            {[
              ['Manufacturing', 'A repeatable cabin kit developed with specialist production partners.'],
              ['Real estate', 'Suitable interior commercial space and local installation expertise.'],
              ['Operations', 'An automation-first operating layer that can be adapted locally.'],
            ].map(([title, body]) => (
              <div key={title} className="border border-asi-border bg-asi-ivory p-8">
                <h2 className="font-serif text-2xl">{title}</h2>
                <p className="mt-4 text-sm leading-relaxed text-asi-navy/65">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-asi-navy/65">Pilot economics and compliance must be validated for each location before rollout.</p>
          <div className="mt-8"><PrimaryCta href="/#partner">Explore a partnership</PrimaryCta></div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
