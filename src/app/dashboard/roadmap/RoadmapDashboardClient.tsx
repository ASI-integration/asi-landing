'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ASI_PRODUCT_ROADMAP } from '@/lib/roadmap/asi-product-roadmap';
import {
  buildRoadmapSummary,
  countStagesByStatus,
  departmentOverallStatus,
  filterDepartments,
  nearestFocusStages,
} from '@/lib/roadmap/summary';
import {
  ROADMAP_FILTER_LABELS,
  ROADMAP_STATUS_ICON,
  ROADMAP_STATUS_LABELS,
  roadmapStatusAriaLabel,
  roadmapStatusBarClass,
  roadmapStatusColorClass,
  roadmapStatusDotClass,
} from '@/lib/roadmap/status-ui';
import type {
  RoadmapEvidence,
  RoadmapFilter,
  RoadmapStage,
  RoadmapStatus,
} from '@/lib/roadmap/types';

const FILTERS: RoadmapFilter[] = ['all', 'done', 'in_progress', 'blocked', 'later'];

function formatAuditDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function StatusBadge({ status }: { status: RoadmapStatus }) {
  return (
    <span
      role="status"
      aria-label={roadmapStatusAriaLabel(status)}
      data-roadmap-status={status}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${roadmapStatusColorClass(status)}`}
    >
      <span aria-hidden="true">{ROADMAP_STATUS_ICON[status]}</span>
      {ROADMAP_STATUS_LABELS[status]}
    </span>
  );
}

function StatusDot({ status }: { status: RoadmapStatus }) {
  return (
    <span
      className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${roadmapStatusDotClass(status)}`}
      aria-hidden="true"
      data-roadmap-dot={status}
    />
  );
}

function ProgressStrip({
  counts,
  total,
}: {
  counts: Record<RoadmapStatus, number>;
  total: number;
}) {
  if (total === 0) return null;
  const order: RoadmapStatus[] = ['done', 'in_progress', 'blocked', 'later'];
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
      role="img"
      aria-label={`Общее состояние: готово ${counts.done}, в работе ${counts.in_progress}, блокеры ${counts.blocked}, позже ${counts.later}`}
      data-roadmap-progress-strip="true"
    >
      {order.map((status) => {
        const value = counts[status];
        if (value <= 0) return null;
        return (
          <div
            key={status}
            className={`${roadmapStatusBarClass(status)} h-full`}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${ROADMAP_STATUS_LABELS[status]}: ${value}`}
          />
        );
      })}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: RoadmapEvidence[] }) {
  return (
    <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
      {evidence.map((item) => (
        <li key={`${item.kind}:${item.path}:${item.note ?? ''}`} className="break-all">
          <span className="font-medium text-slate-700">{item.kind}</span>
          {': '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-800">
            {item.path}
          </code>
          {item.note ? <span className="text-slate-500"> — {item.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function StageCard({ stage }: { stage: RoadmapStage }) {
  const [open, setOpen] = useState(false);

  return (
    <article
      data-roadmap-stage={stage.id}
      data-roadmap-stage-status={stage.status}
      className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="flex items-center gap-2 sm:pt-0.5">
          <StatusDot status={stage.status} />
          <StatusBadge status={stage.status} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900">{stage.title}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-medium text-slate-700">Сейчас: </span>
            {stage.currentState}
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-medium text-slate-700">Дальше: </span>
            {stage.nextStep}
          </p>
          {stage.blocker ? (
            <p
              className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-800"
              data-roadmap-blocker="true"
            >
              <span className="font-medium">Блокер: </span>
              {stage.blocker}
            </p>
          ) : null}
          {stage.dashboardHref ? (
            <Link
              href={stage.dashboardHref}
              className="inline-flex text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
              data-roadmap-dashboard-link={stage.dashboardHref}
            >
              Открыть в Dashboard →
            </Link>
          ) : null}
          <div>
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              data-roadmap-evidence-toggle={stage.id}
            >
              {open ? 'Скрыть подробности' : 'Подробнее'}
            </button>
            {open ? (
              <div data-roadmap-evidence={stage.id} className="mt-1 border-t border-slate-100 pt-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Evidence</p>
                <EvidenceList evidence={stage.evidence} />
                <p className="mt-2 text-[11px] text-slate-400">
                  Проверено: {formatAuditDate(stage.lastReviewedAt)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function DepartmentCard({
  department,
  defaultOpen,
}: {
  department: (typeof ASI_PRODUCT_ROADMAP)[number];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const counts = countStagesByStatus(department.stages);
  const overall = departmentOverallStatus(department.stages);

  return (
    <section
      data-roadmap-department={department.id}
      data-roadmap-department-status={overall}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        className="flex w-full flex-col gap-3 px-4 py-4 text-left hover:bg-slate-50/80 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-roadmap-department-toggle={department.id}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{department.title}</h2>
            <StatusBadge status={overall} />
          </div>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">{department.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs sm:justify-end">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">
            <span aria-hidden="true">✓</span>
            {counts.done} зел.
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-amber-800">
            <span aria-hidden="true">◐</span>
            {counts.in_progress} жёлт.
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-red-800">
            <span aria-hidden="true">✕</span>
            {counts.blocked} кр.
          </span>
          <span className="text-slate-400" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </div>
      </button>
      {open ? (
        <div
          className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-3 py-3 sm:px-5 sm:py-4"
          data-roadmap-department-body={department.id}
        >
          {department.stages.map((stage) => (
            <StageCard key={stage.id} stage={stage} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function RoadmapDashboardClient() {
  const [filter, setFilter] = useState<RoadmapFilter>('all');
  const summary = useMemo(() => buildRoadmapSummary(), []);
  const focus = useMemo(() => nearestFocusStages(ASI_PRODUCT_ROADMAP, 5), []);
  const departments = useMemo(
    () => filterDepartments(ASI_PRODUCT_ROADMAP, filter),
    [filter],
  );

  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-6 overflow-x-hidden px-4 py-6 sm:px-6"
      data-roadmap-dashboard="true"
    >
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">План ASI</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Наглядная карта готовности продукта по отделам и этапам. Статусы подкреплены
          кодом, тестами или документацией — не placeholder.
        </p>
        <p className="text-sm text-slate-500" data-roadmap-audit-date={summary.lastAuditedAt}>
          Последний аудит: {formatAuditDate(summary.lastAuditedAt)}
        </p>
      </header>

      <section
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        data-roadmap-summary="true"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(summary.counts) as RoadmapStatus[]).map((status) => (
            <div
              key={status}
              className={`rounded-lg border px-3 py-2 ${roadmapStatusColorClass(status)}`}
              data-roadmap-count={status}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <span aria-hidden="true">{ROADMAP_STATUS_ICON[status]}</span>
                {ROADMAP_STATUS_LABELS[status]}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{summary.counts[status]}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Общее состояние</span>
            <span>{summary.total} этапов</span>
          </div>
          <ProgressStrip counts={summary.counts} total={summary.total} />
          <div
            className="flex flex-wrap gap-2 pt-1"
            data-roadmap-status-legend="true"
            aria-label="Легенда статусов"
          >
            {(Object.keys(summary.counts) as RoadmapStatus[]).map((status) => (
              <StatusBadge key={`legend-${status}`} status={status} />
            ))}
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        data-roadmap-focus="true"
      >
        <h2 className="text-base font-semibold text-slate-900">Ближайший фокус</h2>
        <p className="mt-1 text-sm text-slate-600">
          Приоритетные блокеры и этапы в работе.
        </p>
        <ol className="mt-3 space-y-2">
          {focus.map((stage, index) => (
            <li
              key={stage.id}
              className="flex flex-col gap-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              data-roadmap-focus-item={stage.id}
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 text-xs font-semibold text-slate-400">{index + 1}.</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot status={stage.status} />
                    <span className="text-sm font-medium text-slate-900">{stage.title}</span>
                    <StatusBadge status={stage.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">{stage.nextStep}</p>
                </div>
              </div>
              {stage.dashboardHref ? (
                <Link
                  href={stage.dashboardHref}
                  className="shrink-0 text-xs font-medium text-slate-700 underline-offset-2 hover:underline"
                >
                  Dashboard
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Фильтр статусов"
        data-roadmap-filters="true"
      >
        {FILTERS.map((value) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              data-roadmap-filter={value}
              onClick={() => setFilter(value)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {ROADMAP_FILTER_LABELS[value]}
            </button>
          );
        })}
      </div>

      <div className="space-y-3" data-roadmap-departments="true">
        {departments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            Нет этапов для выбранного фильтра.
          </p>
        ) : (
          departments.map((department, index) => (
            <DepartmentCard
              key={department.id}
              department={department}
              defaultOpen={filter !== 'all' || index === 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
