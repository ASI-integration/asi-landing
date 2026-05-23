'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  normalizeReportArtifactStatus,
  REPORT_ARTIFACT_STATUS,
  type ReportArtifact,
  type ReportArtifactStatus,
} from '@/lib/location/report-artifact';
import { resolveReportSectionsFromArtifact } from '@/lib/location/report-document-render';
import {
  getNextLocationReportStatusStage,
  hasLocationReportStatusReached,
  isLocationReportStatusStage,
  LOCATION_REPORT_STATUS_ACTIONS,
  LOCATION_REPORT_STATUS_STAGE_CONFIG,
  LOCATION_REPORT_STATUS_STAGE_SEQUENCE,
} from '@/lib/location/report-status-flow';
import { REPORT_PIPELINE_NOT_READY_PUBLIC_MESSAGE } from '@/lib/location/report-pipeline-readiness';

const MOCK_STAGE_ADVANCE_MS = 1400;
const STATUS_POLL_MS = 5000;

type StatusProgressClientProps = {
  initialStatus: ReportArtifactStatus;
  requestId?: string;
};

function reportArtifactFromPayload(payload: unknown): ReportArtifact | null {
  const artifact = (payload as { report_artifact?: unknown } | null)?.report_artifact ?? payload;
  if (!artifact || typeof artifact !== 'object') return null;
  const candidate = artifact as Partial<ReportArtifact>;
  if (typeof candidate.request_id !== 'string') return null;
  return {
    request_id: candidate.request_id,
    status: normalizeReportArtifactStatus(candidate.status),
    preliminary_report_url: typeof candidate.preliminary_report_url === 'string'
      ? candidate.preliminary_report_url
      : null,
    final_report_url: typeof candidate.final_report_url === 'string'
      ? candidate.final_report_url
      : null,
    pdf_url: typeof candidate.pdf_url === 'string' ? candidate.pdf_url : null,
    generated_at: typeof candidate.generated_at === 'string' ? candidate.generated_at : null,
    expires_at: typeof candidate.expires_at === 'string' ? candidate.expires_at : null,
    cleanup_ready: candidate.cleanup_ready === true,
    metadata: candidate.metadata ?? {},
    created_at: typeof candidate.created_at === 'string' ? candidate.created_at : new Date().toISOString(),
    updated_at: typeof candidate.updated_at === 'string' ? candidate.updated_at : new Date().toISOString(),
  };
}

function badgeClassName(state: 'done' | 'active' | 'waiting'): string {
  if (state === 'done') return 'bg-emerald-500/20 text-emerald-300';
  if (state === 'active') return 'bg-amber-500/20 text-amber-200';
  return 'bg-slate-800 text-slate-400';
}

function actionClassName(tone: 'primary' | 'secondary'): string {
  if (tone === 'primary') {
    return 'inline-flex min-h-[48px] items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100';
  }
  return 'inline-flex min-h-[48px] items-center justify-center rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:text-white';
}

export function StatusProgressClient({ initialStatus, requestId }: StatusProgressClientProps) {
  const [status, setStatus] = useState<ReportArtifactStatus>(initialStatus);
  const [artifact, setArtifact] = useState<ReportArtifact | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollPath = requestId
    ? `/api/location-full-report/request/${encodeURIComponent(requestId)}/status`
    : null;

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (requestId) return undefined;
    if (!isLocationReportStatusStage(status)) return undefined;
    const nextStage = getNextLocationReportStatusStage(status);
    if (!nextStage) return undefined;
    const timer = window.setTimeout(() => setStatus(nextStage), MOCK_STAGE_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [requestId, status]);

  useEffect(() => {
    if (!pollPath) return undefined;
    let cancelled = false;

    async function pollStatus() {
      try {
        const res = await fetch(pollPath!, { cache: 'no-store' });
        const payload = await res.json().catch(() => null);
        if (res.status === 503 && payload && typeof payload === 'object') {
          if (!cancelled) {
            setPollError(
              typeof payload.message === 'string'
                ? payload.message
                : REPORT_PIPELINE_NOT_READY_PUBLIC_MESSAGE,
            );
            setStatus(REPORT_ARTIFACT_STATUS.reportForming);
          }
          return;
        }
        if (!res.ok) throw new Error('status_unavailable');
        const nextArtifact = reportArtifactFromPayload(payload);
        if (!nextArtifact || cancelled) return;
        setArtifact(nextArtifact);
        setStatus(nextArtifact.status);
        setPollError(null);
      } catch {
        if (!cancelled) setPollError('Не удалось обновить статус. Попробуем ещё раз.');
      }
    }

    void pollStatus();
    const interval = window.setInterval(pollStatus, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollPath]);

  const activeIndex = useMemo(
    () => isLocationReportStatusStage(status)
      ? LOCATION_REPORT_STATUS_STAGE_SEQUENCE.indexOf(status)
      : -1,
    [status],
  );
  const reportSections = resolveReportSectionsFromArtifact(artifact);

  if (status === REPORT_ARTIFACT_STATUS.failed) {
    return (
      <div
        className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm leading-relaxed text-rose-100"
        data-location-report-request-id={requestId}
        data-location-report-stage={status}
      >
        Не удалось сформировать отчёт. Мы проверим заказ и вернёмся с решением.
      </div>
    );
  }

  return (
    <>
      <ol
        className="mt-8 space-y-3"
        data-location-report-request-id={requestId}
        data-location-report-poll-path={pollPath ?? undefined}
        data-location-report-stage={status}
      >
        {LOCATION_REPORT_STATUS_STAGE_SEQUENCE.map((item, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          const state = isDone ? 'done' : isActive ? 'active' : 'waiting';
          const copy = LOCATION_REPORT_STATUS_STAGE_CONFIG[item];
          return (
            <li
              key={item}
              className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-100 sm:text-base">{copy.label}</span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-400">{copy.detail}</span>
              </span>
              <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${badgeClassName(state)}`}>
                {isDone ? 'готово' : isActive ? 'в процессе' : 'ожидает'}
              </span>
            </li>
          );
        })}
      </ol>

      {requestId ? (
        <p className="mt-4 text-sm text-slate-400">
          Статус обновляется автоматически.
        </p>
      ) : null}
      {pollError ? (
        <p className="mt-3 text-sm text-amber-200">{pollError}</p>
      ) : null}

      {reportSections.length > 0 ? (
        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-4">
          <p className="text-sm font-semibold text-slate-100">Разделы отчёта</p>
          <ul className="mt-3 space-y-2">
            {reportSections.map(section => (
              <li key={section.id} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-slate-200">{section.title}</span>
                <span className="text-slate-400">{section.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        {LOCATION_REPORT_STATUS_ACTIONS.map((action) => (
          hasLocationReportStatusReached(status, action.availableFrom) ? (
            <Link
              key={action.id}
              href={artifact?.[action.href] ?? action.fallbackHref}
              className={actionClassName(action.tone)}
            >
              {action.label}
            </Link>
          ) : null
        ))}
      </div>
    </>
  );
}
