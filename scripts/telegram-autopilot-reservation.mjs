import { normalizeTelegramTestChatId } from './telegram-test-chat-id.mjs';

/**
 * @param {any} sb
 * @param {unknown} preferredChatInput
 * @param {string} propertyId
 */
export async function findLinkedReservation(sb, preferredChatInput = null, propertyId = 'prop_A') {
  const preferredChat = normalizeTelegramTestChatId(preferredChatInput, { required: false });
  let query = sb.from('tg_guest_reservations').select('*').eq('property_id', propertyId);
  if (preferredChat) query = query.eq('chat_id', preferredChat);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(10);
  if (error) throw new Error(`reservation lookup failed: ${error.message}`);
  const direct = (data ?? []).find((row) => row.chat_id);
  if (direct) return direct;

  const { data: allRows, error: allError } = await sb
    .from('tg_guest_reservations')
    .select('*')
    .eq('property_id', propertyId)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (allError) throw new Error(`reservation lookup failed: ${allError.message}`);
  for (const row of allRows ?? []) {
    if (!row.guest_id) continue;
    const { data: identity, error: identityError } = await sb
      .from('tg_guest_identities')
      .select('*')
      .eq('guest_id', row.guest_id)
      .maybeSingle();
    if (identityError) throw new Error(`identity lookup failed: ${identityError.message}`);
    if (!identity?.telegram_chat_id) continue;
    const identityChatId = normalizeTelegramTestChatId(identity.telegram_chat_id);
    if (!preferredChat || identityChatId === preferredChat) {
      return { ...row, chat_id: identityChatId, identity, needsChatLink: true };
    }
  }
  return null;
}
