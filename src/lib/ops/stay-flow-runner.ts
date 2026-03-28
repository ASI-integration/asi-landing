/**
 * Stay-flow runner: proactive pre-checkin advancement.
 *
 * On each runner pass, finds reservations that:
 *   - were previously blocked by the readiness gate (readiness_checked_at IS NOT NULL)
 *   - are now unblocked (readiness_blocked = false)
 *   - have not yet had check-in instructions sent (pre_checkin_sent_at IS NULL)
 *   - have an upcoming / recent check-in (within the 48-hour look-back window)
 *   - are not cancelled
 *
 * For each eligible reservation:
 *   - Re-evaluates the checkin readiness gate (safety re-check — state may have
 *     changed between unlock and this runner pass).
 *   - If still ready AND a pre_checkin_template is configured:
 *       → sends the check-in message via Telegram
 *       → records pre_checkin_sent_at (idempotency seal — future runner passes skip it)
 *       → emits next_reservation_auto_advanced timeline event
 *   - If gate fails again:
 *       → re-blocks the reservation (readiness_blocked = true)
 *       → emits stay_flow_readiness_blocked timeline event
 *   - If no template or no chat_id: skips (leaves eligible for the next pass).
 *
 * Safe to run multiple times: the pre_checkin_sent_at column prevents any re-send.
 */

import { supabase } from '@/lib/supabase';
import { evaluateCheckinReadiness } from '@/lib/ops/checkin-gate';
import { getPropertyTemplates } from '@/lib/communication/templates';
import { replyToTelegram } from '@/lib/telegram';
import { appendTimelineEvent } from '@/lib/communication/timeline';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StayFlowRunnerResult {
  /** Reservations that received a proactive pre-checkin message this pass. */
  advanced:   number;
  /** Eligible but skipped: no template configured or no chat_id. */
  skipped:    number;
  /** Re-blocked: gate failed again after unlock. */
  re_blocked: number;
  /** Errors during processing of individual reservations. */
  failed:     number;
}

interface EligibleReservation {
  id:          string;
  chat_id:     number | null;
  property_id: string;
  check_in:    string | null;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run one pass of the stay-flow auto-advancement runner.
 *
 * Designed to be called from the cron job (GET /api/cron/check-trial).
 * Each call is idempotent: once pre_checkin_sent_at is set the reservation
 * is excluded from all future passes.
 *
 * Returns a summary of what happened during this pass for logging.
 */
export async function runStayFlowAdvancement(): Promise<StayFlowRunnerResult> {
  const result: StayFlowRunnerResult = { advanced: 0, skipped: 0, re_blocked: 0, failed: 0 };

  // ── 1. Find eligible reservations ─────────────────────────────────────────
  // The 48-hour cutoff matches unlockNextBlockedReservation — no need to process
  // records older than that.
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('id, chat_id, property_id, check_in')
    .eq('readiness_blocked', false)
    .not('readiness_checked_at', 'is', null)  // was previously gated (blocked then unlocked)
    .is('pre_checkin_sent_at', null)           // pre-checkin not yet sent
    .neq('status', 'cancelled')
    .gte('check_in', cutoff)
    .order('check_in', { ascending: true });

  if (error) {
    console.error('[StayFlowRunner] Query failed:', error.message);
    result.failed++;
    return result;
  }

  const rows = (data ?? []) as EligibleReservation[];

  if (rows.length === 0) {
    return result; // nothing to do this pass
  }

  console.log(`[StayFlowRunner] Found ${rows.length} eligible reservation(s) for auto-advance`);

  // ── 2. Process each eligible reservation ──────────────────────────────────
  for (const row of rows) {
    try {
      await processEligibleReservation(row, result);
    } catch (err) {
      console.error(`[StayFlowRunner] Unexpected error for reservation ${row.id}:`, err);
      result.failed++;
    }
  }

  console.log(
    `[StayFlowRunner] Pass complete — advanced=${result.advanced} skipped=${result.skipped} re_blocked=${result.re_blocked} failed=${result.failed}`,
  );

  return result;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function processEligibleReservation(
  row: EligibleReservation,
  result: StayFlowRunnerResult,
): Promise<void> {
  // Re-evaluate readiness gate (state may have changed between unlock and this pass)
  const gate = await evaluateCheckinReadiness(row.property_id);

  if (!gate.allowed) {
    // Gate failed — re-block so the system stays consistent
    await supabase
      .from('tg_guest_reservations')
      .update({
        readiness_blocked:      true,
        readiness_block_reason: gate.blocked_reason,
        readiness_checked_at:   gate.checked_at,
      })
      .eq('id', row.id);

    appendTimelineEvent(`prop_${row.property_id}`, {
      type:           'stay_flow_readiness_blocked',
      property_id:    row.property_id,
      blocked_reason: gate.blocked_reason ?? 'unit_not_ready',
      reservation_id: row.id,
      ts:             new Date(),
    }).catch(() => {});

    console.warn(
      `[StayFlowRunner] Reservation ${row.id} re-blocked: ${gate.blocked_reason}`,
    );
    result.re_blocked++;
    return;
  }

  // Gate passed — need a template and a chat_id to send
  if (!row.chat_id) {
    console.warn(`[StayFlowRunner] Reservation ${row.id} has no chat_id — skipping`);
    result.skipped++;
    return;
  }

  const templates = await getPropertyTemplates(row.property_id);
  if (!templates?.pre_checkin_template) {
    console.warn(
      `[StayFlowRunner] Reservation ${row.id} (property ${row.property_id}) has no pre_checkin_template — skipping`,
    );
    result.skipped++;
    return;
  }

  // Send the pre-checkin message
  const message = templates.pre_checkin_template.trim().substring(0, 2000);
  const sent = await replyToTelegram(row.chat_id, message);

  if (!sent) {
    console.error(`[StayFlowRunner] Failed to send pre-checkin to chat ${row.chat_id} for reservation ${row.id}`);
    result.failed++;
    return;
  }

  // Seal with sent timestamp (idempotency — future passes skip this reservation)
  const now = new Date().toISOString();
  await supabase
    .from('tg_guest_reservations')
    .update({ pre_checkin_sent_at: now })
    .eq('id', row.id);

  // Audit event
  appendTimelineEvent(`tg_${row.chat_id}`, {
    type:           'next_reservation_auto_advanced',
    property_id:    row.property_id,
    reservation_id: row.id,
    ts:             new Date(),
  }).catch(() => {});

  console.log(
    `[StayFlowRunner] Auto-advanced reservation ${row.id} (chat ${row.chat_id}, property ${row.property_id})`,
  );
  result.advanced++;
}
