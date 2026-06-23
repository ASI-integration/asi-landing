import { buildAutoOpsDedupKey, listOpsOperatorTasks } from '@/lib/ops-board/repository';
import {
  formatOpsOperatorTasksPreflightFailure,
  getSupabaseHostForLog,
  verifyOpsOperatorTasksTable,
} from '@/lib/ops-board/acceptance-preflight';
import { createPilotBooking } from '@/lib/bookings/repository';
import { runTelegramOpsAcceptanceFull } from '@/lib/communication/telegram-ops-acceptance';
import {
  canSendAutonomousGuestReply,
  getEffectiveCommunicationMode,
  isCommunicationKillSwitchActive,
} from '@/lib/communication/communication-autopilot-settings';
import { cleanupPilotAcceptanceData } from '@/lib/pilot-readiness/cleanup';
import { computePilotReadiness } from '@/lib/pilot-readiness/engine';
import {
  getPilotReadinessForProperty,
  loadPilotObjectSnapshot,
  upsertPilotObjectKnowledge,
} from '@/lib/pilot-readiness/repository';
import { PILOT_ACCEPTANCE_PREFIX } from '@/lib/pilot-readiness/types';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import { supabase } from '@/lib/supabase';

export type PilotReadinessAcceptanceResult = {
  ok: boolean;
  failures: string[];
  runId: string;
  propertyId: string | null;
  bookingId: string | null;
  readinessBefore: boolean | null;
  readinessAfter: boolean | null;
  firstBookingSync: { created: number; scanned: number } | null;
  secondBookingSync: { created: number; scanned: number } | null;
  telegramOps: { ok: boolean; failures: string[] } | null;
};

function localDatePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function runPilotReadinessAcceptance(input?: {
  runId?: string;
  skipCleanup?: boolean;
}): Promise<PilotReadinessAcceptanceResult> {
  const failures: string[] = [];
  const runId = String(input?.runId ?? Date.now().toString(36)).trim() || Date.now().toString(36);
  const marker = `${PILOT_ACCEPTANCE_PREFIX}${runId}`;
  const propertyId = `pilot_accept_${runId}`;
  let bookingId: string | null = null;
  let readinessBefore: boolean | null = null;
  let readinessAfter: boolean | null = null;
  let firstBookingSync: { created: number; scanned: number } | null = null;
  let secondBookingSync: { created: number; scanned: number } | null = null;
  let telegramOps: { ok: boolean; failures: string[] } | null = null;

  const preflight = await verifyOpsOperatorTasksTable();
  if (!preflight.ok) {
    return {
      ok: false,
      failures: [formatOpsOperatorTasksPreflightFailure(preflight.error)],
      runId,
      propertyId: null,
      bookingId: null,
      readinessBefore: null,
      readinessAfter: null,
      firstBookingSync: null,
      secondBookingSync: null,
      telegramOps: null,
    };
  }

  const prevKillSwitch = process.env.COMMUNICATION_KILL_SWITCH;
  const prevEscalationOnly = process.env.TELEGRAM_OPS_ESCALATION_ONLY;
  const prevDryRun = process.env.DRY_RUN_TELEGRAM_OUTBOUND;

  process.env.TELEGRAM_OPS_ESCALATION_ONLY = '1';
  process.env.DRY_RUN_TELEGRAM_OUTBOUND = '1';

  try {
    const created = await upsertPilotObjectKnowledge({
      property_id: propertyId,
      object_name: 'Пилот acceptance',
      active: true,
      pilot_acceptance_marker: marker,
    });
    if (!created.ok) failures.push(`pilot object create failed: ${created.error}`);

    const before = await getPilotReadinessForProperty(propertyId);
    readinessBefore = before?.ready ?? false;
    if (readinessBefore) failures.push('readiness should be not ready before filling data');

    const firstSync = await syncAutoOpsTasks();
    const readinessDedup = buildAutoOpsDedupKey({
      source: 'object_passport',
      sourceId: propertyId,
      taskType: 'request_owner_data',
    });
    const listedAfterFirst = await listOpsOperatorTasks({ status: 'all' });
    const readinessTask = listedAfterFirst.tasks.find((task) => task.dedupKey === readinessDedup);
    if (!readinessTask) {
      failures.push('OPS task for missing pilot readiness not found after first sync');
    }

    const filled = await upsertPilotObjectKnowledge({
      property_id: propertyId,
      object_name: 'Пилот acceptance',
      address: 'Санкт-Петербург, Невский 1',
      description: 'Тестовое описание для acceptance',
      house_rules_text: 'Тишина после 22:00',
      check_in_time: '15:00',
      check_out_time: '12:00',
      wifi_name: 'ASI-Guest',
      wifi_password: 'test-pass',
      booking_channels: 'Авито, вручную',
      photos_deferred: true,
      communication_autopilot: 'enabled',
      pilot_acceptance_marker: marker,
      active: true,
    });
    if (!filled.ok) failures.push(`pilot object fill failed: ${filled.error}`);

    await syncAutoOpsTasks();
    const after = await getPilotReadinessForProperty(propertyId);
    readinessAfter = after?.ready ?? false;
    if (!readinessAfter) {
      failures.push(`readiness still not ready: ${after?.missingLabelsRu.join(', ') ?? 'unknown'}`);
    }

    const booking = await createPilotBooking({
      propertyId,
      guestName: 'Гость acceptance',
      guestContact: '+79000000000',
      checkIn: localDatePlusDays(1),
      checkOut: localDatePlusDays(3),
      channel: 'manual',
      status: 'confirmed',
      comment: marker,
      reservationRef: `${marker}_booking`,
      pilotAcceptanceMarker: marker,
    });
    if (!booking.ok || !booking.booking) {
      failures.push(`booking create failed: ${booking.error ?? 'unknown'}`);
    } else {
      bookingId = booking.booking.id;
    }

    firstBookingSync = await syncAutoOpsTasks();
    secondBookingSync = await syncAutoOpsTasks();
    if (secondBookingSync.created > 0) {
      failures.push(`second booking sync created duplicates: created=${secondBookingSync.created}`);
    }

    const checkinDedup = buildAutoOpsDedupKey({
      source: 'booking',
      sourceId: bookingId ?? 'missing',
      taskType: 'prepare_checkin',
      dateKey: localDatePlusDays(1),
    });
    const listedBookingTasks = await listOpsOperatorTasks({ status: 'all' });
    const checkinTasks = listedBookingTasks.tasks.filter((task) => task.dedupKey === checkinDedup);
    if (bookingId && checkinTasks.length === 0) {
      failures.push('prepare_checkin OPS task not found for acceptance booking');
    }
    if (checkinTasks.length > 1) {
      failures.push(`duplicate prepare_checkin tasks: ${checkinTasks.length}`);
    }

    const telegramResult = await runTelegramOpsAcceptanceFull({
      runId: `pilot_${runId}`,
      skipCleanup: true,
    });
    telegramOps = { ok: telegramResult.ok, failures: telegramResult.failures };
    if (!telegramResult.ok) {
      failures.push(...telegramResult.failures.map((item) => `telegram: ${item}`));
    }

    process.env.COMMUNICATION_KILL_SWITCH = '1';
    const snapshot = await loadPilotObjectSnapshot(propertyId);
    if (snapshot) {
      const mode = getEffectiveCommunicationMode({
        communication_autopilot: (snapshot.communicationMode ?? 'disabled') as 'disabled' | 'enabled' | 'manual',
      });
      if (mode !== 'off') failures.push('kill switch should force communication mode off');
      if (
        canSendAutonomousGuestReply({
          communication_autopilot: (snapshot.communicationMode ?? 'disabled') as 'disabled' | 'enabled' | 'manual',
        })
      ) {
        failures.push('kill switch should block autonomous guest replies');
      }
    }
    if (!isCommunicationKillSwitchActive()) {
      failures.push('kill switch env not active');
    }

    const incompleteSnapshot = computePilotReadiness({
      propertyId,
      objectLabel: 'incomplete',
      name: null,
      address: null,
      description: null,
      rules: null,
      checkInTime: null,
      checkOutTime: null,
      wifiName: null,
      wifiPassword: null,
      wifiSkipped: false,
      accessNotes: null,
      checkinInstructions: null,
      photosDeferred: false,
      photosCount: 0,
      bookingChannels: null,
      communicationMode: null,
      contactId: null,
      ownerName: null,
    });
    if (incompleteSnapshot.ready) failures.push('incomplete snapshot should not be ready');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(`acceptance failed: ${detail}`);
  } finally {
    if (prevKillSwitch === undefined) delete process.env.COMMUNICATION_KILL_SWITCH;
    else process.env.COMMUNICATION_KILL_SWITCH = prevKillSwitch;

    if (prevEscalationOnly === undefined) delete process.env.TELEGRAM_OPS_ESCALATION_ONLY;
    else process.env.TELEGRAM_OPS_ESCALATION_ONLY = prevEscalationOnly;

    if (prevDryRun === undefined) delete process.env.DRY_RUN_TELEGRAM_OUTBOUND;
    else process.env.DRY_RUN_TELEGRAM_OUTBOUND = prevDryRun;

    const shouldCleanup = !input?.skipCleanup && process.env.KEEP_OPS_ACCEPTANCE_DATA !== '1';
    if (shouldCleanup) {
      try {
        await cleanupPilotAcceptanceData(marker);
        await supabase.from('tg_property_knowledge').delete().eq('property_id', propertyId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(`cleanup failed: ${detail}`);
      }
    }
  }

  if (failures.length === 0) {
    console.info('[pilot-readiness-acceptance] run ok', {
      supabase_host: getSupabaseHostForLog(),
      runId,
      propertyId,
      bookingId,
      readinessBefore,
      readinessAfter,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    runId,
    propertyId,
    bookingId,
    readinessBefore,
    readinessAfter,
    firstBookingSync,
    secondBookingSync,
    telegramOps,
  };
}
