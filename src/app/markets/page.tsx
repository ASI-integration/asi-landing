import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, GoldRule } from '@/components/site/primitives';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'Global Expansion — ASI Cabins',
  description: 'ASI Cabins: one modular cabin standard and an operating platform designed for suitable indoor locations worldwide.',
  alternates: { canonical: `${GUEST_AUTOPILOT_ORIGIN}/markets` },
};

export default function MarketsPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />
      <main>
        <Section variant="ivory">
          <Eyebrow>Designed for worldwide scale</Eyebrow>
          <Headline as="h1" className="text-4xl sm:text-6xl max-w-4xl">
            One cabin standard. <span className="text-asi-gold">Any viable market.</span>
          </Headline>
          <GoldRule className="mt-8 mb-6" />
          <p className="text-lg text-asi-navy/70 max-w-3xl leading-relaxed">
            ASI Cabins is designed for suitable commercial properties worldwide: airports, railway
            stations, transport hubs and urban buildings. Market entry follows actual demand,
            local building approvals, unit economics and trusted partners — not a fixed country list.
          </p>
          <div className="mt-10">
            <Link href="/#global" className="inline-flex border border-asi-navy px-6 py-3 text-sm hover:bg-asi-paper">
              Explore our global model
            </Link>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
