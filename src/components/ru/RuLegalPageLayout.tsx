import type { ReactNode } from 'react';
import { BrandEyebrow, BrandGoldRule, BrandHeadline, BrandLogoMark } from '@/components/brand';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuTrustNav } from '@/components/ru/RuTrustNav';

const proseClass =
  [
    'space-y-6 text-asi-navy/75 text-sm sm:text-base leading-relaxed',
    '[&_h2]:font-serif [&_h2]:text-xl sm:[&_h2]:text-2xl [&_h2]:text-asi-navy [&_h2]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:pt-2',
    '[&_h3]:font-serif [&_h3]:text-lg [&_h3]:text-asi-navy [&_h3]:mt-6 [&_h3]:mb-2',
    '[&_p]:max-w-prose',
    '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ul]:max-w-prose',
    '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-2 [&_ol]:max-w-prose',
    '[&_a]:text-asi-navy [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-asi-border hover:[&_a]:decoration-asi-navy',
    '[&_strong]:text-asi-navy [&_strong]:font-semibold',
    '[&_section]:space-y-3',
  ].join(' ');

/**
 * Shared ASI editorial shell for RU compliance / trust documents.
 * No merchant identity here — pages source from `ruCompliance`.
 */
export function RuLegalPageLayout({
  title,
  intro,
  children,
  wide = false,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
  /** Slightly wider content column for payment / contacts trust surfaces. */
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen flex flex-col font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="legal" />

      <main className="flex-1 w-full px-5 sm:px-8 py-12 sm:py-16 print:px-0 print:py-0">
        <div className={`mx-auto ${wide ? 'max-w-5xl' : 'max-w-4xl'}`}>
          <div className="flex items-center gap-3 mb-6">
            <BrandLogoMark size={28} />
            <span className="font-serif text-lg text-asi-navy">ASI</span>
          </div>

          <BrandEyebrow>ASI · документы и условия</BrandEyebrow>
          <BrandHeadline as="h1" className="text-3xl sm:text-4xl lg:text-[2.75rem] max-w-3xl">
            {title}
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-6" />
          {intro ? (
            <p className="max-w-2xl text-asi-navy/65 leading-relaxed mb-8">{intro}</p>
          ) : null}

          <RuTrustNav className="mb-10" />

          <div className={wide ? 'max-w-3xl' : 'max-w-2xl'}>
            <div className={proseClass}>{children}</div>
          </div>
        </div>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </div>
  );
}
