import { supabase } from '@/lib/supabase';

export type ChannelManagerScopeConnection = {
  id: string;
  ownerSetupId: string | null;
  propertySetupId: string | null;
  metadata: Record<string, unknown>;
};

export type ChannelManagerCanonicalScope = {
  connectionId: string;
  ownerSetupId: string;
  propertySetupId: string;
  propertyId: string | null;
  accountId: string | null;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

export async function resolveChannelManagerConnectionScope(
  connection: ChannelManagerScopeConnection,
): Promise<ChannelManagerCanonicalScope> {
  const propertySetupId = text(connection.propertySetupId);
  const ownerSetupId = text(connection.ownerSetupId);
  if (!propertySetupId) {
    throw Object.assign(new Error('У подключения не указан профиль объекта.'), {
      code: 'connection_scope_invalid',
    });
  }
  if (!ownerSetupId) {
    throw Object.assign(new Error('У подключения не указан владелец.'), {
      code: 'connection_scope_invalid',
    });
  }

  const { data: property, error } = await supabase
    .from('booking_property_setup_profiles')
    .select('id,owner_setup_id,property_id')
    .eq('id', propertySetupId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!property) {
    throw Object.assign(new Error('Профиль объекта не найден.'), {
      code: 'connection_scope_invalid',
    });
  }
  if (text(property.owner_setup_id) !== ownerSetupId) {
    throw Object.assign(new Error('Объект не принадлежит владельцу подключения.'), {
      code: 'account_scope_mismatch',
    });
  }

  return {
    connectionId: connection.id,
    ownerSetupId,
    propertySetupId,
    propertyId: nullableText(property.property_id),
    accountId: nullableText(connection.metadata?.accountId),
  };
}

export async function assertChannelManagerConnectionScopeCurrent(
  expected: ChannelManagerCanonicalScope,
): Promise<void> {
  const { data: row, error } = await supabase
    .from('booking_channel_manager_connections')
    .select('id,owner_setup_id,property_setup_id,metadata')
    .eq('id', expected.connectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) {
    throw Object.assign(new Error('Подключение больше не существует.'), {
      code: 'account_scope_mismatch',
    });
  }

  const current = await resolveChannelManagerConnectionScope({
    id: text(row.id),
    ownerSetupId: nullableText(row.owner_setup_id),
    propertySetupId: nullableText(row.property_setup_id),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  });

  if (
    current.ownerSetupId !== expected.ownerSetupId
    || current.propertySetupId !== expected.propertySetupId
    || current.propertyId !== expected.propertyId
    || current.accountId !== expected.accountId
  ) {
    throw Object.assign(new Error('Контур подключения изменился во время операции.'), {
      code: 'account_scope_mismatch',
    });
  }
}
