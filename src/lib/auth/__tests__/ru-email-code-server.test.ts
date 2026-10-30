import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({rpc:vi.fn(), fetch:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}));

import { issueRuEmailCode, consumeRuEmailCode, trustedClientIp, emailCodeIpDigest } from '../ru-email-code-server';

const pepper='isolated-test-only-strong-pepper-at-least-32-chars';
const req=()=>new Request('https://www.asi-global.ru/api/auth/email-code/request',{method:'POST'});

beforeEach(()=>{
  vi.stubEnv('ASI_RU_EMAIL_CODE_ENABLED','true');
  vi.stubEnv('ASI_RU_EMAIL_CODE_SCHEMA_READY','true');
  vi.stubEnv('ASI_RU_EMAIL_CODE_ORIGIN','https://www.asi-global.ru');
  vi.stubEnv('ASI_RU_EMAIL_CODE_PEPPER',pepper);
  vi.stubEnv('ASI_AUTH_RESEND_API_KEY','inert-test-key');
  vi.stubEnv('ASI_AUTH_FROM_EMAIL','login@asi-global.ru');
  vi.stubEnv('SESSION_SECRET','isolated-session-fixture-at-least-32-chars');
  vi.stubEnv('SUPABASE_URL','https://example.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','inert-test-role');
  vi.stubEnv('ASI_RU_AUTH_TRUST_PROXY','false');
  vi.stubGlobal('fetch',mocks.fetch);
  mocks.rpc.mockReset();
  mocks.fetch.mockReset();
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('RU email OTP IP quota cannot be split by spoofed headers',()=>{
  it('uses only Vercel edge-forwarded IP, ignoring x-real-ip and x-forwarded-for',()=>{
    vi.stubEnv('ASI_RU_AUTH_TRUST_PROXY','true');
    vi.stubEnv('VERCEL','1');
    const request=new Request('https://www.asi-global.ru/api/auth/email-code/request',{
      headers:{
        'x-vercel-forwarded-for':'203.0.113.25',
        'x-real-ip':'198.51.100.77',
        'x-forwarded-for':'192.0.2.42',
      },
    });
    expect(trustedClientIp(request)).toBe('203.0.113.25');
  });

  it('uses a shared quota when the edge address is missing, invalid or ambiguous',()=>{
    vi.stubEnv('ASI_RU_AUTH_TRUST_PROXY','true');
    vi.stubEnv('VERCEL','1');
    for(const bad of ['', '203.0.113.1, 198.51.100.1', '999.999.999.999', '2001:db8::1%eth0']){
      const request=new Request('https://www.asi-global.ru/',{
        headers:{'x-vercel-forwarded-for':bad,'x-real-ip':'198.51.100.77'},
      });
      expect(trustedClientIp(request)).toBe('unattributed');
    }
    expect(trustedClientIp(new Request('https://www.asi-global.ru/'))).toBe('unattributed');
  });

  it('requires explicit trusted proxy for a single self-hosted IP',()=>{
    vi.stubEnv('VERCEL','');
    const request=new Request('https://www.asi-global.ru/',{
      headers:{'x-forwarded-for':'2001:db8::1','x-real-ip':'192.0.2.42'},
    });
    expect(trustedClientIp(request)).toBe('unattributed');
    vi.stubEnv('ASI_RU_AUTH_TRUST_PROXY','true');
    expect(trustedClientIp(request)).toBe('2001:db8::1');
    const appended=new Request('https://www.asi-global.ru/',{
      headers:{'x-forwarded-for':'2001:db8::1, 192.0.2.42'},
    });
    expect(trustedClientIp(appended)).toBe('unattributed');
  });
});

describe('RU email code: durable pending -> delivery -> activation',()=>{
  it('activates the exact issued HMAC only after mail provider accepts the send',async()=>{
    const events:string[]=[];
    let issuedHash='';
    mocks.rpc.mockImplementation(async(name:string,args:Record<string,string>)=>{
      events.push(name);
      if(name==='ru_auth_issue_email_code'){
        expect(args.p_email).toBe('user@example.ru');
        expect(args.p_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(args.p_ip_hash).toMatch(/^[a-f0-9]{64}$/);
        issuedHash=args.p_hash;
        return {data:true,error:null};
      }
      if(name==='ru_auth_activate_email_code'){
        expect(args).toEqual({p_email:'user@example.ru',p_hash:issuedHash});
        return {data:true,error:null};
      }
      throw Error('unexpected RPC '+name);
    });
    mocks.fetch.mockImplementation(async(_url:string,opts:RequestInit)=>{
      expect(opts.redirect).toBe('error');
      events.push('mail');
      const payload=JSON.parse(String(opts.body));
      expect(payload.to).toEqual(['user@example.ru']);
      expect(payload.text).toContain('Код действует 10 минут');
      expect(payload.text).not.toContain(issuedHash);
      return new Response(JSON.stringify({id:'e7e2f64a-3cbe-4f91-92cc-79edfae94a41'}),{status:200});
    });
    expect(await issueRuEmailCode(' USER@example.RU ',req())).toEqual({sent:true,throttled:false});
    expect(events).toEqual(['ru_auth_issue_email_code','mail','ru_auth_activate_email_code']);
  });

  it('never activates after provider rejection; revokes reserved pending hash',async()=>{
    let issuedHash='';
    mocks.rpc.mockImplementation(async(name:string,args:Record<string,string>)=>{
      if(name==='ru_auth_issue_email_code'){issuedHash=args.p_hash;return {data:true,error:null};}
      if(name==='ru_auth_revoke_email_code'){
        expect(args.p_hash).toBe(issuedHash);return {data:null,error:null};
      }
      throw Error('activation must not happen after mail failure');
    });
    mocks.fetch.mockResolvedValue(new Response(null,{status:503}));
    expect(await issueRuEmailCode('user@example.ru',req())).toEqual({sent:false,throttled:false});
    expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual([
      'ru_auth_issue_email_code','ru_auth_revoke_email_code',
    ]);
  });

  it('reports a failed activation and revokes instead of claiming delivery success',async()=>{
    mocks.rpc.mockImplementation(async(name:string)=>{
      if(name==='ru_auth_issue_email_code')return {data:true,error:null};
      if(name==='ru_auth_activate_email_code')return {data:false,error:null};
      if(name==='ru_auth_revoke_email_code')return {data:null,error:null};
      throw Error('unexpected RPC');
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({id:'e7e2f64a-3cbe-4f91-92cc-79edfae94a41'}),{status:200}));
    expect(await issueRuEmailCode('user@example.ru',req())).toEqual({sent:false,throttled:false});
    expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual([
      'ru_auth_issue_email_code','ru_auth_activate_email_code','ru_auth_revoke_email_code',
    ]);
  });

  it('rejects a successful HTTP status without a Resend acceptance ID',async()=>{
    mocks.rpc.mockImplementation(async(name:string)=>{
      if(name==='ru_auth_issue_email_code')return {data:true,error:null};
      if(name==='ru_auth_revoke_email_code')return {data:null,error:null};
      throw Error('should never activate an unconfirmed code');
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({id:null}),{status:200}));
    expect(await issueRuEmailCode('user@example.ru',req())).toEqual({sent:false,throttled:false});
    expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual([
      'ru_auth_issue_email_code','ru_auth_revoke_email_code',
    ]);
  });

  it('does not hide a failed revocation or make a second send attempt',async()=>{
    mocks.rpc.mockImplementation(async(name:string)=>{
      if(name==='ru_auth_issue_email_code')return {data:true,error:null};
      if(name==='ru_auth_revoke_email_code')return {data:null,error:{message:'isolated-error'}};
      throw Error('unexpected RPC');
    });
    mocks.fetch.mockRejectedValue(new Error('isolated mail timeout'));
    await expect(issueRuEmailCode('user@example.ru',req()))
      .rejects.toThrow('RU_AUTH_OTP_REVOCATION_UNCERTAIN');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses issuance without server-only delivery configuration',async()=>{
    vi.stubEnv('ASI_AUTH_RESEND_API_KEY','');
    expect(await issueRuEmailCode('user@example.ru',req())).toEqual({sent:false,throttled:true});
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('refuses OTP issue or consume when the protected canonical RU origin is absent',async()=>{
    vi.stubEnv('ASI_RU_EMAIL_CODE_ORIGIN','https://another-business.ru');
    expect(await issueRuEmailCode('user@example.ru',req())).toEqual({sent:false,throttled:true});
    expect(await consumeRuEmailCode('user@example.ru','12345678',req())).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('consumes only an affirmative DB decision and rejects SQL errors',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:false,error:null})
      .mockResolvedValueOnce({data:true,error:null})
      .mockResolvedValueOnce({data:null,error:{message:'isolated SQL failure'}});
    expect(await consumeRuEmailCode('user@example.ru','12345678',req())).toBeNull();
    expect(await consumeRuEmailCode('user@example.ru','12345678',req())).toBe('user@example.ru');
    await expect(consumeRuEmailCode('user@example.ru','12345678',req()))
      .rejects.toThrow('RU_AUTH_OTP_DATABASE_NOT_READY');
    expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual([
      'ru_auth_consume_email_code','ru_auth_consume_email_code','ru_auth_consume_email_code',
    ]);
    for(const [,args] of mocks.rpc.mock.calls) expect(args.p_ip_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('uses only the trusted edge IP to rate-limit verification attempts',async()=>{
    vi.stubEnv('ASI_RU_AUTH_TRUST_PROXY','true');
    vi.stubEnv('VERCEL','1');
    mocks.rpc.mockResolvedValue({data:false,error:null});
    const request=new Request('https://www.asi-global.ru/api/auth/email-code/verify',{
      headers:{'x-vercel-forwarded-for':'203.0.113.25',
        'x-forwarded-for':'198.51.100.7','x-real-ip':'192.0.2.5'},
    });
    expect(await consumeRuEmailCode('user@example.ru','12345678',request)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith('ru_auth_consume_email_code',{
      p_email:'user@example.ru',
      p_hash:expect.stringMatching(/^[a-f0-9]{64}$/),
      p_ip_hash:emailCodeIpDigest('203.0.113.25',pepper),
    });
  });

});
