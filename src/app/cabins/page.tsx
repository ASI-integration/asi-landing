import type { Metadata } from 'next';
import Image from 'next/image';
import cabinsHero from '@/assets/cabins/cabins-hero.webp';
import cabinsFormatStrip from '@/assets/cabins/asi-cabins-five-photo-scenes.webp';
import cabinsComfort from '@/assets/cabins/cabins-comfort.webp';

import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Eyebrow, Headline, Section, PrimaryCta, SecondaryCta, GoldRule } from '@/components/site/primitives';

export const metadata: Metadata = {
  title: 'ASI Cabins — Private modular rooms. Intelligent global operations.',
  description:
    'Five planned ASI Cabins formats for workers, city stays, airports, railway stations and students. Private rooms inside suitable existing buildings, supported by a unified ASI operating platform.',
  alternates: { canonical: 'https://www.guestautopilot.com/cabins' },
  openGraph: {
    title: 'ASI Cabins — One idea. Five formats. Worldwide.',
    description: 'A modular accommodation concept and the ASI operating platform. Now in development and pilot preparation.',
    url: 'https://www.guestautopilot.com/cabins',
    siteName: 'ASI Global',
    type: 'website',
  },
};

const FORMATS = [
  {
    number: '01',
    name: 'ASI Workforce',
    spritePosition: 0,
    imageAlt: 'ASI Workforce concept outside a manufacturing and logistics building',
    label: 'Workers',
    description: 'Practical, private accommodation close to factories, logistics centers and construction projects.',
    detail: 'Designed for longer stays, with potential employer contribution and location-specific pricing.',
  },
  {
    number: '02',
    name: 'ASI Cabins Urban',
    spritePosition: 25,
    imageAlt: 'ASI Cabins Urban concept with private modular rooms in a city',
    label: 'City stays',
    description: 'A private and comfortable room in a well-connected city location.',
    detail: 'An alternative for people who value quiet, privacy and an accessible city address.',
  },
  {
    number: '03',
    name: 'ASI Transit Air',
    spritePosition: 50,
    imageAlt: 'ASI Transit Air concept cabins inside an airport terminal',
    label: 'Airports',
    description: 'A quiet place to sleep and shower between flights.',
    detail: 'For transit passengers who need genuine privacy rather than an open sleeping pod.',
  },
  {
    number: '04',
    name: 'ASI Transit Rail',
    spritePosition: 75,
    imageAlt: 'ASI Transit Rail concept cabins near railway platforms',
    label: 'Railway stations',
    description: 'A peaceful private space between trains.',
    detail: 'A proposed station-based format, subject to local permissions and facilities.',
  },
  {
    number: '05',
    name: 'ASI Student',
    spritePosition: 100,
    imageAlt: 'ASI Student concept with private rooms near campus',
    label: 'Students',
    description: 'A calm personal space near campus for living, studying and resting.',
    detail: 'A housing format adapted to student needs and local accommodation standards.',
  },
] as const;

const FEATURES = [
  { name: 'One proper bed for two', body: 'A private room, not a shared hostel bunk.' },
  { name: 'Private shower and toilet', body: 'No shared bathrooms or queues.' },
  { name: 'Privacy and quiet', body: 'ASI Silent Shell acoustic design is being developed.' },
  { name: 'Fresh air and comfort', body: 'Planned ventilation and climate control.' },
  { name: 'Simple access', body: 'Digital entry where approved local integrations are available.' },
] as const;

const SYSTEM = [
  { number: '01', name: 'Bookings & channels', body: 'Coordinate reservations and availability across connected locations.' },
  { number: '02', name: 'AI guest communication', body: 'Multilingual answers before, during and after the stay, with human handling for exceptions.' },
  { number: '03', name: 'Intelligent dynamic pricing', body: 'Price recommendations using demand, seasonality and occupancy.' },
  { number: '04', name: 'Guest access', body: 'Digital entry through supported local access systems.' },
  { number: '05', name: 'Cleaning & maintenance', body: 'Coordinate turnovers, servicing and operational tasks.' },
  { number: '06', name: 'Network analytics', body: 'Measure occupancy, costs, revenue and service quality across locations.' },
] as const;

const TIMELINE = [
  { period: '0–6', unit: 'months', title: 'Prove the idea', body: 'Prototype, engineering, testing, a first pilot site and real manufacturing cost data.' },
  { period: '6–12', unit: 'months', title: 'Earn trust', body: 'Comfort, cleanliness, reviews, fair prices and returning guests.' },
  { period: '12–24', unit: 'months', title: 'Grow carefully', body: 'Expand only after operations, quality and unit economics are validated.' },
] as const;

const PARTNERS = [
  { name: 'Property owners & developers', body: 'Suitable indoor space, infrastructure and local permits.' },
  { name: 'Manufacturers', body: 'Engineering, prototypes, quality assurance and repeatable production.' },
  { name: 'Investors', body: 'Pilot funding and responsible, evidence-led expansion.' },
  { name: 'ASI Global', body: 'Concept, brand and the central operating software platform.' },
] as const;

export default function CabinsPage() {
  return (
    <div className="bg-asi-ivory text-asi-navy font-sans">
      <SiteHeader />
      <main>
        <section className="relative bg-asi-ivory text-asi-navy px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.05fr,0.95fr] gap-12 lg:gap-16 items-center">
            <div>
              <Eyebrow>Modular spaces · Smart operations</Eyebrow>
              <p className="text-sm font-semibold tracking-[0.2em] uppercase text-asi-gold-text">ASI Global presents</p>
              <Headline as="h1" className="mt-6 text-4xl sm:text-6xl lg:text-[4rem] text-asi-navy">
                ASI Cabins.
                <span className="block text-asi-gold mt-3">One idea. Many formats. Worldwide.</span>
              </Headline>
              <GoldRule className="mt-6 mb-6" />
              <p className="mt-7 text-lg leading-relaxed text-asi-navy/75 max-w-xl">
                Comfortable private modular rooms, designed for installation inside suitable existing buildings.
                One international concept, operated through the ASI platform.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-asi-navy/60 max-w-xl">
                In development and first-pilot preparation. Images are concept illustrations, not operating ASI locations.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="#formats">Explore all five formats</PrimaryCta>
                <SecondaryCta href="#partners">Become a partner</SecondaryCta>
              </div>
            </div>
            <div>
              <div className="relative aspect-[4/5] overflow-hidden border border-asi-border bg-asi-paper">
                <Image src={cabinsHero} alt="ASI Cabins architectural concept illustration from the English presentation" fill priority sizes="(min-width:1024px) 40vw, 90vw" className="object-cover" />
              </div>
              <p className="mt-3 text-xs text-asi-navy/50">Original presentation visual · Concept, not an operating ASI property</p>
            </div>
          </div>
        </section>

        <Section variant="paper">
          <Eyebrow>The concept</Eyebrow>
          <div className="grid lg:grid-cols-[1fr,1fr] gap-10">
            <Headline className="text-3xl sm:text-5xl">Not a hostel pod.<br />Not a tiny house.<br />Your own room.</Headline>
            <div>
              <p className="text-lg leading-relaxed text-asi-navy/75">
                ASI Cabins is being developed as a repeatable private-room product for suitable existing buildings,
                floors and specially prepared indoor structures.
              </p>
              <p className="mt-5 text-asi-navy/70 leading-relaxed">
                The ambition is to bring genuine personal space, comfort and everyday services to more places,
                without having to build a conventional hotel from the ground up.
              </p>
              <p className="mt-5 text-sm text-asi-navy/55">
                Every site must comply with local property, fire-safety, accessibility, water, sewage and electricity requirements.
              </p>
            </div>
          </div>
          <div className="mt-12 grid md:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            {[
              ['01', 'Find the space', 'Identify an appropriate building, floor or indoor structure.'],
              ['02', 'Install the cabins', 'Fit standardized private rooms with the necessary services.'],
              ['03', 'Connect to ASI', 'Coordinate booking, access, cleaning, support and operations.'],
            ].map(([n, title, body]) => (
              <div key={n} className="bg-asi-ivory p-8">
                <p className="font-serif text-4xl text-asi-gold-text">{n}</p>
                <h3 className="font-serif text-2xl mt-4">{title}</h3>
                <p className="text-sm text-asi-navy/65 leading-relaxed mt-3">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="formats" variant="ivory">
          <Eyebrow>The product family</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">One brand. Five ways to stay.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70">
            One fundamental product, adapted for different people, locations and lengths of stay.
            The formats below are proposed concepts, not launched locations.
          </p>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 justify-items-center">
            {FORMATS.map((item) => (
              <article key={item.number} className="w-full max-w-[300px] border border-asi-border bg-asi-paper overflow-hidden flex flex-col h-full">
                <div
                  role="img"
                  aria-label={item.imageAlt}
                  className="aspect-[4/3] w-full bg-asi-ivory bg-no-repeat"
                  style={{
                    backgroundImage: `url(${cabinsFormatStrip.src})`,
                    backgroundSize: '500% auto',
                    backgroundPosition: `${item.spritePosition}% top`,
                  }}
                />
                <div className="p-6 sm:p-7 flex flex-col flex-1">
                <div className="flex justify-between items-start gap-3">
                  <span className="font-serif text-4xl text-asi-gold-text">{item.number}</span>
                  <span className="text-[0.7rem] tracking-[0.14em] uppercase text-asi-navy/50">{item.label}</span>
                </div>
                <h3 className="mt-5 font-serif text-2xl">{item.name}</h3>
                <p className="mt-3 text-asi-navy/80 leading-relaxed">{item.description}</p>
                <p className="mt-3 text-sm text-asi-navy/60 leading-relaxed">{item.detail}</p>
                </div>
              </article>
            ))}
            <div className="w-full max-w-[300px] bg-asi-paper border border-asi-border p-7 flex flex-col justify-center h-full">
              <p className="text-xs uppercase font-semibold tracking-[0.2em] text-asi-gold-text">The unifying idea</p>
              <h3 className="font-serif text-3xl mt-4">Private space.<br />A consistent brand.<br />Intelligent operations.</h3>
              <p className="mt-4 text-sm text-asi-navy/65">Different formats, one ASI network.</p>
            </div>
          </div>
        </Section>

        <Section variant="paper">
          <Eyebrow>Comfort by design</Eyebrow>
          <div className="grid lg:grid-cols-[1fr,1fr] gap-12 items-center">
            <div className="relative aspect-[5/3] lg:aspect-[4/3] border border-asi-border overflow-hidden bg-asi-ivory">
              <Image
                src={cabinsComfort}
                alt="Private ASI Cabins room concept from the English presentation, with warm interior lighting"
                fill
                sizes="(min-width: 1024px) 42vw, 90vw"
                className="object-cover"
              />
            </div>
            <div>
              <Headline className="text-3xl sm:text-5xl max-w-3xl">Compact should still feel comfortable.</Headline>
              <p className="mt-6 text-asi-navy/70 leading-relaxed">
                The ASI Cabins design puts comfort and privacy first, with carefully planned
                amenities rather than shared sleeping pods.
              </p>
              <p className="mt-3 text-xs text-asi-navy/50">Original illustration from the English presentation.</p>
            </div>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.name} className="border-t border-asi-border pt-6 pr-4">
                <h3 className="font-serif text-2xl">{f.name}</h3>
                <p className="mt-3 text-asi-navy/65 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="platform" variant="paper">
          <Eyebrow>ASI operating platform</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">One intelligent system for the entire global network.</Headline>
          <p className="mt-6 max-w-3xl text-asi-navy/70 text-lg leading-relaxed">
            More than a booking calendar: ASI is designed to coordinate the guest journey and operating cycle across locations.
            Functions are introduced in stages and depend on local integrations, testing and operational policy.
          </p>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            {SYSTEM.map((item) => (
              <div key={item.number} className="bg-asi-ivory p-7 sm:p-8">
                <p className="font-serif text-3xl text-asi-gold-text">{item.number}</p>
                <h3 className="font-serif text-2xl text-asi-navy mt-4">{item.name}</h3>
                <p className="mt-3 leading-relaxed text-asi-navy/65 text-sm">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section variant="ivory">
          <Eyebrow>Growth philosophy</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">First 24 months: trust before maximum profit.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70">
            Our early focus is quality, brand recognition, fair pricing and proven unit economics, not maximizing short-term margins.
          </p>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            {TIMELINE.map((step) => (
              <div key={step.period} className="border-l-2 border-asi-gold pl-6 py-2">
                <p className="font-serif text-5xl">{step.period}<span className="ml-2 font-sans uppercase text-xs text-asi-navy/50">{step.unit}</span></p>
                <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                <p className="mt-3 text-asi-navy/70 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-9 text-sm text-asi-navy/60">
            Planning framework only. Not a guarantee of launch timing, returns or expansion.
          </p>
        </Section>

        <Section variant="paper">
          <Eyebrow>Current stage</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">Developing the concept. Preparing the first pilot.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70">
            Product formats and privacy requirements have been outlined. We are researching appropriate properties,
            engineering and production partners worldwide, and funding for a proposed 3–5 cabin pilot.
            No operational site or financial performance is being claimed.
          </p>
        </Section>

        <Section id="partners" variant="ivory">
          <Eyebrow>Partnership</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">The right partner brings more than capital.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/70">A strong pilot can unite the property owner, manufacturer, investor and ASI. Pilot partnerships, joint ventures or equity participation may be discussed individually.</p>
          <div className="mt-12 grid md:grid-cols-2 gap-5">
            {PARTNERS.map((p) => (
              <article key={p.name} className="bg-asi-paper border border-asi-border p-8">
                <h3 className="font-serif text-2xl">{p.name}</h3>
                <p className="mt-3 text-asi-navy/70 leading-relaxed">{p.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-5">
            <PrimaryCta href="mailto:project.ayfaar@gmail.com?subject=ASI%20Cabins%20partnership">Discuss an ASI Cabins partnership</PrimaryCta>
            <span className="text-sm text-asi-navy/60">project.ayfaar@gmail.com</span>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
