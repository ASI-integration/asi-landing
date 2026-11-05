import Image from 'next/image';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline } from '@/components/site/primitives';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'ASI Cabins — Concept',
  description: 'Explore the ASI Cabins indoor modular hospitality concept, designed for worldwide deployment.',
  alternates: { canonical: `${GUEST_AUTOPILOT_ORIGIN}/media` },
};

export default function MediaPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />
      <main>
        <Section variant="ivory">
          <Eyebrow>ASI Cabins concept</Eyebrow>
          <Headline as="h1" className="text-4xl sm:text-6xl max-w-3xl">
            Designed for spaces that already exist.
          </Headline>
          <p className="mt-5 text-asi-navy/70 max-w-3xl leading-relaxed">
            Private modular cabins proposed for indoor installation in suitable commercial buildings.
            A repeatable physical product backed by an automation-first operating system.
          </p>
          <div className="mt-10 relative aspect-[16/10] w-full max-w-4xl overflow-hidden">
            <Image
              src="/images/asi-cabins-airport.webp"
              alt="ASI Cabins illustrative indoor airport deployment"
              fill
              sizes="(min-width: 1024px) 70vw, 90vw"
              className="object-cover"
            />
          </div>
          <p className="mt-3 text-xs text-asi-navy/50">Illustrative concept render — not a completed installation.</p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
