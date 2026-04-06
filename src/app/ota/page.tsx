import Link from 'next/link';

const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/cNi5kxehp6JObmJbh47ss00';

export default function OtaPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800/60 bg-slate-950/90 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            ASI
          </Link>
          <Link href="/connect" className="text-sm text-slate-400 hover:text-white transition-colors">
            Get help connecting
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
          OTA integration
        </p>
        <h1 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Connect your OTA channels — so ASI can run the workflow end-to-end.
        </h1>
        <p className="mt-5 text-lg text-slate-300 leading-relaxed max-w-2xl">
          OTA connection means ASI can “see” where bookings come from and keep everything aligned: availability, pricing, and
          guest flows. You stay in control — ASI just removes the manual coordination.
        </p>

        <div className="mt-10 grid sm:grid-cols-3 gap-4">
          <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40">
            <h2 className="text-sm font-semibold">What “OTA connection” is</h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              A simple setup step that links your booking channels (and/or your channel manager) so the system can coordinate
              bookings as one unified flow.
            </p>
          </div>
          <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40">
            <h2 className="text-sm font-semibold">Why it matters for revenue</h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Fewer calendar mistakes, fewer missed pricing moves, and more direct bookings over time — which means less paid
              commission and higher retained revenue per stay.
            </p>
          </div>
          <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40">
            <h2 className="text-sm font-semibold">What you get</h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              A consistent operating loop: bookings in, messages handled, edge cases escalated, and your availability and
              pricing kept in sync.
            </p>
          </div>
        </div>

        <div className="mt-12 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-6 sm:p-7">
          <h2 className="text-xl font-bold">Get access</h2>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed max-w-2xl">
            Access includes guided onboarding. We’ll help connect your channel manager and OTA platforms and set up a basic
            workflow so the system is actually usable in production.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <a
              href={STRIPE_PAYMENT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-7 py-3.5 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 active:scale-[0.98] transition-all"
            >
              Get access
            </a>
            <Link
              href="/connect"
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-xl border border-slate-700 text-slate-200 hover:bg-slate-900/40 hover:border-slate-600 transition-all"
            >
              Talk to us about connecting
            </Link>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            No technical setup required on your side to start — we guide the connection.
          </p>
        </div>
      </main>
    </div>
  );
}

