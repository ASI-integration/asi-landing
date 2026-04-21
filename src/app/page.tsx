import Link from 'next/link';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { HeroSection } from '@/components/HeroSection';

import { STRIPE_PAYMENT_LINK } from '@/config/payments';
import { FaqAccordion } from '@/components/FaqAccordion';
import { productSupportEmail } from '@/config/contact';
import { TgIcon } from '@/components/TgIcon';
import { RU_PUBLIC_ORIGIN, EN_PUBLIC_ORIGIN } from '@/config/publicOrigins';
import { hostnameFromHostHeader, isRuRuntimeHost } from '@/lib/runtimeHost';
import HomeRu from '@/app/ru/page';

/* ─── Contacts ──────────────────────────────────────────────────────────────── */
function ContactLinks({ orientation = 'row' }: { orientation?: 'row' | 'col' }) {
  const cls = orientation === 'row'
    ? 'flex flex-col sm:flex-row justify-center gap-4'
    : 'flex flex-col gap-3';

  return (
    <div className={cls}>
      <a
        href="https://t.me/ASI_core_bot"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/30 text-white font-semibold text-sm hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/60 transition-all"
      >
        <TgIcon />
        @ASI_core_bot
      </a>
      <a
        href={`mailto:${productSupportEmail}`}
        className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-white font-semibold text-sm hover:bg-slate-800 hover:border-slate-600 transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75" />
        </svg>
        {productSupportEmail}
      </a>
    </div>
  );
}

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
      title: 'ASI — Полная операционная автоматизация',
      description:
        'Автоматизация операций для недвижимости и гостеприимства: коммуникации, объявления, цены, брони и исполнение — замена операционного слоя, а не очередной инструмент.',
      alternates: {
        canonical: `${RU_PUBLIC_ORIGIN}/`,
        languages: {
          'x-default': EN_PUBLIC_ORIGIN,
          en: EN_PUBLIC_ORIGIN,
          ru: `${RU_PUBLIC_ORIGIN}/`,
        },
      },
    };
  }
  return {};
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default async function Home() {
  if (await getIsRuHost()) return <HomeRu />;
  return (
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">

          {/* Brand + nav */}
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-bold text-white tracking-tight shrink-0">
              ASI
            </Link>
            <Link href="/features/location-analysis" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Location Analysis
            </Link>
            <Link href="/features/communication" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Communication
            </Link>
            <a href="#faq" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              FAQ
            </a>
          </div>

          {/* Right: contacts + Telegram + Login */}
          <div className="flex items-center gap-3 sm:gap-4">
            <a
              href={`mailto:${productSupportEmail}`}
              className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors truncate max-w-[11rem] md:max-w-none"
              title={productSupportEmail}
            >
              {productSupportEmail}
            </a>
            <span className="hidden sm:block w-px h-4 bg-slate-800 shrink-0" />
            <a
              href="https://t.me/ASI_core_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all text-sm font-semibold"
            >
              <TgIcon className="w-4 h-4 shrink-0" />
              Telegram
            </a>
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

        {/* ── Hero ── */}
        <HeroSection content={{
          aboutLabel: 'About',
          aboutHeadline: 'AI Operational System for Short-Term Rentals',
          aboutBody: 'ASI is not a dashboard or tool you manage. It replaces your ops team — handling guests, bookings, pricing, and property access automatically, around the clock.',
          aboutPoints: [
            'Not a dashboard',
            'Not a tool you manage',
            'Replaces your operational team',
          ],
          detailsLabel: 'Contact',
          loginLabel: 'Log in',
          loginHref: '/login',
          offerHeadline: <>Your rental property <span className="text-slate-300">runs itself.</span></>,
          offerSub: <>AI operational system for short-term rental owners.<br className="hidden sm:block" /> No operations, no staff — just income.</>,
          ctaLabel: 'Get access',
          ctaHref: STRIPE_PAYMENT_LINK,
          ctaSub: 'One-time payment · $10 · Instant access',
        }} />

        {/* ── Product modules ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
              Three modules
            </h2>
            <p className="text-slate-400 mb-10">
              Each covers a distinct part of operations — and works as part of one system.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">

              {/* Module 1 — Location */}
              <Link
                href="/features/location-analysis"
                className="group flex flex-col p-7 rounded-2xl border border-slate-800 bg-slate-900/60 hover:border-indigo-500/50 hover:bg-indigo-950/20 transition-all"
              >
                <div className="text-3xl mb-4">📍</div>
                <h3 className="font-bold text-white text-lg mb-2">Location Analysis</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-6 flex-1">
                  Instant demo preview: enter an address and get a fast, approximate estimate (magnets, competition density, income range).
                  Request the full report separately — deeper signals and a slower async run for dense cities.
                </p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-400 group-hover:text-indigo-300 transition-colors">
                  Open demo →
                </span>
              </Link>

              {/* Module 2 — Communication */}
              <Link
                href="/features/communication"
                className="group flex flex-col p-7 rounded-2xl border border-slate-800 bg-slate-900/60 hover:border-sky-500/50 hover:bg-sky-950/20 transition-all"
              >
                <div className="text-3xl mb-4">💬</div>
                <h3 className="font-bold text-white text-lg mb-2">Communication Module</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-6 flex-1">
                  AI handles all guest messaging end to end — instant replies, in-chat execution, escalation only for true edge cases.
                </p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-400 group-hover:text-sky-300 transition-colors">
                  Open demo →
                </span>
              </Link>

              {/* Module 3 — Full Platform */}
              <div className="flex flex-col p-7 rounded-2xl border border-indigo-500/40 bg-indigo-950/20">
                <div className="text-3xl mb-4">🔄</div>
                <h3 className="font-bold text-white text-lg mb-2">Full Platform</h3>
                <p className="text-sm text-slate-300 leading-relaxed mb-6 flex-1">
                  Operations autopilot: guest comms, bookings, pricing, access control, and task execution — no ops team required.
                </p>
                <a
                  href={STRIPE_PAYMENT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:opacity-80 transition-opacity"
                >
                  Get access — $10 →
                </a>
              </div>

            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white text-center tracking-tight">
              How the automation works
            </h2>
            <p className="mt-3 text-center text-sm text-slate-400 max-w-xl mx-auto">
              Direct answers — no marketing, no jargon.
            </p>
            <div className="mt-10">
              <FaqAccordion />
            </div>
          </div>
        </section>

        {/* ── CTA + contacts ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Put your rental on autopilot
            </h2>
            <p className="mt-4 text-slate-400 text-lg">
              Full access to ASI. One payment, no subscription.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={STRIPE_PAYMENT_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-10 py-5 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 active:scale-[0.98] transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02] text-lg"
              >
                Get Access — $10
              </a>
              <a
                href="https://t.me/ASI_core_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-10 py-5 border border-slate-600 text-slate-300 font-semibold rounded-xl hover:border-slate-400 hover:text-white transition-all text-lg"
              >
                Book a demo
              </a>
            </div>
            <p className="mt-4 text-sm text-slate-400">One-time payment · Instant access · No commitment required</p>

            <div className="mt-10 pt-8 border-t border-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 mb-5">
                Or reach out directly
              </p>
              <ContactLinks />
              <p className="mt-4 text-xs text-slate-400">
                Mon–Fri, 9:00–18:00 UTC+3 · usually faster
              </p>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer className="py-8 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <span className="text-white font-bold text-lg">ASI</span>
            <span className="text-xs text-slate-400">© {new Date().getFullYear()}</span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5 text-sm">
            <a
              href="https://t.me/ASI_core_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-slate-400 hover:text-sky-300 transition-colors"
            >
              <TgIcon className="w-4 h-4" />
              @ASI_core_bot
            </a>
            <span className="hidden sm:block w-px h-3 bg-slate-800" />
            <a
              href={`mailto:${productSupportEmail}`}
              className="text-slate-400 hover:text-white transition-colors"
            >
              {productSupportEmail}
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
            <Link href="/privacy" className="text-slate-400 hover:text-slate-200 text-xs">Privacy</Link>
            <Link href="/offer" className="text-slate-400 hover:text-slate-200 text-xs">Terms</Link>
            <Link href="/legal" className="text-slate-400 hover:text-slate-200 text-xs">Legal</Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
