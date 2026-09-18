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
  hasLocationReportStatusReached,
  isLocationReportStatusStage,
  LOCATION_REPORT_STATUS_ACTIONS,
  LOCATION_REPORT_STATUS_INVALID_REQUEST_MESSAGE,
  LOCATION_REPORT_STATUS_POLL_ERROR_MESSAGE,
  LOCATION_REPORT_STATUS_STAGE_CONFIG,
  LOCATION_REPORT_STATUS_STAGE_SEQUENCE,
  resolveLocationReportStatusActionHref,
} from '@/lib/location/report-status-flow';
import { REPORT_PIPELINE_NOT_READY_PUBLIC_MESSAGE } from '@/lib/location/report-pipeline-readiness';

const STATUS_POLL_MS = 5000;

type StatusProgressClientProps = {
  requestId: string;
  initialArtifact?: ReportArtifact | null;
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
  if (state === 'done') return 'bg-asi-navy text-asi-ivory';
  if (state === 'active') return 'bg-asi-gold/20 text-asi-gold-text';
  return 'bg-asi-ivory text-asi-navy/50 border border-asi-border';
}

function actionClassName(tone: 'primary' | 'secondary'): string {
  if (tone === 'primary') {
    return 'inline-flex min-h-12 items-center justify-center rounded-sm bg-asi-navy px-5 py-3 text-sm font-sans font-semibold text-asi-ivory transition-colors hover:bg-asi-navy-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asi-navy';
  }
  return 'inline-flex min-h-12 items-center justify-center rounded-sm border border-asi-navy/70 px-5 py-3 text-sm font-sans font-semibold text-asi-navy transition-colors hover:border-asi-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asi-navy';
}

function StatusLoadingIndicator() {
  return (
    <div
      className="mt-6 flex items-center gap-3 border border-asi-border bg-asi-ivory px-4 py-3"
      data-location-report-loading="true"
      role="status"
    >
      <span
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-asi-border border-t-asi-gold"
        aria-hidden="true"
      />
      <p className="text-sm text-asi-navy/70">Обновляем статус формирования отчёта…</p>
    </div>
  );
}

export function StatusProgressClient({ requestId, initialArtifact = null }: StatusProgressClientProps) {
  const [status, setStatus] = useState<ReportArtifactStatus>(
    initialArtifact?.status ?? REPORT_ARTIFACT_STATUS.reportForming,
  );
  const [artifact, setArtifact] = useState<ReportArtifact | null>(initialArtifact);
  const [pollError, setPollError] = useState<string | null>(null);
  const [requestNotFound, setRequestNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(!initialArtifact);
  const pollPath = `/api/location-full-report/request/${encodeURIComponent(requestId)}/status`;

  useEffect(() => {
    let cancelled = false;

    async function pollStatus() {
      try {
        const res = await fetch(pollPath, { cache: 'no-store' });
        const payload = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.status === 404) {
          setRequestNotFound(true);
          setPollError(null);
          setIsLoading(false);
          return;
        }

        if (res.status === 503 && payload && typeof payload === 'object') {
          setPollError(
            typeof payload.message === 'string'
              ? payload.message
              : REPORT_PIPELINE_NOT_READY_PUBLIC_MESSAGE,
          );
          setStatus(REPORT_ARTIFACT_STATUS.reportForming);
          setIsLoading(false);
          return;
        }

        if (!res.ok) throw new Error('status_unavailable');

        const nextArtifact = reportArtifactFromPayload(payload);
        if (!nextArtifact) {
          setIsLoading(false);
          return;
        }

        setArtifact(nextArtifact);
        setStatus(nextArtifact.status);
        setPollError(null);
        setRequestNotFound(false);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setPollError(LOCATION_REPORT_STATUS_POLL_ERROR_MESSAGE);
          setIsLoading(false);
        }
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
  const currentStageCopy = isLocationReportStatusStage(status)
    ? LOCATION_REPORT_STATUS_STAGE_CONFIG[status]
    : LOCATION_REPORT_STATUS_STAGE_CONFIG[REPORT_ARTIFACT_STATUS.reportForming];

  const visibleActions = LOCATION_REPORT_STATUS_ACTIONS.flatMap((action) => {
    if (!hasLocationReportStatusReached(status, action.availableFrom)) return [];
    const href = resolveLocationReportStatusActionHref(action, artifact);
    if (!href) return [];
    if (action.id === 'preliminary_report' && artifact?.final_report_url) return [];
    return [{ ...action, href }];
  });

  if (requestNotFound) {
    return (
      <div
        className="mt-8 border border-asi-border bg-asi-ivory px-5 py-4 text-sm leading-relaxed text-asi-navy/75"
        data-location-report-request-id={requestId}
        data-location-report-invalid-request="true"
        role="status"
      >
        {LOCATION_REPORT_STATUS_INVALID_REQUEST_MESSAGE}
      </div>
    );
  }

  if (status === REPORT_ARTIFACT_STATUS.failed) {
    return (
      <div
        className="mt-8 border border-asi-border bg-asi-ivory px-5 py-4 text-sm leading-relaxed text-asi-navy/75"
        data-location-report-request-id={requestId}
        data-location-report-stage={status}
        role="alert"
      >
        Не удалось сформировать отчёт. Мы проверим заказ и вернёмся с решением.
      </div>
    );
  }

  return (
    <>
      <section
        className="mt-8 border border-asi-border bg-asi-ivory p-5"
        data-location-report-request-id={requestId}
        data-location-report-poll-path={pollPath}
        data-location-report-stage={status}
      >
        <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
          Текущий этап
        </p>
        <h2 className="mt-2 font-serif text-xl tracking-tight text-asi-navy sm:text-2xl">
          {currentStageCopy.label}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-asi-navy/70 sm:text-base">
          {currentStageCopy.detail}
        </p>
        {isLoading ? <StatusLoadingIndicator /> : null}
        {!isLoading ? (
          <p className="mt-4 text-sm text-asi-navy/50">Статус обновляется автоматически.</p>
        ) : null}
        {pollError ? (
          <p
            className="mt-4 border border-asi-border bg-asi-paper px-4 py-3 text-sm leading-relaxed text-asi-navy/75"
            data-location-report-poll-error="true"
            role="status"
          >
            {pollError}
          </p>
        ) : null}
      </section>

      <div className="mt-8 space-y-3" role="list" aria-label="Этапы формирования отчёта">
        {LOCATION_REPORT_STATUS_STAGE_SEQUENCE.map((item, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          const state = isDone ? 'done' : isActive ? 'active' : 'waiting';
          const copy = LOCATION_REPORT_STATUS_STAGE_CONFIG[item];
          return (
            <div
              key={item}
              role="listitem"
              className="flex flex-col gap-4 border border-asi-border bg-asi-ivory p-4 sm:flex-row sm:items-start sm:justify-between"
              data-location-report-step={item}
              data-location-report-step-state={state}
            >
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-semibold text-asi-navy sm:text-base">{copy.label}</p>
                <p className="text-sm leading-relaxed text-asi-navy/60">{copy.detail}</p>
              </div>
              <span className={`shrink-0 rounded-sm px-3 py-1 text-xs font-semibold ${badgeClassName(state)}`}>
                {isDone ? 'готово' : isActive ? 'в процессе' : 'ожидает'}
              </span>
            </div>
          );
        })}
      </div>

      {reportSections.length > 0 ? (
        <div className="mt-8 border border-asi-border bg-asi-ivory p-5">
          <p className="text-sm font-semibold text-asi-navy">Разделы отчёта</p>
          <ul className="mt-3 space-y-3">
            {reportSections.map(section => (
              <li
                key={section.id}
                className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-medium text-asi-navy">{section.title}</span>
                <span className="text-asi-navy/60">{section.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {visibleActions.length > 0 ? (
        <div className="mt-8 flex flex-wrap gap-3" data-location-report-actions="true">
          {visibleActions.map((action) => (
            <Link
              key={action.id}
              href={action.href}
              className={actionClassName(action.tone)}
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
