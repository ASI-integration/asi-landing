'use client';

import { useEffect, useState } from 'react';
import type { ComparisonEntry } from '@/app/report/[id]/ReportView';

// ── Stability order for "best" ranking ────────────────────────────────────────

const STABILITY_RANK: Record<string, number> = { High: 2, Moderate: 1, Low: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;

function StabilityBadge({ stability }: { stability: ComparisonEntry['demandStability'] }) {
  const cfg = {
    High:     { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    Moderate: { bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   text: 'text-amber-400',   dot: 'bg-amber-400' },
    Low:      { bg: 'bg-yellow-500/15',  border: 'border-yellow-500/30',  text: 'text-yellow-400',  dot: 'bg-yellow-400' },
  }[stability];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {stability}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const [comparisons, setComparisons] = useState<ComparisonEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('reportComparisons');
      if (saved) setComparisons(JSON.parse(saved));
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const removeEntry = (address: string) => {
    const updated = comparisons.filter((c) => c.address !== address);
    setComparisons(updated);
    try { localStorage.setItem('reportComparisons', JSON.stringify(updated)); } catch { /* ignore */ }
  };

  if (!loaded) return null;

  // ── Derive highlights ────────────────────────────────────────────────────────
  const maxRevenue = comparisons.length
    ? Math.max(...comparisons.map((c) => c.monthlyMax))
    : -1;
  const bestStabilityRank = comparisons.length
    ? Math.max(...comparisons.map((c) => STABILITY_RANK[c.demandStability] ?? 0))
    : -1;

  return (
    <div className="min-h-screen bg-[#07090f] text-white">
      <div className="max-w-[960px] mx-auto px-6 pb-24">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between py-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <a href="/" className="text-lg font-bold tracking-tight text-white">ASI</a>
            <span className="text-xs text-slate-500 bg-white/[0.05] border border-white/[0.08] rounded-full px-2.5 py-0.5 font-medium">
              Compare Mode
            </span>
          </div>
          {comparisons.length > 0 && (
            <span className="text-xs text-slate-400">
              {comparisons.length} {comparisons.length === 1 ? 'property' : 'properties'} compared
            </span>
          )}
        </div>

        {/* ── Empty state ────────────────────────────────────────────────────── */}
        {comparisons.length === 0 && (
          <div className="py-24 text-center">
            <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-5">
              <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 0v10m0-10a2 2 0 012 2h2a2 2 0 012-2" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No properties compared yet</h2>
            <p className="text-slate-400 text-sm mb-8 max-w-sm mx-auto leading-relaxed">
              Generate a report for a location and click &quot;Add to compare&quot; to start building your comparison table.
            </p>
            <a
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-bold text-sm transition-colors"
            >
              Analyze another property →
            </a>
          </div>
        )}

        {/* ── Comparison table ───────────────────────────────────────────────── */}
        {comparisons.length > 0 && (
          <div className="py-10">
            <h1 className="text-2xl font-bold text-white mb-2">Property Comparison</h1>
            <div className="flex items-center gap-2 mb-8">
              <p className="text-slate-400 text-sm">
                Side-by-side analysis of saved locations.
              </p>
              <span className="text-slate-400 text-sm">·</span>
              <p className="text-slate-400 text-sm">
                Best investment opportunity highlighted
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.03]">
                    <th className="text-left px-5 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Address</th>
                    <th className="text-center px-5 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Score</th>
                    <th className="text-right px-5 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Est. Revenue / mo</th>
                    <th className="text-center px-5 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Stability</th>
                    <th className="text-left px-5 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Strategy</th>
                    <th className="px-5 py-4" />
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((entry) => {
                    const isTopRevenue = entry.monthlyMax === maxRevenue;
                    const isBestStability = STABILITY_RANK[entry.demandStability] === bestStabilityRank;
                    return (
                      <tr key={entry.address} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-4">
                          <p className={`font-medium leading-snug ${isTopRevenue ? 'text-white font-bold' : 'text-slate-200'}`}>
                            {entry.address}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className={`text-lg font-bold ${isTopRevenue ? 'text-emerald-400' : 'text-white'}`}>
                            {entry.score}
                          </span>
                          <span className="text-slate-500 text-xs">/100</span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className={`font-bold ${isTopRevenue ? 'text-emerald-400 text-base' : 'text-white'}`}>
                            {fmt$(entry.monthlyMin)}
                            <span className="text-slate-500 font-normal mx-1.5">–</span>
                            {fmt$(entry.monthlyMax)}
                          </span>
                          {isTopRevenue && (
                            <span className="ml-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                              Highest
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <StabilityBadge stability={entry.demandStability} />
                            {isBestStability && comparisons.length > 1 && (
                              <span className="text-xs font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-full px-2 py-0.5">
                                Best
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-300">{entry.strategy}</td>
                        <td className="px-5 py-4">
                          <button
                            onClick={() => removeEntry(entry.address)}
                            className="text-slate-600 hover:text-rose-400 transition-colors"
                            title="Remove from compare"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── CTA ─────────────────────────────────────────────────────────── */}
            <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center">
              <h3 className="text-xl font-bold text-white mb-2">Analyze another property</h3>
              <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto leading-relaxed">
                Add more locations to find the best rental opportunity in your market.
              </p>
              <a
                href="/"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-bold text-sm transition-colors"
              >
                Analyze another property →
              </a>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
