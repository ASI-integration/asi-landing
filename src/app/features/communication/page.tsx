import type { Metadata } from 'next';
import Link from 'next/link';
import { CommDemo } from '@/components/CommDemo';
import { TgIcon } from '@/components/TgIcon';
import { productSupportEmail } from '@/config/contact';
import { STRIPE_PAYMENT_LINK } from '@/config/payments';
import { RU_PUBLIC_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'Communication Module — ASI',
  description:
    'AI-powered guest communication for short-term rentals. Instant replies, 24/7 coverage, automatic escalation to a human only when genuinely needed.',
};

export default function CommunicationModulePage() {
  return (
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-bold text-white tracking-tight shrink-0">
              ASI
            </Link>
            <span className="hidden sm:block w-px h-4 bg-slate-800 shrink-0" />
            <span className="hidden sm:block text-sm text-slate-400">Communication Module</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/features/location-analysis"
              className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors"
            >
              Location Analysis
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
              <span className="text-slate-400">Communication Module</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">
              Communication Module
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed mb-6">
              ASI handles all guest messaging end to end — check-in questions, issue reports,
              late-checkout requests, upsells. Instant replies, any hour. A human is looped in
              only for genuine edge cases, with full context already prepared.
            </p>
            <ul className="space-y-2 text-sm text-slate-400">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                Responds instantly — no queue, no delay, no missed messages
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                Handles the full conversation lifecycle, not just the first reply
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                Executes in-chat: upsells, payments, access codes, task dispatch
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                Routes true edge cases to an operator with full context — nothing falls through
              </li>
            </ul>
          </div>
        </section>

        {/* ── Demo ── */}
        <CommDemo />

        {/* ── How it works detail ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-900/40 border-t border-slate-800/60">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-8">How it processes each message</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {[
                {
                  step: '1',
                  title: 'Classify & route',
                  desc: 'Every inbound message is classified by intent, urgency, and category in milliseconds.',
                },
                {
                  step: '2',
                  title: 'Execute or compose',
                  desc: 'Routine requests are executed automatically. Complex or sensitive cases get a composed AI reply.',
                },
                {
                  step: '3',
                  title: 'Escalate if needed',
                  desc: 'True edge cases — disputes, emergencies, unclear context — route to an operator with the full thread.',
                },
              ].map(({ step, title, desc }) => (
                <div key={step} className="p-6 rounded-xl border border-slate-800 bg-slate-900/60">
                  <div className="text-3xl font-bold text-slate-700 mb-3">{step}</div>
                  <h3 className="font-semibold text-white text-sm mb-2">{title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 border-t border-slate-800/60">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Ready to hand off guest communications?
            </h2>
            <p className="text-slate-400 mb-8">
              Full access to the Communication Module and all other ASI capabilities.
              One payment, instant setup.
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
              <a
                href="https://t.me/ASI_core_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-slate-700 text-slate-300 font-semibold rounded-xl hover:border-slate-500 hover:text-white transition-all text-base"
              >
                <TgIcon className="w-5 h-5" />
                Book a demo
              </a>
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
            <Link href="/features/location-analysis" className="hover:text-slate-400 transition-colors">Location Analysis</Link>
            <Link href="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
