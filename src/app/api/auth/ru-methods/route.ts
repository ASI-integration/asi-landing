import { NextResponse } from 'next/server';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { ruEmailCodeReady } from '@/lib/auth/ru-email-code-server';
import { ruYandexConfigured } from '@/lib/auth/ru-yandex-policy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET() {
  const isRu=await getIsRuHost();
  return NextResponse.json({
    market:isRu?'ru':'other',
    emailCode:isRu&&ruEmailCodeReady(),
    password:true,
    // Yandex ID must not be advertised until app registration, state/PKCE,
    // protected subject binding and independent acceptance are all complete.
    yandexId:isRu&&ruYandexConfigured(process.env),
    googleOptional:true,
  },{headers:{'Cache-Control':'private, no-store, max-age=0'}});
}
