import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { safeAuthRedirectPath } from '@/lib/auth/app-url';

export const YANDEX_CALLBACK_PATH = '/api/auth/yandex/callback';
export const YANDEX_OAUTH_TTL_MS = 10 * 60 * 1000;

export type YandexFlowMode = 'login' | 'link';

export function ruYandexConfigured(env: Readonly<Record<string,string|undefined>>): boolean {
  try {
    if (env.ASI_RU_YANDEX_ID_ENABLED !== 'true' ||
      env.ASI_RU_YANDEX_LINKS_READY !== 'true' ||
      (env.SESSION_SECRET?.trim().length ?? 0) < 32 ||
      !env.ASI_RU_YANDEX_CLIENT_ID?.trim() ||
      !env.ASI_RU_YANDEX_CLIENT_SECRET?.trim()) return false;
    const raw = env.ASI_RU_YANDEX_ORIGIN?.trim() || '';
    const origin = new URL(raw);
    return origin.protocol === 'https:' && origin.origin === raw &&
      (origin.hostname === 'asi-global.ru' || origin.hostname === 'www.asi-global.ru');
  } catch { return false; }
}

/** Generate new state+verifier each attempt. Never expose verifier to the browser. */
export function generateYandexFlow() {
  const state=randomBytes(32).toString('base64url');
  const verifier=randomBytes(48).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  return {state,verifier,challenge,createdAt:Date.now()};
}

export function verifyYandexState(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received || !/^[A-Za-z0-9_-]{30,128}$/.test(expected) ||
      !/^[A-Za-z0-9_-]{30,128}$/.test(received)) return false;
  const left=Buffer.from(expected);
  const right=Buffer.from(received);
  return left.length===right.length && timingSafeEqual(left,right);
}

export function yandexFlowStillValid(createdAt: number | undefined, now: number=Date.now()): boolean {
  return Number.isSafeInteger(createdAt) && Number.isSafeInteger(now) &&
    now >= createdAt! && now - createdAt! <= YANDEX_OAUTH_TTL_MS;
}

export function yandexCallbackUrl(env: Readonly<Record<string,string|undefined>>): string {
  if (!ruYandexConfigured(env)) throw new Error('YANDEX_NOT_CONFIGURED');
  return env.ASI_RU_YANDEX_ORIGIN! + YANDEX_CALLBACK_PATH;
}

export function buildYandexAuthorizationUrl(opts:{
  clientId:string;callback:string;state:string;challenge:string;
}): string {
  const url=new URL('https://oauth.yandex.ru/authorize');
  url.searchParams.set('response_type','code');
  url.searchParams.set('client_id',opts.clientId);
  url.searchParams.set('redirect_uri',opts.callback);
  url.searchParams.set('scope','login:info');
  url.searchParams.set('state',opts.state);
  url.searchParams.set('code_challenge',opts.challenge);
  url.searchParams.set('code_challenge_method','S256');
  return url.toString();
}

export function yandexSubject(value:unknown): string|null {
  // Yandex ID /info "id" is numeric string. Never authenticate by email.
  if(typeof value==='string' && /^[0-9]{1,40}$/.test(value)) return value;
  if(typeof value==='number' && Number.isSafeInteger(value) && value>0) return String(value);
  return null;
}
export function yandexSafeReturn(value:string|undefined):string {
  return safeAuthRedirectPath(value);
}
