import {
  closeEscalationReview,
  __resetEscalationReviewStoreForTests,
} from '@/lib/communication/operator-review';
import { recordCommunicationEscalation } from '@/lib/communication/escalations';
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
import { supabase } from '@/lib/supabase';

const ACCEPTANCE_PREFIX = 'ASI_COMM_OPS_ACCEPTANCE_';

function printError(error: unknown, message?: string): void {
  if (message) {
    console.error(`[communication-ops-acceptance] FAIL: ${message}`);
  }
  if (error instanceof Error) {
    if (!message || error.message !== message) {
      console.error(`[communication-ops-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
    return;
  }
  console.error(`[communication-ops-acceptance] error: ${String(error)}`);
}

function fail(message: string): never {
  console.error(`[communication-ops-acceptance] FAIL: ${message}`);
  process.exit(1);
}

async function runAcceptancePreflight(): Promise<void> {
  console.info('[communication-ops-acceptance] supabase_host:', getSupabaseHostForLog());

  const preflight = await verifyOpsOperatorTasksTable();
  if (!preflight.ok) {
    console.error(formatOpsOperatorTasksPreflightFailure(preflight.error));
    fail('OPS preflight failed: ops_operator_tasks table unavailable');
  }
}

async function cleanup(reviewId: string | null, taskId: string | null): Promise<void> {
  if (process.env.KEEP_OPS_ACCEPTANCE_DATA === '1') {
    console.info('[communication-ops-acceptance] KEEP_OPS_ACCEPTANCE_DATA=1');
    if (reviewId) console.info('[communication-ops-acceptance] review_id:', reviewId);
    if (taskId) console.info('[communication-ops-acceptance] task_id:', taskId);
    return;
  }

  if (taskId) {
    const { error } = await supabase.from('ops_operator_tasks').delete().eq('id', taskId);
    if (error) {
      console.warn('[communication-ops-acceptance] cleanup task warning:', error.message);
    }
  }

  if (reviewId) {
    try {
      closeEscalationReview(reviewId, 'acceptance_cleanup');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn('[communication-ops-acceptance] cleanup review warning:', detail);
    }
  }
}

async function main(): Promise<void> {
  await runAcceptancePreflight();

  const runId = Date.now().toString(36);
  const sessionId = `${ACCEPTANCE_PREFIX}${runId}`;
  const targetId = `acceptance-${runId}`;

  let reviewId: string | null = null;
  let taskId: string | null = null;
  const failures: string[] = [];

  try {
    const { review } = await recordCommunicationEscalation({
      sessionId,
      channel: 'telegram',
      targetId,
      messageText: `${ACCEPTANCE_PREFIX}Требуется ручная проверка сообщения гостя`,
      summary: 'Требуется ручная проверка сообщения гостя',
      reason: 'acceptance_probe',
      source: 'communication_autopilot',
    });
    reviewId = review.reviewId;
    console.info('[communication-ops-acceptance] created escalation review', { reviewId, sessionId });

    const firstSync = await syncAutoOpsTasks();
    console.info('[communication-ops-acceptance] first sync', firstSync);

    const dedupKey = buildAutoOpsDedupKey({
      source: 'communications',
      sourceId: reviewId,
      taskType: 'verify_guest_issue',
    });

    const listed = await listOpsOperatorTasks({ status: 'all' });
    if (!listed.ok) {
      fail(`listOpsOperatorTasks failed: ${listed.error ?? 'unknown'}`);
    }

    const matching = listed.tasks.filter((task) => task.dedupKey === dedupKey);
    const task = matching[0] ?? null;

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
    }

    const secondSync = await syncAutoOpsTasks();
    console.info('[communication-ops-acceptance] second sync', secondSync);

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

    if (failures.length > 0) {
      console.error('[communication-ops-acceptance] FAIL');
      for (const item of failures) console.error('  -', item);
      process.exit(1);
    }
  } catch (error) {
    printError(error);
    console.error('[communication-ops-acceptance] FAIL: acceptance runner failed');
    process.exit(1);
  } finally {
    await cleanup(reviewId, taskId);
  }
}

if (process.env.NODE_ENV === 'test') {
  __resetEscalationReviewStoreForTests();
}

main().catch((error) => {
  printError(error);
  console.error('[communication-ops-acceptance] FAIL: acceptance runner failed');
  process.exit(1);
});
