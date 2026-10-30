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
import { clearPendingYandexOauth, clearPendingGoogleOauth } from '@/lib/auth/ru-yandex-policy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
// Reject oversized unauthenticated JSON without buffering the whole body.
const RU_AUTH_MAX_JSON_BYTES = 1024;

type RuIdentity = { id: string; email: string };

/** Existing ASI users.email is unique by case-sensitive spelling only.
 * Never create a second account for a mixed-case verified mailbox.
 */
async function findExistingEmailIdentity(email: string): Promise<RuIdentity | null> {
  // PostgreSQL ILIKE treats '%' and '_' as patterns, and '\' as an escape.
  // Also verify exact normalized text after fetching: never authenticate via
  // a fuzzy database pattern match if escaping or PostgREST semantics change.
  const pattern = email.replace(/[\\%_]/g, '\\$&');
  const { data, error } = await supabase.from('users').select('id,email')
    .ilike('email', pattern).limit(3);
  if (error) throw error;
  const rows = data ?? [];
  const matches = rows.filter(row => typeof row.id === 'string' &&
    typeof row.email === 'string' && row.email.toLowerCase() === email);
  if (rows.length > 2 || matches.length !== rows.length || matches.length > 1)
    throw new Error('RU_AUTH_AMBIGUOUS_EMAIL_IDENTITY');
  return matches[0] ?? null;
}

async function findOrCreateExistingIdentity(email: string): Promise<RuIdentity> {
  const existing = await findExistingEmailIdentity(email);
  if (existing) return existing;
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
  const { data: created, error: createError } = await supabase.from('users')
    .insert({ email, password_hash: passwordHash }).select('id,email').single();
  if (created?.id) return { id: created.id, email: created.email };
  if (createError?.code === '23505') {
    const current = await findExistingEmailIdentity(email);
    if (!current) throw new Error('RU_AUTH_IDENTITY_LOOKUP');
    return current;
  }
  throw createError || new Error('IDENTITY_CREATE');
}

export async function POST(req:Request) {
  if (!await getIsRuHost() || !ruEmailCodeReady() || !isCanonicalRuEmailCodeRequest(req.url,process.env))
    return NextResponse.json({ok:false,error:'EMAIL_CODE_UNAVAILABLE'},{status:503,headers});
  if(!isSameOriginAuthRequest(req.url,req.headers.get('origin')))
    return NextResponse.json({ok:false,error:'INVALID_ORIGIN'},{status:403,headers});
  const parsed=await readRequestJson<{email?:unknown;code?:unknown}>(req, { maxBytes: RU_AUTH_MAX_JSON_BYTES });
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
    clearPendingGoogleOauth(session);
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
