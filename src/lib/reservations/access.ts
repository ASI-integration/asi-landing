import { resolveAccountIdForUser } from '@/lib/accounts';
import { isOpsAdminEmail } from '@/lib/crm/access';
import { supabase } from '@/lib/supabase';

export type ReservationAccessScope = {
  accountId: string;
  actorId: string;
  operatorRole: string | null;
  isOpsAdmin: boolean;
};

export async function resolveReservationAccess(session: { userId?: string | null; email?: string | null }): Promise<ReservationAccessScope> {
  const actorId = session.userId ?? '';
  if (!actorId) throw new Error('reservation_account_not_found');
  const accountId = await resolveAccountIdForUser(actorId);
  if (!accountId) throw new Error('reservation_account_not_found');

  let operatorRole: string | null = null;
  if (accountId !== 'legacy') {
    const membership = await supabase.from('account_members').select('role').eq('user_id', actorId).eq('account_id', accountId).maybeSingle();
    if (membership.error) throw new Error(membership.error.message);
    operatorRole = typeof membership.data?.role === 'string' ? membership.data.role : null;
  }

  return { accountId, actorId, operatorRole, isOpsAdmin: isOpsAdminEmail(session.email) };
}
