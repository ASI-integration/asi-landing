import type { Metadata } from 'next';
import Link from 'next/link';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { TgIcon } from '@/components/TgIcon';
import { productSupportEmail } from '@/config/contact';
import { STRIPE_PAYMENT_LINK } from '@/config/payments';
import { RU_PUBLIC_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'Location Analysis — ASI',
  description:
    'AI-powered location analysis for short-term rental properties. Understand demand patterns, competition density, and foot traffic to maximise occupancy.',
};

export default async function LocationAnalysisPage(
  props: { searchParams: Promise<{ mode?: string }> },
) {
  const searchParams = await props.searchParams;
  const mode = searchParams.mode === 'commercial' ? 'commercial' as const : 'residential' as const;
  return (
    <LocationTelemetryProvider>
      <div className="min-h-screen bg-slate-950">

        {/* ── Header ── */}
        <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <Link href="/" className="text-2xl font-bold text-white tracking-tight shrink-0">
                ASI
              </Link>
              <span className="hidden sm:block w-px h-4 bg-slate-800 shrink-0" />
              <span className="hidden sm:block text-sm text-slate-400">Location Analysis</span>
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <Link
                href="/features/communication"
                className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors"
              >
                Communication Module
              </Link>
              <span className="hidden sm:block w-px h-4 bg-slate-800 shrink-0" />
              <div className="flex items-center gap-1 text-sm">
                <span className="px-2 py-1 rounded font-semibold text-white bg-slate-800">EN</span>
                <span className="text-slate-700">|</span>
                <a href={`${RU_PUBLIC_ORIGIN}/`} className="px-2 py-1 rounded text-slate-400 hover:text-white transition-colors">RU</a>
              </div>
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-4 py-2 bg-white text-slate-900 text-sm font-semibold rounded-lg hover:bg-slate-100 transition-colors shadow-sm"
              >
                Log in
              </Link>
            </div>
          </div>
        </header>

        <main>

          {/* ── Breadcrumb + intro ── */}
          <section className="py-14 sm:py-20 px-4 sm:px-6 border-b border-slate-800/60">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-6">
                <Link href="/" className="hover:text-slate-300 transition-colors">ASI</Link>
                <span>/</span>
                <span className="text-slate-400">Location Analysis</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">
                Location Analysis
              </h1>
              <p className="text-slate-400 text-lg leading-relaxed mb-6">
                Enter any address and ASI maps the demand landscape around it — traffic magnets,
                competition density, foot-traffic profile, and an evergreen demand score.
                Used to validate new listings and benchmark existing ones.
              </p>
              <ul className="space-y-2 text-sm text-slate-400">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                  Identifies nearby demand drivers (transport hubs, attractions, business centres)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                  Maps competitor density by distance band
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                  Scores evergreen demand vs. seasonal/event-driven spikes
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                  Works for any city — powered by open data + AI enrichment
                </li>
              </ul>
            </div>
          </section>

          {/* ── Demo ── */}
          <LocationIntelligenceDemo initialMode={mode} />

          {/* ── CTA ── */}
          <section className="py-16 sm:py-20 px-4 sm:px-6 border-t border-slate-800/60">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                See all modules in action
              </h2>
              <p className="text-slate-400 mb-8">
                Location Analysis is one part of the ASI platform. Full access includes guest
                communications, pricing, operations, and more.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href={STRIPE_PAYMENT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-all shadow-lg text-base"
                >
                  Get Access — $10
                </a>
                <Link
                  href="/features/communication"
                  className="inline-flex items-center justify-center px-8 py-4 border border-slate-700 text-slate-300 font-semibold rounded-xl hover:border-slate-500 hover:text-white transition-all text-base"
                >
                  Communication Module →
                </Link>
              </div>
              <div className="mt-8 flex justify-center gap-4 flex-wrap">
                <a
                  href="https://t.me/ASI_core_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-sky-300 transition-colors"
                >
                  <TgIcon className="w-4 h-4" />
                  @ASI_core_bot
                </a>
                <a
                  href={`mailto:${productSupportEmail}`}
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                >
                  {productSupportEmail}
                </a>
              </div>
            </div>
          </section>

        </main>

        {/* ── Footer ── */}
        <footer className="py-6 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-600">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-white font-bold text-lg">ASI</Link>
              <span>© {new Date().getFullYear()}</span>
            </div>
            <div className="flex gap-5">
              <Link href="/" className="hover:text-slate-400 transition-colors">Home</Link>
              <Link href="/features/communication" className="hover:text-slate-400 transition-colors">Communication Module</Link>
              <Link href="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
            </div>
          </div>
        </footer>

      </div>
    </LocationTelemetryProvider>
  );
}
