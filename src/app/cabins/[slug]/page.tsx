import type { Metadata } from 'next';
import Image, { type StaticImageData } from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import workforceSheet from '@/assets/cabins/details/workforce.png';
import urbanSheet from '@/assets/cabins/details/urban.png';
import transitAirSheet from '@/assets/cabins/details/transit-air.png';
import transitRailSheet from '@/assets/cabins/details/transit-rail.png';
import cabinsComfort from '@/assets/cabins/cabins-comfort.webp';
import cabinsFormatStrip from '@/assets/cabins/asi-cabins-five-photo-scenes.webp';

import { CABIN_PRODUCTS, getCabinProduct } from '@/config/cabinProducts';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Eyebrow, Headline, PrimaryCta, SecondaryCta, Section } from '@/components/site/primitives';

const DETAIL_SHEETS: Partial<Record<(typeof CABIN_PRODUCTS)[number]['slug'], StaticImageData>> = {
  workforce: workforceSheet,
  urban: urbanSheet,
  'transit-air': transitAirSheet,
  'transit-rail': transitRailSheet,
};

const CAMPUS_SPRITE_POSITION = '100% top';

export function generateStaticParams() {
  return CABIN_PRODUCTS.map((product) => ({ slug: product.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const product = getCabinProduct(params.slug);
  if (!product) return {};

  const url = `${GUEST_AUTOPILOT_ORIGIN}/cabins/${product.slug}`;
  return {
    title: `${product.name} — ASI Global`,
    description: product.intro,
    alternates: { canonical: url },
    openGraph: {
      title: `${product.name} — ASI Global`,
      description: product.intro,
      url,
      siteName: 'ASI Global',
      type: 'website',
    },
  };
}

export default function CabinDetailPage({ params }: { params: { slug: string } }) {
  const product = getCabinProduct(params.slug);
  if (!product) notFound();

  const sheet = DETAIL_SHEETS[product.slug];

  return (
    <div className="bg-asi-ivory text-asi-navy font-sans">
      <SiteHeader />
      <main>
        <section className="px-5 sm:px-8 pt-10 sm:pt-14 pb-10 border-b border-asi-border">
          <div className="max-w-6xl mx-auto">
            <Link href="/cabins#formats" className="text-sm text-asi-navy/60 hover:text-asi-navy">
              ← All ASI Cabins formats
            </Link>
            <div className="mt-8 grid lg:grid-cols-[0.9fr,1.1fr] gap-10 lg:gap-16 items-end">
              <div>
                <Eyebrow>{product.label}</Eyebrow>
                <p className="font-serif text-5xl text-asi-gold-text">{product.number}</p>
                <Headline as="h1" className="mt-4 text-4xl sm:text-6xl">{product.name}</Headline>
              </div>
              <p className="text-lg sm:text-xl leading-relaxed text-asi-navy/72 max-w-2xl">{product.intro}</p>
            </div>
          </div>
        </section>

        <Section variant="paper">
          <Eyebrow>See the cabin</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-4xl">Exterior, bed, bathroom and everyday interior space.</Headline>
          <p className="mt-5 max-w-3xl text-asi-navy/65 leading-relaxed">
            The images below are concept visuals showing the intended experience and design direction. They are not photographs of an operating ASI property.
          </p>

          {sheet ? (
            <div className="mt-10 border border-asi-border bg-asi-ivory p-2 sm:p-4">
              <Image
                src={sheet}
                alt={`${product.name} concept gallery showing exterior views, bed, bathroom and interior workspace`}
                className="w-full h-auto"
                priority
                sizes="(min-width: 1280px) 1120px, 94vw"
              />
            </div>
          ) : (
            <div className="mt-10 grid lg:grid-cols-[0.9fr,1.1fr] gap-5">
              <div
                role="img"
                aria-label="ASI Campus exterior concept near a student setting"
                className="min-h-[320px] lg:min-h-[520px] border border-asi-border bg-no-repeat bg-asi-ivory"
                style={{
                  backgroundImage: `url(${cabinsFormatStrip.src})`,
                  backgroundSize: '500% auto',
                  backgroundPosition: CAMPUS_SPRITE_POSITION,
                }}
              />
              <div className="relative min-h-[320px] lg:min-h-[520px] border border-asi-border overflow-hidden bg-asi-ivory">
                <Image
                  src={cabinsComfort}
                  alt="ASI Campus interior concept with a real bed and warm private-room design"
                  fill
                  sizes="(min-width:1024px) 55vw, 94vw"
                  className="object-cover"
                />
              </div>
            </div>
          )}
        </Section>

        <Section variant="ivory">
          <Eyebrow>At a glance</Eyebrow>
          <div className="grid lg:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            <article className="bg-asi-paper p-7 sm:p-8">
              <h2 className="font-serif text-2xl">Best for</h2>
              <p className="mt-4 text-asi-navy/70 leading-relaxed">{product.bestFor}</p>
            </article>
            <article className="bg-asi-paper p-7 sm:p-8">
              <h2 className="font-serif text-2xl">Typical stay</h2>
              <p className="mt-4 text-asi-navy/70 leading-relaxed">{product.stayPattern}</p>
            </article>
            <article className="bg-asi-paper p-7 sm:p-8">
              <h2 className="font-serif text-2xl">Why this format exists</h2>
              <p className="mt-4 text-asi-navy/70 leading-relaxed">{product.whyItExists}</p>
            </article>
          </div>
        </Section>

        <Section variant="paper">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16">
            <div>
              <Eyebrow>Planned room experience</Eyebrow>
              <Headline className="text-3xl sm:text-5xl">Small footprint. Real privacy.</Headline>
              <div className="mt-9 grid gap-4">
                {product.features.map((feature, index) => (
                  <div key={feature} className="flex gap-4 border-t border-asi-border pt-4">
                    <span className="font-serif text-2xl text-asi-gold-text">{String(index + 1).padStart(2, '0')}</span>
                    <p className="pt-1 text-asi-navy/75">{feature}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Eyebrow>ASI operations</Eyebrow>
              <Headline className="text-3xl sm:text-5xl">The room is only half the product.</Headline>
              <p className="mt-6 text-asi-navy/70 leading-relaxed">
                ASI is intended to coordinate the operating work around each stay so locations can run with fewer repetitive manual tasks while people handle exceptions.
              </p>
              <div className="mt-9 grid gap-4">
                {product.operations.map((operation, index) => (
                  <div key={operation} className="flex gap-4 border-t border-asi-border pt-4">
                    <span className="font-serif text-2xl text-asi-gold-text">{String(index + 1).padStart(2, '0')}</span>
                    <p className="pt-1 text-asi-navy/75">{operation}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section variant="navy">
          <Eyebrow dark>Development status</Eyebrow>
          <Headline className="text-3xl sm:text-5xl text-asi-ivory max-w-4xl">A product concept being prepared for real-world piloting.</Headline>
          <p className="mt-6 max-w-3xl text-asi-ivory/70 leading-relaxed">
            Final dimensions, engineering, materials, equipment, accessibility, utilities and operating procedures will depend on the pilot site, manufacturing partner and local regulations.
          </p>
          <div className="mt-9 flex flex-wrap gap-4">
            <PrimaryCta href="/cabins#formats">Compare all five formats</PrimaryCta>
            <SecondaryCta href="mailto:project.ayfaar@gmail.com?subject=ASI%20Cabins%20partnership">Discuss a pilot</SecondaryCta>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
