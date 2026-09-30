import { supabase } from '@/lib/supabase';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function accountFromProperty(propertyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('properties')
    .select('account_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw error;
  return text(data?.account_id);
}

async function accountFromReservation(reservationId: string): Promise<string | null> {
  for (const column of ['id', 'booking_id'] as const) {
    const { data, error } = await supabase
      .from('booking_ops_records')
      .select('account_id')
      .eq(column, reservationId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const accountId = text(data?.account_id);
    if (accountId) return accountId;
  }
  return null;
}

async function propertyFromTelegramChat(chatId: number): Promise<string | null> {
  const { data, error } = await supabase
    .from('tg_conversation_sessions')
    .select('property_id')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) throw error;
  return text(data?.property_id);
}

export async function resolveCanonicalOperatorReviewAccountId(input: {
  reservationId?: string | null;
  propertyId?: string | null;
  telegramChatId?: number | null;
}): Promise<string | null> {
  const reservationId = text(input.reservationId);
  const propertyId = text(input.propertyId);
  const candidates: string[] = [];

  if (reservationId) {
    const accountId = await accountFromReservation(reservationId);
    if (accountId) candidates.push(accountId);
  }
  if (propertyId) {
    const accountId = await accountFromProperty(propertyId);
    if (accountId) candidates.push(accountId);
  }
  if (input.telegramChatId != null && Number.isSafeInteger(input.telegramChatId)) {
    const chatPropertyId = await propertyFromTelegramChat(input.telegramChatId);
    if (chatPropertyId) {
      const accountId = await accountFromProperty(chatPropertyId);
      if (accountId) candidates.push(accountId);
    }
  }

  const unique = [...new Set(candidates)];
  if (unique.length > 1) throw new Error('review_account_evidence_conflict');
  return unique[0] ?? null;
}
