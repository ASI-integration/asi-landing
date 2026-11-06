import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import type { Metadata } from 'next';

import { RU_PUBLIC_ORIGIN, EN_PUBLIC_ORIGIN, GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';
import { hostnameFromHostHeader, isRuRuntimeHost } from '@/lib/runtimeHost';
import HomeRu from '@/app/ru/page';
import { RU_HOME_METADATA } from '@/config/ruHomeMetadata';

import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, GoldRule, PrimaryCta, SecondaryCta } from '@/components/site/primitives';
import { LogoMark } from '@/components/site/LogoMark';
import { Shiro } from '@/components/site/Shiro';
import { CircleFeature } from '@/components/site/CircleFeature';
import { MarketCard } from '@/components/site/MarketCard';
import { MediaCard } from '@/components/site/MediaCard';
import { OperationalFlow } from '@/components/site/OperationalFlow';

/* ─── Host detection helper ─────────────────────────────────────────────────── */
async function getIsRuHost(): Promise<boolean> {
  const h = await headers();
  const raw = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  return isRuRuntimeHost(hostnameFromHostHeader(raw));
}

/* ─── Metadata (RU or EN based on host) ─────────────────────────────────────── */
export async function generateMetadata(): Promise<Metadata> {
  if (await getIsRuHost()) {
    return {
      ...RU_HOME_METADATA,
      alternates: {
        canonical: `${RU_PUBLIC_ORIGIN}/`,
        languages: {
          'x-default': EN_PUBLIC_ORIGIN,
          en: EN_PUBLIC_ORIGIN,
          ru: `${RU_PUBLIC_ORIGIN}/`,
        },
      },
      other: {
        'zen-verification': 'PEA1UbOl0f6rAz61ami1mJm9Y0lsCe5fzUcnTOqIAuWSi37Ohv2YqdbovfJkCW7',
      },
    };
  }
  const title = 'ASI Global — ASI Cabins. One idea. Five formats. Worldwide.';
  const description =
    'ASI Cabins is a modular private-room concept for existing buildings: workforce, urban, airport, rail and student stays, coordinated through the ASI operating platform. Development and pilot preparation are underway.';
  const url = GUEST_AUTOPILOT_ORIGIN;
  return {
    title,
    description,
    // No `languages` alternate here on purpose: this international marketing site
    // (guestautopilot.com) has no legal/contact relationship to asi-global.ru and must
    // not advertise it as an hreflang alternate.
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'ASI Global',
      type: 'website',
      images: [{ url: `${url}/images/japan/cabin-clean.jpg` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${url}/images/japan/cabin-clean.jpg`],
    },
  };
}

const CATEGORIES = [
  { name: 'Hotels', items: ['Bookings', 'Guest communication', 'Access', 'Cleaning'] },
  { name: 'Residential', items: ['Tenants', 'Payments', 'Maintenance', 'Access'] },
  { name: 'Commercial Property', items: ['Tenants', 'Billing', 'Service requests', 'Operations'] },
  { name: 'Service Business', items: ['Customers', 'Scheduling', 'Payments', 'Tasks'] },
] as const;

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default async function Home() {
  if (await getIsRuHost()) return <HomeRu />;

  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />

      <main>
        {/* ── 1. Hero ── */}
        <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 overflow-hidden">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.05fr,0.95fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-3">
                <LogoMark size={34} />
                <span className="font-serif text-2xl text-asi-navy">ASI Global</span>
              </div>
              <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                Modular Spaces · Smart Operations
              </p>
              <Headline as="h1" className="mt-8 text-4xl sm:text-6xl lg:text-[4rem]">
                ASI Cabins.
                <br />
                <span className="text-asi-gold">One idea. Five formats. Worldwide.</span>
              </Headline>
              <GoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                Comfortable private modular rooms designed to fit inside suitable existing buildings.
                Five accommodation formats, one brand, and intelligent operations through the ASI platform.
                Currently in development and preparing a first pilot.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="/cabins">Explore ASI Cabins</PrimaryCta>
                <SecondaryCta href="/cabins#partners">Partner with ASI Cabins</SecondaryCta>
              </div>
            </div>
            <div className="relative aspect-[4/5] w-full">
              <Image
                src="/images/japan/cabin-clean.jpg"
                alt="Concept illustration of an ASI Cabins private modular room"
                fill
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover"
                priority
              />
              <div className="absolute bottom-4 right-4">
                <Shiro size={80} />
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Two layers ── */}
        <Section id="intelligence" variant="paper">
          <Eyebrow>One system. Two layers.</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">One system. Two layers.</Headline>
          <div className="mt-12 grid md:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            <div className="bg-asi-ivory p-8 sm:p-10">
              <span className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">Layer 1</span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl">ASI Intelligence</h3>
              <p className="mt-3 text-asi-navy/70 leading-relaxed">
                The operating intelligence for automation-first physical businesses.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed">
                ASI coordinates workflows and decision support across bookings, payments,
                communication, access, cleaning, maintenance, pricing and other operational
                processes, with automation enabled where the required integration is available.
              </p>
            </div>
            <div id="micro-hotels" className="bg-asi-ivory p-8 sm:p-10">
              <span className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">Layer 2</span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl">ASI Cabins</h3>
              <p className="mt-3 text-asi-navy/70 leading-relaxed">
                Physical spaces designed to operate with minimal manual coordination.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed">
                ASI Cabins is a planned family of private modular rooms for workforce, urban, transit and student accommodation.
              </p>
            </div>
          </div>
        </Section>

        {/* ── 3. Where ASI works ── */}
        <Section variant="ivory">
          <Eyebrow>Where ASI works</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">Built for physical businesses.</Headline>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CATEGORIES.map((cat) => (
              <div key={cat.name} className="border border-asi-border bg-asi-paper p-6">
                <h3 className="font-serif text-lg">{cat.name}</h3>
                <ul className="mt-4 space-y-2">
                  {cat.items.map((item) => (
                    <li key={item} className="text-sm text-asi-navy/65 border-t border-asi-border/70 pt-2 first:border-t-0 first:pt-0">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 4. How ASI works ── */}
        <Section variant="navy">
          <Eyebrow dark>How ASI works</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Supported routine work moves automatically.
            <br />
            People handle exceptions.
          </Headline>
          <div className="mt-12 overflow-x-auto pb-2">
            <OperationalFlow dark />
          </div>
          <p className="mt-8 text-asi-ivory/60 max-w-xl leading-relaxed">
            Within enabled workflows, routine steps can continue automatically. When policy, data, or an
            integration cannot safely complete a step, ASI brings the right person in.
          </p>
        </Section>

        {/* ── 5. ASI Cabins ── */}
        <Section variant="paper">
          <div className="grid lg:grid-cols-[0.9fr,1.1fr] gap-12 items-center">
            <div className="order-2 lg:order-1 relative aspect-[4/3] w-full">
              <Image
                src="/images/japan/cabin-clean.jpg"
                alt="Concept illustration of an ASI Cabins modular room"
                fill
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover"
              />
            </div>
            <div className="order-1 lg:order-2">
              <Eyebrow>ASI Cabins · Five planned formats</Eyebrow>
              <Headline className="text-3xl sm:text-5xl">Private rooms. Five ways to stay.</Headline>
              <p className="mt-5 text-asi-navy/70 leading-relaxed max-w-xl">
                ASI Cabins combines the comfort of a private room for two, including its own shower and toilet,
                with a unified approach to booking, guest care and operations.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed max-w-xl">
                The five proposed formats are ASI Workforce, ASI Cabins Urban, ASI Transit Air,
                ASI Transit Rail and ASI Student. Built for suitable existing buildings, not standalone tiny houses.
                These are concepts, not operating locations.
              </p>
              <div className="mt-8 grid sm:grid-cols-2 gap-6 max-w-xl">
                <CircleFeature icon="bed" title="Privacy and comfort" description="Private bed, shower and toilet." />
                <CircleFeature icon="gear" title="Six connected functions" description="Bookings, guest AI, pricing, access, cleaning and analytics." />
                <CircleFeature icon="chart" title="Pilot in preparation" description="A proposed first site with 3–5 cabins." />
              </div>
              <div className="mt-8">
                <PrimaryCta href="/cabins">Discover all five formats</PrimaryCta>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 6. Global expansion ── */}
        <Section id="markets" variant="ivory">
          <Eyebrow>Global expansion</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            One engine. Different real-world operations.
          </Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70 leading-relaxed">
            ASI Cabins is designed for suitable sites worldwide, adapted to local building rules,
            infrastructure and partners. The operating platform can also support other physical businesses.
          </p>
          <p className="mt-3 max-w-3xl font-serif text-xl text-asi-navy/80">
            Different markets. Same principle: operations on autopilot, humans on exceptions.
          </p>

          <div className="mt-12">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
              Active tracks
            </p>
            <div className="mt-5 grid md:grid-cols-2 gap-6">
              <MarketCard
                country="jp"
                name="Japan — Autonomous Hospitality"
                line="Proposed ASI Cabins and integrated guest operations. Exploring a small pilot and local partners; no operating site yet."
                href="/markets/japan"
                status="active"
              />
              <MarketCard
                country="nl"
                name="Netherlands / Europe — Industrial Operations"
                line="Construction, field work, contractors and SLAs. Target program: LANDCROS Innovation Studios Europe Challenge 2026."
                href="/markets/netherlands"
                status="active"
              />
            </div>
          </div>

          <div className="mt-12 pt-10 border-t border-asi-border">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-navy/55">
              Coming next
            </p>
            <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <MarketCard country="hk" name="Hong Kong" line="Dense urban cores, compact private stays." status="coming-next" />
              <MarketCard country="tw" name="Taiwan" line="Urban infill hospitality for modern travelers." status="coming-next" />
              <MarketCard country="sg" name="Singapore" line="Premium micro-stays for a global hub." status="coming-next" />
              <MarketCard country="kr" name="Korea" line="Compact urban hospitality, autonomously run." status="coming-next" />
              <MarketCard country="ae" name="UAE" line="Autonomous hospitality for a fast-growing market." status="coming-next" />
            </div>
          </div>

          <div className="mt-8">
            <SecondaryCta href="/markets">Explore all markets</SecondaryCta>
          </div>
        </Section>

        {/* ── 7. Media ── */}
        <Section variant="paper">
          <Eyebrow>ASI Media</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-2xl">ASI Media</Headline>
          <div className="mt-12 grid sm:grid-cols-3 gap-6">
            <MediaCard label="Deck" title="Japan Pitch Deck" action="coming-soon" />
            <MediaCard label="Film" title="Japan Concept Film" action="coming-soon" />
            <MediaCard label="Deck" title="Europe Industrial Deck" action="coming-soon" />
          </div>
          <div className="mt-10">
            <SecondaryCta href="/media">View Media</SecondaryCta>
          </div>
        </Section>

        {/* ── About / Partner CTA ── */}
        <section id="about" className="bg-asi-navy text-asi-ivory px-5 sm:px-8 py-16 sm:py-24">
          <div id="partner" className="max-w-3xl mx-auto text-center">
            <Eyebrow dark>Partner with ASI</Eyebrow>
            <Headline as="h2" className="text-3xl sm:text-5xl text-asi-ivory">
              Bring ASI to your market.
            </Headline>
            <p className="mt-5 text-asi-ivory/65 leading-relaxed">
              We are seeking property owners, manufacturers and investors for an initial ASI Cabins pilot.
              Our first priority is proven comfort, safe operation and viable economics before expansion.
            </p>
            <div className="mt-9 flex flex-wrap gap-4 justify-center">
              <PrimaryCta href="/cabins#partners">Explore Cabins partnership</PrimaryCta>
              <SecondaryCta href="mailto:project.ayfaar@gmail.com?subject=ASI%20Global%20partnership">Contact ASI Global</SecondaryCta>
            </div>
            <p className="mt-8 text-xs text-asi-ivory/60">
              ASI Cabins is in development. Concept imagery is illustrative; pilot location and timelines are not yet confirmed.
            </p>
            <p className="mt-3 text-xs text-asi-ivory/60">
              Looking for the short-term rental automation product?{' '}
              <Link href="/rental-autopilot" className="underline hover:text-asi-ivory/70">
                Rental Autopilot →
              </Link>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
