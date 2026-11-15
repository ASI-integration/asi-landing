'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import type { BookingOpsRecord } from '@/lib/booking-ops/types';
import { readResponseJson } from '@/lib/safeResponseJson';

function isSynthetic(record: BookingOpsRecord): boolean {
  return /SYNTHETIC|MOCK|E2E|TEST/i.test(
    [record.bookingId, record.propertyLabel].filter(Boolean).join(' '),
  );
}

function formatDate(value: string | null): string {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата не указана';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Read-only operator overview. The existing /dashboard/booking-ops remains
 * the advanced console; none of its operations or side effects are copied here.
 */
export default function SimpleBookingsPage() {
  const [records, setRecords] = useState<BookingOpsRecord[]>([]);
  const [showTest, setShowTest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard/booking-ops', {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await readResponseJson(response, {
        ok: false,
        records: [] as BookingOpsRecord[],
        message: 'Не удалось загрузить бронирования',
      });
      if (!response.ok || !payload.ok || !Array.isArray(payload.records)) {
        throw new Error(payload.message || 'Не удалось загрузить бронирования');
      }
      setRecords(payload.records);
    } catch {
      setError('Не удалось загрузить бронирования. Обновите страницу или обратитесь к оператору.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const real = useMemo(() => records.filter((record) => !isSynthetic(record)), [records]);
  const visible = useMemo(
    () => (showTest ? records : real).slice().sort((a, b) =>
      (a.checkInAt || '').localeCompare(b.checkInAt || '')),
    [records, real, showTest],
  );
  const attention = real.filter((record) => record.isBlocked).length;
  const now = Date.now();
  const upcoming = real.filter((record) => {
    if (!record.checkInAt || record.opsStatus === 'completed' || record.opsStatus === 'cancelled') return false;
    const at = new Date(record.checkInAt).getTime();
    return Number.isFinite(at) && at >= now && at <= now + 7 * 86400000;
  }).length;

  return (
    <CrmAccessGuard>
      <main className="mx-auto max-w-6xl space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Бронирования</h1>
            <p className="mt-2 text-slate-600">
              Самое важное по объектам. Подробные технические настройки скрыты.
            </p>
          </div>
          <button type="button" onClick={() => void reload()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-50">
            Обновить
          </button>
        </header>

        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>
        ) : null}

        {!error && !loading ? (
          <section aria-label="Сводка бронирований" className="grid gap-4 sm:grid-cols-3">
            {[
              { title: 'Бронирований', value: real.length },
              { title: 'Нужно внимание', value: attention },
              { title: 'Заезды за 7 дней', value: upcoming },
            ].map((stat) => (
              <div key={stat.title} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-sm text-slate-500">{stat.title}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{stat.value}</p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-slate-900">Мои бронирования</h2>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showTest} onChange={(event) => setShowTest(event.target.checked)}
                className="h-4 w-4" />
              Показать тестовые
            </label>
          </div>

          {loading ? (
            <p role="status" className="mt-6 text-slate-600">Загружаем данные…</p>
          ) : error ? (
            <p className="mt-6 text-slate-600">Данные временно недоступны.</p>
          ) : visible.length === 0 ? (
            <div className="mt-6 rounded-lg bg-slate-50 p-6">
              <p className="font-semibold text-slate-900">Пока нет бронирований</p>
              <p className="mt-2 text-sm text-slate-600">
                Подключите объект и канал бронирования — записи появятся здесь автоматически.
              </p>
              <Link href="/dashboard/properties/prepare" className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Подготовить объект
              </Link>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {visible.map((record) => (
                <article key={record.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">{record.propertyLabel || 'Объект не указан'}</h3>
                      <p className="mt-1 text-sm text-slate-600">{record.guestName || 'Гость не указан'}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatDate(record.checkInAt)} — {formatDate(record.checkOutAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {isSynthetic(record) ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Тест</span> : null}
                      <span className={record.isBlocked
                        ? 'rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-900'
                        : 'rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800'}>
                        {record.isBlocked ? 'Требует внимания' : 'Без блокировки'}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/dashboard/properties" className="font-medium text-blue-700 hover:underline">Мои объекты</Link>
          <Link href="/dashboard/booking-ops" className="font-medium text-slate-600 hover:underline">
            Расширенный режим оператора
          </Link>
        </div>
      </main>
    </CrmAccessGuard>
  );
}
