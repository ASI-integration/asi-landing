import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getIsRuHost } from '@/lib/getIsRuHost';
import {
  ruYandexConfigured, generateYandexFlow, yandexCallbackUrl,
  buildYandexAuthorizationUrl, yandexSafeReturn,
} from '@/lib/auth/ru-yandex-policy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};

/** A Yandex login always starts through our own canonical RU HTTPS origin. */
export async function GET(request:Request) {
  const url=new URL(request.url);
  if(!await getIsRuHost() || !ruYandexConfigured(process.env) ||
     url.origin!==process.env.ASI_RU_YANDEX_ORIGIN) {
    return NextResponse.json({ok:false,error:'YANDEX_LOGIN_UNAVAILABLE'},{status:503,headers});
  }
  const link=url.searchParams.get('mode')==='link';
  const session=await getSession();
  if(link && !session.userId)
    return NextResponse.redirect(new URL('/login?yandex_error=sign_in_first',url.origin));
  // A seven-day session cookie alone must not permit attaching a new login method.
  if(link && (!Number.isSafeInteger(session.lastStrongAuthAt) ||
      Date.now()<session.lastStrongAuthAt! ||
      Date.now()-session.lastStrongAuthAt!>10*60*1000))
    return NextResponse.redirect(new URL('/dashboard/settings?yandex_error=recent_auth_required',url.origin));
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
