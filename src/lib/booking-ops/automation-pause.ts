import { supabase } from '@/lib/supabase';

/** Durable manual takeover. No timeout or implicit resume; read errors fail closed. */
export async function requireBookingAutomationRunning(bookingId: string): Promise<void> {
  const result = await supabase.from('booking_ops_records').select('automation_paused').eq('id', bookingId).single();
  if (result.error || !result.data) throw new Error('booking_automation_state_unavailable');
  if (result.data.automation_paused !== false) throw new Error('booking_automation_manually_paused');
}
