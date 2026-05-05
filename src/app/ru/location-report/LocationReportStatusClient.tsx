'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

const manualReportPriceRub = Number(process.env.NEXT_PUBLIC_LOCATION_REPORT_PRICE_RUB);
const MANUAL_REPORT_PRICE_RUB =
  Number.isFinite(manualReportPriceRub) && manualReportPriceRub > 0
    ? manualReportPriceRub
    : 990;

export type RequestStatus = {
  requestId?: string;
  status?: string;
  access_status?: 'draft' | 'pending_payment' | 'paid' | 'granted' | 'generated' | 'expired';
  payment_provider?: 'manual' | 'yookassa';
  payment_id?: string | null;
  payment_url?: string | null;
  reportId?: string | null;
  next_action?: { type?: string; url?: string };
  error?: string;
};

export function LocationReportStatusClient({
  initialRequestId,
  initialStatus,
}: {
  initialRequestId?: string;
  initialStatus?: RequestStatus | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = initialRequestId ?? searchParams.get('requestId')?.trim() ?? '';
  const [status, setStatus] = useState<RequestStatus | null>(initialStatus ?? null);
  const [loading, setLoading] = useState(Boolean(requestId) && !initialStatus);
  const [generating, setGenerating] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (status?.access_status === 'granted' && status.reportId) {
      router.replace(`/ru/location-report/${status.reportId}`);
    }
  }, [router, status?.access_status, status?.reportId]);

  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/location-full-report/request/${encodeURIComponent(requestId)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'status_failed');
        if (!cancelled) setStatus(json);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (!initialStatus) void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [initialStatus, requestId]);

  async function generateReport() {
    if (!requestId || generating) return;
    setGenerating(true);
    setErr(null);
    try {
      const res = await fetch('/api/location-full-report/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'process_failed');
      setStatus(current => ({
        ...current,
        ...json,
        requestId,
        reportId: json?.reportId ?? current?.reportId ?? null,
        access_status: json?.access_status ?? current?.access_status,
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function confirmPayment() {
    if (!requestId || confirmingPayment) return;
    setConfirmingPayment(true);
    setErr(null);
    try {
      const res = await fetch('/api/location-full-report/confirm-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'confirm_failed');

      setStatus(current => ({
        ...current,
        ...json,
        requestId,
        reportId: json?.reportId ?? current?.reportId ?? null,
        access_status: json?.access_status ?? current?.access_status,
      }));

      if (json?.next_action?.url) {
        router.replace(json.next_action.url);
      } else {
        router.replace(`/ru/location-report?requestId=${encodeURIComponent(requestId)}`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmingPayment(false);
    }
  }

  const statusView = (() => {
    if (!requestId) return null;
    const accessStatus = status?.access_status;
    const reportUrl = status?.reportId ? `/ru/location-report/${status.reportId}` : status?.next_action?.url;
    const paymentUrl = status?.payment_url || null;
    const isYooKassaPayment = status?.payment_provider === 'yookassa';
    const isManualPayment = status?.payment_provider === 'manual';

    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="rounded-3xl border border-slate-800/70 bg-slate-900/20 p-8 sm:p-10">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полный отчёт</p>
            <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Статус заказа</h1>
            <p className="mt-3 text-slate-300 leading-relaxed">
              Полный отчёт включает магниты спроса, расстояния, сценарии дохода, риски и рекомендации.
              Доступ к полной версии открывается по серверному статусу заказа.
            </p>
            {accessStatus === 'pending_payment' ? (
              <p className="mt-3 text-slate-400 leading-relaxed">
                {isYooKassaPayment
                  ? 'Оплатите полный отчёт картой. После успешной оплаты YooKassa вернёт вас на страницу статуса, а доступ откроется автоматически.'
                  : 'Оплатите полный отчёт вручную. После перевода нажмите «Я оплатил» — страница проверит заявку и сразу откроет отчёт.'}
              </p>
            ) : null}

            {accessStatus === 'pending_payment' && isYooKassaPayment ? (
              <div className="mt-7 rounded-3xl border border-indigo-500/30 bg-indigo-950/20 p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-200/80">Оплата картой</p>
                <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <p className="text-4xl font-black tracking-tight text-white tabular-nums">
                    {`${MANUAL_REPORT_PRICE_RUB.toLocaleString('ru-RU')} ₽`}
                  </p>
                  <p className="pb-1 text-sm text-slate-400">полный отчёт по локации</p>
                </div>
                <div className="mt-5 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Номер заявки</p>
                  <p className="mt-2 font-mono text-sm text-slate-100 break-all">{requestId}</p>
                  {status?.payment_id ? (
                    <>
                      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Платёж YooKassa</p>
                      <p className="mt-2 font-mono text-sm text-slate-100 break-all">{status.payment_id}</p>
                    </>
                  ) : null}
                </div>
                {paymentUrl ? (
                  <a
                    href={paymentUrl}
                    className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-4 text-sm font-bold text-slate-950 shadow-lg shadow-indigo-950/20 transition-colors hover:bg-slate-100"
                  >
                    Оплатить картой
                  </a>
                ) : (
                  <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                    Платёж YooKassa создан не полностью. Обновите страницу статуса через несколько секунд.
                  </p>
                )}
              </div>
            ) : accessStatus === 'pending_payment' && isManualPayment ? (
              <div className="mt-7 rounded-3xl border border-indigo-500/30 bg-indigo-950/20 p-5 sm:p-6">
                <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-start">
                  <div className="w-full max-w-[180px] mx-auto sm:mx-0">
                    <div className="aspect-square rounded-2xl border border-slate-700/70 bg-white p-4 shadow-lg shadow-indigo-950/20">
                      <div className="grid h-full w-full grid-cols-5 grid-rows-5 gap-1">
                        {Array.from({ length: 25 }).map((_, i) => (
                          <span
                            key={i}
                            className={`rounded-sm ${
                              [0, 1, 3, 4, 5, 9, 15, 19, 20, 21, 23, 24, 7, 11, 13, 17].includes(i)
                                ? 'bg-slate-950'
                                : 'bg-slate-200'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-center text-[11px] text-slate-500">SBP QR placeholder</p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-200/80">Ручная оплата</p>
                    <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                      <p className="text-4xl font-black tracking-tight text-white tabular-nums">
                        {`${MANUAL_REPORT_PRICE_RUB.toLocaleString('ru-RU')} ₽`}
                      </p>
                      <p className="pb-1 text-sm text-slate-400">полный отчёт по локации</p>
                    </div>

                    <div className="mt-5 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Инструкция</p>
                      <ol className="mt-3 space-y-2 text-sm text-slate-300 leading-relaxed">
                        <li>1. Переведите сумму по СБП по QR выше или по реквизитам, которые дал менеджер ASI.</li>
                        <li>2. В комментарии к платежу укажите номер заявки.</li>
                        <li>3. После перевода нажмите кнопку «Я оплатил».</li>
                      </ol>
                      <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-900/35 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Номер заявки</p>
                        <p className="mt-1 font-mono text-sm text-slate-100 break-all">{requestId}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={confirmPayment}
                      disabled={confirmingPayment || loading}
                      className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-4 text-sm font-bold text-slate-950 shadow-lg shadow-indigo-950/20 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {confirmingPayment ? 'проверяем оплату...' : 'Я оплатил'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
              <p className="text-sm text-slate-500">Заявка</p>
              <p className="mt-1 font-mono text-sm text-slate-300 break-all">{requestId}</p>
              <p className="mt-4 text-sm text-slate-500">Статус доступа</p>
              <p className="mt-1 text-xl font-bold text-slate-100">
                {loading
                  ? 'Проверяем…'
                  : accessStatus === 'generated'
                    ? 'Отчёт готов'
                    : accessStatus === 'paid'
                      ? 'Оплата подтверждена, можно сформировать отчёт'
                      : accessStatus === 'granted'
                        ? 'Доступ открыт'
                        : accessStatus === 'expired'
                          ? 'Заявка истекла'
                          : accessStatus === 'draft'
                            ? 'Заявка ожидает запуска оплаты'
                            : 'Ожидает оплаты'}
              </p>
              {!loading && accessStatus === 'pending_payment' ? (
                <p className="mt-3 text-sm text-slate-400">
                  Провайдер оплаты: {isYooKassaPayment ? 'YooKassa.' : 'ручное подтверждение.'}
                </p>
              ) : null}
              {!loading && accessStatus === 'granted' && !status?.reportId ? (
                <p className="mt-3 text-sm text-slate-400">подготовка отчёта...</p>
              ) : null}
              {!loading && accessStatus === 'expired' ? (
                <p className="mt-3 text-sm text-slate-400">
                  Создайте новую заявку из демо‑оценки, чтобы получить актуальные условия оплаты.
                </p>
              ) : null}
              {!loading && accessStatus === 'draft' ? (
                <p className="mt-3 text-sm text-slate-400">
                  Вернитесь к демо‑оценке и создайте платную заявку заново, если оплата не была запущена.
                </p>
              ) : null}
              {err ? <p className="mt-3 text-sm text-amber-300">Не удалось проверить статус: {err}</p> : null}
            </div>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              {loading ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold opacity-70"
                >
                  Проверяем статус…
                </button>
              ) : (accessStatus === 'generated' || accessStatus === 'granted') && reportUrl ? (
                <Link
                  href={reportUrl}
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors"
                >
                  Открыть отчёт
                </Link>
              ) : accessStatus === 'paid' ? (
                <button
                  type="button"
                  onClick={generateReport}
                  disabled={generating}
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 disabled:opacity-70 transition-colors"
                >
                  {generating ? 'Формируем…' : 'Сформировать отчёт'}
                </button>
              ) : accessStatus === 'pending_payment' ? (
                null
              ) : (
                <Link
                  href="/ru/location-analysis"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors"
                >
                  Создать новую заявку
                </Link>
              )}
              <Link
                href="/ru/location-analysis"
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors"
              >
                Вернуться к демо‑оценке
              </Link>
            </div>

            {accessStatus === 'paid' ? (
              <p className="mt-4 text-xs text-slate-600">
                Генерация полного отчёта запускается серверным процессом. Клиентский статус оплаты не используется.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  })();

  const emptyState = useMemo(() => {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="rounded-3xl border border-slate-800/70 bg-slate-900/20 p-8 sm:p-10">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полный отчёт</p>
            <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Отчёт открывается по постоянной ссылке</h1>
            <p className="mt-3 text-slate-300 leading-relaxed">
              Запустите демо‑оценку, затем закажите полный отчёт. После подтверждения оплаты мы откроем постоянную ссылку.
              Полная версия включает магниты, расстояния, сценарии дохода, риски и рекомендации.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Link
                href="/ru"
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors"
              >
                Вернуться на главную
              </Link>
              <Link
                href="/ru/location-analysis"
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors"
              >
                Запустить анализ заново
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-600">
              Подсказка: нажмите «Заказать полный отчёт» в демо‑оценке — вы получите номер заявки и страницу статуса.
            </p>
          </div>
        </div>
      </div>
    );
  }, []);

  return statusView ?? emptyState;
}
