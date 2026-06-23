import { tgTextUpdate } from './dev/telegram-fixtures';
import { processUpdate } from './orchestrator';
import { closeEscalationReview, listEscalationReviews, type EscalationReview } from './operator-review';
import {
  buildTelegramOpsAcceptanceMessage,
  getTelegramOpsAcceptanceSyntheticChatId,
  TELEGRAM_OPS_ACCEPTANCE_PREFIX,
  TELEGRAM_OPS_ACCEPTANCE_ESCALATE_MARKER,
  TELEGRAM_OPS_ACCEPTANCE_MESSAGE_SUFFIX,
  TELEGRAM_OPS_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT,
} from './telegram-ops-acceptance-shared';
import { ProcessOutcome } from './types';
import {
  formatOpsOperatorTasksPreflightFailure,
  getSupabaseHostForLog,
  verifyOpsOperatorTasksTable,
} from '@/lib/ops-board/acceptance-preflight';
import {
  buildAutoOpsDedupKey,
  listOpsOperatorTasks,
} from '@/lib/ops-board/repository';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import { mapOperatorTaskToV1 } from '@/lib/ops-v1/mapping';
import { listOpsV1Tasks, updateOpsV1Task } from '@/lib/ops-v1/repository';
import { supabase } from '@/lib/supabase';

export {
  TELEGRAM_OPS_ACCEPTANCE_PREFIX,
  TELEGRAM_OPS_ACCEPTANCE_ESCALATE_MARKER,
  TELEGRAM_OPS_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT,
  TELEGRAM_OPS_ACCEPTANCE_MESSAGE_SUFFIX,
  buildTelegramOpsAcceptanceMessage,
  getTelegramOpsAcceptanceSyntheticChatId,
  isTelegramOpsAcceptanceEscalationRequest,
} from './telegram-ops-acceptance-shared';

export function buildTelegramOpsAcceptanceSyntheticUpdate(runId: string) {
  const now = Date.now();
  return tgTextUpdate({
    update_id: now,
    message_id: now + 1,
    chat_id: getTelegramOpsAcceptanceSyntheticChatId(),
    user_id: now + 2,
    language_code: 'ru',
    text: buildTelegramOpsAcceptanceMessage(runId),
  });
}

function reviewMatchesMarker(review: EscalationReview, targetId: string, marker: string): boolean {
  if (String(review.targetId) !== String(targetId)) return false;
  const haystack = [
    review.detail,
    review.suggestedReply,
    ...review.latestMessages.map((item) => item.content),
    String(review.source?.message_preview ?? ''),
  ]
    .filter(Boolean)
    .join('\n');
  return haystack.includes(marker);
}

export function findAcceptanceEscalationReview(input: {
  targetId: string;
  marker: string;
}): EscalationReview | null {
  const targetId = String(input.targetId).trim();
  const marker = String(input.marker).trim();
  if (!targetId || !marker) return null;

  const pending = listEscalationReviews({ status: 'pending', limit: 200 });
  const matches = pending
    .filter((review) => reviewMatchesMarker(review, targetId, marker))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return matches[0] ?? null;
}

export async function verifyTelegramOpsTaskForReview(reviewId: string): Promise<{
  ok: boolean;
  failures: string[];
  taskId: string | null;
  firstSync: { created: number; scanned: number };
  secondSync: { created: number; scanned: number };
}> {
  const failures: string[] = [];
  const dedupKey = buildAutoOpsDedupKey({
    source: 'communications',
    sourceId: reviewId,
    taskType: 'verify_guest_issue',
  });

  const firstSync = await syncAutoOpsTasks();
  const listed = await listOpsOperatorTasks({ status: 'all' });
  if (!listed.ok) {
    return {
      ok: false,
      failures: [`listOpsOperatorTasks failed: ${listed.error ?? 'unknown'}`],
      taskId: null,
      firstSync,
      secondSync: { created: 0, scanned: 0 },
    };
  }

  const matching = listed.tasks.filter((task) => task.dedupKey === dedupKey);
  const task = matching[0] ?? null;
  let taskId: string | null = null;

  if (!task) {
    failures.push('OPS task not found after first syncAutoOpsTasks()');
  } else {
    taskId = task.id;
    const v1 = mapOperatorTaskToV1(task);
    if (v1.source !== 'communications') {
      failures.push(`expected source=communications, got ${v1.source}`);
    }
    if (v1.origin !== 'auto') {
      failures.push(`expected origin=auto, got ${v1.origin}`);
    }
    if (v1.taskType !== 'issue') {
      failures.push(`expected taskType=issue (Проблема), got ${v1.taskType}`);
    }
    if (v1.status !== 'needs_attention') {
      failures.push(`expected status=needs_attention, got ${v1.status}`);
    }
    if (v1.comment !== 'Требуется ручная проверка сообщения гостя') {
      failures.push(`unexpected comment: ${v1.comment}`);
    }
    if (v1.objectLabel || v1.propertyId) {
      failures.push('expected unknown object (objectLabel/propertyId empty)');
    }
  }

  const secondSync = await syncAutoOpsTasks();
  const listedAgain = await listOpsOperatorTasks({ status: 'all' });
  if (!listedAgain.ok) {
    failures.push(`listOpsOperatorTasks after second sync failed: ${listedAgain.error ?? 'unknown'}`);
  } else {
    const matchingAgain = listedAgain.tasks.filter((item) => item.dedupKey === dedupKey);
    if (matchingAgain.length > 1) {
      failures.push(`duplicate OPS tasks found (${matchingAgain.length}) after second sync`);
    }
    if (secondSync.created > 0 && taskId) {
      failures.push(`second sync created=${secondSync.created}, expected 0`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    taskId,
    firstSync,
    secondSync,
  };
}

export async function runTelegramOpsAcceptanceLifecycle(taskId: string): Promise<{
  ok: boolean;
  failures: string[];
}> {
  const failures: string[] = [];

  const activeBefore = await listOpsV1Tasks({ filter: 'active', syncAuto: false });
  const activeTaskBefore = activeBefore.tasks.find((task) => task.id === taskId);
  if (!activeTaskBefore) {
    failures.push('task not visible in active list before lifecycle');
  }

  const doneUpdate = await updateOpsV1Task(taskId, { status: 'done' });
  if (!doneUpdate.ok || !doneUpdate.task) {
    failures.push(`updateOpsV1Task(done) failed: ${doneUpdate.error ?? 'unknown'}`);
    return { ok: false, failures };
  }

  const activeAfterDone = await listOpsV1Tasks({ filter: 'active', syncAuto: false });
  if (activeAfterDone.tasks.some((task) => task.id === taskId)) {
    failures.push('task still visible in active list after done');
  }

  const doneList = await listOpsV1Tasks({ filter: 'done', syncAuto: false });
  if (!doneList.tasks.some((task) => task.id === taskId)) {
    failures.push('task not visible in done list after done');
  }

  const reopenUpdate = await updateOpsV1Task(taskId, { status: 'in_progress' });
  if (!reopenUpdate.ok || !reopenUpdate.task) {
    failures.push(`updateOpsV1Task(in_progress) failed: ${reopenUpdate.error ?? 'unknown'}`);
    return { ok: false, failures };
  }
  if (reopenUpdate.task.status !== 'in_progress') {
    failures.push(`expected status=in_progress after reopen, got ${reopenUpdate.task.status}`);
  }

  const activeAfterReopen = await listOpsV1Tasks({ filter: 'active', syncAuto: false });
  if (!activeAfterReopen.tasks.some((task) => task.id === taskId)) {
    failures.push('task not visible in active list after reopen');
  }

  return { ok: failures.length === 0, failures };
}

export type TelegramOpsAcceptanceRunResult = {
  ok: boolean;
  failures: string[];
  runId: string;
  marker: string;
  chatId: string;
  reviewId: string | null;
  taskId: string | null;
  processOutcome: string | null;
  firstSync: { created: number; scanned: number } | null;
  secondSync: { created: number; scanned: number } | null;
};

export async function runTelegramOpsAcceptanceFull(input?: {
  runId?: string;
  skipCleanup?: boolean;
}): Promise<TelegramOpsAcceptanceRunResult> {
  const failures: string[] = [];
  const runId = String(input?.runId ?? Date.now().toString(36)).trim() || Date.now().toString(36);
  const marker = `${TELEGRAM_OPS_ACCEPTANCE_PREFIX}${runId}`;
  const chatId = String(getTelegramOpsAcceptanceSyntheticChatId());

  const preflight = await verifyOpsOperatorTasksTable();
  if (!preflight.ok) {
    return {
      ok: false,
      failures: [formatOpsOperatorTasksPreflightFailure(preflight.error)],
      runId,
      marker,
      chatId,
      reviewId: null,
      taskId: null,
      processOutcome: null,
      firstSync: null,
      secondSync: null,
    };
  }

  let reviewId: string | null = null;
  let taskId: string | null = null;
  let processOutcome: string | null = null;
  let firstSync: { created: number; scanned: number } | null = null;
  let secondSync: { created: number; scanned: number } | null = null;

  const prevDryRun = process.env.DRY_RUN_TELEGRAM_OUTBOUND;
  process.env.DRY_RUN_TELEGRAM_OUTBOUND = '1';

  try {
    const update = buildTelegramOpsAcceptanceSyntheticUpdate(runId);
    const processResult = await processUpdate(update);
    processOutcome = processResult.outcome;

    if (processResult.outcome === ProcessOutcome.Duplicate) {
      failures.push('processUpdate returned Duplicate (inbound idempotency collision)');
    } else if (processResult.outcome === ProcessOutcome.Ignored) {
      failures.push('processUpdate ignored synthetic update');
    }

    const review = findAcceptanceEscalationReview({ targetId: chatId, marker });
    if (!review) {
      failures.push('pending escalation review not found after processUpdate');
    } else {
      reviewId = review.reviewId;
    }

    if (reviewId) {
      const verify = await verifyTelegramOpsTaskForReview(reviewId);
      firstSync = verify.firstSync;
      secondSync = verify.secondSync;
      if (!verify.ok) {
        failures.push(...verify.failures);
      } else {
        taskId = verify.taskId;
      }

      if (taskId) {
        const lifecycle = await runTelegramOpsAcceptanceLifecycle(taskId);
        if (!lifecycle.ok) {
          failures.push(...lifecycle.failures);
        }
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(`acceptance run failed: ${detail}`);
  } finally {
    if (prevDryRun === undefined) {
      delete process.env.DRY_RUN_TELEGRAM_OUTBOUND;
    } else {
      process.env.DRY_RUN_TELEGRAM_OUTBOUND = prevDryRun;
    }

    const shouldCleanup = !input?.skipCleanup && process.env.KEEP_OPS_ACCEPTANCE_DATA !== '1';
    if (shouldCleanup && (reviewId || taskId)) {
      try {
        await cleanupTelegramOpsAcceptanceData({ reviewId, taskId });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(`cleanup failed: ${detail}`);
      }
    }
  }

  if (failures.length === 0) {
    console.info('[telegram-ops-acceptance] run ok', {
      supabase_host: getSupabaseHostForLog(),
      chatId,
      marker,
      processOutcome,
      reviewId,
      taskId,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    runId,
    marker,
    chatId,
    reviewId,
    taskId,
    processOutcome,
    firstSync,
    secondSync,
  };
}

export async function cleanupTelegramOpsAcceptanceData(input: {
  reviewId: string | null;
  taskId: string | null;
}): Promise<void> {
  if (process.env.KEEP_OPS_ACCEPTANCE_DATA === '1') return;

  if (input.taskId) {
    const { error } = await supabase.from('ops_operator_tasks').delete().eq('id', input.taskId);
    if (error) {
      console.warn('[telegram-ops-acceptance] cleanup task warning:', error.message);
    }
  }

  if (input.reviewId) {
    try {
      closeEscalationReview(input.reviewId, 'acceptance_cleanup');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn('[telegram-ops-acceptance] cleanup review warning:', detail);
    }
  }
}
