import { STRIPE_PAYMENT_LINK } from '@/config/payments';

export default function ReportPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hero */}
      <section className="relative overflow-hidden bg-slate-900 py-16 sm:py-20 px-4 sm:px-6 border-b border-slate-800/60">
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        <div
          className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-[0.06]"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
        />

        <div className="relative max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
            AI-powered location analysis for short-term rentals
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
            Stop guessing. See exactly how much your property can earn.
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-2xl leading-relaxed font-medium">
            Get a fast, clear answer before you buy. A bad location choice can cost you thousands in missed revenue and empty
            nights.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 items-start">
            <a
              href={STRIPE_PAYMENT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 active:scale-[0.98] transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02] text-base"
            >
              Unlock full report for $10
            </a>
          </div>
          <p className="mt-3 text-xs text-slate-600">One-time payment. No subscription.</p>
        </div>
      </section>

      {/* Problem */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-950 border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Most investors guess — and pay for it later</h2>
          <p className="mt-3 text-slate-400 max-w-3xl leading-relaxed">
            Buying a short-term rental is a high-stakes decision. Pick the wrong location and you can lose thousands of
            dollars to low occupancy, price cuts, and months of underperformance — even if the property looks great on paper.
          </p>

          <div className="mt-10 grid sm:grid-cols-3 gap-4">
            {[
              {
                title: 'Demand is unclear',
                desc: 'Seasonality and volatility can swing revenue hard — and most buyers don’t see it until it’s too late.',
              },
              {
                title: 'Listings ≠ profit',
                desc: 'Listings and reviews don’t reveal unit economics. You need pricing + occupancy behavior, not vibes.',
              },
              {
                title: 'Tools are heavy',
                desc: 'Most tools are built for pros: expensive, complex dashboards, and a learning curve for a simple question.',
              },
            ].map((card) => (
              <div
                key={card.title}
                className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-900/60 hover:border-slate-700 transition-all"
              >
                <h3 className="text-sm font-semibold text-white">{card.title}</h3>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solution */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-900/30 border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">ASI turns location data into a decision</h2>
          <p className="mt-3 text-slate-400 max-w-3xl leading-relaxed">
            We generate a simple report focused on the numbers that matter for an investment decision — not a dashboard you
            have to learn. This isn’t random data: it’s based on real market patterns, occupancy trends, and pricing behavior.
          </p>

          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: 'Demand stability', desc: 'Is demand consistent or highly seasonal/volatile?' },
              { title: 'Occupancy', desc: 'Expected occupancy and how it moves across the year.' },
              { title: 'ADR / RevPAR', desc: 'Revenue metrics to estimate performance, not just “activity”.' },
              { title: 'Competition', desc: 'How saturated the market is and what you’re up against.' },
              { title: 'Strategy fit', desc: 'Recommendation for short-term / mid-term / long-term based on signals.' },
            ].map((item) => (
              <div key={item.title} className="p-5 rounded-xl border border-slate-800 bg-slate-950/30">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
            <div className="p-5 rounded-xl border border-indigo-500/40 bg-indigo-950/20">
              <h3 className="text-sm font-semibold text-white">Clear recommendation</h3>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                A conclusion you can act on — with the assumptions visible, not hidden.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-950 border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">ASI vs AirDNA</h2>
          <p className="mt-3 text-slate-400 max-w-3xl leading-relaxed">
            Keep it simple: if you want a fast “should I buy here?” answer, ASI is built for that.
          </p>

          <div className="mt-10 grid lg:grid-cols-2 gap-4">
            <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">AirDNA</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-400 leading-relaxed">
                <li>Expensive (often $100+)</li>
                <li>Complex dashboards</li>
                <li>Made for professionals</li>
              </ul>
            </div>
            <div className="p-6 rounded-2xl border border-indigo-500/40 bg-indigo-950/20">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">ASI</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-200 leading-relaxed">
                <li>$10</li>
                <li>Simple answer: “good / risky / strong”</li>
                <li>Built for regular property owners</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-900/30 border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">What you get</h2>
          <div className="mt-8 grid sm:grid-cols-2 gap-4">
            {[
              { title: 'Revenue estimate', desc: 'A realistic estimate grounded in demand and competition.' },
              { title: 'Pricing strategy', desc: 'How to price across high/low seasons and typical booking windows.' },
              { title: 'Demand analysis', desc: 'Stability, seasonality, and whether demand is expanding or shrinking.' },
              { title: 'Risk level', desc: 'A simple risk assessment for the location and strategy you choose.' },
            ].map((item) => (
              <div key={item.title} className="p-6 rounded-2xl border border-slate-800 bg-slate-950/30">
                <h3 className="font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Report Preview */}
      <section className="py-14 sm:py-16 px-4 sm:px-6 bg-slate-950 border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm text-slate-400">
            This is exactly the kind of output you&apos;ll get — clear, simple, and actionable.
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Example of what you&apos;ll see</h2>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/30 p-6 sm:p-7">
            <ul className="space-y-2 text-sm sm:text-base text-slate-200 leading-relaxed">
              <li>
                <span className="font-semibold text-white">Estimated monthly revenue:</span> $2,300 – $3,100
              </li>
              <li>
                <span className="font-semibold text-white">Occupancy:</span> 72% (stable demand)
              </li>
              <li>
                <span className="font-semibold text-white">Competition:</span> High
              </li>
              <li>
                <span className="font-semibold text-white">Strategy:</span> Short-term rental recommended
              </li>
              <li>
                <span className="font-semibold text-white">Risk level:</span> Medium
              </li>
            </ul>
            <p className="mt-5 text-sm text-slate-400">
              This is a simplified example. Your report will include deeper analysis.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-950">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Get your report now — $10</h2>
          <p className="mt-4 text-slate-400 text-lg">
            Get a clear go/no-go answer fast — before a bad location costs you thousands.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={STRIPE_PAYMENT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-10 py-5 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 active:scale-[0.98] transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02] text-lg"
            >
              Unlock full report for $10
            </a>
          </div>
          <p className="mt-4 text-sm text-slate-600">One-time payment. No subscription.</p>
        </div>
      </section>
    </div>
  );
}

