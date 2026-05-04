'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

type RequestStatus = {
  requestId?: string;
  status?: string;
  access_status?: 'draft' | 'pending_payment' | 'paid' | 'generated' | 'expired';
  payment_provider?: 'manual' | 'prodamus' | 'yookassa';
  payment_url?: string | null;
  reportId?: string | null;
  next_action?: { type?: string; url?: string };
  error?: string;
};

export default function RuLocationFullReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <RuLocationFullReportContent />
    </Suspense>
  );
}

function RuLocationFullReportContent() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get('requestId')?.trim() || '';
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [loading, setLoading] = useState(!!requestId);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [requestId]);

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

  const statusView = (() => {
    if (!requestId) return null;
    const accessStatus = status?.access_status;
    const reportUrl = status?.reportId ? `/ru/location-report/${status.reportId}` : status?.next_action?.url;
    const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'support@asi-global.ru';
    const paymentHref = status?.payment_url
      || `mailto:${contactEmail}?subject=${encodeURIComponent(`Оплата полного отчёта ASI ${requestId}`)}`;

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
                Оплатите полный отчёт удобным способом. Доступ откроется после подтверждения оплаты на стороне ASI.
              </p>
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
                      : accessStatus === 'expired'
                        ? 'Заявка истекла'
                        : accessStatus === 'draft'
                          ? 'Заявка ожидает запуска оплаты'
                          : 'Ожидает оплаты'}
              </p>
              {!loading && accessStatus === 'pending_payment' ? (
                <p className="mt-3 text-sm text-slate-400">
                  Провайдер оплаты: {status?.payment_provider === 'prodamus' ? 'Prodamus' : 'ручное подтверждение'}.
                  Клиентская страница не может открыть доступ без серверного подтверждения.
                </p>
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
              ) : accessStatus === 'generated' && reportUrl ? (
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
                <Link
                  href={paymentHref}
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors"
                >
                  Оплатить полный отчёт
                </Link>
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
                Генерация полного отчёта пока запускается серверным процессом. Клиентский статус оплаты не используется.
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
