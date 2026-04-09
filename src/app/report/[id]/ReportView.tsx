'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import type { ReportData } from '@/lib/report/generator';

// ── Flow state ────────────────────────────────────────────────────────────────

type FlowState = 'idle' | 'email' | 'preparing' | 'paywall' | 'unlocked';

// ── Compare entry type ────────────────────────────────────────────────────────

export interface ComparisonEntry {
  address: string;
  score: number;
  monthlyMin: number;
  monthlyMax: number;
  demandStability: ReportData['demandStability'];
  strategy: string;
}

// ── Score circle SVG ──────────────────────────────────────────────────────────

function ScoreCircle({ score, stroke }: { score: number; stroke: string }) {
  const r  = 54;
  const cx = 72;
  const cy = 72;
  const circ = 2 * Math.PI * r;
  const filled = circ * (score / 100);
  const gap    = circ - filled;

  return (
    <svg width={144} height={144} viewBox="0 0 144 144" className="block">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${gap}`}
        strokeDashoffset={circ * 0.25}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={32} fontWeight={700} fontFamily="inherit">
        {score}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize={11} fontWeight={500} fontFamily="inherit" letterSpacing={1}>
        / 100
      </text>
    </svg>
  );
}

// ── Demand stability badge ────────────────────────────────────────────────────

function StabilityBadge({ stability }: { stability: ReportData['demandStability'] }) {
  const cfg = {
    High:     { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    Moderate: { bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   text: 'text-amber-400',   dot: 'bg-amber-400' },
    Low:      { bg: 'bg-yellow-500/15',  border: 'border-yellow-500/30',  text: 'text-yellow-400',  dot: 'bg-yellow-400' },
  }[stability];

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      Demand Stability: {stability}
    </span>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`py-10 border-b border-white/[0.07] ${className}`}>
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-bold text-white mb-6 tracking-tight">
      {children}
    </h2>
  );
}

// ── Lock gate ─────────────────────────────────────────────────────────────────

function LockGate({
  locked,
  onUnlock,
  children,
  label = 'Full data locked',
}: {
  locked: boolean;
  onUnlock: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  if (!locked) return <>{children}</>;
  return (
    <div className="relative rounded-2xl overflow-hidden">
      <div className="blur-sm pointer-events-none select-none opacity-30 rounded-2xl">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-[#0d1117]/90 backdrop-blur-md border border-white/[0.10] rounded-2xl px-7 py-6 text-center shadow-xl">
          <div className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.10] flex items-center justify-center mx-auto mb-3">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-white mb-1">{label}</p>
          <p className="text-xs text-slate-500 mb-4">Enter your email to unlock the full analysis</p>
          <button
            onClick={onUnlock}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors"
          >
            Unlock section
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, highlight,
}: {
  label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-6 border ${highlight ? 'bg-white/[0.06] border-white/[0.12]' : 'bg-white/[0.03] border-white/[0.07]'}`}>
      <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      <p className="text-3xl font-bold text-white leading-none">{value}</p>
      {sub && <p className="text-sm text-slate-500 mt-2">{sub}</p>}
    </div>
  );
}

// ── Platform row ──────────────────────────────────────────────────────────────

function PlatformRow({ name, count, color, icon }: { name: string; count: number; color: string; icon: string }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/[0.06] last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-lg">{icon}</span>
        <span className="text-white font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-2xl font-bold ${color}`}>{count}</span>
        <span className="text-slate-500 text-sm">listings</span>
      </div>
    </div>
  );
}

// ── Demand driver row ─────────────────────────────────────────────────────────

function DriverRow({ icon, label, items }: { icon: string; label: string; items: string[] }) {
  return (
    <div className="flex gap-4 py-4 border-b border-white/[0.06] last:border-0">
      <span className="text-xl mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">{label}</p>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className="text-sm text-slate-200 bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-1">
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Bullet list ───────────────────────────────────────────────────────────────

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5 mt-4">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <span className="text-slate-300 text-sm leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Email modal ───────────────────────────────────────────────────────────────

function EmailModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (email: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Card */}
      <div className="relative w-full max-w-md bg-[#0d1117] border border-white/[0.10] rounded-2xl p-8 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mb-6">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-2">Full Report</p>
          <h3 className="text-2xl font-bold text-white mb-2">Get full report</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Unlock the complete analysis — competition deep-dive, revenue breakdown, strategy, and 12-month projections.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email address</label>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="you@example.com"
              className="w-full bg-white/[0.05] border border-white/[0.10] rounded-xl px-4 py-3 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-all"
            />
            {error && <p className="mt-1.5 text-xs text-rose-400">{error}</p>}
          </div>

          <button
            type="submit"
            className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-bold text-sm transition-colors"
          >
            Get my full report →
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-600">
          No spam. One-time report delivery.
        </p>
      </div>
    </div>
  );
}

// ── Preparing modal ───────────────────────────────────────────────────────────

function PreparingModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-[#0d1117] border border-white/[0.10] rounded-2xl p-8 shadow-2xl text-center">
        {/* Spinner */}
        <div className="w-12 h-12 mx-auto mb-5 relative">
          <div className="absolute inset-0 rounded-full border-2 border-white/[0.08]" />
          <div className="absolute inset-0 rounded-full border-2 border-t-emerald-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Report is being prepared...</h3>
        <p className="text-slate-400 text-sm">Compiling market data and generating your full analysis.</p>
      </div>
    </div>
  );
}

// ── Paywall modal ─────────────────────────────────────────────────────────────

function PaywallModal({
  onContinue,
  onClose,
}: {
  onContinue: () => void;
  onClose: () => void;
}) {
  const includes = [
    'Platform-level competitor breakdown (Airbnb, Booking, VRBO)',
    'Full revenue model with monthly projections',
    'Recommended rental strategy & target audience',
    'Pricing approach and dynamic rate guidance',
    'ASI occupancy optimization roadmap',
    '12-month demand and revenue forecast',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-[#0d1117] border border-white/[0.10] rounded-2xl p-8 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400">Report ready</span>
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">Unlock full report</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Your analysis is complete. Get access to all sections including strategy, revenue breakdown, and competitor intelligence.
          </p>
          <p className="text-slate-400 text-xs mt-2">
            Used by property investors to evaluate rental potential
          </p>
        </div>

        {/* What's included */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 mb-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">What&apos;s included</p>
          <ul className="space-y-2">
            {includes.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <svg className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-slate-300 text-xs leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={onContinue}
          className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-bold text-sm transition-colors mb-3"
        >
          Continue — Download PDF
        </button>

        <p className="text-center text-xs text-slate-600">
          Full report delivered instantly as a PDF.
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReportView({ data }: { data: ReportData }) {
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [isFreeReport, setIsFreeReport] = useState(false);
  const [comparisons, setComparisons] = useState<ComparisonEntry[]>([]);
  const [addedToCompare, setAddedToCompare] = useState(false);
  const [showCompareToast, setShowCompareToast] = useState(false);
  const prepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Free sample: unlock first report automatically ──────────────────────────
  useEffect(() => {
    try {
      if (localStorage.getItem('paidUser') === 'true') {
        setFlowState('unlocked');
        return;
      }
      const hasUsed = localStorage.getItem('hasUsedFreeReport');
      if (!hasUsed) {
        setFlowState('unlocked');
        setIsFreeReport(true);
        localStorage.setItem('hasUsedFreeReport', 'true');
      }
    } catch { /* localStorage unavailable (SSR / private mode) */ }
  }, []);

  // ── Load saved comparisons ──────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('reportComparisons');
      if (saved) {
        const parsed: ComparisonEntry[] = JSON.parse(saved);
        setComparisons(parsed);
        if (parsed.some((c) => c.address === data.address)) {
          setAddedToCompare(true);
        }
      }
    } catch { /* ignore */ }
  }, [data.address]);

  const locked = flowState !== 'unlocked';

  const openEmailModal = useCallback(() => {
    setFlowState('email');
  }, []);

  const handleEmailSubmit = useCallback((_email: string) => {
    // In production: POST email to /api/report/lead or similar
    setFlowState('preparing');
    prepTimer.current = setTimeout(() => {
      setFlowState('paywall');
    }, 1800);
  }, []);

  const handlePaywallContinue = useCallback(async () => {
    const res = await fetch('/api/create-checkout-session', { method: 'POST' });
    const data = await res.json();
    window.location.href = data.url;
  }, []);

  const closeModal = useCallback(() => {
    if (prepTimer.current) clearTimeout(prepTimer.current);
    setFlowState('idle');
  }, []);

  // ── Cleanup timers on unmount ───────────────────────────────────────────────
  useEffect(() => () => {
    if (prepTimer.current) clearTimeout(prepTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const handleAddToCompare = useCallback(() => {
    if (addedToCompare) return;
    const entry: ComparisonEntry = {
      address: data.address,
      score: data.score,
      monthlyMin: data.monthlyMin,
      monthlyMax: data.monthlyMax,
      demandStability: data.demandStability,
      strategy: data.strategy,
    };
    const updated = [...comparisons, entry];
    setComparisons(updated);
    setAddedToCompare(true);
    try {
      localStorage.setItem('reportComparisons', JSON.stringify(updated));
    } catch { /* ignore */ }
    // Fire engagement toast when user has added a second property
    if (updated.length === 2) {
      setShowCompareToast(true);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setShowCompareToast(false), 2500);
    }
  }, [addedToCompare, comparisons, data]);

  const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;

  const generatedDate = new Date(data.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Confidence logic (for trust block)
  const confidence =
    data.competitors500m >= 15 ? 'High'
    : data.competitors500m >= 8 ? 'Medium'
    : 'Low';

  const confCfg = {
    High:   { dot: 'bg-emerald-400', text: 'text-emerald-400', desc: 'based on active market listings and real pricing data' },
    Medium: { dot: 'bg-amber-400',   text: 'text-amber-400',   desc: 'based on partial live data and estimated signals' },
    Low:    { dot: 'bg-slate-400',    text: 'text-slate-400',   desc: 'based on limited data, using modeled estimates' },
  }[confidence];

  const lastUpdated = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-[#07090f] text-white">

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {flowState === 'email'    && <EmailModal   onSubmit={handleEmailSubmit} onClose={closeModal} />}
      {flowState === 'preparing' && <PreparingModal />}
      {flowState === 'paywall'  && <PaywallModal  onContinue={handlePaywallContinue} onClose={closeModal} />}

      {/* ── Compare toast ─────────────────────────────────────────────────── */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-300
          ${showCompareToast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
      >
        <div className="flex items-center gap-3 bg-[#0d1117]/95 backdrop-blur-md border border-white/[0.10] rounded-2xl px-5 py-3.5 shadow-2xl">
          <span className="text-lg">📊</span>
          <p className="text-sm text-slate-200 leading-snug">
            Compare more locations to identify the strongest opportunity
          </p>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto px-6 pb-24">

        {/* ── Top bar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between py-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-white">ASI</span>
            <span className="text-xs text-slate-500 bg-white/[0.05] border border-white/[0.08] rounded-full px-2.5 py-0.5 font-medium">
              Location Report
            </span>
            {isFreeReport && (
              <>
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-0.5">
                  Free sample report
                </span>
                <span className="text-xs text-slate-400">
                  1 of 1 free report used
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {comparisons.length > 0 && (
              <a
                href="/compare"
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                {comparisons.length} {comparisons.length === 1 ? 'property' : 'properties'} compared
              </a>
            )}
            <span className="text-xs text-slate-500">{generatedDate}</span>
          </div>
        </div>

        {/* ── FREE: Hero block ──────────────────────────────────────────────── */}
        <Section>
          <div className="flex flex-col sm:flex-row sm:items-start gap-8">
            <div className="shrink-0 flex flex-col items-center gap-3">
              <ScoreCircle score={data.score} stroke={data.strokeColor} />
              <p className={`text-sm font-semibold ${data.bandColor}`}>{data.bandLabel}</p>
            </div>
            <div className="flex-1 pt-1">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-2">Location</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-snug mb-4">{data.address}</h1>
              <p className={`text-lg font-medium mb-5 ${data.bandColor}`}>{data.verdict}</p>
              <div className="flex flex-wrap items-center gap-3">
                <StabilityBadge stability={data.demandStability} />
                <button
                  onClick={handleAddToCompare}
                  disabled={addedToCompare}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all
                    ${addedToCompare
                      ? 'bg-slate-500/10 border-slate-500/20 text-slate-500 cursor-default'
                      : 'bg-white/[0.04] border-white/[0.10] text-slate-300 hover:bg-white/[0.08] hover:border-white/[0.18] hover:text-white active:scale-95'
                    }`}
                >
                  {addedToCompare ? (
                    <>
                      <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Added to compare
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 0v10m0-10a2 2 0 012 2h2a2 2 0 012-2" />
                      </svg>
                      Add to compare
                    </>
                  )}
                </button>
                {comparisons.length > 1 && (
                  <a href="/compare" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors underline underline-offset-2">
                    View {comparisons.length} compared →
                  </a>
                )}
              </div>
            </div>
          </div>
        </Section>

        {/* ── FREE: Market snapshot ─────────────────────────────────────────── */}
        <Section>
          <SectionTitle>Market Snapshot</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <MetricCard label="Competitors (500 m)" value={String(data.competitors500m)} sub="active listings nearby" highlight />
            <MetricCard label="Avg ADR"              value={fmt$(data.avgADR)}            sub="per night"              highlight />
            <MetricCard label="Est. Occupancy"       value={`${data.occupancy}%`}         sub="market average" />
            <MetricCard label="RevPAR"               value={fmt$(data.revpar)}            sub="revenue per available night" />
            <MetricCard label="Demand Stability"     value={data.demandStability}         sub="demand consistency score" />
            <MetricCard label="Optimal Strategy"     value={data.strategy}                sub="recommended rental model" />
          </div>
        </Section>

        {/* ── LOCKED: Competition breakdown ────────────────────────────────── */}
        <Section>
          <SectionTitle>Local Competition</SectionTitle>
          <LockGate locked={locked} onUnlock={openEmailModal} label="Platform-level competition data locked">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
              <div className="px-6 py-2">
                <PlatformRow name="Airbnb"       count={data.airbnbCount}  color="text-rose-400"   icon="🏠" />
                <PlatformRow name="Booking.com"  count={data.bookingCount} color="text-blue-400"   icon="🏨" />
                <PlatformRow name="VRBO"         count={data.vrboCount}    color="text-violet-400" icon="🏡" />
              </div>
              <div className="border-t border-white/[0.06] px-6 py-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1">Price Range</p>
                  <p className="text-2xl font-bold text-white">
                    {fmt$(data.priceMin)}
                    <span className="text-slate-400 font-normal mx-2">—</span>
                    {fmt$(data.priceMax)}
                    <span className="text-slate-500 text-sm font-normal ml-2">/ night</span>
                  </p>
                </div>
                <p className="text-xs text-slate-500 max-w-[160px] text-right leading-relaxed">
                  Based on active listings in proximity
                </p>
              </div>
            </div>
          </LockGate>
        </Section>

        {/* ── FREE: Demand drivers ──────────────────────────────────────────── */}
        <Section>
          <SectionTitle>What Drives Demand Here</SectionTitle>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-2">
            <DriverRow icon="🏛️" label="Nearby Attractions" items={data.attractions} />
            <DriverRow icon="🏢" label="Business Hubs"       items={data.businessHubs} />
            <DriverRow icon="🚇" label="Transport Access"    items={data.transport} />
            <DriverRow icon="📅" label="Seasonality"         items={[data.seasonality]} />
          </div>
        </Section>

        {/* ── LOCKED: Revenue model ─────────────────────────────────────────── */}
        <Section>
          <SectionTitle>Revenue Model</SectionTitle>
          <LockGate locked={locked} onUnlock={openEmailModal} label="Revenue breakdown locked">
            <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-8 text-center">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-3">Estimated Monthly Revenue</p>
              <p className="text-5xl sm:text-6xl font-bold text-white tracking-tight">
                {fmt$(data.monthlyMin)}
                <span className="text-slate-500 font-normal mx-3">–</span>
                {fmt$(data.monthlyMax)}
              </p>
              <p className="text-slate-400 text-sm mt-5 max-w-sm mx-auto leading-relaxed">
                Based on market pricing, demand signals, and competition dynamics
              </p>
              <p className="text-slate-500 text-xs mt-4 max-w-md mx-auto leading-relaxed">
                Estimates are derived from real market data, competition analysis, coupled with demand dynamics, and may vary depending on execution.
              </p>
            </div>
          </LockGate>
        </Section>

        {/* ── LOCKED: Strategy ──────────────────────────────────────────────── */}
        <Section>
          <SectionTitle>Recommended Strategy</SectionTitle>
          <LockGate locked={locked} onUnlock={openEmailModal} label="Strategy recommendations locked">
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-2">Rental Model</p>
                <p className="text-lg font-bold text-white">{data.recommendedStrategy}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-2">Target Audience</p>
                  <p className="text-white text-sm leading-relaxed">{data.targetAudience}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-2">Pricing Approach</p>
                  <p className="text-white text-sm leading-relaxed">{data.pricingApproach}</p>
                </div>
              </div>
            </div>
          </LockGate>
        </Section>

        {/* ── LOCKED: ASI execution ─────────────────────────────────────────── */}
        <Section>
          <SectionTitle>How ASI Maximizes Occupancy</SectionTitle>
          <LockGate locked={locked} onUnlock={openEmailModal} label="ASI execution roadmap locked">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-7">
              <p className="text-slate-300 text-sm leading-relaxed mb-6">
                ASI analyzes demand patterns, selects the optimal rental strategy, and gradually
                shifts your property toward high-occupancy channels — including corporate accounts
                and repeat bookings.
              </p>
              <BulletList
                items={[
                  'Dynamic pricing optimization — adjusts daily rate to market demand in real time',
                  'Audience targeting — matches your property to the right guest segment automatically',
                  'OTA reduction — moves volume from commission-heavy platforms to direct channels',
                  'B2B shift — builds corporate and repeat-booking pipeline for stable base occupancy',
                ]}
              />
            </div>
          </LockGate>
        </Section>

        {/* ── FREE: Trust & Methodology ─────────────────────────────────────── */}
        <Section>
          <SectionTitle>How this analysis works</SectionTitle>
          <div className="rounded-2xl border border-white/[0.08] bg-slate-800/20 p-6">
            <p className="text-slate-300 text-sm leading-relaxed mb-6">
              This report combines real market data with location-specific demand analysis.
            </p>

            {/* 3 pillars */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">📈</span>
                  <p className="text-sm font-bold text-white">Demand Signals</p>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed">
                  Evaluates real demand drivers including nearby attractions, business activity, and seasonality.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">🗺️</span>
                  <p className="text-sm font-bold text-white">Competitive Landscape</p>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed">
                  Analyzes active listings, pricing ranges, and density of nearby rental properties.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">💵</span>
                  <p className="text-sm font-bold text-white">Pricing & Revenue</p>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed">
                  Estimates revenue based on ADR, occupancy trends, and pricing pressure in the area.
                </p>
              </div>
            </div>

            <p className="text-slate-400 text-xs leading-relaxed border-t border-white/[0.06] pt-5 mb-3">
              Unlike static averages, this analysis adapts to real-world demand behavior and local competition.
            </p>
            <p className="text-slate-500 text-xs mb-5">
              Used for evaluating rental potential across multiple markets.
            </p>

            {/* Transparency footer */}
            <div className="border-t border-white/[0.06] pt-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Data sources</p>
                <ul className="space-y-1">
                  {[
                    'Rental listings (Airbnb, Booking, VRBO)',
                    'Market pricing signals (Zillow, local comps)',
                    'Location demand data (POIs, infrastructure, activity patterns)',
                  ].map((src) => (
                    <li key={src} className="flex items-start gap-2 text-slate-500 text-xs leading-relaxed">
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-600 shrink-0" />
                      {src}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Last updated</p>
                <p className="text-slate-500 text-xs">{lastUpdated}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Confidence level</p>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${confCfg.dot}`} />
                  <span className={`text-xs font-semibold ${confCfg.text}`}>{confidence}</span>
                </div>
                <p className="text-slate-500 text-xs leading-relaxed">{confCfg.desc}</p>
              </div>
            </div>
          </div>
        </Section>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <section className="pt-10">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 text-center">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-3">Full Report</p>
            <h3 className="text-2xl font-bold text-white mb-2">Get the complete analysis</h3>
            <p className="text-slate-400 text-sm mb-7 max-w-sm mx-auto leading-relaxed">
              Includes competitor deep-dive, 12-month projections, channel mix recommendations, and an ASI onboarding roadmap.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {flowState === 'unlocked' ? (
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-bold text-sm transition-colors"
                >
                  <span>↓</span>
                  Download PDF
                </button>
              ) : (
                <button
                  onClick={openEmailModal}
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-bold text-sm transition-colors"
                >
                  Unlock Full Report
                  <span>→</span>
                </button>
              )}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
