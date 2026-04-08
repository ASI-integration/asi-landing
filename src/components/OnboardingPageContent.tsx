'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/cNi5kxehp6JObmJbh47ss00';

type PricingPlan = 'small' | 'growth' | 'enterprise';
const SELECTED_PLAN_STORAGE_KEY = 'asi.selectedPlan';

export default function OnboardingPageContent() {
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();

  const selectedPlan = useMemo(() => {
    const plan = (searchParams.get('plan') || '').toLowerCase();
    if (plan === 'small' || plan === 'growth' || plan === 'enterprise') return plan;
    return null;
  }, [searchParams]);

  useEffect(() => {
    if (!selectedPlan) return;
    try {
      window.localStorage.setItem(SELECTED_PLAN_STORAGE_KEY, selectedPlan);
    } catch {
      // ignore
    }
  }, [selectedPlan]);

  const handleCheckout = () => {
    setLoading(true);
    window.location.href = STRIPE_PAYMENT_LINK;
  };

  const selectedPlanLabel = useMemo(() => {
    const fallback = (() => {
      try {
        const stored = window.localStorage.getItem(SELECTED_PLAN_STORAGE_KEY);
        if (stored === 'small' || stored === 'growth' || stored === 'enterprise') return stored;
      } catch {
        // ignore
      }
      return null;
    })();

    const plan: PricingPlan | null = selectedPlan ?? fallback;
    if (!plan) return null;
    if (plan === 'small') return 'Small';
    if (plan === 'growth') return 'Growth';
    return 'Enterprise';
  }, [selectedPlan]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="p-8 rounded-2xl bg-gray-900 shadow-xl text-center">
        <h1 className="text-2xl mb-4">ASI Global</h1>
        <p className="mb-6 text-gray-400">
          {selectedPlanLabel ? `Selected plan: ${selectedPlanLabel}` : 'Access the platform'}
        </p>

        <button
          onClick={handleCheckout}
          disabled={loading}
          className="px-6 py-3 bg-white text-black rounded-xl hover:opacity-80"
        >
          {loading ? 'Redirecting...' : 'Buy Access'}
        </button>
      </div>
    </div>
  );
}