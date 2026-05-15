'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PENDING_LOCATION_REPORT_STORAGE_KEY,
  pendingLocationReportFromSearchParams,
  sanitizePendingLocationReportContext,
  type PendingLocationReportContext,
  type PendingLocationReportStatus,
} from '@/lib/location/pending-location-report';

const STATUS_LABELS: Record<PendingLocationReportStatus, string> = {
  payment_pending: 'Ожидает оплаты',
  processing: 'Готовим отчёт',
  ready: 'Готов',
  failed: 'Ошибка, попробовать снова',
};

function readStoredPendingReport(): PendingLocationReportContext | null {
  try {
    const raw = window.localStorage.getItem(PENDING_LOCATION_REPORT_STORAGE_KEY);
    if (!raw) return null;
    return sanitizePendingLocationReportContext(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredPendingReport(context: PendingLocationReportContext): void {
  try {
    window.localStorage.setItem(PENDING_LOCATION_REPORT_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // Keep the in-memory card even if storage is unavailable.
  }
}

function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function mapApiStatus(status: unknown): PendingLocationReportStatus {
  if (status === 'processing') return 'processing';
  if (status === 'completed') return 'ready';
  if (status === 'failed') return 'failed';
  return 'payment_pending';
}

export function ReportsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingReport, setPendingReport] = useState<PendingLocationReportContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const contextFromUrl = useMemo(
    () => pendingLocationReportFromSearchParams(searchParams),
    [searchParams],
  );

  useEffect(() => {
    const next = contextFromUrl ?? readStoredPendingReport();
    if (!next) return;
    const normalized = { ...next, status: next.status ?? 'payment_pending' } satisfies PendingLocationReportContext;
    setPendingReport(normalized);
    writeStoredPendingReport(normalized);
  }, [contextFromUrl]);

  useEffect(() => {
    const requestId = pendingReport?.requestId;
    if (!requestId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/location-full-report/request/${encodeURIComponent(requestId)}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        setPendingReport(current => {
          if (!current || current.requestId !== requestId) return current;
          const next: PendingLocationReportContext = {
            ...current,
            status: mapApiStatus(data.status),
            ...(typeof data.reportId === 'string' && data.reportId ? { paidReportId: data.reportId } : {}),
            ...(typeof data.updatedAt === 'string' ? { updatedAt: data.updatedAt } : {}),
          };
          writeStoredPendingReport(next);
          return next;
        });
      } catch {
        // Status polling is best-effort for the placeholder flow.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingReport?.requestId]);

  async function orderDetailedReport() {
    if (!pendingReport || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/location-full-report/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: pendingReport.address,
          lat: pendingReport.lat,
          lon: pendingReport.lon,
          locale: 'ru',
          mode: 'residential',
          delivery: { channel: 'dashboard', target: 'dashboard' },
          access_tier: 'paid_required',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.requestId) throw new Error('request_failed');
      const requestId = String(data.requestId);
      const next: PendingLocationReportContext = {
        ...pendingReport,
        requestId,
        status: 'payment_pending',
        updatedAt: new Date().toISOString(),
      };
      setPendingReport(next);
      writeStoredPendingReport(next);
      router.push(`/dashboard/reports/${encodeURIComponent(requestId)}`);
    } catch {
      const next = { ...pendingReport, status: 'failed' as const, updatedAt: new Date().toISOString() };
      setPendingReport(next);
      writeStoredPendingReport(next);
      setError('Не удалось создать заявку. Попробуйте снова.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Мои отчёты</h1>
        <p className="mt-2 text-base leading-relaxed text-slate-600">
          Подробный отчёт доступен в личном кабинете. После оплаты отчёт появится в разделе Мои отчёты.
        </p>
      </div>

      {pendingReport ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Отчёт по локации</p>
              <h2 className="mt-2 text-2xl font-bold leading-snug text-slate-900">{pendingReport.address}</h2>
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-600">
                <span className="rounded-full bg-slate-100 px-3 py-1">Жилая недвижимость</span>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
                  {STATUS_LABELS[pendingReport.status ?? 'payment_pending']}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {formatDateRu(pendingReport.createdAt)}
                </span>
              </div>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
                Детальный расчёт появится после оплаты и генерации отчёта. Сейчас мы сохраняем адрес и контекст бесплатной проверки.
              </p>
              {pendingReport.requestId ? (
                <p className="mt-3 text-sm text-slate-500">Номер заявки: {pendingReport.requestId}</p>
              ) : null}
              {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto">
              {!pendingReport.requestId || pendingReport.status === 'failed' ? (
                <button
                  type="button"
                  onClick={orderDetailedReport}
                  disabled={busy}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? 'Создаём заявку…' : 'Заказать подробный отчёт'}
                </button>
              ) : (
                <Link
                  href={`/dashboard/reports/${encodeURIComponent(pendingReport.requestId)}`}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  Открыть отчёт
                </Link>
              )}
              <Link
                href="/ru/location-analysis?mode=residential#location-check"
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
              >
                Оценить другой адрес
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-xl font-bold text-slate-900">Здесь появятся ваши отчёты</h2>
          <p className="mx-auto mt-2 max-w-xl text-base leading-relaxed text-slate-600">
            Сначала получите общий отчёт по локации, затем запросите подробный отчёт по выбранному адресу.
          </p>
          <Link
            href="/ru/location-analysis?mode=residential#location-check"
            className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Оценить объект по адресу
          </Link>
        </section>
      )}
    </div>
  );
}
