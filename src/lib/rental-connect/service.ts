import 'server-only';
import { createHash } from 'node:crypto';
import { createOpsOperatorTask } from '@/lib/ops-board/repository';
import { supabase } from '@/lib/supabase';
import { loadOnboarding, saveOnboardingStep } from '@/lib/ops-v17/service';
import { getPilotReadinessForProperty, upsertPilotObjectKnowledge } from '@/lib/pilot-readiness/repository';
import { beginSetup, createSupabaseRuCommercialPilotStore, getPilotLifecycle, supabaseOwnsProperty, supabaseReadinessProbe } from '@/lib/ru-commercial-pilot';
import { BOOKING_SITES, EMPTY_CONNECTION, validateConnection, type RentalConnectionDraft } from './model';

// Stable per-account test object: retries or simultaneous first submissions cannot create duplicates.
export function connectionPropertyId(accountId: string): string {
  const hash = createHash('sha256').update(`asi:ru-connect:v1:${accountId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Server-derived task identity; existing UUID primary key arbitrates concurrent submissions. */
export function connectionOperatorTaskId(accountId: string, propertyId: string): string {
  const hash = createHash('sha256').update(`asi:ru-owner-connect-task:v1:${accountId}:${propertyId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class ConnectionValidationError extends Error {}

const pilotDeps = () => ({ store: createSupabaseRuCommercialPilotStore(), ownsProperty: supabaseOwnsProperty, isReadinessSatisfied: supabaseReadinessProbe });

export async function readConnection(accountId: string) {
  const saved = await loadOnboarding(accountId);
  const draft: RentalConnectionDraft = { ...EMPTY_CONNECTION, ...saved?.data.rentalConnection };
  if (draft.step < 3) return { draft, readiness: null, pilotStatus: null };
  const propertyId = connectionPropertyId(accountId);
  const [readiness, pilot] = await Promise.all([
    getPilotReadinessForProperty(propertyId), getPilotLifecycle(pilotDeps(), accountId, propertyId),
  ]);
  if (!pilot.ok) throw new Error('Не удалось проверить принадлежность объекта.');
  return {
    draft,
    readiness: readiness ? { ready: readiness.ready, checks: readiness.checks.map(({ id, labelRu, ok }) => ({ id, labelRu, ok })) } : null,
    pilotStatus: pilot.state?.status ?? null,
  };
}

export async function saveConnection(accountId: string, actorId: string, step: number, values: Partial<RentalConnectionDraft>) {
  const saved = await loadOnboarding(accountId);
  const draft: RentalConnectionDraft = { ...EMPTY_CONNECTION, ...saved?.data.rentalConnection, ...values, step: step + 1 };
  const invalid = validateConnection(draft, step);
  if (invalid) throw new ConnectionValidationError(invalid);

  const existingPilot = await pilotDeps().store.get(accountId, connectionPropertyId(accountId));
  if (existingPilot && !['application', 'setup'].includes(existingPilot.status)) {
    throw new ConnectionValidationError('Объект уже передан на запуск. Для изменений свяжитесь с ASI.');
  }

  if (step === 2) {
    const propertyId = connectionPropertyId(accountId);
    // IDs and account scope are server-derived, never accepted from client input.
    const { error } = await supabase.from('properties').upsert({
      id: propertyId, account_id: accountId, name: draft.name, address_line: draft.address,
    }, { onConflict: 'id' });
    if (error) throw new Error('Не удалось сохранить объект. Повторите попытку.');
    const knowledge = await upsertPilotObjectKnowledge({
      property_id: propertyId, object_name: draft.name, address: draft.address, description: draft.description,
      house_rules_text: draft.rules, check_in_time: draft.checkIn, check_out_time: draft.checkOut,
      wifi_name: draft.wifiName, wifi_password: draft.wifiPassword, access_notes: draft.instructions,
      booking_channels: draft.channels.map((code) => BOOKING_SITES.find((site) => site.value === code)?.label).join(', '),
      photos_deferred: draft.photosLater, active: true,
      // The owner is collecting information, not enabling automatic guest messages.
      communication_autopilot: 'disabled',
    });
    if (!knowledge.ok) throw new Error('Не удалось сохранить инструкции. Повторите попытку.');
    // The existing RU commercial lifecycle owns the clock. Intake only enters setup.
    const pilot = await beginSetup(pilotDeps(), accountId, propertyId);
    if (!pilot.ok) throw new Error('Не удалось подготовить проверку объекта. Повторите попытку.');

    // Intake summary only: the existing channel-manager connection remains authoritative.
    // Reuse the operator queue and its object-scoped deduplication; never send credentials.
    const summary = [
      `Аккаунт: ${accountId}`, `Объект: ${propertyId} — ${draft.name}`,
      `Менеджер каналов: ${draft.manager}${draft.otherManager ? ` (${draft.otherManager})` : ''}`,
      `Площадки: ${draft.channels.map((code) => BOOKING_SITES.find((site) => site.value === code)?.label).join(', ')}`,
      'Анкета владельца заполнена. Проверьте доступы и продолжите подключение в существующем контуре Менеджера Каналов.',
    ].join('\n');
    const handoff = await createOpsOperatorTask({
      taskId: connectionOperatorTaskId(accountId, propertyId),
      taskType: 'verify_channel_manager', taskStatus: 'needs_operator', source: 'channel_manager',
      objectId: propertyId, objectLabel: draft.name,
      dedupKey: `ru-owner-connect:${accountId}:${propertyId}`,
      description: summary, lastEventText: 'Владелец заполнил данные для подключения',
      metadata: { account_id: accountId, property_id: propertyId, actor_id: actorId, integration: 'ru_owner_connect' },
      updateIfExists: { description: summary },
    });
    if (!handoff.ok || !handoff.task) throw new Error('Не удалось передать данные оператору. Повторите попытку.');
  }

  await saveOnboardingStep({
    accountId, actorId,
    step: step === 0 ? 'channel_manager' : step === 1 ? 'reservations' : 'verification',
    patch: { rentalConnection: draft },
  });
  return readConnection(accountId);
}
