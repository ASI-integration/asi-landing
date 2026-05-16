'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  PENDING_LOCATION_REPORT_STORAGE_KEY,
  sanitizePendingLocationReportContext,
  type PendingLocationReportContext,
  type PendingLocationReportStatus,
} from '@/lib/location/pending-location-report';

const STATUS_LABELS: Record<PendingLocationReportStatus, string> = {
  payment_pending: 'Ожидает оплаты',
  processing: 'Генерируется',
  ready: 'Готов',
  failed: 'Ошибка, попробовать снова',
};

const LOCKED_SECTIONS = [
  'Полный вывод по адресу',
  'Спрос рядом',
  'Конкуренция',
  'Транспорт и окружение',
  'Риски',
  'Рекомендации по цене и запуску',
] as const;

function readStoredReport(reportId: string): PendingLocationReportContext | null {
  try {
    const raw = window.localStorage.getItem(PENDING_LOCATION_REPORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = sanitizePendingLocationReportContext(JSON.parse(raw));
    if (!parsed) return null;
    if (parsed.requestId === reportId || parsed.paidReportId === reportId) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeStoredReport(context: PendingLocationReportContext): void {
  try {
    window.localStorage.setItem(PENDING_LOCATION_REPORT_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // Ignore private-mode storage failures.
  }
}

function mapApiStatus(status: unknown): PendingLocationReportStatus {
  if (status === 'processing') return 'processing';
  if (status === 'completed') return 'ready';
  if (status === 'failed') return 'failed';
  return 'payment_pending';
}

export function ReportPlaceholderClient({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<PendingLocationReportContext | null>(null);
  const reportRef = useRef<PendingLocationReportContext | null>(null);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    const stored = readStoredReport(reportId);
    if (stored) setReport(stored);
  }, [reportId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/location-full-report/request/${encodeURIComponent(reportId)}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const current = reportRef.current;
        const next = sanitizePendingLocationReportContext({
          ...(current ?? {}),
          address: typeof data.address === 'string' ? data.address : current?.address,
          lat: typeof data.lat === 'number' ? data.lat : current?.lat,
          lon: typeof data.lon === 'number' ? data.lon : current?.lon,
          mode: 'residential',
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : current?.createdAt,
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : current?.updatedAt,
          requestId: reportId,
          paidReportId: typeof data.reportId === 'string' ? data.reportId : current?.paidReportId,
          status: mapApiStatus(data.status),
        });
        if (!next) return;
        setReport(next);
        writeStoredReport(next);
      } catch {
        // The placeholder can render from local context without live status.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const status = report?.status ?? 'payment_pending';

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Подробный отчёт</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {report?.address ?? 'Отчёт по выбранной локации'}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Подробный расчёт появится после оплаты и генерации. Сейчас это место для будущего полного отчёта.
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
          {STATUS_LABELS[status]}
        </span>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Оплата</h2>
        <p className="mt-2 text-base leading-relaxed text-slate-600">
          Оплата пока не подключена в интерфейсе. После оплаты отчёт появится в разделе Мои отчёты.
        </p>
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5">
          <p className="text-sm font-semibold text-slate-900">Платёжная ссылка</p>
          <p className="mt-1 text-sm text-slate-500">Будет доступна здесь.</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Разделы полного отчёта</h2>
            <p className="mt-1 text-sm text-slate-500">Закрыто до оплаты и генерации.</p>
          </div>
          <button
            type="button"
            disabled
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400"
          >
            Скачать PDF
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {LOCKED_SECTIONS.map(section => (
            <div key={section} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-base font-semibold text-slate-900">{section}</p>
              <p className="mt-2 text-sm text-slate-500">Детальный расчёт появится после оплаты.</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard/reports"
          className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Вернуться в Мои отчёты
        </Link>
        {report?.paidReportId ? (
          <Link
            href={`/dashboard/reports/${encodeURIComponent(report.paidReportId)}`}
            className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-base font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            Открыть готовый отчёт
          </Link>
        ) : null}
      </div>
    </div>
  );
}
