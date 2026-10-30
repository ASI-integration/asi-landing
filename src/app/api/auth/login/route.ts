import { getIsRuHost } from '@/lib/getIsRuHost';
import { isRuRuntimeHost } from '@/lib/runtimeHost';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { ensureAccountForUser } from '@/lib/accounts';
import { readRequestJson } from '@/lib/safeRequestJson';
import { isSameOriginAuthRequest } from '@/lib/auth/ru-email-code-policy';
import { clearPendingYandexOauth, clearPendingGoogleOauth } from '@/lib/auth/ru-yandex-policy';

export async function POST(req: Request) {
  try {
    // RU cookies retain SameSite=None for OAuth. Password login must reject
    // cross-site login CSRF before credentials or session cookies are touched.
    // Forwarded Host can be misconfigured or supplied by an untrusted proxy.
    // Never let it downgrade an actual .ru request into the global plan/trial
    // login branch. Either independently observed RU signal enforces RU policy.
    const isRu = isRuRuntimeHost(new URL(req.url).hostname) || await getIsRuHost();
    if (isRu && process.env.NODE_ENV === 'production' &&
        !isSameOriginAuthRequest(req.url, req.headers.get('origin'))) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
    }
    // RU password login has the same bounded unauthenticated request-body policy
    // as RU email-code login. Preserve the existing non-RU parser behavior.
    const parsed = await readRequestJson<{
      email?: unknown; password?: unknown; plan?: unknown;
    }>(req, isRu ? { maxBytes: 2048 } : {});
    if (!parsed.ok) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { email, password, plan } = parsed.data;
    if (typeof email !== 'string' || !email.trim() ||
        typeof password !== 'string' || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const emailLower = email.trim().toLowerCase();

    // RU password fallback must resolve the same existing identity as OTP.
    // users.email has case-sensitive uniqueness today: never authenticate an
    // ambiguous case-folded identity or a broad ILIKE wildcard match.
    let user: { id: string; email: string; password_hash: string } | null = null;
    if (isRu) {
      const escaped = emailLower.replace(/[\\%_]/g, '\\$&');
      const { data: rows, error } = await supabase.from('users')
        .select('id, email, password_hash').ilike('email', escaped).limit(3);
      if (!error && rows?.length === 1 &&
          typeof rows[0].email === 'string' &&
          rows[0].email.toLowerCase() === emailLower) {
        user = rows[0];
      }
    } else {
      // Leave international email/password matching unchanged.
      const { data, error } = await supabase.from('users')
        .select('id, email, password_hash').eq('email', emailLower).single();
      if (!error) user = data;
    }
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Failure to establish account mapping must not leave a valid login
    // session cookie after a 500. Login never starts or resets a pilot.
    // Sign-in is not a purchase or plan-change operation. RU callers must
    // not upgrade or reset an existing commercial plan with a forged `plan`.
    // Keep the pre-existing non-RU login contract unchanged in this Draft PR.
    await ensureAccountForUser(isRu
      ? { userId: user.id, email: user.email, ruCommercial: true }
      : { userId: user.id, email: user.email, selectedPlan: plan, deferTrial: true }
    );

    const session = await getSession();
    clearPendingYandexOauth(session);
    // A completed RU password login invalidates older, unfinished provider flows.
    // Keep existing international Google login behavior unchanged.
    if (isRu) clearPendingGoogleOauth(session);
    session.userId = user.id;
    session.email = user.email;
    session.lastStrongAuthAt = Date.now();
    session.lastStrongAuthUserId = user.id;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error('[Login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
