import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { getSession } from '@/lib/auth';
import { ensureAccountForUser } from '@/lib/accounts';
import { readRequestJson } from '@/lib/safeRequestJson';
import { supabase } from '@/lib/supabase';
import { consumeRuEmailCode, ruEmailCodeReady } from '@/lib/auth/ru-email-code-server';
import { isCanonicalRuEmailCodeRequest, isSameOriginAuthRequest } from '@/lib/auth/ru-email-code-policy';
import { clearPendingYandexOauth } from '@/lib/auth/ru-yandex-policy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};

async function findOrCreateExistingIdentity(email: string): Promise<{id:string;email:string}> {
  const {data:user,error:lookupError}=await supabase
    .from('users').select('id,email').eq('email',email).maybeSingle();
  if(lookupError)throw lookupError;
  if(user?.id)return {id:user.id,email:user.email};

  // The custom ASI users.password_hash remains NOT NULL. A random bcrypt hash
  // prevents password login for code-created accounts until password is set.
  const passwordHash=await bcrypt.hash(randomBytes(32).toString('hex'),12);
  const {data:created,error:createError}=await supabase.from('users')
    .insert({email,password_hash:passwordHash}).select('id,email').single();
  if(created?.id)return {id:created.id,email:created.email};
  if(createError?.code==='23505'){
    const {data:current,error:readError}=await supabase
      .from('users').select('id,email').eq('email',email).single();
    if(readError||!current)throw readError||new Error('IDENTITY_LOOKUP');
    return {id:current.id,email:current.email};
  }
  throw createError||new Error('IDENTITY_CREATE');
}

export async function POST(req:Request) {
  if (!await getIsRuHost() || !ruEmailCodeReady() || !isCanonicalRuEmailCodeRequest(req.url,process.env))
    return NextResponse.json({ok:false,error:'EMAIL_CODE_UNAVAILABLE'},{status:503,headers});
  if(!isSameOriginAuthRequest(req.url,req.headers.get('origin')))
    return NextResponse.json({ok:false,error:'INVALID_ORIGIN'},{status:403,headers});
  const parsed=await readRequestJson<{email?:unknown;code?:unknown}>(req);
  if(!parsed.ok)
    return NextResponse.json({ok:false,error:'INVALID_BODY'},{status:400,headers});
  try {
    // Single-use code is consumed transactionally by the database before login.
    const email=await consumeRuEmailCode(parsed.data.email,parsed.data.code);
    if(!email)return NextResponse.json({ok:false,error:'INVALID_OR_EXPIRED_CODE'}, {status:401,headers});
    const user=await findOrCreateExistingIdentity(email);
    await ensureAccountForUser({userId:user.id,email:user.email,ruCommercial:true});
    const session=await getSession();
    clearPendingYandexOauth(session);
    session.userId=user.id;
    session.email=user.email;
    session.lastStrongAuthAt=Date.now();
    session.lastStrongAuthUserId=user.id;
    await session.save();
    return NextResponse.json({ok:true},{headers});
  } catch {
    return NextResponse.json({ok:false,error:'AUTH_TEMPORARILY_UNAVAILABLE'},{status:503,headers});
  }
}
