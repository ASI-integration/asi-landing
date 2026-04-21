import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) return NextResponse.json({ channels: [] });

  const { data, error } = await supabase
    .from('dist_distribution_channels')
    .select('id, code, name, status, created_at, updated_at')
    .order('name', { ascending: true });
  if (error) throw error;

  return NextResponse.json({ channels: data ?? [] });
}

