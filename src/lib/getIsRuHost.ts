import { headers } from 'next/headers';
import { hostnameFromHostHeader, isRuRuntimeHost } from '@/lib/runtimeHost';

export async function getIsRuHost(): Promise<boolean> {
  const h = await headers();
  const raw = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  return isRuRuntimeHost(hostnameFromHostHeader(raw));
}
