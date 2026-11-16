import { describe,it,expect,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeOtaFinanceScope, FinanceScopeDenied } from '../private-scope';

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const U='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token='opaque-server-validated-authentication-token';
const request={accessToken:token,accountId:A,propertyId:P,intent:'read' as const};

function fake(options: {
  verifiedId?: string|null, role?: string|null, memberError?:boolean,
  property?: {id:string;account_id:string}|null, propertyError?:boolean,
  authError?:boolean,
}={}) {
  const calls: {table:string;filters:[string,unknown][];columns:string}[]=[];
  const client={
    auth:{getUser:vi.fn(async (suppliedToken:string)=>({
      data:{user: options.verifiedId === null ? null : {id:options.verifiedId ?? U}},
      error: options.authError ? {message:'expired'} : null,
    }))},
    from:(name:string)=>{
      const record={table:name,filters:[] as [string,unknown][],columns:''};
      calls.push(record);
      const builder={
        select(fields:string){record.columns=fields;return builder;},
        eq(field:string,value:unknown){record.filters.push([field,value]);return builder;},
        async maybeSingle(){
          if(name==='account_members'){
            return {data: options.role===null ? null : {role:options.role ?? 'owner'},
              error:options.memberError ? {message:'db problem'} : null};
          }
          if(name==='properties'){
            return {data: options.property === null ? null :
              (options.property ?? {id:P,account_id:A}),
              error:options.propertyError ? {message:'db problem'} : null};
          }
          throw new Error('UNKNOWN_TABLE');
        },
      };
      return builder;
    },
  };
  return {client:client as unknown as SupabaseClient,calls,verify:client.auth.getUser};
}

describe('server-only finance account and property authorization',()=>{
  it('verifies token server-side and filters account_members and properties by canonical scope',async()=>{
    const a=fake();
    const result=await authorizeOtaFinanceScope(request,a.client);
    expect(result).toEqual({userId:U,accountId:A,propertyId:P,intent:'read',role:'owner'});
    expect(a.verify).toHaveBeenCalledTimes(1);
    expect(a.verify).toHaveBeenCalledWith(token);
    expect(a.calls).toEqual([
      {table:'account_members',columns:'role',filters:[['account_id',A],['user_id',U]]},
      {table:'properties',columns:'id,account_id',filters:[['id',P],['account_id',A]]},
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('rejects guest or unapproved membership roles',async()=>{
    for(const role of ['guest','viewer','',null]){
      const a=fake({role});
      await expect(authorizeOtaFinanceScope(request,a.client))
        .rejects.toThrow('FINANCE_SCOPE_DENIED');
      expect(a.calls.map(c=>c.table)).toEqual(['account_members']);
    }
  });
  it('rejects manager append but permits manager read',async()=>{
    const a=fake({role:'manager'});
    await expect(authorizeOtaFinanceScope({...request,intent:'append'},a.client))
      .rejects.toThrow('FINANCE_SCOPE_DENIED');
    const b=fake({role:'manager'});
    expect((await authorizeOtaFinanceScope(request,b.client)).role).toBe('manager');
  });
  it('permits owner/admin append only for their account property',async()=>{
    for(const role of ['owner','admin']){
      const a=fake({role});
      expect((await authorizeOtaFinanceScope({...request,intent:'append'},a.client)).intent)
        .toBe('append');
    }
  });
  it('rejects forged cross-account property despite a deceptive lookup response',async()=>{
    const a=fake({property:{id:OTHER,account_id:B}});
    await expect(authorizeOtaFinanceScope(request,a.client))
      .rejects.toThrow('FINANCE_SCOPE_DENIED');
  });
  it('rejects a property in another account without leaking which field mismatched',async()=>{
    const a=fake({property:{id:P,account_id:B}});
    await expect(authorizeOtaFinanceScope(request,a.client))
      .rejects.toThrow(FinanceScopeDenied);
  });
  it('rejects missing property and DB lookup failures',async()=>{
    for(const config of [{property:null},{propertyError:true},{memberError:true}]){
      await expect(authorizeOtaFinanceScope(request,fake(config).client))
        .rejects.toThrow('FINANCE_SCOPE_DENIED');
    }
  });
  it('rejects unverified JWT, even when account and property IDs are valid',async()=>{
    for(const config of [{verifiedId:null},{authError:true},{verifiedId:'bad'}]){
      const a=fake(config);
      await expect(authorizeOtaFinanceScope(request,a.client))
        .rejects.toThrow('FINANCE_SCOPE_DENIED');
      expect(a.calls).toHaveLength(0);
    }
  });
  it('rejects ambiguous text property identifiers or other uncanonical parameters before network',async()=>{
    for(const update of [
      {accountId:'text-account'}, {accountId:B.toUpperCase()},
      {propertyId:'some-listing'}, {propertyId:'../property'},
      {accessToken:'too-short'}, {intent:'delete' as 'read'},
    ]){
      const a=fake();
      await expect(authorizeOtaFinanceScope({...request,...update},a.client))
        .rejects.toThrow('FINANCE_SCOPE_DENIED');
      expect(a.calls).toHaveLength(0);
      expect(a.verify).not.toHaveBeenCalled();
    }
  });
  it('does not call any OTA, payment or financial table APIs during authorization',async()=>{
    const a=fake();
    await authorizeOtaFinanceScope(request,a.client);
    expect(a.calls.map(c=>c.table)).toEqual(['account_members','properties']);
  });
});
