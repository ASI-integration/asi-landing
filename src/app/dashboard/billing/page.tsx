import { YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Billing
        </h1>
        <p className="mt-1 text-slate-600">
          Update your payment method to continue using ASI.
        </p>
      </header>

      <div className="bg-white rounded-lg shadow-sm p-6 max-w-md">
        <p className="text-slate-600 mb-4">
          Subscription: 990 ₽/month
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          {YOOKASSA_PENDING_REVIEW_MESSAGE}
        </div>
      </div>
    </div>
  );
}
