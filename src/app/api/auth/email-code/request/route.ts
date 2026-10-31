import { NextResponse } from 'next/server';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { readRequestJson } from '@/lib/safeRequestJson';
import { AUTH_GENERIC_RESPONSE, issueRuEmailCode, ruEmailCodeReady } from '@/lib/auth/ru-email-code-server';
import { isCanonicalRuEmailCodeRequest, isSameOriginAuthRequest } from '@/lib/auth/ru-email-code-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };
// Reject oversized unauthenticated JSON without buffering the whole body.
const RU_AUTH_MAX_JSON_BYTES = 1024;

export async function POST(req: Request) {
  if (!await getIsRuHost() || !ruEmailCodeReady() || !isCanonicalRuEmailCodeRequest(req.url,process.env))
    return NextResponse.json({ok:false, error:'EMAIL_CODE_UNAVAILABLE'}, {status:503,headers:noStore});
  if (!isSameOriginAuthRequest(req.url, req.headers.get('origin')))
    return NextResponse.json({ok:false,error:'INVALID_ORIGIN'},{status:403,headers:noStore});
  const parsed=await readRequestJson<{email?: unknown}>(req, { maxBytes: RU_AUTH_MAX_JSON_BYTES });
  if (!parsed.ok)
    return NextResponse.json({ok:false,error:'INVALID_BODY'},{status:400,headers:noStore});
  try {
    // Always respond identically for known and unknown users, success and cooldown.
    // IP and address quotas are enforced in one SQL transaction.
    const delivery=await issueRuEmailCode(parsed.data.email,req);
    if (!delivery.sent && !delivery.throttled)
      return NextResponse.json({ok:false,error:'AUTH_TEMPORARILY_UNAVAILABLE'},{status:503,headers:noStore});
    return NextResponse.json(AUTH_GENERIC_RESPONSE,{status:202,headers:noStore});
  } catch {
    // No email, OTP, HMAC or database internals enter logs or responses.
    return NextResponse.json({ok:false,error:'AUTH_TEMPORARILY_UNAVAILABLE'},{status:503,headers:noStore});
  }
}
