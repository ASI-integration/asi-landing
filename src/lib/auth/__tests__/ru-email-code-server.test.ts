import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({rpc:vi.fn(), fetch:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}));

import { issueRuEmailCode, consumeRuEmailCode } from '../ru-email-code-server';

const pepper='isolated-test-only-strong-pepper-at-least-32-chars';
const req=()=>new Request('https://www.asi-global.ru/api/auth/email-code/request',{method:'POST'});

beforeEach(()=>{
  vi.stubEnv('ASI_RU_EMAIL_CODE_ENABLED','true');
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
      events.push('mail');
      const payload=JSON.parse(String(opts.body));
      expect(payload.to).toEqual(['user@example.ru']);
      expect(payload.text).toContain('Код действует 10 минут');
      expect(payload.text).not.toContain(issuedHash);
      return new Response(null,{status:202});
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
    mocks.fetch.mockResolvedValue(new Response(null,{status:202}));
    expect(await issueRuEmailCode('user@example.ru',req())).toEqual({sent:false,throttled:false});
    expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual([
      'ru_auth_issue_email_code','ru_auth_activate_email_code','ru_auth_revoke_email_code',
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

  it('consumes only an affirmative DB decision and rejects SQL errors',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:false,error:null})
      .mockResolvedValueOnce({data:true,error:null})
      .mockResolvedValueOnce({data:null,error:{message:'isolated SQL failure'}});
    expect(await consumeRuEmailCode('user@example.ru','12345678')).toBeNull();
    expect(await consumeRuEmailCode('user@example.ru','12345678')).toBe('user@example.ru');
    await expect(consumeRuEmailCode('user@example.ru','12345678'))
      .rejects.toThrow('RU_AUTH_OTP_DATABASE_NOT_READY');
    expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual([
      'ru_auth_consume_email_code','ru_auth_consume_email_code','ru_auth_consume_email_code',
    ]);
  });
});
