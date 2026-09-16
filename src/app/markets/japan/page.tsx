import type { Metadata } from 'next';
import Image from 'next/image';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, GoldRule, PrimaryCta, SecondaryCta } from '@/components/site/primitives';
import { LogoMark } from '@/components/site/LogoMark';
import { Shiro } from '@/components/site/Shiro';
import { CircleFeature } from '@/components/site/CircleFeature';
import { MediaCard } from '@/components/site/MediaCard';
import { OperationalFlow } from '@/components/site/OperationalFlow';
import { productSupportEmail } from '@/config/contact';
import { EN_PUBLIC_ORIGIN } from '@/config/publicOrigins';

const title = 'ASI Japan — Micro Hotels, from Osaka to the next generation';
const description =
  'ASI Japan brings autonomous operations to micro-hospitality, respecting the birthplace of capsule hospitality while building real private rooms for modern travelers.';
const url = `${EN_PUBLIC_ORIGIN}/markets/japan`;

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
    images: [{ url: `${EN_PUBLIC_ORIGIN}/images/japan/cabin-clean.jpg` }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [`${EN_PUBLIC_ORIGIN}/images/japan/cabin-clean.jpg`],
  },
};

const OPERATIONS = ['Booking', 'Payment', 'Guest communication', 'Digital access', 'Cleaning coordination', 'Maintenance', 'Pricing', 'Exceptions'];

export default function JapanMarketPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />

      <main>
        {/* ── Hero ── */}
        <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.05fr,0.95fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-3">
                <LogoMark size={32} />
                <span className="font-serif text-xl text-asi-navy">ASI Global</span>
              </div>
              <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                Micro Hotels · Autonomous Operations
              </p>
              <Headline as="h1" className="mt-7 text-4xl sm:text-6xl">
                From Osaka, 1979 —<br />
                <span className="text-asi-gold">to the next generation of micro-hospitality</span>
              </Headline>
              <p className="mt-5 font-serif italic text-xl sm:text-2xl text-asi-navy/70">
                Operations on autopilot. Humans on exceptions.
              </p>
              <p lang="ja" className="mt-6 font-jp text-lg text-asi-gold tracking-wide" style={{ textShadow: '0 0 18px rgba(166,129,60,0.35)' }}>
                ルーティンはASIへ。
              </p>
              <GoldRule className="mt-6 mb-6" />
              <p className="text-asi-navy/70 max-w-lg leading-relaxed">
                A real private room for two, designed for today&apos;s cities.
              </p>
              <p className="mt-3 text-sm text-asi-navy/65 max-w-lg leading-relaxed">
                Respecting the birthplace of capsule hospitality while reimagining private urban
                stays for modern travelers.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="#pilot">Partner on the Japan Pilot</PrimaryCta>
                <SecondaryCta href="#media">Japan Pitch Deck</SecondaryCta>
              </div>
              <div className="mt-12 flex items-center gap-3">
                <GoldRule className="w-8" />
                <span className="text-xs font-sans uppercase tracking-[0.18em] text-asi-navy/65">
                  People × Places × Possibilities
                </span>
              </div>
            </div>
            <div className="relative aspect-[4/5] w-full">
              <Image
                src="/images/japan/cabin-clean.jpg"
                alt="ASI Micro Hotel cabin, Osaka"
                fill
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover"
                priority
              />
              <div className="absolute bottom-4 right-4">
                <Shiro country="jp" size={80} />
              </div>
            </div>
          </div>
        </section>

        {/* ── Osaka heritage ── */}
        <Section variant="paper">
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div>
              <Eyebrow>Heritage</Eyebrow>
              <Headline className="text-2xl sm:text-4xl">Osaka, 1979.</Headline>
            </div>
            <p className="text-asi-navy/70 leading-relaxed">
              Capsule hospitality emerged in Osaka in 1979. ASI respects that history while
              moving the format toward real privacy, two-person rooms, modern comfort and
              autonomous operations.
            </p>
          </div>
        </Section>

        {/* ── The problem ── */}
        <Section variant="ivory">
          <Eyebrow>The problem</Eyebrow>
          <Headline className="text-2xl sm:text-4xl max-w-2xl">
            Cities need more capacity. Building more is not always the answer.
          </Headline>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {['Expensive urban space', 'Underused commercial floor area', 'Heavy operational labour', 'Need for compact private accommodation'].map((p) => (
              <div key={p} className="border-l-2 border-asi-gold pl-4 py-1 text-sm text-asi-navy/70 leading-relaxed">
                {p}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Micro Hotel ── */}
        <Section variant="paper">
          <div className="grid lg:grid-cols-[0.9fr,1.1fr] gap-12 items-center">
            <div className="relative aspect-[4/3] w-full">
              <Image
                src="/images/japan/cityscape-wide.jpg"
                alt="ASI Micro Hotel unit against the Osaka skyline"
                fill
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover"
              />
            </div>
            <div>
              <Eyebrow>Micro Hotel</Eyebrow>
              <Headline className="text-2xl sm:text-4xl">A real private room, built for the city.</Headline>
              <div className="mt-8 grid sm:grid-cols-2 gap-6 max-w-xl">
                <CircleFeature icon="bed" title="Private room for two" description="Real privacy. Real comfort." />
                <CircleFeature icon="gear" title="Autonomous operations" description="Bookings, access, support, cleaning, optimization." />
                <CircleFeature icon="chart" title="Underused space, reactivated" description="Turning empty square meters into brighter city stays." />
              </div>
            </div>
          </div>
        </Section>

        {/* ── Autonomous operations ── */}
        <Section variant="navy">
          <Eyebrow dark>Autonomous operations</Eyebrow>
          <Headline className="text-2xl sm:text-4xl max-w-2xl text-asi-ivory">
            Operations on autopilot. Humans on exceptions.
          </Headline>
          <div className="mt-10 flex flex-wrap gap-3">
            {OPERATIONS.map((op) => (
              <span key={op} className="px-3.5 py-2 text-sm font-sans text-asi-ivory/80 border border-asi-ivory/25 rounded-sm">
                {op}
              </span>
            ))}
          </div>
          <div className="mt-10 overflow-x-auto pb-2">
            <OperationalFlow dark />
          </div>
        </Section>

        {/* ── Pilot ── */}
        <Section id="pilot" variant="ivory">
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div>
              <Eyebrow>Pilot</Eyebrow>
              <Headline className="text-2xl sm:text-4xl">Start small. Prove the model.</Headline>
              <p className="mt-4 text-asi-navy/70 leading-relaxed">3–5 cabins.</p>
            </div>
            <div>
              <p className="text-asi-navy/70 leading-relaxed">
                A limited first deployment allows ASI and its partners to validate space, guest
                demand, operations and economics.
              </p>
              <div className="mt-6">
                <PrimaryCta href={`mailto:${productSupportEmail}`}>Partner on the Japan Pilot</PrimaryCta>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Media ── */}
        <Section id="media" variant="paper">
          <Eyebrow>Media</Eyebrow>
          <Headline className="text-2xl sm:text-4xl">Japan Media</Headline>
          <div className="mt-10 grid sm:grid-cols-2 gap-6 max-w-2xl">
            <MediaCard label="Deck" title="Japan Pitch Deck" action="view" href="/media#japan-deck" />
            <MediaCard label="Film" title="Japan Concept Film" action="coming-soon" />
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
