'use client';

import { useEffect, useState } from 'react';

type Traffic = 'ok' | 'warn' | 'err';

function TrafficLights({ a, b, c }: { a: Traffic; b: Traffic; c: Traffic }) {
  const cls: Record<Traffic, string> = {
    ok: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]',
    warn: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.35)]',
    err: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]',
  };
  return (
    <div className="flex items-center gap-1 shrink-0" aria-hidden>
      {[a, b, c].map((tone, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ring-1 ring-white/10 ${cls[tone]}`}
        />
      ))}
    </div>
  );
}

const OBJECTS: { name: string; meta: string; lights: [Traffic, Traffic, Traffic] }[] = [
  { name: 'Loft, Central District', meta: 'Active booking', lights: ['ok', 'ok', 'ok'] },
  { name: 'Studio «Falcon»', meta: 'Check-out today', lights: ['ok', 'warn', 'ok'] },
  { name: 'Duplex Westside', meta: 'Cleaning', lights: ['ok', 'ok', 'warn'] },
  { name: 'Portfolio «Season»', meta: '4 properties', lights: ['warn', 'ok', 'ok'] },
];

export function AutopilotInterfaceMock() {
  const [yookassaActive, setYookassaActive] = useState(false);

  useEffect(() => {
    // Fetch current user session + subscription status.
    // If subscription.status === 'active', turn YooKassa indicator green.
    fetch('/api/auth/session')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.subscription?.status === 'active') {
          setYookassaActive(true);
        }
      })
      .catch(() => {/* unauthenticated visitors — keep default */});
  }, []);

  return (
    <section
      className="relative py-20 px-4 sm:px-6 border-y border-slate-800/80 bg-slate-950"
      aria-labelledby="autopilot-interface-heading"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="relative max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            Interface
          </p>
          <h2
            id="autopilot-interface-heading"
            className="mt-2 text-3xl sm:text-4xl font-bold text-white tracking-tight"
          >
            Autopilot Interface
          </h2>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-2xl shadow-black/40 overflow-hidden backdrop-blur-sm">
          {/* window chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/90 bg-slate-900/80">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
            <span className="ml-3 text-[11px] font-mono text-slate-500 truncate">
              dashboard.asi.app / property
            </span>
          </div>

          <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
            {/* Left: objects */}
            <div className="lg:col-span-3 flex flex-col min-h-0 rounded-xl border border-slate-800/90 bg-slate-950/50">
              <div className="px-4 py-3 border-b border-slate-800/80">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Properties
                </h3>
              </div>
              <ul className="p-2 space-y-1 flex-1">
                {OBJECTS.map((obj, i) => (
                  <li key={obj.name}>
                    <div
                      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                        i === 0
                          ? 'bg-slate-800/70 ring-1 ring-slate-700/80'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <TrafficLights a={obj.lights[0]} b={obj.lights[1]} c={obj.lights[2]} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-100 truncate">{obj.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{obj.meta}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Center: evergreen index */}
            <div className="lg:col-span-6 flex flex-col rounded-xl border border-slate-800/90 bg-slate-950/50">
              <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Location Score
                  </h3>
                  <p className="text-sm text-slate-400 mt-1">Loft, Central District · 30 days</p>
                </div>
                <span className="text-xs text-emerald-400/90 font-medium">+4.2 vs last month</span>
              </div>
              <div className="p-4 sm:p-5 flex-1 flex flex-col">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl sm:text-6xl font-bold text-white tabular-nums tracking-tight">
                    87
                  </span>
                  <span className="text-slate-500 text-sm">/ 100</span>
                </div>
                <p className="mt-2 text-xs text-slate-500 max-w-md leading-relaxed">
                  Composite score of occupancy, margin, and review stability. Higher means the
                  property monetises consistently without manual adjustments.
                </p>

                {/* faux chart */}
                <div className="mt-6 flex-1 min-h-[140px] flex flex-col justify-end">
                  <div className="flex items-end justify-between gap-1.5 h-28 px-1">
                    {[
                      42, 55, 48, 62, 58, 71, 68, 74, 80, 77, 85, 87,
                    ].map((h, idx) => (
                      <div
                        key={idx}
                        className="flex-1 rounded-t-sm bg-gradient-to-t from-emerald-600/20 to-emerald-400/70 min-w-[4px] max-w-[20px] mx-auto transition-all"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-slate-600 font-mono uppercase tracking-wide">
                    <span>1 wk</span>
                    <span>now</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: integrations */}
            <div className="lg:col-span-3 flex flex-col rounded-xl border border-slate-800/90 bg-slate-950/50">
              <div className="px-4 py-3 border-b border-slate-800/80">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Integrations
                </h3>
              </div>
              <div className="p-4 space-y-3 flex-1">
                {/* Stripe — always active in mock */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-100">Stripe</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
                      Active
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">Payments &amp; refunds</p>
                </div>

                {/* YooKassa — green when subscription is active, amber otherwise */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-100">YooKassa</span>
                    {yookassaActive ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
                        Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25">
                        Setup
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">Local payment methods</p>
                </div>

                <p className="text-[11px] text-slate-600 leading-relaxed pt-1">
                  Statuses update when keys are saved and a test payment passes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
