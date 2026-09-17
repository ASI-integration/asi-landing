import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline } from '@/components/site/primitives';
import { MediaCard } from '@/components/site/MediaCard';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

const title = 'ASI Media';
const description = 'Watch and read ASI Global media — the Japan pitch deck, concept film, and market materials.';
const url = `${GUEST_AUTOPILOT_ORIGIN}/media`;

export const metadata: Metadata = {
  title,
  description,
  // No `languages` alternate here on purpose: this international marketing site
  // (guestautopilot.com) has no legal/contact relationship to asi-global.ru.
  alternates: { canonical: url },
  openGraph: {
    title,
    description,
    url,
    siteName: 'ASI Global',
    type: 'website',
    images: [{ url: `${GUEST_AUTOPILOT_ORIGIN}/images/japan/cabin-clean.jpg` }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [`${GUEST_AUTOPILOT_ORIGIN}/images/japan/cabin-clean.jpg`],
  },
};

export default function MediaPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />

      <main>
        <section className="px-5 sm:px-8 pt-14 sm:pt-20 pb-10">
          <div className="max-w-6xl mx-auto">
            <Eyebrow>ASI Media</Eyebrow>
            <Headline as="h1" className="text-4xl sm:text-6xl">
              ASI Media
            </Headline>
          </div>
        </section>

        <Section variant="paper">
          <div className="grid sm:grid-cols-3 gap-6">
            <MediaCard label="Deck" title="Japan Pitch Deck" action="coming-soon" />
            <MediaCard label="Film" title="Japan Concept Film" action="coming-soon" />
            <MediaCard label="Deck" title="Hong Kong Pitch Deck" action="coming-soon" />
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
