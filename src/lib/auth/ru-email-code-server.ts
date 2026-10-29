import { createHmac } from 'node:crypto';
import { createOneTimeCode, digestOneTimeCode, normalizeLoginEmail, ruCodeAuthConfigured } from './ru-email-code-policy';
import { supabase } from '@/lib/supabase';

export const AUTH_GENERIC_RESPONSE = {
  ok: true, message: 'Если адрес указан верно, письмо с кодом будет отправлено.',
} as const;

export function ruEmailCodeReady(): boolean {
  return ruCodeAuthConfigured(process.env);
}

export function emailCodeIpDigest(ip: string, pepper: string): string {
  return createHmac('sha256', pepper).update('asi.ru.email-code.ip.v1\0').update(ip).digest('hex');
}

/** Proxy must overwrite forwarded IP headers; otherwise use a shared quota. */
export function trustedClientIp(req: Request): string {
  if (process.env.ASI_RU_AUTH_TRUST_PROXY !== 'true') return 'unattributed';
  const ip = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '').trim();
  return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : 'unattributed';
}

export async function issueRuEmailCode(emailInput: unknown, req: Request): Promise<{sent: boolean; throttled: boolean}> {
  const email = normalizeLoginEmail(emailInput);
  if (!email || !ruEmailCodeReady()) return {sent:false, throttled:true};
  const code = createOneTimeCode();
  const pepper = process.env.ASI_RU_EMAIL_CODE_PEPPER!;
  const digest = digestOneTimeCode(email, code, pepper);
  const ipHash = emailCodeIpDigest(trustedClientIp(req), pepper);
  const {data, error} = await supabase.rpc('ru_auth_issue_email_code', {
    p_email:email, p_hash:digest, p_ip_hash:ipHash,
  });
  if (error) throw new Error('RU_AUTH_OTP_DATABASE_NOT_READY');
  if (data !== true) return {sent:false, throttled:true};
  try {
    await sendRuAuthMail(email, code);
    return {sent:true, throttled:false};
  } catch {
    // Never leave a fresh credential valid after a delivery failure.
    await supabase.rpc('ru_auth_revoke_email_code', {p_email:email,p_hash:digest});
    return {sent:false, throttled:false};
  }
}

export async function consumeRuEmailCode(emailInput: unknown, codeInput: unknown): Promise<string | null> {
  const email=normalizeLoginEmail(emailInput);
  if (!email || typeof codeInput !== 'string' || !/^[0-9]{8}$/.test(codeInput) || !ruEmailCodeReady()) return null;
  const digest=digestOneTimeCode(email,codeInput,process.env.ASI_RU_EMAIL_CODE_PEPPER!);
  const {data,error}=await supabase.rpc('ru_auth_consume_email_code',{p_email:email,p_hash:digest});
  if(error) throw new Error('RU_AUTH_OTP_DATABASE_NOT_READY');
  return data===true ? email : null;
}

/** Separate transactional login mail, not guest auto-send and not a draft. */
async function sendRuAuthMail(email: string, code: string): Promise<void> {
  const controller=new AbortController();
  const deadline=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        Authorization:'Bearer '+process.env.ASI_AUTH_RESEND_API_KEY!,
        'Content-Type':'application/json',
      },
      body:JSON.stringify({
        from:process.env.ASI_AUTH_FROM_EMAIL,
        to:[email],
        subject:'ASI — код для входа',
        text:'Ваш одноразовый код ASI: '+code+'\n\nКод действует 10 минут. Если вы не запрашивали вход, проигнорируйте это письмо.',
      }),
      cache:'no-store',
      signal:controller.signal,
    });
    if(!response.ok)throw new Error('AUTH_DELIVERY_FAILED');
  } finally {clearTimeout(deadline);}
}
