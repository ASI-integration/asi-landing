import { supabase } from '@/lib/supabase';
import { requireBookingOpsRecordScope } from './repository';

export type OwnerPayoutResult = {
  status: 'PASS'; idempotent: boolean;
  grossRevenueCents?: number; depositHoldCents?: number; depositRetainedCents?: number;
  managementCommissionCents?: number; operationalExpensesCents?: number;
  ownerPayoutCents: number; balanceDifferenceCents: number;
};

/** Service-role only; the SQL RPC locks the scoped booking and posts all entries atomically. */
export async function settleClosedBookingFinance(
  bookingId: string, expectedScope: { accountId: string; propertyId: string },
): Promise<OwnerPayoutResult> {
  await requireBookingOpsRecordScope(bookingId, expectedScope);
  const result = await supabase.rpc('settle_closed_booking_finance', {
    p_booking_id: bookingId,
    p_account_id: expectedScope.accountId,
    p_property_id: expectedScope.propertyId,
  });
  if (result.error) throw new Error(`owner_finance_settlement_failed: ${result.error.code ?? 'unknown'} ${result.error.message}`);
  const report = result.data as OwnerPayoutResult;
  if (report?.status !== 'PASS' || report.balanceDifferenceCents !== 0)
    throw new Error('owner_finance_balance_mismatch');
  return report;
}
