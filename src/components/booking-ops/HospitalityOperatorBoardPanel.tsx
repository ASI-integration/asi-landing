'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type {
  HospitalityOperatorBoard,
  HospitalityOperatorBucket,
} from '@/lib/booking-ops/hospitality-operator-board';
import { HOSPITALITY_OPERATOR_BUCKETS } from '@/lib/booking-ops/hospitality-operator-board';

type BoardResponse = {
  ok: boolean;
  message?: string;
  board?: HospitalityOperatorBoard;
};

const BUCKET_ORDER: HospitalityOperatorBucket[] = [...HOSPITALITY_OPERATOR_BUCKETS];

const BUCKET_TONE: Record<HospitalityOperatorBucket, string> = {
  needs_attention_now: 'border-rose-200 bg-rose-50',
  at_risk: 'border-amber-200 bg-amber-50',
  asi_handled: 'border-emerald-200 bg-emerald-50',
  requires_owner_approval: 'border-indigo-200 bg-indigo-50',
  coming_next: 'border-sky-200 bg-sky-50',
};

export function HospitalityOperatorBoardPanel({ enabled }: { enabled: boolean }) {
  const [board, setBoard] = useState<HospitalityOperatorBoard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/dashboard/booking-ops/operator-board', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await readResponseJson<BoardResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok || !payload.board) {
          setError(payload.message || 'Не удалось загрузить операционную доску.');
          return;
        }
        setBoard(payload.board);
        setError('');
      } catch {
        if (!cancelled) setError('Не удалось загрузить операционную доску.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return null;
  if (error) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Операции по броням</h2>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
      </section>
    );
  }
  if (!board) return null;

  const totalOpen =
    board.counts.needs_attention_now
    + board.counts.at_risk
    + board.counts.requires_owner_approval;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Операции по броням</h2>
          <p className="mt-1 text-sm text-slate-600">
            Что требует внимания сейчас, что под риском, что ASI ведёт сама, и что ждёт решения.
          </p>
        </div>
        <Link
          href="/dashboard/booking-ops"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
        >
          Открыть Booking Ops
        </Link>
      </div>

      {totalOpen === 0 && board.counts.asi_handled + board.counts.coming_next === 0 ? (
        <p className="text-sm text-emerald-800">Активных броней пока нет.</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-5">
        {BUCKET_ORDER.map((bucket) => {
          const items = board.buckets[bucket].slice(0, 3);
          return (
            <div key={bucket} className={`rounded-lg border p-3 ${BUCKET_TONE[bucket]}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {board.buckets[bucket][0]?.bucketLabel
                  ?? (bucket === 'needs_attention_now'
                    ? 'Нужно сейчас'
                    : bucket === 'at_risk'
                      ? 'Под риском'
                      : bucket === 'asi_handled'
                        ? 'ASI уже ведёт'
                        : bucket === 'requires_owner_approval'
                          ? 'Нужно решение владельца'
                          : 'Скоро')}
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{board.counts[bucket]}</p>
              <ul className="mt-2 space-y-2">
                {items.length === 0 ? (
                  <li className="text-xs text-slate-500">Пусто</li>
                ) : (
                  items.map((item) => (
                    <li key={`${bucket}-${item.bookingOpsId}`}>
                      <Link href={item.href} className="block rounded-md bg-white/80 p-2 hover:bg-white">
                        <p className="text-sm font-medium text-slate-900">{item.displayName}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{item.title}</p>
                        <p className="mt-1 text-xs font-medium text-slate-800">{item.nextAction}</p>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
