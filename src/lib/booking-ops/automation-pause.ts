import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';

/** Durable manual takeover. No timeout or implicit resume; read errors fail closed. */
export async function requireBookingAutomationRunning(bookingId: string): Promise<void> {
  const result = await supabase.from('booking_ops_records').select('automation_paused').eq('id', bookingId).single();
  if (result.error || !result.data) throw new Error('booking_automation_state_unavailable');
  if (result.data.automation_paused !== false) throw new Error('booking_automation_manually_paused');
}

/** Shared durable execution lease; failures remain HOLD because a remote write may still commit. */
export async function withBookingAutomationLease<T>(bookingId: string, execute: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const begin = await supabase.rpc('g0_begin_automation', { p_booking: bookingId, p_token: token });
  if (begin.error || begin.data !== true) throw new Error(begin.error?.message ?? 'booking_automation_admission_uncertain');
  const result = await execute(); // Deliberately no finally release on timeout/error/unknown commit.
  const summary = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (summary.ok === false || summary.intakeStatus === 'failed' || (Array.isArray(summary.errors) && summary.errors.length > 0)) return result;
  const end = await supabase.rpc('g0_end_automation', { p_booking: bookingId, p_token: token });
  if (end.error || end.data !== true) throw new Error('booking_automation_release_uncertain');
  return result;
}
