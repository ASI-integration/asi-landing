import { createCrmContact, deleteCrmContact } from '@/lib/crm/repository';
import {
  buildAutoOpsDedupKey,
  getOpsOperatorTask,
  listOpsOperatorTasks,
} from '@/lib/ops-board/repository';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import { updateOpsV1Task } from '@/lib/ops-v1/repository';
import { supabase } from '@/lib/supabase';

const ACCEPTANCE_PREFIX = 'ASI_OPS_ACCEPTANCE_';

function printError(error: unknown, message?: string): void {
  if (message) {
    console.error(`[ops-v12-acceptance] FAIL: ${message}`);
  }
  if (error instanceof Error) {
    if (!message || error.message !== message) {
      console.error(`[ops-v12-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
    return;
  }
  console.error(`[ops-v12-acceptance] error: ${String(error)}`);
}

function fail(message: string): never {
  console.error(`[ops-v12-acceptance] FAIL: ${message}`);
  process.exit(1);
}

async function cleanup(contactId: string, taskId: string | null): Promise<void> {
  if (process.env.KEEP_OPS_ACCEPTANCE_DATA === '1') {
    console.info('[ops-v12-acceptance] KEEP_OPS_ACCEPTANCE_DATA=1');
    console.info('[ops-v12-acceptance] contact_id:', contactId);
    if (taskId) console.info('[ops-v12-acceptance] task_id:', taskId);
    return;
  }

  if (taskId) {
    const { error } = await supabase.from('ops_operator_tasks').delete().eq('id', taskId);
    if (error) {
      console.warn('[ops-v12-acceptance] cleanup task warning:', error.message);
    }
  }

  try {
    await deleteCrmContact(contactId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn('[ops-v12-acceptance] cleanup contact warning:', detail);
  }
}

async function main(): Promise<void> {
  const runId = Date.now().toString(36);
  const name = `${ACCEPTANCE_PREFIX}${runId}`;
  const phoneSuffix = String(Date.now()).slice(-7);

  let contactId = '';
  let taskId: string | null = null;
  const failures: string[] = [];

  try {
    const contact = await createCrmContact({
      name,
      phone: `+7999${phoneSuffix}`,
      telegramUsername: '',
      email: null,
      role: 'owner',
      source: 'other',
      objectsCount: 1,
      city: 'Acceptance',
      note: `${ACCEPTANCE_PREFIX}live acceptance probe`,
      status: 'access_received',
      communicationStatus: 'no_contact',
      lastContactAt: null,
      nextStep: '',
      nextActionAt: null,
    });
    contactId = contact.id;
    console.info('[ops-v12-acceptance] created CRM contact', { id: contactId, status: contact.status });

    const firstSync = await syncAutoOpsTasks();
    console.info('[ops-v12-acceptance] first sync', firstSync);

    const dedupKey = buildAutoOpsDedupKey({
      source: 'crm',
      sourceId: contactId,
      taskType: 'other',
    });

    const listed = await listOpsOperatorTasks({ status: 'all' });
    if (!listed.ok) {
      fail(`listOpsOperatorTasks failed: ${listed.error ?? 'unknown'}`);
    }

    const matching = listed.tasks.filter(
      (task) => task.contactId === contactId && task.dedupKey === dedupKey,
    );
    const task = matching[0] ?? null;

    if (!task) {
      failures.push('OPS task not found after first syncAutoOpsTasks()');
    } else {
      taskId = task.id;
      if (task.source !== 'crm') failures.push(`expected source=crm, got ${task.source}`);
      if (task.metadata?.created_by_system !== true) {
        failures.push('expected metadata.created_by_system=true');
      }
      if (task.taskType !== 'other') {
        failures.push(`expected taskType=other (manual review), got ${task.taskType}`);
      }
    }

    const secondSync = await syncAutoOpsTasks();
    console.info('[ops-v12-acceptance] second sync', secondSync);

    const listedAgain = await listOpsOperatorTasks({ status: 'all' });
    if (!listedAgain.ok) {
      failures.push(`listOpsOperatorTasks after second sync failed: ${listedAgain.error ?? 'unknown'}`);
    } else {
      const matchingAgain = listedAgain.tasks.filter(
        (item) => item.contactId === contactId && item.dedupKey === dedupKey,
      );
      if (matchingAgain.length > 1) {
        failures.push(`duplicate OPS tasks found (${matchingAgain.length}) after second sync`);
      }
      if (secondSync.created > 0 && taskId) {
        failures.push(`second sync created=${secondSync.created}, expected 0`);
      }
    }

    if (taskId) {
      const updated = await updateOpsV1Task(taskId, { status: 'in_progress' });
      if (!updated.ok || !updated.task) {
        failures.push(`updateOpsV1Task failed: ${updated.error ?? 'unknown'}`);
      } else if (updated.task.status !== 'in_progress') {
        failures.push(`expected v1 status in_progress, got ${updated.task.status}`);
      }

      const loaded = await getOpsOperatorTask(taskId);
      if (!loaded.ok || !loaded.task) {
        failures.push(`getOpsOperatorTask failed: ${loaded.error ?? 'unknown'}`);
      } else if (loaded.task.taskStatus !== 'in_progress') {
        failures.push(`expected operator status in_progress, got ${loaded.task.taskStatus}`);
      }
    }

    if (failures.length > 0) {
      console.error('[ops-v12-acceptance] FAIL');
      for (const item of failures) console.error('  -', item);
      process.exit(1);
    }

  } catch (error) {
    printError(error);
    console.error('[ops-v12-acceptance] FAIL: acceptance runner failed');
    process.exit(1);
  } finally {
    if (contactId) {
      await cleanup(contactId, taskId);
    }
  }
}

main().catch((error) => {
  printError(error);
  console.error('[ops-v12-acceptance] FAIL: acceptance runner failed');
  process.exit(1);
});
