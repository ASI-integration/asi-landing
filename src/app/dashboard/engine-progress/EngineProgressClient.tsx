'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { EngineProgressStatus } from '@/lib/engine-progress/roadmap';

type Step = {
  id: string; milestoneId: number; title: string;
  initialStatus: EngineProgressStatus; status: EngineProgressStatus;
  source: 'github' | 'snapshot'; evidenceUrl: string | null;
};
type Milestone = {
  id: number; group: string; title: string; pass: string;
  total: number; completed: number; status: EngineProgressStatus;
};
type Ci = {
  available: boolean; reason: string | null; sha: string | null;
  prUrl: string; runUrl: string | null; runId: number | null; checkedAt: string;
  jobs: { ubuntu: string; windows: string; artifact: string };
};
type Activity = {
  status: string; stale: boolean; stage: string; currentItem: string;
  progressPercent: number | null; updatedAt: string;
};
type Snapshot = {
  ok: boolean; fetchedAt: string; snapshotDate: string;
  milestones: Milestone[]; steps: Step[]; ci: Ci; activity: Activity | null;
};
const POLL_MS = 15000;
const STATUS: Record<EngineProgressStatus, { label: string; dot: string; badge: string }> = {
  done: { label: 'ГОТОВО', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' },
  in_progress: { label: 'В РАБОТЕ', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-800' },
  blocked: { label: 'БЛОК', dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700' },
  not_started: { label: 'НЕ НАЧАТО', dot: 'bg-slate-300', badge: 'bg-slate-100 text-slate-600' },
  unknown: { label: 'НЕТ ДАННЫХ', dot: 'bg-slate-500', badge: 'bg-slate-200 text-slate-700' },
};
const CI_LABELS = [
  ['ubuntu', 'Ubuntu'],
  ['windows', 'Windows'],
  ['artifact', 'Windows artifact'],
] as const;
const jobLabel = (s: string) => s === 'success' ? 'PASS' : s === 'failed' ? 'FAIL'
  : s === 'pending' ? 'Выполняется' : 'Нет результата';
const pct = (done: number, total: number) => total === 0 ? 0 : Math.round(100 * done / total);

function StatusPill({ value }: { value: EngineProgressStatus }) {
  const s = STATUS[value];
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${s.badge}`}>
    <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden="true" />{s.label}
  </span>;
}

function ProgressBar({ done, total, small = false }: { done: number; total: number; small?: boolean }) {
  return <div className={`w-full overflow-hidden rounded-full bg-slate-100 ${small ? 'h-2' : 'h-3'}`}
    role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total || 1}
    aria-label={`Выполнено ${done} из ${total}`}>
    <div className="h-full rounded-full bg-teal-500 transition-[width] duration-500"
      style={{ width: `${pct(done,total)}%` }} />
  </div>;
}

function MilestoneCard({ milestone, steps, initiallyOpen }: { milestone: Milestone; steps: Step[]; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const relevant = steps.filter(step => step.milestoneId === milestone.id);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" data-engine-milestone={milestone.id}>
      <button type="button" onClick={() => setOpen(x => !x)} aria-expanded={open}
        className="flex w-full flex-col gap-3 p-4 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:px-5 sm:py-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-lg font-black text-white">{milestone.id}</span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-slate-500">{milestone.group}</div>
            <h3 className="text-base font-bold leading-6 text-slate-900">{milestone.title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">PASS: {milestone.pass}</p>
          </div>
        </div>
        <div className="flex w-full shrink-0 items-center gap-3 sm:w-56">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-right text-xs font-bold tabular-nums text-slate-600">{milestone.completed} / {milestone.total}</div>
            <ProgressBar done={milestone.completed} total={milestone.total} small />
          </div>
          <StatusPill value={milestone.status} />
          <span aria-hidden="true" className="text-slate-500">{open ? '▴' : '▾'}</span>
        </div>
      </button>
      {open && <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4">
        {relevant.map(step => <div key={step.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3"
          data-engine-step={step.id}>
          <span className="w-10 shrink-0 text-sm font-bold tabular-nums text-slate-500">{step.id}</span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{step.title}</span>
          {step.source === 'github' && <span title="Статус из GitHub CI на текущем SHA"
            className="text-[11px] font-medium text-teal-700">● GitHub</span>}
          {step.source === 'snapshot' && <span title="Плановый снимок, не живое подтверждение"
            className="text-[11px] text-slate-400">Снимок</span>}
          <StatusPill value={step.status} />
          {step.evidenceUrl && <a href={step.evidenceUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs font-semibold text-blue-700 hover:underline">Проверить ↗</a>}
        </div>)}
      </div>}
    </section>
  );
}

export default function EngineProgressClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all'|'dispatcher'|'engine'|'other'>('all');
  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch('/api/dashboard/engine-progress', {
        credentials: 'include', cache: 'no-store',
      });
      if (!response.ok) throw new Error('Источник временно недоступен.');
      const payload = await response.json() as Snapshot;
      if (!payload.ok || !Array.isArray(payload.steps) || !Array.isArray(payload.milestones))
        throw new Error('Данные о вехах неполные.');
      setSnapshot(payload);
      setError(null);
    } catch {
      setError('Не удалось обновить вехи. Последние данные могут быть устаревшими.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const all = snapshot?.milestones ?? [];
  const steps = snapshot?.steps ?? [];
  const total = steps.length;
  const completed = steps.filter(x => x.status === 'done').length;
  const dispatcher = steps.filter(x => x.milestoneId <= 8);
  const engine = steps.filter(x => x.milestoneId >= 9 && x.milestoneId <= 15);
  const next = all.find(m => m.status !== 'done');
  const currentStep = next ? steps.find(x => x.milestoneId === next.id && x.status !== 'done') : null;
  const visible = useMemo(() => all.filter(m =>
    filter === 'all' || (filter === 'dispatcher' && m.id <= 8) ||
    (filter === 'engine' && m.id >= 9 && m.id <= 15) ||
    (filter === 'other' && m.id >= 16)), [all, filter]);
  if (loading && !snapshot) return <div className="mx-auto max-w-6xl py-20 text-center text-slate-500">Загружаю вехи ASI…</div>;

  return <div className="mx-auto w-full max-w-6xl space-y-6 pb-14">
    <header className="rounded-3xl bg-slate-950 px-5 py-6 text-white sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-teal-300">ASI / OWNER DEVELOPMENT</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Вехи диспетчера и движка</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            19 вех · 63 шага · фактическая проверка GitHub CI. Статусы остальных задач — снимок плана,
            пока к ним не подключён подтверждающий источник.
          </p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={refreshing}
          className="rounded-xl border border-slate-500 px-4 py-2 text-sm font-bold hover:bg-slate-800 disabled:opacity-60">
          {refreshing ? 'Проверяю…' : '↻ Обновить'}
        </button>
      </div>
      <p className="mt-4 text-xs text-slate-400">
        Автопроверка каждые 15 сек · последний опрос {snapshot?.fetchedAt
          ? new Date(snapshot.fetchedAt).toLocaleTimeString('ru-RU') : '—'} · снимок остальных шагов {snapshot?.snapshotDate || '—'}
      </p>
    </header>

    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        ['ВСЕГО',completed,total],
        ['ДИСПЕТЧЕР',dispatcher.filter(x=>x.status==='done').length,dispatcher.length],
        ['ДВИЖОК',engine.filter(x=>x.status==='done').length,engine.length],
        ['ВЕХ',all.filter(x=>x.status==='done').length,all.length],
      ].map(([name,done,size])=><div key={String(name)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold tracking-wider text-slate-500">{name}</p>
        <p className="mt-2 text-3xl font-black tabular-nums text-slate-900">{done}<span className="text-lg font-medium text-slate-400"> / {size}</span></p>
        <div className="mt-3"><ProgressBar done={Number(done)} total={Number(size)} small /></div>
      </div>)}
    </div>

    {snapshot?.ci && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-black text-slate-900">Живая проверка Dispatcher CI</h2>
        <div className="flex gap-3 text-xs font-bold">
          <a href={snapshot.ci.prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">PR #165 ↗</a>
          {snapshot.ci.runUrl && <a href={snapshot.ci.runUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">CI run ↗</a>}
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">Только текущий опубликованный SHA: <code className="font-semibold">{snapshot.ci.sha?.slice(0,12) ?? 'не определён'}</code></p>
      {snapshot.ci.reason && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{snapshot.ci.reason}</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CI_LABELS.map(([key,label]) => <div key={key} className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-slate-500">{label}</div>
          <div className={`mt-2 text-xl font-black ${snapshot.ci.jobs[key]==='success'?'text-emerald-700':snapshot.ci.jobs[key]==='failed'?'text-rose-700':'text-slate-700'}`}>
            {jobLabel(snapshot.ci.jobs[key])}
          </div>
        </div>)}
      </div>
    </section>}

    {snapshot?.activity && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-black text-slate-900">Оперативный статус ASI</h2>
        <StatusPill value={snapshot.activity.stale ? 'unknown' : snapshot.activity.status==='running'?'in_progress':snapshot.activity.status==='error'?'blocked':snapshot.activity.status==='done'?'done':'unknown'} />
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-700">{snapshot.activity.stage || 'Нет активной стадии'}</p>
      <p className="mt-1 text-sm text-slate-500">{snapshot.activity.stale?'События устарели.':snapshot.activity.currentItem || 'Нет активного задания.'}</p>
      <Link href="/dashboard/control-center" className="mt-3 inline-block text-sm font-bold text-blue-700 hover:underline">Открыть Центр управления →</Link>
    </section>}

    {next && <section className="rounded-2xl border border-teal-200 bg-teal-50/50 p-5">
      <p className="text-xs font-extrabold uppercase tracking-wider text-teal-700">ТЕКУЩАЯ ВЕХА №{next.id}</p>
      <h2 className="mt-1 text-xl font-black text-slate-900">{next.title}</h2>
      <p className="mt-1 text-sm text-slate-700">Следующий незакрытый шаг: <strong>{currentStep ? `${currentStep.id} — ${currentStep.title}` : 'проверить источники'}</strong></p>
      <p className="mt-2 text-xs text-slate-500">Статус «ГОТОВО» не разрешает автоматически merge, deployment или живое исполнение.</p>
    </section>}

    <nav aria-label="Фильтр этапов" className="flex flex-wrap gap-2">
      {([
        ['all','Все 19'],['dispatcher','Диспетчер 1–8'],['engine','Движок 9–15'],['other','Интеграции 16–19'],
      ] as const).map(([value,label])=><button key={value} type="button" onClick={() => setFilter(value)}
        aria-pressed={filter === value}
        className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${filter===value?'border-slate-900 bg-slate-900 text-white':'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{label}</button>)}
    </nav>
    <div className="space-y-3">
      {visible.map(m=><MilestoneCard key={m.id} milestone={m} steps={steps}
        initiallyOpen={m.id===2} />)}
    </div>
    <p className="text-xs leading-5 text-slate-500">
      Плановый снимок — не автоматическое доказательство выполнения. GitHub CI отображается по текущему SHA;
      при отсутствии доступа к источнику показывается «Нет данных», а не прошлый PASS.
      Источники остальных шагов будут подключаться последовательно.
    </p>
  </div>;
}
