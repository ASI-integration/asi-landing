import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Оплата
        </h1>
        <p className="mt-1 text-slate-600">
          Оплата услуги раннего доступа к коммуникационному модулю.
        </p>
      </header>

      <div className="bg-white rounded-lg shadow-sm p-6 max-w-md">
        <p className="text-sm font-semibold text-slate-900">
          {COMMUNICATION_PILOT_SERVICE_TITLE}
        </p>
        <p className="mt-2 text-slate-600">
          {COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}
        </p>
        <p className="mt-4 mb-4 text-2xl font-bold text-slate-900">
          {COMMUNICATION_PILOT_PRICE_RUB} ₽
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          {COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE}
        </div>
      </div>
    </div>
  );
}
