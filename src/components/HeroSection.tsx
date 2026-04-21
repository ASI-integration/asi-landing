import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { TgIcon } from '@/components/TgIcon';

export interface HeroContent {
  /* top-left */
  aboutLabel: string;
  aboutHeadline: string;
  aboutBody: string;
  aboutPoints: string[];
  /* top-right */
  detailsLabel: string;
  loginLabel: string;
  loginHref: string;
  /* bottom-center */
  offerHeadline: React.ReactNode;
  offerSub: React.ReactNode;
  ctaLabel: string;
  ctaHref: string;
  ctaExternal?: boolean;
  ctaSub?: string;
}

export function HeroSection({
  content,
  telegramVariant = 'handle',
  showTopRow = true,
}: {
  content: HeroContent;
  telegramVariant?: 'handle' | 'icon';
  showTopRow?: boolean;
}) {
  const {
    aboutLabel, aboutHeadline, aboutBody, aboutPoints,
    detailsLabel, loginLabel, loginHref,
    offerHeadline, offerSub, ctaLabel, ctaHref, ctaExternal = true, ctaSub,
  } = content;

  return (
    <section
      className={[
        'relative overflow-hidden bg-[var(--t-surface-2)] px-4 sm:px-6',
        showTopRow ? 'py-16 sm:py-24' : 'py-12 sm:py-16',
      ].join(' ')}
    >
      {/* Grid texture */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full opacity-[0.05]"
        style={{ background: 'radial-gradient(circle, var(--t-accent), transparent 70%)' }}
      />

      <div className="relative max-w-5xl mx-auto">

        {showTopRow && (
          <>
            {/* ── Top row: About us + Our details ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 sm:gap-16 pb-12 sm:pb-16 border-b border-[var(--t-border)]">

              {/* Top-left: About us */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--t-muted)] mb-4">
                  {aboutLabel}
                </p>
                <h2 className="text-lg sm:text-xl font-semibold text-[var(--t-text)] leading-snug mb-3">
                  {aboutHeadline}
                </h2>
                <p className="text-sm text-[var(--t-text-2)] leading-relaxed mb-5">
                  {aboutBody}
                </p>
                <ul className="space-y-1.5">
                  {aboutPoints.map((pt) => (
                    <li key={pt} className="flex items-center gap-2 text-xs text-[var(--t-muted)]">
                      <span className="w-1 h-1 rounded-full bg-[var(--t-muted)] shrink-0" aria-hidden />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Top-right: Our details */}
              <div className="sm:flex sm:flex-col sm:items-end">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--t-muted)] mb-4">
                  {detailsLabel}
                </p>
                <div className="flex flex-col items-start sm:items-end gap-3">
                  <a
                    href="https://t.me/ASI_core_bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Telegram"
                    title="Telegram"
                    className={
                      telegramVariant === 'icon'
                        ? 'inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all'
                        : 'inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all text-sm font-semibold'
                    }
                  >
                    <TgIcon className="w-4 h-4 shrink-0" />
                    {telegramVariant === 'handle' ? '@ASI_core_bot' : <span className="sr-only">Telegram</span>}
                  </a>
                  <a
                    href={`mailto:${productSupportEmail}`}
                    className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text-2)] hover:bg-[var(--t-surface-2)] transition-all text-sm"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[var(--t-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75" />
                    </svg>
                    {productSupportEmail}
                  </a>
                  <Link
                    href={loginHref}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text-2)] hover:bg-[var(--t-surface-2)] transition-all text-sm"
                  >
                    {loginLabel}
                  </Link>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Bottom center: Main offer ── */}
        <div className={[showTopRow ? 'pt-12 sm:pt-16' : 'pt-2 sm:pt-4', 'text-center max-w-3xl mx-auto'].join(' ')}>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-[var(--t-text)] tracking-tight leading-[1.05]">
            {offerHeadline}
          </h1>
          <p className="mt-6 text-xl sm:text-2xl text-[var(--t-text-2)] leading-snug">
            {offerSub}
          </p>
          <div className="mt-10 flex flex-col items-center gap-3">
            <a
              href={ctaHref}
              {...(ctaExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="inline-flex items-center justify-center px-10 py-4 bg-[var(--t-accent)] text-white font-bold rounded-xl hover:bg-[var(--t-accent-hover)] active:scale-[0.98] transition-all shadow-lg hover:scale-[1.02] text-base sm:text-lg"
            >
              {ctaLabel}
            </a>
            {ctaSub && (
              <p className="text-xs text-[var(--t-muted)]">{ctaSub}</p>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}
