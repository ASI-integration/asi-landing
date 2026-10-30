import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { supabase } from '@/lib/supabase';
import { ensureAccountForUser } from '@/lib/accounts';
import {
  ruYandexConfigured, verifyYandexState, yandexFlowStillValid,
  verifiedYandexBearerAccessToken, verifiedYandexProfileSubject, yandexSafeReturn,
  hasRecentYandexLinkProof, clearPendingGoogleOauth,
} from '@/lib/auth/ru-yandex-policy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
// Never expose transient OAuth callback codes/states as Referer on subsequent
// navigation, including when the provider returns an error.
const oauthRedirectHeaders={
  'Cache-Control':'private, no-store, max-age=0',
  'Referrer-Policy':'no-referrer',
};

function fail(origin:string,reason:string) {
  const url=new URL('/login',origin);
  url.searchParams.set('yandex_error',reason);
  return NextResponse.redirect(url,{headers:oauthRedirectHeaders});
}
async function yandexProfile(code:string,verifier:string):Promise<string> {
  // Only backend may access secret/tokens; no sensitive values enter browser/logs.
  const form=new URLSearchParams({
    grant_type:'authorization_code',code,code_verifier:verifier,
    client_id:process.env.ASI_RU_YANDEX_CLIENT_ID!,
    client_secret:process.env.ASI_RU_YANDEX_CLIENT_SECRET!,
  });
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),8000);
  try {
    const response=await fetch('https://oauth.yandex.ru/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:form.toString(),signal:ctrl.signal,cache:'no-store',redirect:'error',
    });
    if(!response.ok)throw new Error('YANDEX_TOKEN_EXCHANGE_REJECTED');
    const token=await response.json() as unknown;
    const accessToken=verifiedYandexBearerAccessToken(token);
    if(!accessToken)throw new Error('YANDEX_INVALID_TOKEN_RESPONSE');
    const user=await fetch('https://login.yandex.ru/info?format=json',{
      headers:{Authorization:'OAuth '+accessToken},signal:ctrl.signal,cache:'no-store',redirect:'error',
    });
    if(!user.ok)throw new Error('YANDEX_PROFILE_REJECTED');
    const profile=await user.json() as unknown;
    const subject=verifiedYandexProfileSubject(profile,process.env.ASI_RU_YANDEX_CLIENT_ID!);
    if(!subject)throw new Error('YANDEX_SUBJECT_UNVERIFIED');
    return subject;
  } finally { clearTimeout(timer); }
}

export async function GET(request:Request) {
  const url=new URL(request.url);
  if(!await getIsRuHost() || !ruYandexConfigured(process.env) ||
     url.origin!==process.env.ASI_RU_YANDEX_ORIGIN)
    // Do not reflect an untrusted Host/request origin into a login redirect.
    return NextResponse.json({ok:false,error:'YANDEX_LOGIN_UNAVAILABLE'},
      {status:503,headers:{'Cache-Control':'private, no-store, max-age=0'}});
  const session=await getSession();
  const state=session.yandexOauthState;
  const verifier=session.yandexOauthVerifier;
  const startedAt=session.yandexOauthStartedAt;
  const mode=session.yandexOauthMode;
  const linkUserId=session.yandexOauthLinkUserId;
  const strongAt=session.lastStrongAuthAt;
  const strongUserId=session.lastStrongAuthUserId;
  const intended=yandexSafeReturn(session.yandexOauthRedirect);
  // An OAuth callback must contain exactly one state and either one code or
  // one provider error. Duplicate/contradictory parameters must not rely on
  // URLSearchParams.get() silently choosing the first value.
  const states=url.searchParams.getAll('state');
  const codes=url.searchParams.getAll('code');
  const errors=url.searchParams.getAll('error');
  const unambiguousCallback=states.length===1 &&
    ((codes.length===1 && errors.length===0) || (codes.length===0 && errors.length===1));
  const code=codes[0] ?? null;
  const matched=unambiguousCallback && yandexFlowStillValid(startedAt) &&
    typeof verifier==='string' && /^[A-Za-z0-9_-]{43,128}$/.test(verifier) &&
    (mode==='login'||mode==='link') &&
    !url.searchParams.has('error') &&
    typeof code==='string' && code.length>5 && code.length<4096;

  // A cross-site request can hit this GET callback with SameSite=None cookies.
  // Never let an unsolicited/mismatched state erase the user's pending OAuth
  // login or account link. Only a callback proving possession of our random
  // state may consume the transient flow, including legitimate provider errors.
  if (states.length!==1 || !verifyYandexState(state,states[0] ?? null))
    return fail(url.origin,'invalid_state');

  // Burn a state-matched flow before external token request; prevent reuse.
  delete session.yandexOauthState;
  delete session.yandexOauthVerifier;
  delete session.yandexOauthStartedAt;
  delete session.yandexOauthRedirect;
  delete session.yandexOauthMode;
  delete session.yandexOauthLinkUserId;
  await session.save();
  if(!matched) {
    // A state-matched user refusal is not a forged or expired OAuth state.
    // Never reflect arbitrary provider error text into the return URL.
    const declined = unambiguousCallback && codes.length === 0 &&
      errors[0] === 'access_denied' && yandexFlowStillValid(startedAt) &&
      (mode === 'login' || mode === 'link');
    return fail(url.origin, declined ? 'access_denied' : 'invalid_state');
  }

  // Check the ASI identity and recent, user-bound step-up BEFORE exchanging
  // an OAuth code with Yandex or reading/writing the link registry. A browser
  // identity switch, expired proof, or malformed link session must fail closed
  // without unnecessary provider calls or side effects. Keep the later guard
  // as defense in depth across asynchronous provider requests.
  if(mode==='link' && (!linkUserId || session.userId!==linkUserId ||
      !hasRecentYandexLinkProof(linkUserId,strongUserId,strongAt)))
    return fail(url.origin,'link_requires_recent_auth');

  try {
    const subject=await yandexProfile(code!,(verifier as string));
    const {data:linked,error:lookupError}=await supabase.from('ru_auth_yandex_links')
      .select('user_id').eq('yandex_subject',subject).maybeSingle();
    if(lookupError)throw new Error('YANDEX_LINK_REGISTRY_UNAVAILABLE');

    if(mode==='link'){
      if(!linkUserId || session.userId!==linkUserId ||
          !hasRecentYandexLinkProof(linkUserId,strongUserId,strongAt))
        return fail(url.origin,'link_requires_recent_auth');
      if(linked && linked.user_id!==linkUserId)
        return fail(url.origin,'already_linked');
      if(!linked){
        const {error:insertError}=await supabase.from('ru_auth_yandex_links')
          .insert({yandex_subject:subject,user_id:linkUserId});
        if(insertError)return fail(url.origin,'link_not_available');
      }
      return NextResponse.redirect(new URL(intended,url.origin),{headers:oauthRedirectHeaders});
    }
    if(!linked?.user_id)
      return fail(url.origin,'link_first');
    const {data:user,error:userError}=await supabase.from('users')
      .select('id,email').eq('id',linked.user_id).maybeSingle();
    if(userError||!user?.id||typeof user.email!=='string')
      return fail(url.origin,'account_not_found');

    // Reuse existing ASI identity and session, never infer ownership from a
    // Yandex email or start/restart a trial by authenticating.
    await ensureAccountForUser({userId:user.id,email:user.email,ruCommercial:true});
    // Completing a Yandex login supersedes a pending Google login; otherwise
    // a later callback could replace the newly chosen identity or plan.
    clearPendingGoogleOauth(session);
    session.userId=user.id;
    session.email=user.email;
    // A Yandex login must not inherit password/email step-up from another identity.
    delete session.lastStrongAuthAt;
    delete session.lastStrongAuthUserId;
    await session.save();
    return NextResponse.redirect(new URL(intended,url.origin),{headers:oauthRedirectHeaders});
  } catch {
    return fail(url.origin,'temporary_failure');
  }
}
