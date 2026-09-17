'use client';

import { useState } from 'react';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';
import { readResponseJson } from '@/lib/safeResponseJson';

type CreatePaymentResponse = {
  status?: string;
  message?: string;
  paymentUrl?: string | null;
  amountRub?: number;
  service?: string;
  description?: string;
};

/**
 * Safe checkout entry for the published MVP tariff.
 * When YooKassa is disabled, the API returns 503 with a clear pending message —
 * this CTA never claims that live payment is available.
 */
export function PilotCheckoutCta({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const onCheckout = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/yookassa/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await readResponseJson<CreatePaymentResponse>(res, {});

      if (data.paymentUrl) {
        window.location.assign(data.paymentUrl);
        return;
      }

      setFeedback(data.message?.trim() || COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE);
    } catch {
      setFeedback(COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--t-text-2)]">
        <p className="font-semibold text-[var(--t-text)]">{COMMUNICATION_PILOT_SERVICE_TITLE}</p>
        <p className="mt-1">{COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}</p>
        <p className="mt-1">Стоимость: {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽</p>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--t-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Проверяем оплату…' : 'Перейти к оплате'}
      </button>
      {feedback ? (
        <p className="text-sm leading-6 text-[var(--t-muted)]" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
