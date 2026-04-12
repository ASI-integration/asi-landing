import Link from 'next/link';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import { HeroSection } from '@/components/HeroSection';

import { STRIPE_PAYMENT_LINK } from '@/config/payments';
import { CommDemo } from '@/components/CommDemo';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { FaqAccordion } from '@/components/FaqAccordion';
import { productSupportEmail } from '@/config/contact';
import { TgIcon } from '@/components/TgIcon';
import { RU_PUBLIC_ORIGIN } from '@/config/publicOrigins';

/* ─── Platform modules ──────────────────────────────────────────────────────── */
const MODULES = [
  {
    id: 'real-estate',
    name: 'Real Estate Autopilot',
    status: 'ACTIVE' as const,
    desc: 'Runs guest communication, operations, payments, and control end to end.',
  },
  {
    id: 'security',
    name: 'Security Autopilot',
    status: 'COMING SOON' as const,
    desc: 'Monitors events, runs access rules, and executes incident response automatically.',
  },
  {
    id: 'market',
    name: 'Market Automation',
    status: 'COMING SOON' as const,
    desc: 'Runs customer flows, transactions, and operational workflows without a separate ops desk.',
  },
];

/* ─── What gets automated (hero-adjacent) ───────────────────────────────────── */
const AUTOMATED_ITEMS = [
  {
    title: 'Guest communication',
    desc: 'AI replies instantly, 24/7 — replaces front desk and inbox coverage.',
  },
  {
    title: 'Listing management',
    desc: 'Creation, updates, and sync across channels — replaces listing admin work.',
  },
  {
    title: 'Pricing',
    desc: 'Auto-adjusts from demand signals — replaces manual rate desk work.',
  },
  {
    title: 'Booking handling',
    desc: 'Confirmations and calendar execution — replaces booking coordinator roles.',
  },
  {
    title: 'Reviews',
    desc: 'Requests and responses run on policy — replaces reputation busywork.',
  },
  {
    title: 'Issue handling',
    desc: 'AI resolves most cases to completion — replaces first-line support.',
  },
  {
    title: 'Channel sync',
    desc: 'Works with platforms; replaces channel managers and spreadsheet ops.',
  },
  {
    title: 'Financial tracking',
    desc: 'Income, performance, and forecasting roll up automatically — replaces ops reporting.',
  },
];

/* ─── Cards ─────────────────────────────────────────────────────────────────── */
const CARDS = [
  {
    icon: '📥',
    title: 'Customer communication',
    desc: 'Runs inbound guest messaging around the clock — no delays, no missed threads.',
  },
  {
    icon: '📋',
    title: 'Data collection & intake',
    desc: 'Executes qualification and data capture end to end — replaces intake staff.',
  },
  {
    icon: '🔄',
    title: 'Workflow & scheduling',
    desc: 'Access codes, cleaning, recurring tasks — the system executes and closes them automatically.',
  },
  {
    icon: '💳',
    title: 'Payments & monetization',
    desc: 'Upsells, late checkouts, add-ons — invoiced in chat, paid in one tap.',
  },
  {
    icon: '📊',
    title: 'Dynamic pricing',
    desc: 'Rates move with demand, competition, and load — without a revenue manager in the loop.',
  },
  {
    icon: '🔔',
    title: 'Rare operator handoff',
    desc: 'True edge cases route to a person with full context. Everything else executes automatically.',
  },
  {
    icon: '🔒',
    title: 'Security & access control',
    desc: 'Real-time monitoring, access control, incident detection, and automated response workflows.',
  },
];


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

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <LocationTelemetryProvider>
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">

          {/* Brand + nav */}
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-bold text-white tracking-tight shrink-0">
              ASI
            </Link>
            <a href="#platform-modules" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Platform
            </a>
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

        {/* ── Feature quick-nav ── */}
        <section className="py-5 px-4 sm:px-6 bg-slate-950 border-b border-slate-800/60">
          <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3">
            <a
              href="#scale"
              className="group flex items-center gap-3 px-5 py-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-indigo-500/40 hover:bg-indigo-950/20 transition-all"
            >
              <span className="text-2xl shrink-0">📈</span>
              <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors leading-snug">
                Works for 1 property or 100+
              </span>
            </a>
            <a
              href="#finances"
              className="group flex items-center gap-3 px-5 py-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-indigo-500/40 hover:bg-indigo-950/20 transition-all"
            >
              <span className="text-2xl shrink-0">🔄</span>
              <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors leading-snug">
                What it handles
              </span>
            </a>
            <a
              href="#faq"
              className="group flex items-center gap-3 px-5 py-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-indigo-500/40 hover:bg-indigo-950/20 transition-all"
            >
              <span className="text-2xl shrink-0">🤖</span>
              <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors leading-snug">
                How it works
              </span>
            </a>
          </div>
        </section>

        {/* ── What actually gets automated ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
              What actually gets automated
            </h2>
            <p className="text-slate-400 mb-10 text-lg">
              Not tools. Not dashboards. Operations.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {AUTOMATED_ITEMS.map((item) => (
                <div
                  key={item.title}
                  className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all"
                >
                  <h3 className="font-semibold text-white text-sm leading-snug">{item.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Positioning ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-900/40 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-8">
              Not another tool
            </h2>
            <ul className="space-y-3 text-slate-400 text-base leading-relaxed">
              <li>
                <span className="text-slate-500" aria-hidden>❌ </span>
                Channel managers → still need manual control
              </li>
              <li>
                <span className="text-slate-500" aria-hidden>❌ </span>
                CRMs → still need operators
              </li>
              <li>
                <span className="text-slate-500" aria-hidden>❌ </span>
                “Automation” point products → partial coverage
              </li>
              <li className="pt-2 text-slate-200 font-medium">
                <span className="text-emerald-500/90" aria-hidden>✅ </span>
                ASI → runs operations end to end, replacing the ops team entirely
              </li>
            </ul>
          </div>
        </section>

        {/* ── Scale ── */}
        <section id="scale" className="scroll-mt-20 py-16 sm:py-20 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
              Built for any scale
            </h2>
            <ul className="space-y-2 text-slate-400 text-base leading-relaxed">
              <li>1 apartment → fully automated</li>
              <li>10 units → no staff needed</li>
              <li>100+ units → centralized AI control</li>
            </ul>
            <p className="mt-8 text-xs text-slate-600 text-center sm:text-left">
              Used in real estate, hospitality, corporate housing, and distributed operations.
            </p>
          </div>
        </section>

        {/* ── Location demo ── */}
        <div id="location-demo">
          <LocationIntelligenceDemo />
        </div>

        {/* ── Communication demo ── */}
        <CommDemo />

        {/* ── What the platform does ── */}
        <section id="finances" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-900/40 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
              What it handles
            </h2>
            <p className="text-slate-500 mb-10">
              Everything that used to sit with an ops team — the system runs it automatically.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CARDS.map((card) => (
                <div
                  key={card.title}
                  className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all"
                >
                  <span className="text-2xl" aria-hidden>{card.icon}</span>
                  <h3 className="mt-3 font-semibold text-white text-sm leading-snug">{card.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Platform modules ── */}
        <section id="platform-modules" className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
              Platform modules
            </h2>
            <p className="text-slate-500 mb-10">
              Autonomous systems on one infrastructure — each runs its domain.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
              {MODULES.filter((m) => m.status === 'ACTIVE').map((mod) => (
                <div
                  key={mod.id}
                  className="p-6 rounded-xl border border-indigo-500/50 bg-indigo-950/30 hover:border-indigo-400/70 hover:bg-indigo-950/40 transition-all"
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <h3 className="font-semibold text-sm leading-snug text-white">
                      {mod.name}
                    </h3>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {mod.status}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-300">
                    {mod.desc}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-slate-600">
              Security Autopilot and Market Automation — in development.
            </p>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white text-center tracking-tight">
              How the automation works
            </h2>
            <p className="mt-3 text-center text-sm text-slate-500 max-w-xl mx-auto">
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
            <p className="mt-4 text-sm text-slate-600">One-time payment · Instant access · No commitment required</p>

            {/* Contacts below CTA */}
            <div className="mt-10 pt-8 border-t border-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 mb-5">
                Or reach out directly
              </p>
              <ContactLinks />
              <p className="mt-4 text-xs text-slate-600">
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
            <span className="text-xs text-slate-600">© {new Date().getFullYear()}</span>
          </div>

          {/* Contacts in footer */}
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
            <Link href="/privacy" className="text-slate-600 hover:text-slate-400 text-xs">Privacy</Link>
            <Link href="/offer" className="text-slate-600 hover:text-slate-400 text-xs">Terms</Link>
            <Link href="/legal" className="text-slate-600 hover:text-slate-400 text-xs">Legal</Link>
          </div>
        </div>
      </footer>

    </div>
    </LocationTelemetryProvider>
  );
}
