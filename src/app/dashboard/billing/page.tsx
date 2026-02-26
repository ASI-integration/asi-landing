'use client';

import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

export default function BillingPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handlePay = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/yookassa/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 99000 }),
      });
      const data = await res.json();
      if (data.confirmation_url) {
        window.location.href = data.confirmation_url;
      } else {
        alert(data.error || 'Payment failed');
      }
    } catch {
      alert('Payment failed');
    } finally {
      setLoading(false);
    }
  };

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
        <button
          onClick={handlePay}
          disabled={loading}
          className="px-6 py-3 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-70"
        >
          {loading ? 'Loading...' : 'Pay with card'}
        </button>
      </div>
    </div>
  );
}
