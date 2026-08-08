import { supabase } from '@/lib/supabase';
import { cleanupLiveCoreAcceptanceHarness } from './channel-manager-live-core-acceptance';

type OpsCleanupRpcResult = {
  status?: 'passed' | 'already_clean' | 'blocked';
  deletedBookingOpsRecords?: number;
  blocker?: string | null;
};

/**
 * Durable acceptance cleanup path.
 *
 * The Booking Ops subtree contains append-only tables that intentionally do not grant
 * DELETE to service_role. First remove only the deterministic synthetic Booking Ops
 * parent through a SECURITY DEFINER RPC, letting PostgreSQL enforce reviewed CASCADE
 * semantics. Then reuse the existing harness cleanup for the remaining test contour.
 */
export async function cleanupLiveCoreAcceptanceHarnessV2() {
  const { data, error } = await supabase.rpc('channel_manager_live_core_acceptance_ops_cleanup_v2');
  if (error) {
    throw new Error(`acceptance_ops_cleanup_v2: ${error.message}`);
  }

  const rpc = (data ?? {}) as OpsCleanupRpcResult;
  if (rpc.status !== 'passed' && rpc.status !== 'already_clean') {
    throw new Error(rpc.blocker || 'acceptance_ops_cleanup_v2_blocked');
  }

  return cleanupLiveCoreAcceptanceHarness();
}
