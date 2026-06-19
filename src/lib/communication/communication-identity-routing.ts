import { supabase } from '@/lib/supabase';
import type { InboundMessageEnvelope, IdentityResolution } from './types';

export type SenderIdentity =
  | 'guest'
  | 'owner'
  | 'manager'
  | 'lead'
  | 'unknown'
  | 'test_guest'
  | 'internal_operator';

export type CommunicationIdentityRoute =
  | 'guest_concierge'
  | 'owner_manager'
  | 'lead'
  | 'unknown_clarify'
  | 'internal_operator';

export type CommunicationIdentityRoutingDecision = {
  senderIdentity: SenderIdentity;
  route: CommunicationIdentityRoute;
  shouldRunGuestConcierge: boolean;
  replyText?: string;
  crmContactId?: string;
  reason: string;
  audit: Record<string, unknown>;
};

export const UNKNOWN_IDENTITY_CLARIFY_RU =
  'Здравствуйте. Подскажите, пожалуйста, вы гость по бронированию, владелец/управляющий объекта или хотите узнать про подключение ASI?';

const LEAD_REPLY_RU =
  'Спасибо за интерес к ASI. Напишите, пожалуйста, город, тип объекта и сколько у вас объектов. Мы передадим заявку команде пилота.';

const OWNER_MANAGER_REPLY_RU =
  'Принято. Я не буду отвечать как гостю. Передайте, пожалуйста, объект и что нужно проверить, оператор увидит это как внутреннее обращение.';

const INTERNAL_OPERATOR_REPLY_RU =
  'Операторский контекст принят. Гостевой автопилот для этого сообщения не запущен.';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function norm(value: unknown): string {
  return text(value).toLowerCase().replace(/^@+/, '');
}

function hasTelegramTestMode(envelope: InboundMessageEnvelope): boolean {
  const metadata = envelope.metadata ?? {};
  return (
    text(envelope.messageText).startsWith('/guest_test') ||
    metadata.guestTestMode === true ||
    metadata.guest_test_mode === true ||
    norm(metadata.senderIdentity) === 'test_guest'
  );
}

function isLeadIntent(messageText: string): boolean {
  const t = messageText.toLowerCase();
  return (
    /\basi\b/i.test(messageText) ||
    /подключ|пилот|ранн(ий|его) доступ|автоматизац|сервис|демо|заявк/.test(t)
  );
}

function metadataIdentity(envelope: InboundMessageEnvelope): SenderIdentity | null {
  const value = norm(envelope.metadata?.senderIdentity ?? envelope.metadata?.sender_identity ?? envelope.metadata?.role);
  if (value === 'guest') return 'guest';
  if (value === 'owner') return 'owner';
  if (value === 'manager') return 'manager';
  if (value === 'lead') return 'lead';
  if (value === 'test_guest') return 'test_guest';
  if (value === 'internal_operator' || value === 'operator') return 'internal_operator';
  return null;
}

function identityFromBinding(identity: IdentityResolution): SenderIdentity | null {
  if (identity.role === 'guest') return 'guest';
  if (identity.role === 'test_guest') return 'test_guest';
  if (identity.role === 'owner') return 'owner';
  if (identity.role === 'manager') return 'manager';
  if (identity.role === 'lead') return 'lead';
  if (identity.role === 'operator') return 'internal_operator';
  return null;
}

function telegramUsername(envelope: InboundMessageEnvelope): string {
  return norm(
    envelope.metadata?.telegram_username ??
      envelope.metadata?.telegramUsername ??
      (envelope.metadata as any)?.telegram?.username,
  );
}

function telegramDisplayName(envelope: InboundMessageEnvelope): string {
  const firstName = text(envelope.metadata?.telegram_first_name ?? (envelope.metadata as any)?.telegram?.first_name);
  const username = telegramUsername(envelope);
  return firstName || (username ? `@${username}` : 'Telegram lead');
}

async function findCrmContactByTelegramUsername(username: string): Promise<{ id: string; role?: string | null } | null> {
  if (!username) return null;
  try {
    const { data, error } = await supabase
      .from('crm_contacts')
      .select('id,role')
      .eq('telegram_username', username)
      .maybeSingle();
    if (error || !data) return null;
    return data as { id: string; role?: string | null };
  } catch {
    return null;
  }
}

async function createLeadIfSafe(envelope: InboundMessageEnvelope): Promise<string | undefined> {
  const username = telegramUsername(envelope);
  if (!username) return undefined;

  const existing = await findCrmContactByTelegramUsername(username);
  if (existing?.id) return existing.id;

  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('crm_contacts')
      .insert({
        name: telegramDisplayName(envelope),
        phone: null,
        contact: username,
        telegram_username: username,
        email: null,
        role: 'unknown',
        source: 'telegram',
        property_count: 0,
        city: null,
        notes: 'Первое обращение в Telegram с интересом к подключению ASI.',
        status: 'new_lead',
        communication_status: 'wrote_first',
        last_activity_at: now,
        next_action: 'Уточнить город, тип объекта и количество объектов.',
        next_action_due_at: null,
      })
      .select('id')
      .single();
    if (error || !data) return undefined;
    return String((data as { id?: unknown }).id ?? '') || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveCommunicationIdentityRoute(params: {
  envelope: InboundMessageEnvelope;
  identity: IdentityResolution;
}): Promise<CommunicationIdentityRoutingDecision> {
  const { envelope, identity } = params;
  const messageText = text(envelope.messageText);
  const metaIdentity = metadataIdentity(envelope);
  const boundIdentity = identityFromBinding(identity);
  const crmByUsername = await findCrmContactByTelegramUsername(telegramUsername(envelope));
  const crmRole = norm(crmByUsername?.role);

  let senderIdentity: SenderIdentity =
    metaIdentity ??
    (hasTelegramTestMode(envelope) ? 'test_guest' : null) ??
    (crmRole === 'owner' ? 'owner' : crmRole === 'manager' ? 'manager' : null) ??
    boundIdentity ??
    (isLeadIntent(messageText) ? 'lead' : 'unknown');

  if (!metaIdentity && senderIdentity === 'guest' && identity.status !== 'resolved' && !hasTelegramTestMode(envelope)) {
    senderIdentity = isLeadIntent(messageText) ? 'lead' : 'unknown';
  }

  if (senderIdentity === 'guest' || senderIdentity === 'test_guest') {
    return {
      senderIdentity,
      route: 'guest_concierge',
      shouldRunGuestConcierge: true,
      reason: senderIdentity === 'test_guest' ? 'test_guest_route' : 'guest_identity_resolved',
      audit: { identityStatus: identity.status, identityReason: identity.reason },
    };
  }

  if (senderIdentity === 'owner' || senderIdentity === 'manager') {
    return {
      senderIdentity,
      route: 'owner_manager',
      shouldRunGuestConcierge: false,
      replyText: OWNER_MANAGER_REPLY_RU,
      reason: `${senderIdentity}_route`,
      audit: { crmContactId: crmByUsername?.id ?? null },
    };
  }

  if (senderIdentity === 'internal_operator') {
    return {
      senderIdentity,
      route: 'internal_operator',
      shouldRunGuestConcierge: false,
      replyText: INTERNAL_OPERATOR_REPLY_RU,
      reason: 'internal_operator_route',
      audit: {},
    };
  }

  if (senderIdentity === 'lead') {
    const crmContactId = crmByUsername?.id ?? (await createLeadIfSafe(envelope));
    return {
      senderIdentity: 'lead',
      route: 'lead',
      shouldRunGuestConcierge: false,
      replyText: LEAD_REPLY_RU,
      crmContactId,
      reason: crmContactId ? 'lead_intent_crm_linked' : 'lead_intent_no_safe_crm_key',
      audit: { crmContactId: crmContactId ?? null, telegramUsername: telegramUsername(envelope) || null },
    };
  }

  return {
    senderIdentity: 'unknown',
    route: 'unknown_clarify',
    shouldRunGuestConcierge: false,
    replyText: UNKNOWN_IDENTITY_CLARIFY_RU,
    reason: 'unknown_sender_needs_role',
    audit: { identityStatus: identity.status, identityReason: identity.reason },
  };
}
