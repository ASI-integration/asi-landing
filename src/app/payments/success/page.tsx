'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/**
 * Legacy success URL — redirects to the server-verified return page.
 * Never treat this route itself as payment proof.
 */
function LegacySuccessRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const paymentId = params.get('paymentId');
    const next = paymentId
      ? `/payments/return?paymentId=${encodeURIComponent(paymentId)}`
      : '/payments/return';
    router.replace(next);
  }, [params, router]);

  return (
    <div className="flex h-screen items-center justify-center text-sm text-gray-600">
      Перенаправляем к проверке статуса оплаты…
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">…</div>}>
      <LegacySuccessRedirect />
    </Suspense>
  );
}
