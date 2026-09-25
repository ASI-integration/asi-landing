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
  const title = 'ASI Global — Operations on autopilot. Humans on exceptions.';
  const description =
    'ASI handles the daily work of physical businesses — bookings, payments, messages, access, cleaning and maintenance — automatically. People step in only when something unusual needs a decision.';
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
      images: [{ url: `${url}/images/japan/cityscape-wide.jpg` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${url}/images/japan/cityscape-wide.jpg`],
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
                Micro Hotels · Autonomous Operations
              </p>
              <Headline as="h1" className="mt-8 text-4xl sm:text-6xl lg:text-[4rem]">
                Operations on autopilot.
                <br />
                <span className="text-asi-gold">Humans on exceptions.</span>
              </Headline>
              <GoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                ASI handles most routine operations across physical businesses. People step in
                when something unusual needs a decision.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="#intelligence">Explore ASI</PrimaryCta>
                <SecondaryCta href="#partner">Partner with ASI</SecondaryCta>
              </div>
            </div>
            <div className="relative aspect-[4/5] w-full">
              <Image
                src="/images/japan/cityscape-wide.jpg"
                alt="ASI Micro Hotel unit set against the Osaka skyline"
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
                The operating intelligence behind autonomous businesses.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed">
                ASI coordinates routine work, decisions and workflows across bookings, payments,
                communication, access, cleaning, maintenance, pricing and other operational
                processes.
              </p>
            </div>
            <div id="micro-hotels" className="bg-asi-ivory p-8 sm:p-10">
              <span className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">Layer 2</span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl">ASI Physical</h3>
              <p className="mt-3 text-asi-navy/70 leading-relaxed">
                Physical spaces designed to operate with minimal manual coordination.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed">
                ASI Micro Hotels are the first physical implementation of the ASI operating model.
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
            Routine work moves automatically.
            <br />
            People handle exceptions.
          </Headline>
          <div className="mt-12 overflow-x-auto pb-2">
            <OperationalFlow dark />
          </div>
          <p className="mt-8 text-asi-ivory/60 max-w-xl leading-relaxed">
            Most routine operations continue automatically. When something unusual happens, ASI
            brings the right person in.
          </p>
        </Section>

        {/* ── 5. Micro Hotels ── */}
        <Section variant="paper">
          <div className="grid lg:grid-cols-[0.9fr,1.1fr] gap-12 items-center">
            <div className="order-2 lg:order-1 relative aspect-[4/3] w-full">
              <Image
                src="/images/japan/cabin-clean.jpg"
                alt="ASI Micro Hotel cabin exterior and interior"
                fill
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover"
              />
            </div>
            <div className="order-1 lg:order-2">
              <Eyebrow>ASI Micro Hotels</Eyebrow>
              <Headline className="text-3xl sm:text-5xl">A physical proof of autonomous hospitality.</Headline>
              <p className="mt-5 text-asi-navy/70 leading-relaxed max-w-xl">
                ASI Micro Hotels combine real private rooms with autonomous operations.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed max-w-xl">
                They are designed for underused urban spaces where conventional hospitality is
                too expensive, too slow or too operationally heavy.
              </p>
              <div className="mt-8 grid sm:grid-cols-2 gap-6 max-w-xl">
                <CircleFeature icon="bed" title="Private room for two" description="Real privacy, real comfort." />
                <CircleFeature icon="gear" title="Autonomous operations" description="Bookings, access, support, cleaning." />
                <CircleFeature icon="chart" title="Underused space, reactivated" description="Compact urban footprint." />
              </div>
              <div className="mt-8">
                <PrimaryCta href="/markets/japan">Explore Micro Hotels</PrimaryCta>
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
            In Japan, ASI begins with autonomous hospitality. In Europe, the same operating
            engine expands into industrial and field operations.
          </p>
          <p className="mt-3 max-w-3xl font-serif text-xl text-asi-navy/80">
            Different markets. Same principle: operations on autopilot, humans on exceptions.
          </p>
          <div className="mt-12 grid md:grid-cols-2 gap-6">
            <MarketCard
              country="jp"
              name="Japan — Autonomous Hospitality"
              line="ASI Micro Hotels + autonomous daily operations. Target program: Open Network Lab 32nd."
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
              We work with operators and property owners to launch the ASI operating model in new
              cities, starting with a small, provable pilot.
            </p>
            <div className="mt-9 flex flex-wrap gap-4 justify-center">
              <PrimaryCta href="/markets/japan#pilot">Partner on the Japan Pilot</PrimaryCta>
              <SecondaryCta href="#" disabledReason="International contact channel launching soon">Contact ASI Global</SecondaryCta>
            </div>
            <p className="mt-8 text-xs text-asi-ivory/60">
              International contact channel launching soon.
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
