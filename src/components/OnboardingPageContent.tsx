'use client';

import { useState } from 'react';

const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/cNi5kxehp6JObmJbh47ss00';

export default function OnboardingPageContent() {
  const [loading, setLoading] = useState(false);

  const handleCheckout = () => {
    setLoading(true);
    window.location.href = STRIPE_PAYMENT_LINK;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="p-8 rounded-2xl bg-gray-900 shadow-xl text-center">
        <h1 className="text-2xl mb-4">ASI Global</h1>
        <p className="mb-6 text-gray-400">Access the platform</p>

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