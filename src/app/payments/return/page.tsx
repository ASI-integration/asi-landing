'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

type StatusPayload = {
  paymentId: string;
  status: string;
  amount: number;
  currency: string;
  serviceType: string | null;
};

function PaymentReturnInner() {
  const searchParams = useSearchParams();
  const paymentId = searchParams.get('paymentId');
  const [state, setState] = useState<'checking' | 'paid' | 'pending' | 'failed' | 'missing'>('checking');
  const [payload, setPayload] = useState<StatusPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!paymentId) {
        setState('missing');
        return;
      }
      // Intentionally ignore ?paid=true / ?status=succeeded — server state only.
      try {
        const res = await fetch(`/api/payments/status?paymentId=${encodeURIComponent(paymentId)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) setState(res.status === 404 ? 'missing' : 'failed');
          return;
        }
        const body = (await res.json()) as StatusPayload;
        if (cancelled) return;
        setPayload(body);
        if (body.status === 'paid') setState('paid');
        else if (body.status === 'failed' || body.status === 'cancelled' || body.status === 'expired') {
          setState('failed');
        } else setState('pending');
      } catch {
        if (!cancelled) setState('failed');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  const title =
    state === 'checking'
      ? 'Проверяем оплату…'
      : state === 'paid'
        ? 'Оплата подтверждена'
        : state === 'pending'
          ? 'Оплата ещё не подтверждена'
          : state === 'missing'
            ? 'Платёж не найден'
            : 'Оплата не подтверждена';

  const detail =
    state === 'checking'
      ? 'Статус загружается с сервера ASI. Редирект ЮKassa сам по себе не является подтверждением.'
      : state === 'paid'
        ? 'Статус подтверждён сервером ASI по данным провайдера.'
        : state === 'pending'
          ? 'Платёж ещё обрабатывается. Обновите страницу через минуту.'
          : 'Если вы оплатили, дождитесь webhook-подтверждения или обратитесь в поддержку.';

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-sm rounded-lg border border-gray-100 bg-white p-6 text-center shadow-sm">
        <h1 className="mb-2 text-xl font-bold">{title}</h1>
        <p className="mb-4 text-sm text-gray-600">{detail}</p>
        {payload ? (
          <p className="mb-6 text-xs text-gray-500">
            {payload.paymentId} · {(payload.amount / 100).toFixed(2)} {payload.currency}
          </p>
        ) : null}
        <Link
          href="/ru/early-access#pilot-form"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          Вернуться к заявке
        </Link>
      </div>
    </div>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Проверяем оплату…</div>}>
      <PaymentReturnInner />
    </Suspense>
  );
}
