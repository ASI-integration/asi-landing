import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getBookingOpsActionTemplateById } from './action-templates';
import { canCreateTelegramDraftForAction, fetchTelegramDraftStatusesForRecord } from './readiness';
import { getBookingOpsRecord } from './repository';
import {
  BOOKING_OPS_OPERATOR_ACTIONS,
  BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS,
  BOOKING_OPS_TELEGRAM_DRAFT_STATUSES,
  type BookingOpsRecord,
  type BookingOpsTelegramDraft,
  type BookingOpsTelegramDraftActionId,
  type BookingOpsTelegramDraftStatus,
} from './types';

type TelegramDraftRow = {
  id: string;
  booking_ops_record_id: string;
  source_booking_id: string | null;
  telegram_chat_id: number | string | null;
  telegram_target: string | null;
  action_id: string;
  message_text: string;
  status: string;
  created_by: string | null;
  warning: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type TelegramDraftTarget = {
  chatId: string | null;
  target: string | null;
  warning: string | null;
};

export type CreateTelegramDraftInput = {
  id: string;
  bookingOpsRecordId: string;
  sourceBookingId: string | null;
  telegramChatId: string | null;
  telegramTarget: string | null;
  actionId: BookingOpsTelegramDraftActionId;
  messageText: string;
  createdBy: string | null;
  warning: string | null;
  metadata: Record<string, unknown>;
};

type TelegramDraftDependencies = {
  getRecord: typeof getBookingOpsRecord;
  resolveTarget: typeof resolveBookingOpsTelegramTarget;
  insertDraft: typeof insertBookingOpsTelegramDraft;
};

const DEFAULT_DEPENDENCIES: TelegramDraftDependencies = {
  getRecord: getBookingOpsRecord,
  resolveTarget: resolveBookingOpsTelegramTarget,
  insertDraft: insertBookingOpsTelegramDraft,
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function isDraftAction(value: string): value is BookingOpsTelegramDraftActionId {
  return (BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS as readonly string[]).includes(value);
}

function normalizeStatus(value: unknown): BookingOpsTelegramDraftStatus {
  const raw = text(value);
  return (BOOKING_OPS_TELEGRAM_DRAFT_STATUSES as readonly string[]).includes(raw)
    ? raw as BookingOpsTelegramDraftStatus
    : 'draft';
}

function mapRow(row: TelegramDraftRow): BookingOpsTelegramDraft {
  return {
    id: row.id,
    bookingOpsRecordId: row.booking_ops_record_id,
    sourceBookingId: text(row.source_booking_id) || null,
    telegramChatId: row.telegram_chat_id == null ? null : String(row.telegram_chat_id),
    telegramTarget: text(row.telegram_target) || null,
    actionId: row.action_id as BookingOpsTelegramDraftActionId,
    messageText: row.message_text,
    status: normalizeStatus(row.status),
    createdBy: text(row.created_by) || null,
    warning: text(row.warning) || null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chatIdFromStoredTarget(value: string | null): string | null {
  const raw = text(value);
  const matched = raw.match(/^(?:tg_)?(-?\d+)$/i);
  return matched?.[1] ?? null;
}

async function findReservationTarget(
  column: 'id' | 'booking_id',
  value: string,
): Promise<{ chatId: string | null; guestId: string | null }> {
  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('chat_id, guest_id')
    .eq(column, value)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { chatId: null, guestId: null };
  const row = data as { chat_id?: number | string | null; guest_id?: string | null };
  return {
    chatId: row.chat_id == null ? null : String(row.chat_id),
    guestId: text(row.guest_id) || null,
  };
}

export async function resolveBookingOpsTelegramTarget(
  record: BookingOpsRecord,
): Promise<TelegramDraftTarget> {
  const directChatId = chatIdFromStoredTarget(record.guestTelegram);
  if (directChatId) {
    return { chatId: directChatId, target: `tg_${directChatId}`, warning: null };
  }

  if (record.bookingId) {
    const byId = await findReservationTarget('id', record.bookingId);
    const linked = byId.chatId ? byId : await findReservationTarget('booking_id', record.bookingId);
    if (linked.chatId) {
      return {
        chatId: linked.chatId,
        target: linked.guestId ?? `tg_${linked.chatId}`,
        warning: null,
      };
    }
  }

  return {
    chatId: null,
    target: text(record.guestTelegram) || null,
    warning: 'Чат Telegram не найден. Текст можно скопировать и отправить вручную после проверки получателя.',
  };
}

export async function insertBookingOpsTelegramDraft(
  input: CreateTelegramDraftInput,
): Promise<{ ok: true; draft: BookingOpsTelegramDraft } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('booking_ops_telegram_drafts')
    .insert({
      id: input.id,
      booking_ops_record_id: input.bookingOpsRecordId,
      source_booking_id: input.sourceBookingId,
      telegram_chat_id: input.telegramChatId,
      telegram_target: input.telegramTarget,
      action_id: input.actionId,
      message_text: input.messageText,
      status: 'draft',
      created_by: input.createdBy,
      warning: input.warning,
      metadata: input.metadata,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'draft_create_failed' };
  return { ok: true, draft: mapRow(data as TelegramDraftRow) };
}

export async function listBookingOpsTelegramDrafts(
  bookingOpsRecordId: string,
): Promise<{ ok: true; drafts: BookingOpsTelegramDraft[] } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId);
  if (!recordId) return { ok: false, error: 'id_required' };

  const { data, error } = await supabase
    .from('booking_ops_telegram_drafts')
    .select('*')
    .eq('booking_ops_record_id', recordId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, drafts: ((data ?? []) as TelegramDraftRow[]).map(mapRow) };
}

export async function updateBookingOpsTelegramDraftStatus(
  bookingOpsRecordId: string,
  draftId: string,
  status: string,
): Promise<{ ok: true; draft: BookingOpsTelegramDraft } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId);
  const id = text(draftId);
  const nextStatus = text(status);
  if (!recordId || !id) return { ok: false, error: 'id_required' };
  if (!(BOOKING_OPS_TELEGRAM_DRAFT_STATUSES as readonly string[]).includes(nextStatus)) {
    return { ok: false, error: 'invalid_status' };
  }

  const { data, error } = await supabase
    .from('booking_ops_telegram_drafts')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('booking_ops_record_id', recordId)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  return { ok: true, draft: mapRow(data as TelegramDraftRow) };
}

export async function createTelegramDraftFromBookingOpsAction(
  recordId: string,
  actionId: string,
  options?: { createdBy?: string | null },
  dependencies: TelegramDraftDependencies = DEFAULT_DEPENDENCIES,
): Promise<
  | { ok: true; draft: BookingOpsTelegramDraft }
  | { ok: false; error: string; message: string }
> {
  const id = text(recordId);
  const action = text(actionId);
  if (!id) return { ok: false, error: 'id_required', message: 'Не указана операционная запись.' };
  if (!isDraftAction(action)) {
    const knownAction = (BOOKING_OPS_OPERATOR_ACTIONS as readonly string[]).includes(action);
    return {
      ok: false,
      error: knownAction ? 'action_not_guest_facing' : 'invalid_action',
      message: knownAction
        ? 'Для этого внутреннего действия черновик Telegram недоступен.'
        : 'Недопустимое действие для черновика Telegram.',
    };
  }

  const record = await dependencies.getRecord(id);
  if (!record) return { ok: false, error: 'not_found', message: 'Операционная запись не найдена.' };

  const template = getBookingOpsActionTemplateById(record, action);
  if (!template.messageTemplate?.trim()) {
    return { ok: false, error: 'message_missing', message: 'Для действия нет текста сообщения.' };
  }
  if (!template.isAllowed) {
    return {
      ok: false,
      error: 'action_not_available',
      message: template.blockedReason ?? 'Действие сейчас недоступно.',
    };
  }

  const existingDrafts = await fetchTelegramDraftStatusesForRecord(record.id);
  const readinessGate = canCreateTelegramDraftForAction(
    { ...record, telegramDrafts: existingDrafts },
    action,
  );
  if (!readinessGate.allowed) {
    const preview = readinessGate.missingItems.slice(0, 3).join(' ');
    return {
      ok: false,
      error: 'readiness_blocked',
      message: preview
        ? `Нельзя создать черновик: ${preview}`
        : 'Нельзя создать черновик: не выполнены условия готовности.',
    };
  }

  const target = await dependencies.resolveTarget(record);
  const inserted = await dependencies.insertDraft({
    id: randomUUID(),
    bookingOpsRecordId: record.id,
    sourceBookingId: record.bookingId,
    telegramChatId: target.chatId,
    telegramTarget: target.target,
    actionId: action,
    messageText: template.messageTemplate,
    createdBy: text(options?.createdBy) || null,
    warning: target.warning,
    metadata: {
      property_id: record.propertyId,
      ota_source: record.otaSource,
      template_warnings: template.warnings,
    },
  });

  if (!inserted.ok) {
    return { ok: false, error: 'database_error', message: inserted.error };
  }
  return inserted;
}
