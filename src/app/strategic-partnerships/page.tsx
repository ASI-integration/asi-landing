import { StrategicLanding } from '@/components/StrategicLanding';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, GoldRule, PrimaryCta } from '@/components/site/primitives';

export const metadata: Metadata = {
  title: 'Strategic Partnerships | ASI Cabins',
  description: 'Partner with ASI Global to develop private modular hospitality cabins in suitable existing buildings worldwide.',
  alternates: { canonical: `${GUEST_AUTOPILOT_ORIGIN}/strategic-partnerships` },
};

export default async function StrategicPartnershipsPage() {
  const isRuHost = await getIsRuHost();
  if (isRuHost) {
    return (
      <div className="min-h-screen bg-white">
        <Header isRuHost={isRuHost} />
        <main><StrategicLanding /></main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />
      <main>
        <section className="px-5 sm:px-8 pt-14 sm:pt-20 pb-16 sm:pb-24">
          <div className="max-w-6xl mx-auto">
            <Eyebrow>ASI Global · Strategic Partnerships</Eyebrow>
            <Headline as="h1" className="text-4xl sm:text-6xl max-w-4xl">
              An international modular hospitality business.
            </Headline>
            <GoldRule className="mt-8 mb-7" />
            <p className="text-lg leading-relaxed text-asi-navy/70 max-w-3xl">
              ASI Cabins combines private two-person modular rooms placed inside existing
              commercial spaces with an automation-first operating system. We are preparing
              manufacturing sourcing, prototype engineering, pilot economics and market validation.
            </p>
          </div>
        </section>
        <Section variant="paper">
          <Eyebrow>Partnership opportunities</Eyebrow>
          <Headline className="text-3xl sm:text-5xl">Build the first pilot together.</Headline>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            {[
              ['Property & development', 'Identify suitable premises, validate installation feasibility and support local approvals.'],
              ['Manufacturing & engineering', 'Develop a manufacturable indoor cabin kit, testing, quality control and scaling capability.'],
              ['Capital & operations', 'Structure pilot financing, measure real unit economics and expand only after validation.'],
            ].map(([heading, body]) => (
              <div className="border border-asi-border bg-asi-ivory p-7" key={heading}>
                <h2 className="font-serif text-2xl">{heading}</h2>
                <p className="mt-4 text-sm leading-relaxed text-asi-navy/65">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-asi-navy/65 max-w-3xl">
            Flexible collaboration formats may include joint ventures, pilot partnerships and
            strategic investment. No rollout, operational capacity or return is represented
            as guaranteed.
          </p>
          <div className="mt-8"><PrimaryCta href="/contacts">Contact ASI Global</PrimaryCta></div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
