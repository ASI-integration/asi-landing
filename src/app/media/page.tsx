import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Section, Eyebrow, Headline } from '@/components/site/primitives';
import { MediaCard } from '@/components/site/MediaCard';

export const metadata: Metadata = {
  title: 'ASI Media',
  description: 'Watch and read ASI Global media — the Japan pitch deck, concept film, and market materials.',
};

// Set this once the approved Japan pitch deck asset (PDF or slide embed URL) is uploaded.
const JAPAN_DECK_EMBED_URL: string | null = null;

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
            <MediaCard label="Deck" title="Japan Pitch Deck" action="view" href="#japan-deck" />
            <MediaCard label="Film" title="Japan Concept Film" action="coming-soon" />
            <MediaCard label="Deck" title="Hong Kong Pitch Deck" action="coming-soon" />
          </div>
        </Section>

        <Section id="japan-deck" variant="ivory">
          <Eyebrow>Now viewing</Eyebrow>
          <Headline className="text-2xl sm:text-4xl">Japan Pitch Deck</Headline>
          <div className="mt-8 border border-asi-border bg-asi-paper aspect-[16/9] max-w-4xl flex items-center justify-center">
            {JAPAN_DECK_EMBED_URL ? (
              <iframe
                src={JAPAN_DECK_EMBED_URL}
                title="Japan Pitch Deck"
                className="w-full h-full"
                allowFullScreen
              />
            ) : (
              <p className="text-sm text-asi-navy/50 px-8 text-center">
                The approved Japan pitch deck asset has not been uploaded yet. This viewer will
                display it in place once it is available.
              </p>
            )}
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
