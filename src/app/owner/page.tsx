import { Suspense } from 'react';
import { headers } from 'next/headers';
import { hostnameFromHostHeader } from '@/lib/runtimeHost';
import { OwnerConsole } from './OwnerConsole';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'ASI Global — Owner Console',
  robots: { index: false, follow: false },
};

export default async function OwnerPage() {
  const h = await headers();
  const raw = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  const hostname = hostnameFromHostHeader(raw);
  return (
    <Suspense fallback={<div className="min-h-dvh bg-asi-ivory" />}>
      <OwnerConsole hostname={hostname} />
    </Suspense>
  );
}
