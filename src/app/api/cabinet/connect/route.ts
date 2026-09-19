import { NextResponse } from 'next/server';
import { requireCabinetSession } from '@/lib/cabinet/api-auth';
import { supabase } from '@/lib/supabase';
import { parseConnectionInput } from '@/lib/rental-connect/model';
import { ConnectionValidationError, readConnection, saveConnection } from '@/lib/rental-connect/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireOwner() {
  const auth = await requireCabinetSession();
  if ('error' in auth) return auth;
  const { data, error } = await supabase.from('account_members').select('account_id')
    .eq('user_id', auth.session.userId).in('role', ['owner', 'manager'])
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) return { error: NextResponse.json({ message: 'Не удалось загрузить кабинет. Попробуйте ещё раз.' }, { status: 503 }) };
  if (!data) return { error: NextResponse.json({ message: 'Подключение доступно владельцу или управляющему объекта.' }, { status: 403 }) };
  return { accountId: data.account_id as string, actorId: auth.session.userId };
}

export async function GET() {
  try {
    const auth = await requireOwner();
    if ('error' in auth) return auth.error;
    return NextResponse.json({ ok: true, ...await readConnection(auth.accountId) });
  } catch {
    return NextResponse.json({ message: 'Не удалось загрузить подключение. Попробуйте ещё раз.' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireOwner();
    if ('error' in auth) return auth.error;
    let input;
    try { input = parseConnectionInput(await req.json()); } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : 'Некорректные данные.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...await saveConnection(auth.accountId, auth.actorId, input.step, input.values) });
  } catch (error) {
    if (error instanceof ConnectionValidationError) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ message: 'Не удалось сохранить шаг. Данные на экране сохранены — попробуйте ещё раз.' }, { status: 503 });
  }
}
