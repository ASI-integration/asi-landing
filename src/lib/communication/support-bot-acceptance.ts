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
  getSupabaseHostForLog,
  verifyOpsOperatorTasksTable,
} from '@/lib/ops-board/acceptance-preflight';
import { buildAutoOpsDedupKey, listOpsOperatorTasks } from '@/lib/ops-board/repository';
import { supabase } from '@/lib/supabase';

export const SUPPORT_BOT_ACCEPTANCE_PREFIX = 'ASI_SUPPORT_BOT_ACCEPTANCE_';
export const SUPPORT_BOT_ACCEPTANCE_SYNTHETIC_CHAT_ID_DEFAULT = 9_880_001;
export const SUPPORT_BOT_ACCEPTANCE_CONNECT_MESSAGE = 'хочу подключить квартиру';
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
}) {
  const now = Date.now();
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
  taskId?: string | null;
}): Promise<void> {
  if (input.taskId) {
    await supabase.from('ops_operator_tasks').delete().eq('id', input.taskId);
  }
  if (input.contactId) {
    await supabase.from('crm_contacts').delete().eq('id', input.contactId);
  }
}

export type SupportBotAcceptanceRunResult = {
  ok: boolean;
  failures: string[];
  connectResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null;
  unknownResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null;
  secondConnectResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null;
};

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

  const connectIntent = classifySupportBotIntent(SUPPORT_BOT_ACCEPTANCE_CONNECT_MESSAGE);
  if (connectIntent !== 'connect_property') {
    failures.push(`expected connect_property intent, got ${connectIntent}`);
  }
  const connectReply = buildSupportBotReply('connect_property');
  if (!connectReply.includes('город')) {
    failures.push('connect_property reply missing city prompt');
  }
  if (shouldCreateSupportOpsTask('connect_property')) {
    failures.push('connect_property should not create OPS task');
  }

  const unknownIntent = classifySupportBotIntent(SUPPORT_BOT_ACCEPTANCE_UNKNOWN_MESSAGE);
  if (unknownIntent !== 'unknown') {
    failures.push(`expected unknown intent, got ${unknownIntent}`);
  }
  if (!shouldCreateSupportOpsTask('unknown')) {
    failures.push('unknown should create OPS task');
  }

  const prevDryRun = process.env.DRY_RUN_TELEGRAM_OUTBOUND;
  process.env.DRY_RUN_TELEGRAM_OUTBOUND = '1';

  const username = `support_acceptance_${getSupportBotAcceptanceSyntheticChatId()}`;
  let connectResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null = null;
  let unknownResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null = null;
  let secondConnectResult: Awaited<ReturnType<typeof processSupportBotUpdate>> | null = null;
  let cleanupContactId: string | null = null;
  let cleanupTaskId: string | null = null;

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

    secondConnectResult = await processSupportBotUpdate(connectUpdate);
    const contactAfterSecond = await findSupportBotCrmContact(username);
    if (!contactAfterSecond?.id) {
      failures.push('CRM contact missing after second connect sync');
    }

    const unknownUpdate = buildSupportBotAcceptanceSyntheticUpdate({
      text: SUPPORT_BOT_ACCEPTANCE_UNKNOWN_MESSAGE,
      username: `${username}_unknown`,
    });
    unknownResult = await processSupportBotUpdate(unknownUpdate);

    if (!unknownResult.opsTaskId || !unknownResult.dedupKey) {
      failures.push('OPS support_review task was not created for unknown intent');
    } else {
      cleanupTaskId = unknownResult.opsTaskId;
      const listed = await listOpsOperatorTasks({ status: 'all' });
      if (!listed.ok) {
        failures.push(`listOpsOperatorTasks failed: ${listed.error ?? 'unknown'}`);
      } else {
        const matches = listed.tasks.filter((task) => task.dedupKey === unknownResult?.dedupKey);
        if (matches.length !== 1) {
          failures.push(`expected 1 OPS task for dedup key, found ${matches.length}`);
        }
        if (matches[0]?.taskType !== 'support_review') {
          failures.push(`expected taskType=support_review, got ${matches[0]?.taskType ?? 'none'}`);
        }
        if (matches[0]?.taskStatus !== 'needs_operator') {
          failures.push(`expected taskStatus=needs_operator, got ${matches[0]?.taskStatus ?? 'none'}`);
        }
        if (matches[0]?.source !== 'telegram_support') {
          failures.push(`expected source=telegram_support, got ${matches[0]?.source ?? 'none'}`);
        }
      }

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
          taskId: cleanupTaskId,
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
    unknownResult,
    secondConnectResult,
  };
}
