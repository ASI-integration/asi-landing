import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getIsRuHost } from '@/lib/getIsRuHost';
import {
  ruYandexConfigured, generateYandexFlow, yandexCallbackUrl,
  buildYandexAuthorizationUrl, yandexSafeReturn, hasRecentYandexLinkProof,
  trustedYandexStartNavigation,
} from '@/lib/auth/ru-yandex-policy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
// The browser must not leak the local login/link URL or flow context in a Referer
// when it follows the cross-origin redirect to Yandex.
const headers={
  'Cache-Control':'private, no-store, max-age=0',
  'Referrer-Policy':'no-referrer',
};

/** A Yandex login always starts through our own canonical RU HTTPS origin. */
export async function GET(request:Request) {
  const url=new URL(request.url);
  if(!await getIsRuHost() || !ruYandexConfigured(process.env) ||
     url.origin!==process.env.ASI_RU_YANDEX_ORIGIN) {
    return NextResponse.json({ok:false,error:'YANDEX_LOGIN_UNAVAILABLE'},{status:503,headers});
  }
  // Do not silently turn an invalid/ambiguous account-link request into a
  // login that can switch the browser to a different ASI identity.
  const modes=url.searchParams.getAll('mode');
  if (modes.length>1 || (modes.length===1 && modes[0]!=='login' && modes[0]!=='link'))
    return NextResponse.json({ok:false,error:'YANDEX_INVALID_MODE'},{status:400,headers});
  const link=modes[0]==='link';
  // Login as well as account-link initiation must be an intentional first-party
  // navigation. A third-party GET must not silently switch an existing session
  // to a Yandex-linked identity (login CSRF), even with OAuth state + PKCE.
  if (!trustedYandexStartNavigation(
    request.url, request.headers.get('sec-fetch-site'), request.headers.get('referer')))
    return NextResponse.json({ok:false,error:'YANDEX_START_ORIGIN_REJECTED'},{status:403,headers});
  const session=await getSession();
  if(link && !session.userId)
    return NextResponse.redirect(new URL('/login?yandex_error=sign_in_first',url.origin),{headers});
  // A seven-day session cookie alone must not permit attaching a new login method.
  if(link && !hasRecentYandexLinkProof(
      session.userId,session.lastStrongAuthUserId,session.lastStrongAuthAt))
    return NextResponse.redirect(new URL('/dashboard/settings?yandex_error=recent_auth_required',url.origin),{headers});
  // The provider identity must never be bound merely by matching profile email.
  const flow=generateYandexFlow();
  session.yandexOauthState=flow.state;
  session.yandexOauthVerifier=flow.verifier;
  session.yandexOauthStartedAt=flow.createdAt;
  session.yandexOauthRedirect=yandexSafeReturn(url.searchParams.get('redirect')||undefined);
  session.yandexOauthMode=link?'link':'login';
  session.yandexOauthLinkUserId=link?session.userId:undefined;
  await session.save();

  const location=buildYandexAuthorizationUrl({
    clientId:process.env.ASI_RU_YANDEX_CLIENT_ID!,
    callback:yandexCallbackUrl(process.env),
    state:flow.state, challenge:flow.challenge,
  });
  return NextResponse.redirect(location,{headers});
}
