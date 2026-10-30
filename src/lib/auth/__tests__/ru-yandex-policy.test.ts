import { describe,expect,it } from 'vitest';
import {
  buildYandexAuthorizationUrl,generateYandexFlow,ruYandexConfigured,
  verifyYandexState,yandexFlowStillValid,yandexSubject,yandexCallbackUrl,
  hasRecentYandexLinkProof,verifiedYandexProfileSubject,trustedYandexStartNavigation,
  verifiedYandexBearerAccessToken,
} from '../ru-yandex-policy';

const env={
  ASI_RU_YANDEX_ID_ENABLED:'true', ASI_RU_YANDEX_LINKS_READY:'true',
  ASI_RU_YANDEX_CLIENT_ID:'fixture-client',ASI_RU_YANDEX_CLIENT_SECRET:'fixture-secret',
  ASI_RU_YANDEX_ORIGIN:'https://www.asi-global.ru',
  SESSION_SECRET:'fixture-session-secret-which-is-long-enough',
  SUPABASE_URL:'https://fixture.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'fixture-server-only-service-key',
};
describe('RU Yandex link-only OAuth',()=>{
  it('requires complete registered canonical RU environment',()=>{
    expect(ruYandexConfigured(env)).toBe(true);
    for(const key of Object.keys(env)){
      expect(ruYandexConfigured({...env,[key]:undefined})).toBe(false);
    }
    // Preserve the existing server-side URL fallback, but never advertise an
    // operational provider with no service-role credentials or database URL.
    expect(ruYandexConfigured({...env,SUPABASE_URL:undefined,
      NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid'})).toBe(true);
    expect(ruYandexConfigured({...env,SUPABASE_SERVICE_ROLE_KEY:'   '})).toBe(false);
    expect(ruYandexConfigured({...env,ASI_RU_YANDEX_ORIGIN:'https://evil.example'})).toBe(false);
    expect(ruYandexConfigured({...env,ASI_RU_YANDEX_ORIGIN:'http://www.asi-global.ru'})).toBe(false);
    expect(ruYandexConfigured({...env,ASI_RU_YANDEX_ORIGIN:'https://www.asi-global.ru:8443'})).toBe(false);
    expect(yandexCallbackUrl(env)).toBe('https://www.asi-global.ru/api/auth/yandex/callback');
  });
  it('generates fresh random state and PKCE S256 with exact registered callback',()=>{
    const x=generateYandexFlow(),y=generateYandexFlow();
    expect(x.state).not.toBe(y.state);expect(x.verifier).not.toBe(y.verifier);
    expect(x.challenge).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    const url=new URL(buildYandexAuthorizationUrl({
      clientId:'fixture-client',callback:yandexCallbackUrl(env),state:x.state,challenge:x.challenge,
    }));
    expect(url.origin).toBe('https://oauth.yandex.ru');
    expect(url.searchParams.get('scope')).toBe('login:info');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(x.state);
    expect(url.searchParams.get('redirect_uri')).toBe(yandexCallbackUrl(env));
    expect(url.searchParams.has('code_verifier')).toBe(false);
    expect(url.searchParams.has('client_secret')).toBe(false);
  });
  it('rejects missing, mismatched or malformed state without throwing',()=>{
    const x=generateYandexFlow();
    expect(verifyYandexState(x.state,x.state)).toBe(true);
    for(const value of [null,'a','!'.repeat(43),generateYandexFlow().state]){
      expect(verifyYandexState(x.state,value)).toBe(false);
    }
  });
  it('expires and prevents future timestamp replay',()=>{
    const x=generateYandexFlow();
    expect(yandexFlowStillValid(x.createdAt,x.createdAt+1000)).toBe(true);
    expect(yandexFlowStillValid(x.createdAt,x.createdAt-1)).toBe(false);
    expect(yandexFlowStillValid(x.createdAt,x.createdAt+600001)).toBe(false);
  });
  it('only accepts the stable provider numeric subject, never an email',()=>{
    expect(yandexSubject('123456789')).toBe('123456789');
    expect(yandexSubject('john@example.ru')).toBeNull();
    expect(yandexSubject('123abc')).toBeNull();
    expect(yandexSubject('0')).toBeNull();
    expect(yandexSubject('00123')).toBeNull();
    expect(yandexSubject('')).toBeNull();
    expect(yandexSubject({email:'verified@example.ru'})).toBeNull();
  });
  it('never accepts fresh strong proof belonging to a different ASI user',()=>{
    const now=1_800_000_000_000;
    expect(hasRecentYandexLinkProof('user-a','user-a',now-1000,now)).toBe(true);
    expect(hasRecentYandexLinkProof('user-b','user-a',now-1000,now)).toBe(false);
    expect(hasRecentYandexLinkProof('user-a',undefined,now-1000,now)).toBe(false);
    expect(hasRecentYandexLinkProof('user-a','user-a',now-600001,now)).toBe(false);
    expect(hasRecentYandexLinkProof('user-a','user-a',now+1,now)).toBe(false);
  });
  it('rejects cross-origin, cross-subdomain and third-party account-link starts',()=>{
    const url='https://www.asi-global.ru/api/auth/yandex/start?mode=link';
    const same='https://www.asi-global.ru/dashboard/settings';
    expect(trustedYandexStartNavigation(url,'same-origin',null)).toBe(true);
    expect(trustedYandexStartNavigation(url,null,same)).toBe(true);
    for(const site of ['same-site','cross-site','none']){
      expect(trustedYandexStartNavigation(url,site,same)).toBe(false);
    }
    expect(trustedYandexStartNavigation(url,null,null)).toBe(false);
    expect(trustedYandexStartNavigation(url,null,'https://asi-global.ru/dashboard/settings')).toBe(false);
    expect(trustedYandexStartNavigation(url,null,'https://evil.example/settings')).toBe(false);
    expect(trustedYandexStartNavigation('http://www.asi-global.ru/api/auth/yandex/start',null,
      'http://www.asi-global.ru/dashboard/settings')).toBe(false);
  });
  it('rejects malformed Yandex bearer responses before using Authorization',()=>{
    const valid={token_type:'bearer',access_token:'test-only-access-token'};
    expect(verifiedYandexBearerAccessToken(valid)).toBe(valid.access_token);
    expect(verifiedYandexBearerAccessToken({...valid,token_type:'Bearer'})).toBe(valid.access_token);
    // The provider may omit scope for full grants or return a space-separated
    // reduced grant; only exact login:info is sufficient for ASI sign-in.
    expect(verifiedYandexBearerAccessToken({...valid,scope:'login:info'})).toBe(valid.access_token);
    expect(verifiedYandexBearerAccessToken({...valid,scope:'login:email login:info'})).toBe(valid.access_token);
    for(const invalid of [
      {...valid,scope:'login:email login:avatar'},
      {...valid,scope:'login:information'},
      {...valid,scope:'other:login:info'},
      {...valid,scope:''},
      {...valid,scope:[]},
      {...valid,scope:null},
      null, [], {}, 'test-only-access-token',
      {...valid,token_type:'mac'}, {...valid,token_type:null},
      {...valid,access_token:'short'}, {...valid,access_token:123},
      {...valid,access_token:'test-only-access-token\nHeader: injected'},
      {...valid,access_token:'test-only-access-token\r'},
      {...valid,access_token:'test-only-access-token '},
      {...valid,access_token:'a'.repeat(4097)},
      {...valid,access_token:new String('test-only-access-token')},
    ])expect(verifiedYandexBearerAccessToken(invalid)).toBeNull();
  });
  it('binds the Yandex subject to our registered OAuth app',()=>{
    expect(verifiedYandexProfileSubject({id:'12345',client_id:'fixture-client'},'fixture-client')).toBe('12345');
    for(const profile of [
      {id:'12345',client_id:'different-client'}, {id:'12345'},
      {id:'john@example.ru',client_id:'fixture-client'},
      {id:'0',client_id:'fixture-client'}, null,
    ]) expect(verifiedYandexProfileSubject(profile,'fixture-client')).toBeNull();
  });
});
