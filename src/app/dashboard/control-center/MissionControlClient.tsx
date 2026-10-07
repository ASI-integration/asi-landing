'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type {
  MissionControlDashboardProject,
  MissionControlStatusKind,
} from '@/lib/mission-control/types';

type StatusResponse = {
  ok: boolean;
  projects?: MissionControlDashboardProject[];
  fetchedAt?: string;
  message?: string;
};

const POLL_MS = 5_000;

const STATUS_LABELS: Record<MissionControlStatusKind, string> = {
  running: 'РАБОТАЕТ',
  waiting: 'ЖДЁТ',
  error: 'ОШИБКА',
  done: 'ГОТОВО',
  idle: 'НЕТ ДАННЫХ',
};

const STATUS_BADGE: Record<MissionControlStatusKind, string> = {
  running: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  waiting: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  error: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  done: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  idle: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const STATUS_DOT: Record<MissionControlStatusKind, string> = {
  running: 'bg-emerald-500',
  waiting: 'bg-amber-500',
  error: 'bg-rose-500',
  done: 'bg-blue-500',
  idle: 'bg-slate-400',
};

const STATUS_BAR: Record<MissionControlStatusKind, string> = {
  running: 'bg-emerald-500',
  waiting: 'bg-amber-500',
  error: 'bg-rose-500',
  done: 'bg-blue-500',
  idle: 'bg-slate-400',
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number): string {
  const normalized = clampPercent(value);
  return Number.isInteger(normalized) ? `${normalized}%` : `${normalized.toFixed(1)}%`;
}

function formatUpdatedAt(value: string, ageSeconds: number): string {
  if (!value) return '—';
  if (ageSeconds < 10) return 'только что';
  if (ageSeconds < 60) return `${ageSeconds} сек назад`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} мин назад`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'green' | 'amber' | 'red' | 'blue';
}) {
  const toneClass = {
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-rose-600',
    blue: 'text-blue-600',
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className={`mt-1 text-4xl font-black tracking-tight ${toneClass}`}>{value}</div>
    </div>
  );
}

function ProjectCard({ project }: { project: MissionControlDashboardProject }) {
  const effectiveStatus: MissionControlStatusKind = project.stale && project.status !== 'done'
    ? 'waiting'
    : project.status;
  const badgeLabel = project.stale && project.status !== 'done'
    ? 'ДАННЫЕ УСТАРЕЛИ'
    : STATUS_LABELS[effectiveStatus];
  const progress = project.progressPercent === null ? null : clampPercent(project.progressPercent);
  const stageProgress = project.stageProgressPercent === null
    ? null
    : clampPercent(project.stageProgressPercent);

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-6 md:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-extrabold uppercase tracking-[0.18em] text-slate-400">
              ПРОЕКТ
            </div>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
              {project.name}
            </h2>
          </div>

          <div
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black ring-1 ring-inset ${STATUS_BADGE[effectiveStatus]}`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[effectiveStatus]}`} />
            {badgeLabel}
          </div>
        </div>

        <div className="mt-7 flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
              ОБЩИЙ ПРОГРЕСС
            </div>
            <div className="mt-1 text-6xl font-black tracking-[-0.05em] text-slate-950 md:text-7xl">
              {progress === null ? '—' : formatPercent(progress)}
            </div>
          </div>
          <div className="pb-2 text-right">
            <div className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">ГОТОВО</div>
            <div className="mt-1 text-2xl font-black text-slate-900">
              {project.totalItems > 0
                ? `${project.completedItems} / ${project.totalItems}`
                : '—'}
            </div>
          </div>
        </div>

        <div className="mt-5 h-4 overflow-hidden rounded-full bg-slate-100">
          {progress !== null ? (
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${STATUS_BAR[effectiveStatus]}`}
              style={{ width: `${progress}%` }}
            />
          ) : null}
        </div>
      </div>

      <div className="px-6 py-6 md:px-7">
        <div className="rounded-2xl bg-slate-950 px-5 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">
                СЕЙЧАС
              </div>
              <div className="mt-1 text-2xl font-black uppercase tracking-tight md:text-3xl">
                {project.stage || '—'}
              </div>
            </div>
            {stageProgress !== null ? (
              <div className="text-3xl font-black text-white">
                {formatPercent(stageProgress)}
              </div>
            ) : null}
          </div>

          {stageProgress !== null ? (
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-500"
                style={{ width: `${stageProgress}%` }}
              />
            </div>
          ) : null}

          <div className="mt-4 min-h-12 text-base font-semibold leading-6 text-slate-200">
            {project.currentItem || project.lastEvent || 'Нет активной задачи.'}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">СКОРОСТЬ</div>
            <div className="mt-1 truncate text-xl font-black text-slate-900 md:text-2xl">
              {project.speed || '—'}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">ОСТАЛОСЬ</div>
            <div className="mt-1 truncate text-xl font-black text-slate-900 md:text-2xl">
              {project.eta || '—'}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-sm">
          <span className="text-slate-500">
            {project.lastEvent || 'Нет дополнительных событий.'}
          </span>
          <span className={project.stale ? 'font-bold text-amber-600' : 'font-medium text-slate-400'}>
            Обновлено: {formatUpdatedAt(project.updatedAt, project.ageSeconds)}
          </span>
        </div>
      </div>
    </article>
  );
}

export default function MissionControlClient() {
  const [projects, setProjects] = useState<MissionControlDashboardProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    try {
      const res = await fetch('/api/dashboard/mission-control/status', {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await readResponseJson<StatusResponse>(res, {
        ok: false,
        message: 'Не удалось загрузить Центр управления.',
      });
      if (!res.ok || !data.ok || !Array.isArray(data.projects)) {
        setError(data.message ?? 'Не удалось загрузить Центр управления.');
        return;
      }
      setProjects(data.projects);
      setFetchedAt(data.fetchedAt ?? new Date().toISOString());
      setError(null);
    } catch {
      setError('Нет связи с Центром управления.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => {
      void load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const counters = useMemo(() => {
    const fresh = projects.filter((project) => !project.stale);
    return {
      running: fresh.filter((project) => project.status === 'running').length,
      waiting: projects.filter((project) => project.stale || project.status === 'waiting' || project.status === 'idle').length,
      error: fresh.filter((project) => project.status === 'error').length,
      done: fresh.filter((project) => project.status === 'done').length,
    };
  }, [projects]);

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          <div className="mt-4 text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
            ЗАГРУЖАЮ ЦЕНТР УПРАВЛЕНИЯ
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 pb-10">
      <section className="rounded-3xl bg-slate-950 px-6 py-7 text-white shadow-sm md:px-8 md:py-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-sm font-extrabold uppercase tracking-[0.2em] text-slate-400">
              OWNER MISSION CONTROL
            </div>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] md:text-5xl">
              Центр управления
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300 md:text-lg">
              KIM, движок ASI и ORIS — этап, прогресс, скорость и остаток времени в одном месте.
            </p>
          </div>

          <div className="text-right text-sm text-slate-400">
            <div className="font-semibold text-slate-200">
              {refreshing ? 'Обновляю…' : 'Автообновление каждые 5 сек'}
            </div>
            <div className="mt-1">
              {fetchedAt
                ? `Последний опрос: ${new Date(fetchedAt).toLocaleTimeString('ru-RU')}`
                : '—'}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="РАБОТАЕТ" value={counters.running} tone="green" />
        <SummaryCard label="ЖДЁТ" value={counters.waiting} tone="amber" />
        <SummaryCard label="ОШИБКИ" value={counters.error} tone="red" />
        <SummaryCard label="ГОТОВО" value={counters.done} tone="blue" />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.projectId} project={project} />
        ))}
      </section>
    </div>
  );
}
