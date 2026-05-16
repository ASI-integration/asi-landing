'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
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
  processing: 'Генерируется',
  ready: 'Готов',
  failed: 'Ошибка, попробовать снова',
};

const PAID_REPORT_START_HREF = '/ru/location-analysis?mode=residential#location-check';

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

function savedReportType(report: PendingLocationReportContext): 'Бесплатный' | 'Подробный' {
  return report.requestId || report.paidReportId ? 'Подробный' : 'Бесплатный';
}

function savedReportStatus(report: PendingLocationReportContext): string {
  if (!report.requestId && !report.paidReportId) return 'Готов';
  return STATUS_LABELS[report.status ?? 'payment_pending'];
}

function savedReportHref(report: PendingLocationReportContext): string {
  if (report.paidReportId) return `/dashboard/reports/${encodeURIComponent(report.paidReportId)}`;
  if (report.requestId) return `/dashboard/reports/${encodeURIComponent(report.requestId)}`;
  if (report.freeReportPermalink) return report.freeReportPermalink;
  if (report.freeReportId) return `/ru/location-report/${encodeURIComponent(report.freeReportId)}`;
  return '/dashboard/reports';
}

export function ReportsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingReport, setPendingReport] = useState<PendingLocationReportContext | null>(null);
  const [freeAddress, setFreeAddress] = useState('');
  const [freeBusy, setFreeBusy] = useState(false);
  const [freeError, setFreeError] = useState('');
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
    if (pendingReport?.address) setFreeAddress(pendingReport.address);
  }, [pendingReport?.address]);

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
      if (res.status === 401 && typeof data?.loginUrl === 'string') {
        router.push(data.loginUrl);
        return;
      }
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

  async function openFreeReport(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (freeBusy) return;

    const existingPermalink = pendingReport?.freeReportPermalink
      ?? (pendingReport?.freeReportId ? `/ru/location-report/${encodeURIComponent(pendingReport.freeReportId)}` : '');
    if (existingPermalink) {
      router.push(existingPermalink);
      return;
    }

    const address = (pendingReport?.address ?? freeAddress).trim();
    if (!address) {
      setFreeError('Введите адрес объекта.');
      return;
    }

    setFreeBusy(true);
    setFreeError('');
    try {
      const res = await fetch('/api/location-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address,
          is_paid: false,
          locale: 'ru',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (!data?.reportId && !data?.permalink)) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'request_failed');
      }

      const reportId = typeof data.reportId === 'string' ? data.reportId : undefined;
      const permalink = typeof data.permalink === 'string'
        ? data.permalink
        : reportId
          ? `/ru/location-report/${encodeURIComponent(reportId)}`
          : '';
      if (!permalink) throw new Error('missing_permalink');

      const next = sanitizePendingLocationReportContext({
        address: typeof data.address === 'string' ? data.address : address,
        lat: typeof data.lat === 'number' ? data.lat : pendingReport?.lat,
        lon: typeof data.lon === 'number' ? data.lon : pendingReport?.lon,
        freeReportId: reportId,
        freeReportPermalink: permalink,
        mode: 'residential',
        createdAt: new Date().toISOString(),
        status: 'ready',
      });
      if (next) {
        setPendingReport(next);
        writeStoredPendingReport(next);
      }
      router.push(permalink);
    } catch {
      setFreeError('Не удалось создать бесплатный отчёт. Уточните адрес и попробуйте снова.');
    } finally {
      setFreeBusy(false);
    }
  }

  const freeReportHasContext = Boolean(pendingReport?.address);
  const freeReportCanOpenExisting = Boolean(pendingReport?.freeReportPermalink || pendingReport?.freeReportId);

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Отчёты по объектам</h1>
        <p className="mt-2 text-base leading-relaxed text-slate-600">
          Сначала можно получить бесплатный краткий отчёт по адресу. Подробный отчёт доступен после оплаты и генерации.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="flex min-h-[260px] flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900">Бесплатный отчёт по локации</h2>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              Быстрый общий вывод по адресу: спрос, риски, сильные объекты рядом и первичная оценка локации.
            </p>
          </div>
          <form onSubmit={openFreeReport} className="mt-6 space-y-3">
            {freeReportHasContext ? (
              <p className="text-sm leading-relaxed text-slate-500">
                {freeReportCanOpenExisting ? 'Готовый бесплатный отчёт:' : 'Создадим бесплатный отчёт для адреса:'}{' '}
                {pendingReport?.address}
              </p>
            ) : (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Адрес объекта</span>
                <input
                  type="text"
                  value={freeAddress}
                  onChange={event => setFreeAddress(event.target.value)}
                  placeholder="Город, улица, дом"
                  className="mt-2 min-h-[48px] w-full rounded-lg border border-slate-300 px-4 py-3 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
                />
              </label>
            )}
            {freeError ? <p className="text-sm text-red-600">{freeError}</p> : null}
            <button
              type="submit"
              disabled={freeBusy}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
            >
              {freeBusy ? 'Готовим отчёт…' : 'Получить бесплатный отчёт'}
            </button>
          </form>
        </article>

        <article className="flex min-h-[260px] flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900">Подробный платный отчёт</h2>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              Расширенный разбор объекта: спрос, конкуренция, транспорт, окружение, риски, рекомендации по цене и запуску.
            </p>
            {pendingReport && !pendingReport.requestId ? (
              <p className="mt-4 text-sm leading-relaxed text-slate-500">
                Можно продолжить с адресом: {pendingReport.address}
              </p>
            ) : null}
            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          </div>
          {pendingReport && (!pendingReport.requestId || pendingReport.status === 'failed') ? (
            <button
              type="button"
              onClick={orderDetailedReport}
              disabled={busy}
              className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
            >
              {busy ? 'Создаём заявку…' : 'Заказать подробный отчёт'}
            </button>
          ) : (
            <Link
              href={PAID_REPORT_START_HREF}
              className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800 sm:w-fit"
            >
              Заказать подробный отчёт
            </Link>
          )}
        </article>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Мои сохранённые отчёты</h2>
        {pendingReport ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_140px_150px_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-900">{pendingReport.address}</p>
                <p className="mt-1 text-sm text-slate-500">{formatDateRu(pendingReport.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Тип</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{savedReportType(pendingReport)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Статус</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{savedReportStatus(pendingReport)}</p>
              </div>
              <Link
                href={savedReportHref(pendingReport)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
              >
                Открыть
              </Link>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-base text-slate-600">
            Пока нет сохранённых отчётов.
          </p>
        )}
      </section>
    </div>
  );
}
