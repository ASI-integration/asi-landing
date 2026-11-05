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
  const title = 'ASI Global | Private Cabins for Every Kind of Stay — Worldwide';
  const description =
    'One simple cabin idea, many uses worldwide: affordable worker housing, private city rooms and short stays in airports and train stations. Designed for suitable existing buildings.';
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
      images: [{ url: `${url}/images/asi-cabins-airport.webp` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${url}/images/asi-cabins-airport.webp`],
    },
  };
}

const CABIN_FEATURES = [
  ['Privacy for two', 'Enclosed two-person room with a real bed and personal space.'],
  ['Private shower & WC', 'Self-contained bathroom in the proposed cabin specification.'],
  ['ASI Silent Shell', 'Acoustic shell and quiet ventilation being engineered for the prototype.'],
  ['Automation-first', 'Booking, access, guest support, cleaning and maintenance workflows.'],
] as const;

export default async function Home() {
  if (await getIsRuHost()) return <HomeRu />;

  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />
      <main>
        {/* The visual represents an INDOOR installation, not an outdoor dwelling. */}
        <section className="bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 overflow-hidden">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[0.9fr,1.1fr] gap-10 lg:gap-12 items-center">
            <div>
              <div className="flex items-center gap-3">
                <LogoMark size={34} />
                <span className="font-serif text-2xl text-asi-navy">ASI Global</span>
              </div>
              <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                ASI CABINS · BUILT FOR THE WORLD
              </p>
              <Headline as="h1" className="mt-8 text-4xl sm:text-6xl lg:text-[4rem]">
                One simple idea.
                <br />
                <span className="text-asi-gold">Many ways to stay.</span>
              </Headline>
              <GoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                Private, comfortable cabins designed for two people. Install them inside suitable
                existing buildings — in cities, near workplaces or at transport hubs.
                One idea that can grow around the world.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="#cabin-types">See our cabin family</PrimaryCta>
                <SecondaryCta href="#partner">Partner with ASI</SecondaryCta>
              </div>
            </div>
            <div>
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-asi-paper">
                <Image
                  src="/images/asi-cabins-airport.webp"
                  alt="ASI Cabins concept rendering: rounded modular private cabin with a neutral cat, installed inside an international airport terminal"
                  fill
                  sizes="(min-width: 1024px) 52vw, 90vw"
                  className="object-cover"
                  priority
                />
              </div>
              <p className="mt-2 text-xs text-asi-navy/50">
                Concept visualization · Proposed indoor deployment · Subject to engineering and site approval
              </p>
            </div>
          </div>
        </section>

        {/* Product family is intentionally visible immediately below the hero. */}
        <Section id="cabin-types" variant="paper">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Eyebrow>ASI product family</Eyebrow>
            <span className="border border-asi-gold/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-asi-gold-text">
              Designed for the world
            </span>
          </div>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">
            One idea. Many ways to stay. Worldwide.
          </Headline>
          <p className="mt-5 max-w-4xl text-lg text-asi-navy/70 leading-relaxed">
            We are developing private cabins for people who need a place to stay —
            near work, in a city, at an airport, between trains or close to university.
            The same basic idea, adapted to different needs.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
            <article id="product-workforce" key="workforce" className="flex flex-col overflow-hidden border border-asi-border bg-asi-ivory">
              <div
                role="img"
                aria-label="Concept illustration of ASI private modular cabins within dedicated worker housing beside an industrial campus in Shenzhen, China. Not an operating site."
                className="relative aspect-[15/14] w-full overflow-hidden bg-asi-paper"
                style={{
                  backgroundImage: "url('/images/cabins/ASI-Cabins-Five-Photo-Scenes.webp'), url('/images/cabins/workforce-shenzhen.svg')",
                  backgroundSize: "500% 100%, cover",
                  backgroundPosition: "0% center, center",
                  backgroundRepeat: "no-repeat, no-repeat",
                }}
              ></div>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-asi-gold-text">Live near work</p>
                <h3 className="mt-3 font-serif text-2xl leading-tight">ASI Workforce</h3>
                <p className="mt-4 font-medium leading-snug text-asi-navy">A better place to live while working away from home.</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-asi-navy/65">Affordable longer stays for people working at factories, building sites and large workplaces. Employers may help pay.</p>
                <div className="mt-5 border-t border-asi-border pt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-asi-navy/55">Shenzhen, China</span>
                  <a href="#cabins" className="text-xs font-semibold text-asi-gold-text underline underline-offset-4 hover:text-asi-navy">How it works</a>
                </div>
              </div>
            </article>
            <article id="product-urban" key="urban" className="flex flex-col overflow-hidden border border-asi-border bg-asi-ivory">
              <div
                role="img"
                aria-label="Concept illustration of an ASI modular cabin in a dedicated indoor city accommodation space in Singapore. Not an operating site."
                className="relative aspect-[15/14] w-full overflow-hidden bg-asi-paper"
                style={{
                  backgroundImage: "url('/images/cabins/ASI-Cabins-Five-Photo-Scenes.webp'), url('/images/cabins/urban-singapore.svg')",
                  backgroundSize: "500% 100%, cover",
                  backgroundPosition: "25% center, center",
                  backgroundRepeat: "no-repeat, no-repeat",
                }}
              ></div>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-asi-gold-text">Stay in the city</p>
                <h3 className="mt-3 font-serif text-2xl leading-tight">ASI Cabins Urban</h3>
                <p className="mt-4 font-medium leading-snug text-asi-navy">Your own private space in the city.</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-asi-navy/65">A comfortable room for two, with a bed, shower and toilet, inside a suitable city building.</p>
                <div className="mt-5 border-t border-asi-border pt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-asi-navy/55">Singapore</span>
                  <a href="#cabins" className="text-xs font-semibold text-asi-gold-text underline underline-offset-4 hover:text-asi-navy">How it works</a>
                </div>
              </div>
            </article>
            <article id="product-airport" key="airport" className="flex flex-col overflow-hidden border border-asi-border bg-asi-ivory">
              <div
                role="img"
                aria-label="Concept illustration of an ASI private cabin inside a designated airport rest lounge in Taipei, Taiwan. Not an operating site."
                className="relative aspect-[15/14] w-full overflow-hidden bg-asi-paper"
                style={{
                  backgroundImage: "url('/images/cabins/ASI-Cabins-Five-Photo-Scenes.webp'), url('/images/cabins/airport-taipei.svg')",
                  backgroundSize: "500% 100%, cover",
                  backgroundPosition: "50% center, center",
                  backgroundRepeat: "no-repeat, no-repeat",
                }}
              ></div>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-asi-gold-text">Rest between flights</p>
                <h3 className="mt-3 font-serif text-2xl leading-tight">ASI Transit · Airports</h3>
                <p className="mt-4 font-medium leading-snug text-asi-navy">Sleep, shower and recharge before your next flight.</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-asi-navy/65">Private cabins in a quiet rest area inside an airport, away from the busy main hall.</p>
                <div className="mt-5 border-t border-asi-border pt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-asi-navy/55">Taipei, Taiwan</span>
                  <a href="#cabins" className="text-xs font-semibold text-asi-gold-text underline underline-offset-4 hover:text-asi-navy">How it works</a>
                </div>
              </div>
            </article>
            <article id="product-rail" key="rail" className="flex flex-col overflow-hidden border border-asi-border bg-asi-ivory">
              <div
                role="img"
                aria-label="Concept illustration of an ASI private modular cabin in a dedicated rest area of a Tokyo railway station. Not an operating site."
                className="relative aspect-[15/14] w-full overflow-hidden bg-asi-paper"
                style={{
                  backgroundImage: "url('/images/cabins/ASI-Cabins-Five-Photo-Scenes.webp'), url('/images/cabins/rail-tokyo.svg')",
                  backgroundSize: "500% 100%, cover",
                  backgroundPosition: "75% center, center",
                  backgroundRepeat: "no-repeat, no-repeat",
                }}
              ></div>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-asi-gold-text">Rest between trains</p>
                <h3 className="mt-3 font-serif text-2xl leading-tight">ASI Transit · Rail</h3>
                <p className="mt-4 font-medium leading-snug text-asi-navy">A private place to rest during a long journey.</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-asi-navy/65">Cabins in a quiet station rest area for a nap, a shower or an overnight connection.</p>
                <div className="mt-5 border-t border-asi-border pt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-asi-navy/55">Tokyo, Japan</span>
                  <a href="#cabins" className="text-xs font-semibold text-asi-gold-text underline underline-offset-4 hover:text-asi-navy">How it works</a>
                </div>
              </div>
            </article>
            <article id="product-student" key="student" className="flex flex-col overflow-hidden border border-asi-border bg-asi-ivory">
              <div
                role="img"
                aria-label="Concept illustration of ASI private modular student rooms in a university residential common area in Seoul. Not an operating site."
                className="relative aspect-[15/14] w-full overflow-hidden bg-asi-paper"
                style={{
                  backgroundImage: "url('/images/cabins/ASI-Cabins-Five-Photo-Scenes.webp'), url('/images/cabins/student-seoul.svg')",
                  backgroundSize: "500% 100%, cover",
                  backgroundPosition: "100% center, center",
                  backgroundRepeat: "no-repeat, no-repeat",
                }}
              ></div>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-asi-gold-text">Stay near campus</p>
                <h3 className="mt-3 font-serif text-2xl leading-tight">ASI Student</h3>
                <p className="mt-4 font-medium leading-snug text-asi-navy">Affordable private space for student life.</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-asi-navy/65">A comfortable place to sleep, study and recharge near universities and student housing.</p>
                <div className="mt-5 border-t border-asi-border pt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-asi-navy/55">Seoul, South Korea</span>
                  <a href="#cabins" className="text-xs font-semibold text-asi-gold-text underline underline-offset-4 hover:text-asi-navy">How it works</a>
                </div>
              </div>
            </article>
          </div>
          <p className="mt-5 text-xs text-asi-navy/55 leading-relaxed">
            All images are concept illustrations, not photos of completed locations.
            City names and any corporate signage are illustrative and do not indicate operating sites or partnerships.
          </p>
          <div className="mt-12 border-y border-asi-border py-9 grid gap-7 lg:grid-cols-[1.1fr,1fr] lg:items-center">
            <div>
              <Eyebrow>And this is just the beginning</Eyebrow>
              <Headline className="text-3xl sm:text-4xl">Different countries. Same simple idea.</Headline>
              <p className="mt-4 text-asi-navy/70 leading-relaxed">
                Start with one site. Make it work well. Then bring the cabins to more cities,
                workplaces, transport hubs and campuses around the world.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 lg:justify-end">
              <PrimaryCta href="#cabins">See the cabin</PrimaryCta>
              <SecondaryCta href="#partner">Build it with ASI</SecondaryCta>
            </div>
          </div>
        </Section>

        <Section id="intelligence" variant="paper">
          <Eyebrow>One system. Two layers.</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            Modular accommodation. Intelligent operations.
          </Headline>
          <div className="mt-10 grid md:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            <div className="bg-asi-ivory p-8 sm:p-10">
              <span className="text-xs uppercase tracking-[0.18em] text-asi-gold-text">Physical product</span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl">ASI Cabins</h3>
              <p className="mt-3 text-asi-navy/70 leading-relaxed">
                Repeatable, fully enclosed private cabin modules placed inside suitable existing
                commercial properties — not standalone outdoor houses.
              </p>
            </div>
            <div className="bg-asi-ivory p-8 sm:p-10">
              <span className="text-xs uppercase tracking-[0.18em] text-asi-gold-text">Operating platform</span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl">ASI Intelligence</h3>
              <p className="mt-3 text-asi-navy/70 leading-relaxed">
                Coordinated guest communication, reservations, access, cleaning and support.
                Real automation is enabled only where integrations and operating permissions are ready.
              </p>
            </div>
          </div>
        </Section>

        <Section id="cabins" variant="ivory">
          <div className="grid lg:grid-cols-[1.1fr,0.9fr] gap-12 items-center">
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-asi-paper">
              <Image
                src="/images/asi-cabins-airport.webp"
                alt="Illustrative ASI apple-profile modular cabin inside a transit building"
                fill
                sizes="(min-width: 1024px) 45vw, 90vw"
                className="object-cover"
              />
            </div>
            <div>
              <Eyebrow>ASI Cabins</Eyebrow>
              <Headline className="text-3xl sm:text-5xl">
                A private room, not a sleeping pod.
              </Headline>
              <p className="mt-5 text-asi-navy/70 leading-relaxed">
                Our proposed compact room is designed for two guests, with a full bed, private
                shower and toilet, climate control and acoustic isolation. The distinctive rounded
                apple-cabin profile is adapted for indoor modular construction.
              </p>
              <p className="mt-4 text-sm text-asi-navy/60 leading-relaxed">
                The first prototype, assembly method, costs and performance specifications are
                under development. Installation requires local fire, planning, accessibility and
                building-services approval.
              </p>
            </div>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {CABIN_FEATURES.map(([name, description]) => (
              <div key={name} className="border border-asi-border bg-asi-paper p-6">
                <h3 className="font-serif text-xl">{name}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="platform" variant="paper">
          <Eyebrow>Operations on autopilot</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            One operating layer across the entire guest journey.
          </Headline>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              ['01', 'Demand & booking', 'Coordinate inquiries, reservations and supported sales channels.'],
              ['02', 'Arrival & access', 'Prepare and verify guest access using enabled integrations.'],
              ['03', 'Turnover & upkeep', 'Dispatch cleaning and technical tasks, with human verification where needed.'],
              ['04', 'Performance', 'Track utilization, costs and quality across a repeatable portfolio.'],
            ].map(([num, title, detail]) => (
              <div key={num} className="border-t border-asi-gold pt-5">
                <span className="text-xs uppercase tracking-[0.18em] text-asi-gold-text">{num}</span>
                <h3 className="mt-3 font-serif text-xl">{title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-asi-navy/55">
            Capabilities are phased; this is a product development plan, not a claim of completed autonomous deployment.
          </p>
        </Section>

        <Section id="global" variant="ivory">
          <Eyebrow>Designed for worldwide scale</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">
            One cabin standard. Many buildings. Any viable market.
          </Headline>
          <p className="mt-6 max-w-3xl text-lg text-asi-navy/70 leading-relaxed">
            ASI Cabins is not tied to a single city or country. The repeatable product is designed
            for suitable indoor spaces in airports, railway stations, urban commercial properties
            and other locations with verified guest demand.
          </p>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            <div className="bg-asi-paper border border-asi-border p-7">
              <h3 className="font-serif text-2xl">Manufacture</h3>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Engineer and source standardized modular cabin kits through qualified manufacturers.
              </p>
            </div>
            <div className="bg-asi-paper border border-asi-border p-7">
              <h3 className="font-serif text-2xl">Install</h3>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Work with local property partners to validate spaces, permissions and infrastructure.
              </p>
            </div>
            <div className="bg-asi-paper border border-asi-border p-7">
              <h3 className="font-serif text-2xl">Operate</h3>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Connect each location to the same evolving ASI operational platform.
              </p>
            </div>
          </div>
        </Section>

        <Section id="partner" variant="paper">
          <div id="about" className="max-w-3xl mx-auto text-center">
            <Eyebrow>Strategic partnerships</Eyebrow>
            <Headline as="h2" className="text-3xl sm:text-5xl">
              Build a new category of modular hospitality.
            </Headline>
            <p className="mt-5 text-asi-navy/70 leading-relaxed">
              ASI Cabins is currently in product engineering and manufacturing sourcing.
              We are exploring strategic partnerships for a prototype, a 3–5 cabin pilot,
              commercial property access and repeatable international deployment.
            </p>
            <p className="mt-5 text-sm text-asi-navy/55">
              Pilot economics, regulatory suitability and manufacturing quotes remain to be validated.
            </p>
            <div className="mt-9 flex justify-center">
              <SecondaryCta href="#cabins">Review the cabin concept</SecondaryCta>
            </div>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
