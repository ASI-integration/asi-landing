import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';

/* ─── Telegram icon ─────────────────────────────────────────────────────────── */
function TgIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.595l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.964z" />
    </svg>
  );
}

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
}

export function HeroSection({ content }: { content: HeroContent }) {
  const {
    aboutLabel, aboutHeadline, aboutBody, aboutPoints,
    detailsLabel, loginLabel, loginHref,
    offerHeadline, offerSub, ctaLabel, ctaHref, ctaExternal = true,
  } = content;

  return (
    <section className="relative overflow-hidden bg-slate-900 py-16 sm:py-24 px-4 sm:px-6">
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
        style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
      />

      <div className="relative max-w-5xl mx-auto">

        {/* ── Top row: About us + Our details ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 sm:gap-16 pb-12 sm:pb-16 border-b border-slate-800/60">

          {/* Top-left: About us */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-600 mb-4">
              {aboutLabel}
            </p>
            <h2 className="text-lg sm:text-xl font-semibold text-white leading-snug mb-3">
              {aboutHeadline}
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed mb-5">
              {aboutBody}
            </p>
            <ul className="space-y-1.5">
              {aboutPoints.map((pt) => (
                <li key={pt} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-1 h-1 rounded-full bg-slate-600 shrink-0" aria-hidden />
                  {pt}
                </li>
              ))}
            </ul>
          </div>

          {/* Top-right: Our details */}
          <div className="sm:flex sm:flex-col sm:items-end">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-600 mb-4">
              {detailsLabel}
            </p>
            <div className="flex flex-col items-start sm:items-end gap-3">
              <a
                href="https://t.me/ASI_core_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all text-sm font-semibold"
              >
                <TgIcon className="w-4 h-4 shrink-0" />
                @ASI_core_bot
              </a>
              <a
                href={`mailto:${productSupportEmail}`}
                className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600 hover:text-white transition-all text-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75" />
                </svg>
                {productSupportEmail}
              </a>
              <Link
                href={loginHref}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-slate-700 text-slate-300 hover:bg-white/10 hover:border-slate-500 hover:text-white transition-all text-sm"
              >
                {loginLabel}
              </Link>
            </div>
          </div>
        </div>

        {/* ── Bottom center: Main offer ── */}
        <div className="pt-12 sm:pt-16 text-center max-w-3xl mx-auto">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.05]">
            {offerHeadline}
          </h1>
          <p className="mt-6 text-xl sm:text-2xl text-slate-200 leading-snug">
            {offerSub}
          </p>
          <div className="mt-10 flex justify-center">
            <a
              href={ctaHref}
              {...(ctaExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="inline-flex items-center justify-center px-10 py-4 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 active:scale-[0.98] transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02] text-base sm:text-lg"
            >
              {ctaLabel}
            </a>
          </div>
        </div>

      </div>
    </section>
  );
}
