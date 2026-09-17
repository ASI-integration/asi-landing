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
    <div className={`space-y-5 ${className}`.trim()}>
      <div className="border-t border-asi-border pt-5">
        <p className="font-serif text-lg text-asi-navy leading-snug">
          {COMMUNICATION_PILOT_SERVICE_TITLE}
        </p>
        <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">
          {COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}
        </p>
        <p className="mt-3 text-sm font-sans text-asi-navy/70">
          Стоимость:{' '}
          <span className="font-semibold text-asi-navy">
            {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
          </span>
        </p>
      </div>

      <button
        type="button"
        onClick={onCheckout}
        disabled={busy}
        className="inline-flex min-h-12 w-full sm:w-auto items-center justify-center gap-2 px-7 py-3.5 bg-asi-navy text-asi-ivory text-sm font-sans font-semibold tracking-wide rounded-sm border border-asi-navy hover:bg-asi-navy-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asi-gold disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Проверяем оплату…' : 'Перейти к оплате'}
      </button>

      <p className="text-xs text-asi-navy/50 leading-relaxed">
        Приём оплаты через ЮKassa включается после модерации. Пока платежи отключены, кнопка не
        создаёт успешный платёж — вы увидите статус ожидания.
      </p>

      {feedback ? (
        <div
          className="border border-asi-border bg-asi-paper px-4 py-3 text-sm leading-relaxed text-asi-navy/75"
          role="status"
        >
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-gold-text">
            Статус оплаты
          </p>
          <p className="mt-2">{feedback}</p>
        </div>
      ) : null}
    </div>
  );
}
