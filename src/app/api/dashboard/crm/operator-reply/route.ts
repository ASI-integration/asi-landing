import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isDashboardInternalUser } from '@/lib/dashboard/internal-access';
import { getCrmContactById } from '@/lib/crm/repository';
import { sendOperatorReplyToTelegram } from '@/lib/crm/operator-followup';
import { OPERATOR_REPLY_MAX_LENGTH } from '@/lib/crm/operator-reply-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireInternalSession() {
  if (!isSessionSecretConfigured()) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const session = await getSession();
  if (!session.userId) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (!isDashboardInternalUser(session.email)) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, session };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function stringFromBody(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function mapOperatorReplyError(error?: string): { message: string; status: number } {
  switch (error) {
    case 'empty_reply':
      return { message: 'Введите ответ оператора', status: 400 };
    case 'reply_too_long':
      return { message: `Ответ должен быть не длиннее ${OPERATOR_REPLY_MAX_LENGTH} символов`, status: 400 };
    case 'telegram_chat_missing':
      return { message: 'У контакта нет Telegram-чата', status: 400 };
    case 'bot_token_missing':
      return { message: 'Не настроен токен Telegram-бота ASI Feedback', status: 400 };
    case 'contact_not_found':
      return { message: 'Запись CRM не найдена', status: 404 };
    case 'send_failed':
      return { message: 'Не удалось отправить ответ гостю в Telegram', status: 502 };
    default:
      return { message: 'Не удалось отправить ответ гостю', status: 400 };
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireInternalSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError('Некорректный JSON', 400);
  }

  const contactId = stringFromBody(body, ['crmContactId', 'contactId', 'threadId', 'id']);
  const telegramChatId = stringFromBody(body, ['telegramChatId', 'telegram_chat_id']);
  const replyText = stringFromBody(body, ['replyText', 'text', 'operatorReply']);
  const relatedEscalationId = stringFromBody(body, ['relatedEscalationId', 'escalationId']);

  if (!contactId && !telegramChatId) return jsonError('Укажите запись CRM или Telegram-чат', 400);
  if (!replyText) return jsonError('Введите ответ оператора', 400);
  if (replyText.length > OPERATOR_REPLY_MAX_LENGTH) {
    return jsonError(`Ответ должен быть не длиннее ${OPERATOR_REPLY_MAX_LENGTH} символов`, 400);
  }

  try {
    const result = await sendOperatorReplyToTelegram({
      contactId,
      telegramChatId,
      replyText,
      relatedEscalationId,
      operatorId: auth.session.email,
    });
    if (!result.ok) {
      const mapped = mapOperatorReplyError(result.error);
      return jsonError(mapped.message, mapped.status);
    }

    const contact = contactId ? await getCrmContactById(contactId) : null;
    return NextResponse.json({ ok: true, contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[dashboard/crm/operator-reply] failed', { error: message, contactId: contactId || null });
    return jsonError('Не удалось отправить ответ гостю', 500);
  }
}
