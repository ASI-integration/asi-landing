'use client';

import Link from 'next/link';

export default function PaymentSuccessPage() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-sm rounded-lg bg-white p-6 shadow-sm text-center border border-gray-100">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="mb-2 text-xl font-bold">Оплата подтверждена</h1>
        <p className="text-sm text-gray-600 mb-6">
          Оплачен ранний доступ к AI-коммуникациям для посуточной аренды: 1 объект, 1 месяц.
        </p>
        <Link
          href="/ru/early-access#pilot-form"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          Заполнить анкету объекта
        </Link>
      </div>
    </div>
  );
}
