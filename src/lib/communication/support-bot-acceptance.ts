import { tgTextUpdate } from './dev/telegram-fixtures';
import {
  buildSupportBotReply,
  buildSupportOpsDedupKey,
  classifySupportBotIntent,
  processSupportBotUpdate,
  shouldCreateSupportOpsTask,
} from './telegram-support-bot';
import { TELEGRAM_CORE_BOT_HANDLE, TELEGRAM_SUPPORT_BOT_HANDLE } from '@/config/telegramBots';
import {
  formatOpsOperatorTasksPreflightFailure,
  formatSupportBotOpsPreflightFailure,
  getSupabaseHostForLog,
  verifyOpsOperatorTasksTable,
  verifySupportBotOpsSchema,
} from '@/lib/ops-board/acceptance-preflight';
import { listOpsOperatorTasks } from '@/lib/ops-board/repository';
import { supabase } from '@/lib/supabase';

export const SUPPORT_BOT_ACCEPTANCE_PREFIX = 'ASI_SUPPORT_BOT_ACCEPTANCE_';
export const SUPPORT_BOT_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT = 9_880_001;
export const SUPPORT_BOT_ACCEPTANCE_CONNECT_MESSAGE = 'хочу подключить квартиру';
export const SUPPORT_BOT_ACCEPTANCE_OPERATOR_MESSAGE = 'не работает, нужен оператор';
export const SUPPORT_BOT_ACCEPTANCE_UNKNOWN_MESSAGE = 'случайный запрос без понятного смысла xyz';

export function getSupportBotAcceptanceSyntheticChatId(): number {
  const raw = process.env.SUPPORT_BOT_ACCEPTANCE_CHAT_ID?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : SUPPORT_BOT_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT;
}

export function buildSupportBotAcceptanceSyntheticUpdate(input?: {
  text?: string;
  chatId?: number;
  username?: string;
  updateIdOffset?: number;
}) {
  const now = Date.now() + (input?.updateIdOffset ?? 0);
  const chatId = input?.chatId ?? getSupportBotAcceptanceSyntheticChatId();
  const update = tgTextUpdate({
    update_id: now,
    message_id: now + 1,
    chat_id: chatId,
    user_id: now + 2,
    language_code: 'ru',
    text: input?.text ?? SUPPORT_BOT_ACCEPTANCE_CONNECT_MESSAGE,
  });
  const message = update.message!;
  message.from = {
    id: now + 2,
    username: input?.username ?? `support_acceptance_${chatId}`,
    first_name: 'Support Acceptance',
  };
  return update;
}

export async function findSupportBotCrmContact(username: string): Promise<{ id: string } | null> {
  const normalized = username.trim().replace(/^@/, '');
  if (!normalized) return null;
  const { data, error } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('telegram_username', normalized)
    .maybeSingle();
  if (error || !data) return null;
  return { id: String((data as { id: unknown }).id) };
}

export async function cleanupSupportBotAcceptanceData(input: {
  contactId?: string | null;
  taskIds?: string[];
}): Promise<void> {
  for (const taskId of input.taskIds ?? []) {
    if (taskId) {
      await supabase.from('ops_operator_tasks').delete().eq('id', taskId);
    }
  }
  if (input.contactId) {
    await supabase.from('crm_contacts').delete().eq('id', input.contactId);
  }
}

export type SupportBotAcceptanceRunResult = {
  ok: boolean;
  failures: string[];
  connectResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null;
  operatorResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null;
  unknownResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null;
  secondOperatorResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null;
};

async function assertOpsTaskForDedupKey(
  failures: string[],
  dedupKey: string | null | undefined,
  label: string,
): Promise<void> {
  if (!dedupKey) {
    failures.push(`${label}: missing dedup key`);
    return;
  }
  const listed = await listOpsOperatorTasks({ status: 'all' });
  if (!listed.ok) {
    failures.push(`${label}: listOpsOperatorTasks failed: ${listed.error ?? 'unknown'}`);
    return;
  }
  const matches = listed.tasks.filter((task) => task.dedupKey === dedupKey);
  if (matches.length !== 1) {
    failures.push(`${label}: expected 1 OPS task for dedup key, found ${matches.length}`);
    return;
  }
  const task = matches[0];
  if (task?.taskType !== 'support_review') {
    failures.push(`${label}: expected taskType=support_review, got ${task?.taskType ?? 'none'}`);
  }
  if (task?.taskStatus !== 'needs_operator') {
    failures.push(`${label}: expected taskStatus=needs_operator, got ${task?.taskStatus ?? 'none'}`);
  }
  if (task?.source !== 'telegram_support') {
    failures.push(`${label}: expected source=telegram_support, got ${task?.source ?? 'none'}`);
  }
  if (!task?.description?.includes('ручная проверка')) {
    failures.push(`${label}: OPS description should mention manual review in Russian`);
  }
}

export async function runSupportBotAcceptanceFull(): Promise<SupportBotAcceptanceRunResult> {
  const failures: string[] = [];

  if (TELEGRAM_SUPPORT_BOT_HANDLE !== 'ASI_Support_Bot') {
    failures.push(`expected support bot handle ASI_Support_Bot, got ${TELEGRAM_SUPPORT_BOT_HANDLE}`);
  }
  if (TELEGRAM_CORE_BOT_HANDLE !== 'ASI_core_bot') {
    failures.push(`expected core bot handle ASI_core_bot, got ${TELEGRAM_CORE_BOT_HANDLE}`);
  }

  const preflight = await verifyOpsOperatorTasksTable();
  if (!preflight.ok) {
    failures.push(formatOpsOperatorTasksPreflightFailure(preflight.error));
  }

  const supportOpsPreflight = await verifySupportBotOpsSchema();
  if (!supportOpsPreflight.ok) {
    failures.push(formatSupportBotOpsPreflightFailure(supportOpsPreflight.error));
  }

  const connectIntent = classifySupportBotIntent(SUPPORT_BOT_ACCEPTANCE_CONNECT_MESSAGE);
  if (connectIntent !== 'connect_property') {
    failures.push(`expected connect_property intent, got ${connectIntent}`);
  }
  const connectReply = buildSupportBotReply('connect_property');
  if (!connectReply.includes(TELEGRAM_CORE_BOT_HANDLE)) {
    failures.push('connect_property reply should reference core bot');
  }
  if (shouldCreateSupportOpsTask('connect_property')) {
    failures.push('connect_property should not create OPS task');
  }

  const operatorIntent = classifySupportBotIntent(SUPPORT_BOT_ACCEPTANCE_OPERATOR_MESSAGE);
  if (operatorIntent !== 'needs_human') {
    failures.push(`expected needs_human intent, got ${operatorIntent}`);
  }
  if (!shouldCreateSupportOpsTask('needs_human')) {
    failures.push('needs_human should create OPS task');
  }

  const unknownIntent = classifySupportBotIntent(SUPPORT_BOT_ACCEPTANCE_UNKNOWN_MESSAGE);
  if (unknownIntent !== 'unknown') {
    failures.push(`expected unknown intent, got ${unknownIntent}`);
  }
  if (!shouldCreateSupportOpsTask('unknown')) {
    failures.push('unknown should create OPS task');
  }

  const dedupKey = buildSupportOpsDedupKey(
    getSupportBotAcceptanceSyntheticChatId() + 1,
    SUPPORT_BOT_ACCEPTANCE_OPERATOR_MESSAGE,
  );
  if (!dedupKey.includes('telegram_support')) {
    failures.push('dedup key should include telegram_support marker');
  }

  const prevDryRun = process.env.DRY_RUN_TELEGRAM_OUTBOUND;
  process.env.DRY_RUN_TELEGRAM_OUTBOUND = '1';

  const username = `support_acceptance_${getSupportBotAcceptanceSyntheticChatId()}`;
  let connectResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null = null;
  let operatorResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null = null;
  let unknownResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null = null;
  let secondOperatorResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null = null;
  let cleanupContactId: string | null = null;
  const cleanupTaskIds: string[] = [];

  try {
    const connectUpdate = buildSupportBotAcceptanceSyntheticUpdate({
      text: SUPPORT_BOT_ACCEPTANCE_CONNECT_MESSAGE,
      username,
    });
    connectResult = await processSupportBotUpdate(connectUpdate);

    if (connectResult.outcome !== 'replied') {
      failures.push(`connect message outcome=${connectResult.outcome}`);
    }
    if (!connectResult.replyText || !/[а-яё]/i.test(connectResult.replyText)) {
      failures.push('connect message reply is not Russian');
    }
    if (!connectResult.crmContactId) {
      failures.push('CRM lead was not created/updated for connect_property');
    } else {
      cleanupContactId = connectResult.crmContactId;
    }
    if (connectResult.opsTaskId) {
      failures.push('OPS task should not be created for connect_property');
    }

    const operatorChatId = getSupportBotAcceptanceSyntheticChatId() + 1;
    const operatorUpdate = buildSupportBotAcceptanceSyntheticUpdate({
      text: SUPPORT_BOT_ACCEPTANCE_OPERATOR_MESSAGE,
      chatId: operatorChatId,
      username: `${username}_operator`,
      updateIdOffset: 10_000,
    });
    operatorResult = await processSupportBotUpdate(operatorUpdate);

    if (operatorResult.outcome !== 'replied') {
      failures.push(`operator message outcome=${operatorResult.outcome}`);
    }
    if (!operatorResult.replyText?.includes('оператор')) {
      failures.push('operator message reply should mention operator handoff');
    }
    if (!operatorResult.opsTaskId || !operatorResult.dedupKey) {
      failures.push('OPS support_review task was not created for needs_human intent');
    } else {
      cleanupTaskIds.push(operatorResult.opsTaskId);
      await assertOpsTaskForDedupKey(failures, operatorResult.dedupKey, 'needs_human');
    }

    secondOperatorResult = await processSupportBotUpdate(operatorUpdate);
    if (secondOperatorResult.opsTaskId && operatorResult.opsTaskId) {
      if (secondOperatorResult.opsTaskId !== operatorResult.opsTaskId) {
        failures.push('second operator sync created a different OPS task id');
      }
      const listedAgain = await listOpsOperatorTasks({ status: 'all' });
      if (listedAgain.ok && operatorResult.dedupKey) {
        const dupes = listedAgain.tasks.filter((task) => task.dedupKey === operatorResult?.dedupKey);
        if (dupes.length > 1) {
          failures.push(`duplicate OPS tasks after second operator sync (${dupes.length})`);
        }
      }
    }

    const unknownUpdate = buildSupportBotAcceptanceSyntheticUpdate({
      text: SUPPORT_BOT_ACCEPTANCE_UNKNOWN_MESSAGE,
      chatId: getSupportBotAcceptanceSyntheticChatId() + 2,
      username: `${username}_unknown`,
      updateIdOffset: 20_000,
    });
    unknownResult = await processSupportBotUpdate(unknownUpdate);

    if (!unknownResult.opsTaskId || !unknownResult.dedupKey) {
      failures.push('OPS support_review task was not created for unknown intent');
    } else {
      cleanupTaskIds.push(unknownResult.opsTaskId);
      await assertOpsTaskForDedupKey(failures, unknownResult.dedupKey, 'unknown');

      const secondUnknown = await processSupportBotUpdate(unknownUpdate);
      const listedAgain = await listOpsOperatorTasks({ status: 'all' });
      if (listedAgain.ok) {
        const dupes = listedAgain.tasks.filter((task) => task.dedupKey === unknownResult?.dedupKey);
        if (dupes.length > 1) {
          failures.push(`duplicate OPS tasks after second unknown sync (${dupes.length})`);
        }
      }
      if (secondUnknown.opsTaskId && secondUnknown.opsTaskId !== unknownResult.opsTaskId) {
        failures.push('second unknown sync created a different OPS task id');
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (prevDryRun === undefined) {
      delete process.env.DRY_RUN_TELEGRAM_OUTBOUND;
    } else {
      process.env.DRY_RUN_TELEGRAM_OUTBOUND = prevDryRun;
    }

    if (process.env.KEEP_SUPPORT_BOT_ACCEPTANCE_DATA !== '1') {
      try {
        await cleanupSupportBotAcceptanceData({
          contactId: cleanupContactId,
          taskIds: cleanupTaskIds,
        });
      } catch (error) {
        failures.push(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (failures.length === 0) {
    console.info('[support-bot-acceptance] run ok', {
      supabase_host: getSupabaseHostForLog(),
      support_bot: TELEGRAM_SUPPORT_BOT_HANDLE,
      core_bot: TELEGRAM_CORE_BOT_HANDLE,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    connectResult,
    operatorResult,
    unknownResult,
    secondOperatorResult,
  };
}
