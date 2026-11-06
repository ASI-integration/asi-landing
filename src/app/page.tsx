import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import type { Metadata } from 'next';

import cabinsHero from '@/assets/cabins/cabins-hero.webp';
import cabinsWorkforce from '@/assets/cabins/cabins-workforce.webp';
import cabinsUrban from '@/assets/cabins/cabins-urban.webp';
import cabinsStudent from '@/assets/cabins/cabins-student.webp';
import cabinsAir from '@/assets/cabins/cabins-air.webp';
import cabinsRail from '@/assets/cabins/cabins-rail.webp';

import { RU_PUBLIC_ORIGIN, EN_PUBLIC_ORIGIN, GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';
import { hostnameFromHostHeader, isRuRuntimeHost } from '@/lib/runtimeHost';
import HomeRu from '@/app/ru/page';
import { RU_HOME_METADATA } from '@/config/ruHomeMetadata';

import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline, GoldRule, PrimaryCta, SecondaryCta } from '@/components/site/primitives';
import { LogoMark } from '@/components/site/LogoMark';
import { Shiro } from '@/components/site/Shiro';

async function getIsRuHost(): Promise<boolean> {
  const h = await headers();
  const raw = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  return isRuRuntimeHost(hostnameFromHostHeader(raw));
}

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

  const title = 'ASI Global — ASI Cabins. One idea. Many formats. Worldwide.';
  const description =
    'ASI Cabins is a worldwide modular private-room concept for suitable existing buildings, with five accommodation formats and one ASI operating platform.';
  const url = GUEST_AUTOPILOT_ORIGIN;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'ASI Global',
      type: 'website',
      images: [{ url: `${url}${cabinsHero.src}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${url}${cabinsHero.src}`],
    },
  };
}

const FORMATS = [
  {
    number: '01',
    name: 'ASI Workforce',
    label: 'Workers',
    image: cabinsWorkforce,
    alt: 'ASI Workforce concept for workers near industrial and logistics sites',
    body: 'Private accommodation close to work for longer stays near factories, logistics centers and construction projects.',
  },
  {
    number: '02',
    name: 'ASI Cabins Urban',
    label: 'City stays',
    image: cabinsUrban,
    alt: 'ASI Cabins Urban private modular room concept in a city setting',
    body: 'A private, comfortable room in a useful city location for short and medium stays.',
  },
  {
    number: '03',
    name: 'ASI Transit Air',
    label: 'Airports',
    image: cabinsAir,
    alt: 'ASI Transit Air private cabin concept inside an airport environment',
    body: 'A quiet place to sleep, shower and reset between flights — private rather than an open sleeping pod.',
  },
  {
    number: '04',
    name: 'ASI Transit Rail',
    label: 'Rail',
    image: cabinsRail,
    alt: 'ASI Transit Rail private cabin concept near railway platforms',
    body: 'A peaceful private room between trains, designed for suitable station and transport-hub spaces.',
  },
  {
    number: '05',
    name: 'ASI Student',
    label: 'Students',
    image: cabinsStudent,
    alt: 'ASI Student private modular room concept near a campus',
    body: 'A calm personal space near study and campus life, designed for living, studying and resting.',
  },
] as const;

const SYSTEM = [
  ['01', 'Bookings & channels', 'Reservations and availability across connected locations.'],
  ['02', 'AI guest communication', 'Fast multilingual answers before, during and after a stay, with people handling exceptions.'],
  ['03', 'Intelligent dynamic pricing', 'Rates can respond to demand, season and occupancy where the required data and integrations are available.'],
  ['04', 'Guest access', 'Digital entry through supported local access systems.'],
  ['05', 'Cleaning & maintenance', 'Coordinate turnovers, servicing and operational tasks.'],
  ['06', 'Network analytics', 'Track occupancy, costs, revenue and service quality across the network.'],
] as const;

const PARTNERS = [
  ['Property owners & developers', 'Suitable indoor space, infrastructure and local permissions.'],
  ['Manufacturers', 'Engineering, prototypes, quality assurance and repeatable production.'],
  ['Investors', 'Funding for the first pilot and evidence-led growth.'],
  ['ASI Global', 'Concept, brand and the central operating software platform.'],
] as const;

export default async function Home() {
  if (await getIsRuHost()) return <HomeRu />;

  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />

      <main>
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
                <span className="text-asi-gold">One idea. Many formats. Worldwide.</span>
              </Headline>
              <GoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                Comfortable private modular rooms designed for installation inside suitable existing buildings.
                One repeatable concept, five accommodation formats, and one ASI operating platform.
              </p>
              <p className="mt-4 text-sm text-asi-navy/55 max-w-xl leading-relaxed">
                ASI Cabins is in development and first-pilot preparation. Concept images show the intended product,
                not operating ASI locations.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="#formats">See the five formats</PrimaryCta>
                <SecondaryCta href="#partners">Build it with ASI</SecondaryCta>
              </div>
            </div>

            <div>
              <div className="relative aspect-[4/5] w-full border border-asi-border bg-asi-paper overflow-hidden">
                <Image
                  src={cabinsHero}
                  alt="ASI Cabins concept illustration from the English presentation"
                  fill
                  sizes="(min-width: 1024px) 40vw, 90vw"
                  className="object-cover"
                  priority
                />
                <div className="absolute bottom-4 right-4">
                  <Shiro size={80} />
                </div>
              </div>
              <p className="mt-3 text-xs text-asi-navy/50">Concept illustration · ASI Cabins in development</p>
            </div>
          </div>
        </section>

        <Section id="concept" variant="paper">
          <Eyebrow>The concept</Eyebrow>
          <div className="grid lg:grid-cols-[0.95fr,1.05fr] gap-10 lg:gap-16">
            <Headline className="text-3xl sm:text-5xl">
              Not a hostel pod.
              <br />
              Not a tiny house.
              <br />
              Your own room.
            </Headline>
            <div>
              <p className="text-lg text-asi-navy/75 leading-relaxed">
                ASI Cabins is being developed as a repeatable private-room product for suitable existing buildings,
                floors and prepared indoor structures.
              </p>
              <div className="mt-7 grid sm:grid-cols-2 gap-5">
                <div className="border-t border-asi-border pt-5">
                  <h3 className="font-serif text-xl">Private space for two</h3>
                  <p className="mt-2 text-sm text-asi-navy/65">A proper bed and a room of your own.</p>
                </div>
                <div className="border-t border-asi-border pt-5">
                  <h3 className="font-serif text-xl">Private shower & toilet</h3>
                  <p className="mt-2 text-sm text-asi-navy/65">No shared bathroom queues.</p>
                </div>
                <div className="border-t border-asi-border pt-5">
                  <h3 className="font-serif text-xl">Quiet by design</h3>
                  <p className="mt-2 text-sm text-asi-navy/65">ASI Silent Shell acoustic design is in development.</p>
                </div>
                <div className="border-t border-asi-border pt-5">
                  <h3 className="font-serif text-xl">Simple digital access</h3>
                  <p className="mt-2 text-sm text-asi-navy/65">Digital entry where approved local integrations are available.</p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section id="formats" variant="ivory">
          <Eyebrow>The product family</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">One brand. Five ways to stay.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70 leading-relaxed">
            The same basic private-room idea can serve different people and places without changing the core ASI brand.
          </p>

          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FORMATS.map((item) => (
              <Link
                key={item.number}
                href="/cabins#formats"
                className="group border border-asi-border bg-asi-paper overflow-hidden flex flex-col h-full hover:border-asi-gold transition-colors"
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-asi-ivory">
                  <Image
                    src={item.image}
                    alt={item.alt}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.01]"
                  />
                </div>
                <div className="p-7 sm:p-8 flex-1">
                  <div className="flex justify-between gap-4 items-start">
                    <span className="font-serif text-4xl text-asi-gold-text">{item.number}</span>
                    <span className="text-[0.7rem] tracking-[0.14em] uppercase text-asi-navy/50">{item.label}</span>
                  </div>
                  <h3 className="mt-6 font-serif text-2xl">{item.name}</h3>
                  <p className="mt-3 text-sm text-asi-navy/70 leading-relaxed">{item.body}</p>
                  <p className="mt-5 text-sm font-semibold text-asi-navy">See the cabin →</p>
                </div>
              </Link>
            ))}

            <div className="border border-asi-border bg-asi-paper p-8 flex flex-col justify-center">
              <p className="text-xs uppercase font-semibold tracking-[0.18em] text-asi-gold-text">The common idea</p>
              <h3 className="mt-4 font-serif text-3xl">
                Private space.
                <br />
                One brand.
                <br />
                Intelligent operations.
              </h3>
              <p className="mt-4 text-sm text-asi-navy/65">Different uses, one ASI network.</p>
              <div className="mt-7">
                <SecondaryCta href="/cabins">Explore ASI Cabins</SecondaryCta>
              </div>
            </div>
          </div>
        </Section>

        <Section id="how-it-works" variant="paper">
          <Eyebrow>How a site comes together</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">Find the space. Install the cabins. Connect to ASI.</Headline>
          <div className="mt-12 grid md:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            {[
              ['01', 'Find the space', 'A suitable building, floor or specially prepared indoor structure.'],
              ['02', 'Install the cabins', 'Standardized private rooms with the utilities and services the location requires.'],
              ['03', 'Connect to ASI', 'Coordinate bookings, guest access, cleaning, support and daily operations.'],
            ].map(([number, title, body]) => (
              <div key={number} className="bg-asi-ivory p-8 sm:p-10">
                <p className="font-serif text-4xl text-asi-gold-text">{number}</p>
                <h3 className="mt-4 font-serif text-2xl">{title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-7 text-sm text-asi-navy/55 max-w-3xl">
            Every real site must meet local requirements for property use, fire safety, accessibility, water,
            sewage and electricity.
          </p>
        </Section>

        <Section id="platform" variant="navy">
          <Eyebrow dark>ASI operating platform</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl text-asi-ivory">
            One intelligent system for the whole network.
          </Headline>
          <p className="mt-6 max-w-3xl text-asi-ivory/70 text-lg leading-relaxed">
            ASI is designed to coordinate much more than a booking calendar. The goal is one operating layer
            across the guest journey and daily site work.
          </p>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            {SYSTEM.map(([number, name, body]) => (
              <div key={number} className="bg-asi-navy p-7 sm:p-8">
                <p className="font-serif text-3xl text-asi-gold-soft">{number}</p>
                <h3 className="mt-4 font-serif text-2xl text-asi-ivory">{name}</h3>
                <p className="mt-3 text-sm text-asi-ivory/65 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-asi-ivory/55 max-w-3xl">
            Functions roll out in stages. Automation depends on integrations, testing and local operating requirements.
          </p>
        </Section>

        <Section id="pilot" variant="ivory">
          <Eyebrow>Development path</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">Trust before maximum profit.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70 leading-relaxed">
            The first priority is a product people are comfortable using, a repeatable installation process and real unit economics.
          </p>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            <div className="border-l-2 border-asi-gold pl-6 py-2">
              <p className="font-serif text-4xl">0–6 <span className="font-sans text-xs uppercase text-asi-navy/50">months</span></p>
              <h3 className="mt-4 font-semibold">Prove the idea</h3>
              <p className="mt-2 text-sm text-asi-navy/65">Prototype, engineering, testing, first pilot and real manufacturing costs.</p>
            </div>
            <div className="border-l-2 border-asi-gold pl-6 py-2">
              <p className="font-serif text-4xl">6–12 <span className="font-sans text-xs uppercase text-asi-navy/50">months</span></p>
              <h3 className="mt-4 font-semibold">Earn trust</h3>
              <p className="mt-2 text-sm text-asi-navy/65">Comfort, cleanliness, reviews, fair pricing and returning guests.</p>
            </div>
            <div className="border-l-2 border-asi-gold pl-6 py-2">
              <p className="font-serif text-4xl">12–24 <span className="font-sans text-xs uppercase text-asi-navy/50">months</span></p>
              <h3 className="mt-4 font-semibold">Grow carefully</h3>
              <p className="mt-2 text-sm text-asi-navy/65">Add sites and partners only after quality and economics are validated.</p>
            </div>
          </div>

          <div className="mt-12 border border-asi-border bg-asi-paper p-8 sm:p-10">
            <p className="text-xs uppercase font-semibold tracking-[0.18em] text-asi-gold-text">Where the project is today</p>
            <h3 className="mt-4 font-serif text-3xl">Development and first-pilot preparation.</h3>
            <p className="mt-4 text-asi-navy/70 leading-relaxed max-w-3xl">
              Product formats and privacy requirements are defined at concept level. ASI is looking for suitable properties,
              engineering and manufacturing partners, and funding for a proposed 3–5 cabin pilot. No operating ASI Cabins
              location or proven financial performance is being claimed.
            </p>
          </div>
        </Section>

        <Section id="partners" variant="paper">
          <Eyebrow>Partnership</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">The right partner brings more than capital.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70 leading-relaxed">
            A strong pilot brings together the property, manufacturing, funding and the ASI operating platform.
            Partnership structures are discussed individually.
          </p>

          <div className="mt-12 grid md:grid-cols-2 gap-5">
            {PARTNERS.map(([name, body]) => (
              <article key={name} className="border border-asi-border bg-asi-ivory p-8">
                <h3 className="font-serif text-2xl">{name}</h3>
                <p className="mt-3 text-asi-navy/70 leading-relaxed">{body}</p>
              </article>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-4">
            <PrimaryCta href="mailto:project.ayfaar@gmail.com?subject=ASI%20Cabins%20partnership">
              Build it with ASI
            </PrimaryCta>
            <SecondaryCta href="/cabins">See full ASI Cabins concept</SecondaryCta>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
