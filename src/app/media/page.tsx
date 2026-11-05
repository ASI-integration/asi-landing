import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, PrimaryCta } from '@/components/site/primitives';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'ASI Global | Concept',
  description: 'Discover the international ASI Cabins concept and the automation-first operations behind it.',
  alternates: { canonical: `${GUEST_AUTOPILOT_ORIGIN}/media` },
};

export default function MediaPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />
      <main>
        <section className="px-5 sm:px-8 pt-14 sm:pt-20 pb-10">
          <div className="max-w-6xl mx-auto">
            <Eyebrow>ASI Global</Eyebrow>
            <Headline as="h1" className="text-4xl sm:text-6xl">
              An international hospitality concept.
            </Headline>
            <p className="mt-6 text-asi-navy/70 max-w-2xl leading-relaxed">
              ASI Cabins combines repeatable modular rooms inside suitable existing properties
              with automation-first operations. The prototype and pilot are in preparation.
            </p>
          </div>
        </section>
        <Section variant="paper">
          <Headline className="text-3xl sm:text-5xl">Discover ASI Cabins.</Headline>
          <p className="mt-6 max-w-2xl text-asi-navy/65">
            Explore the concept, global expansion model and strategic partnership opportunities.
          </p>
          <div className="mt-8"><PrimaryCta href="/#cabins">View the cabin concept</PrimaryCta></div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
