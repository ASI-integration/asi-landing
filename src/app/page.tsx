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
import { CircleFeature } from '@/components/site/CircleFeature';
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
    'ASI Cabins: private modular rooms for two, designed for installation inside suitable existing commercial properties worldwide, supported by automation-first operations.';
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
      images: [{ url: `${url}/images/cabins/airport-hero.jpg` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${url}/images/cabins/airport-hero.jpg`],
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
          <div className="max-w-7xl mx-auto grid lg:grid-cols-[0.85fr,1.15fr] gap-12 lg:gap-12 items-center">
            <div>
              <div className="flex items-center gap-3">
                <LogoMark size={34} />
                <span className="font-serif text-2xl text-asi-navy">ASI Global</span>
              </div>
              <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                ASI Cabins · Globally scalable hospitality
              </p>
              <Headline as="h1" className="mt-8 text-4xl sm:text-6xl lg:text-[4rem]">
                Operations on autopilot.
                <br />
                <span className="text-asi-gold">Humans on exceptions.</span>
              </Headline>
              <GoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                Private modular rooms for two inside existing commercial properties. A repeatable physical product,
                supported by automation-first guest operations and designed to scale across markets.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="#intelligence">Explore ASI</PrimaryCta>
                <SecondaryCta href="#partner">Partner with ASI</SecondaryCta>
              </div>
            </div>
            <div className="relative aspect-[948/581] w-full">
              <Image
                src="/images/cabins/airport-hero.jpg"
                alt="Concept rendering: a complete ASI apple-style modular cabin inside a modern international airport terminal"
                fill
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-contain"
                priority
              />
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
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl">ASI Physical</h3>
              <p className="mt-3 text-asi-navy/70 leading-relaxed">
                Physical spaces designed to operate with minimal manual coordination.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed">
                ASI Cabins are conceived as repeatable, private modular rooms installed inside suitable existing
                buildings rather than standalone outdoor houses.
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
        <Section id="cabins" variant="paper">
          <div className="grid lg:grid-cols-[0.95fr,1.05fr] gap-12 items-center">
            <div className="relative aspect-[948/581] w-full">
              <Image
                src="/images/cabins/airport-hero.jpg"
                alt="Concept rendering of an ASI apple-style modular cabin installed inside an airport terminal"
                fill
                sizes="(min-width: 1024px) 45vw, 90vw"
                className="object-contain"
              />
            </div>
            <div>
              <Eyebrow>ASI Cabins</Eyebrow>
              <Headline className="text-3xl sm:text-5xl">
                A private room. Inside an existing building.
              </Headline>
              <p className="mt-5 text-asi-navy/70 leading-relaxed">
                A modular two-person cabin with a real bed, private shower and WC, acoustic privacy,
                ventilation and smart access. Designed to be installed inside suitable commercial
                premises, such as transit hubs, mixed-use buildings and underused urban space.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed">
                The rounded apple-cabin form is a design direction. Engineering, compliance, factory
                selection and pilot economics are in development; the image is a concept rendering.
              </p>
              <div className="mt-8 grid sm:grid-cols-2 gap-6 max-w-xl">
                <CircleFeature icon="bed" title="Two-person privacy" description="Bed, private bathroom and personal space." />
                <CircleFeature icon="gear" title="Acoustic comfort" description="ASI Silent Shell engineering concept." />
                <CircleFeature icon="chart" title="Existing square metres" description="Modular hospitality without a new hotel building." />
              </div>
              <div className="mt-8">
                <PrimaryCta href="#partner">Explore a pilot partnership</PrimaryCta>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 6. Global model ── */}
        <Section id="global" variant="ivory">
          <Eyebrow>One model. Worldwide opportunity.</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            Designed for cities everywhere.
          </Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70 leading-relaxed">
            The same cabin specification, repeatable supply chain and ASI operating layer can be
            adapted to suitable locations around the world. Each installation must meet local
            property, fire-safety, accessibility and hospitality requirements.
          </p>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            {[
              { title: 'Manufacture', text: 'Source specialist manufacturers, validate engineering and create a reproducible indoor cabin kit.' },
              { title: 'Install', text: 'Partner with property owners and developers to activate approved existing spaces.' },
              { title: 'Operate & scale', text: 'Coordinate bookings, access, cleaning and support through ASI, expanding after a proven pilot.' },
            ].map((step, i) => (
              <div key={step.title} className="border border-asi-border bg-asi-paper p-8">
                <span className="text-asi-gold-text text-xs uppercase tracking-[0.2em]">0{i + 1}</span>
                <h3 className="mt-4 font-serif text-2xl">{step.title}</h3>
                <p className="mt-4 text-sm leading-relaxed text-asi-navy/65">{step.text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 7. Strategic partner CTA ── */}
        <section id="about" className="bg-asi-paper text-asi-navy px-5 sm:px-8 py-16 sm:py-24 border-t border-asi-border">
          <div id="partner" className="max-w-3xl mx-auto text-center">
            <Eyebrow>Strategic partnerships</Eyebrow>
            <Headline as="h2" className="text-3xl sm:text-5xl">
              Build the first pilot. Scale worldwide.
            </Headline>
            <p className="mt-5 text-asi-navy/65 leading-relaxed">
              We are developing the cabin engineering, manufacturing partnerships and pilot
              financing model. We welcome property, manufacturing and investment partners
              interested in proving a repeatable international hospitality business.
            </p>
            <div className="mt-9 flex flex-wrap gap-4 justify-center">
              <PrimaryCta href="/strategic-partnerships">Explore partnership</PrimaryCta>
              <SecondaryCta href="/contacts">Contact ASI Global</SecondaryCta>
            </div>
            <p className="mt-8 text-xs text-asi-navy/55">
              Concept stage · No pilot launch or investment return is represented as completed or guaranteed.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
