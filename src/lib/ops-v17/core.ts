import { createHash } from 'node:crypto';
import { onboardingSteps, type AdapterBatch, type LaunchReadiness, type ModuleKey, type ModuleState, type OnboardingData, type OnboardingStep, type VerificationItem } from './types';

const required: Record<OnboardingStep, (data: OnboardingData) => string[]> = {
  business: (d) => d.business?.name ? [] : ['Название компании'],
  owner: (d) => [!d.owner?.name && 'Имя владельца', !(d.owner?.phone || d.owner?.email) && 'Контакт владельца'].filter(Boolean) as string[],
  properties: (d) => d.properties?.length && d.properties.every((p) => p.name && p.address) ? [] : ['Название и адрес каждого объекта'],
  units: (d) => d.units?.length && d.units.every((u) => u.name && u.propertyKey) ? [] : ['Помещения каждого объекта'],
  operations: (d) => [!d.operations?.checkInTime && 'Время заезда', !d.operations?.checkOutTime && 'Время выезда', !d.operations?.cleaningRule && 'Правила уборки'].filter(Boolean) as string[],
  channel_manager: (d) => d.channelManager?.provider && (d.channelManager.credentialsRef || d.channelManager.snapshotReady) ? [] : ['Подключение менеджера каналов или файл для импорта'],
  reservations: (d) => d.reservations?.completed || d.reservations?.choice === 'skip' ? [] : ['Импортируйте существующие брони или явно пропустите этот шаг'],
  communications: (d) => d.communications?.guestChannel && d.communications?.workerChannel ? [] : ['Каналы связи с гостями и сотрудниками'],
  legal_payments: (d) => d.legalPayments?.legalMode && d.legalPayments?.depositMode && d.legalPayments?.mvdMode ? [] : ['Правила документов, депозита и МВД'],
  staff: (d) => d.staff?.length && d.staff.every((s) => s.name && s.role && s.contact && s.propertyKeys?.length) ? [] : ['Сотрудники, роли, контакты и объекты'],
  verification: (d) => d.verification?.length && d.verification.every((v) => v.status !== 'pending') ? [] : ['Проверка объекта на месте'],
  launch: () => [],
};

export function missingFields(data: OnboardingData, step?: OnboardingStep): Partial<Record<OnboardingStep, string[]>> {
  const steps = step ? [step] : onboardingSteps.filter((item) => item !== 'launch');
  return Object.fromEntries(steps.map((item) => [item, required[item](data)] as const).filter(([, fields]) => fields.length)) as Partial<Record<OnboardingStep, string[]>>;
}

export function onboardingProgress(data: OnboardingData) {
  const applicable = onboardingSteps.filter((s) => s !== 'launch');
  const completed = applicable.filter((s) => required[s](data).length === 0);
  return { completed, percentage: Math.round((completed.length / applicable.length) * 100), missing: missingFields(data) };
}

const moduleRequirements: Record<ModuleKey, OnboardingStep[]> = {
  owner_setup: ['business', 'owner'], property_setup: ['properties'], object_readiness: ['properties', 'units', 'operations'], channel_manager: ['channel_manager'], channel_publication: ['properties', 'units', 'channel_manager'], pricing: ['properties', 'units'], availability: ['units', 'reservations'], booking_intake: ['properties', 'reservations', 'communications'], lifecycle_v16: ['operations', 'staff'], communication_policies: ['communications', 'legal_payments'], sla_alerts: ['operations', 'staff'], checkin_checkout: ['operations', 'legal_payments'], worker_roles: ['staff'], task_templates: ['operations', 'staff'],
};

export function initializeModules(onboardingId: string, data: OnboardingData, existing: ModuleState[] = []): ModuleState[] {
  const byKey = new Map(existing.map((item) => [item.key, item]));
  return (Object.keys(moduleRequirements) as ModuleKey[]).map((key) => {
    const missing = moduleRequirements[key].flatMap((step) => required[step](data));
    const idempotencyKey = createHash('sha256').update(`${onboardingId}:${key}:v1`).digest('hex');
    if (missing.length) return byKey.get(key)?.status === 'initialized' ? byKey.get(key)! : { key, status: 'blocked', idempotencyKey, detail: missing.join(', ') };
    return { key, status: 'initialized', idempotencyKey };
  });
}

export function reportVerificationIssue(item: VerificationItem, taskId: string): VerificationItem {
  return { ...item, status: 'issue', maintenanceTaskId: taskId, reinspectionRequired: true };
}
export function completeMaintenance(item: VerificationItem): VerificationItem {
  if (!item.maintenanceTaskId) throw new Error('maintenance_task_required');
  return { ...item, status: 'pending', reinspectionRequired: true };
}
export function completeReinspection(item: VerificationItem): VerificationItem {
  return { ...item, status: 'passed', reinspectionRequired: false };
}

export function computeLaunchReadiness(data: OnboardingData, modules: ModuleState[], active = false): LaunchReadiness {
  const progress = onboardingProgress(data);
  const verification = data.verification ?? [];
  const issues = verification.filter((v) => v.status === 'issue' || v.reinspectionRequired);
  const blockingItems: string[] = [...Object.values(progress.missing).flatMap((items) => items ?? []), ...issues.filter((v) => v.blocking !== false).map((v) => `Не решена проблема проверки: ${v.key}`)];
  const warnings = issues.filter((v) => v.blocking === false).map((v) => `Требует внимания: ${v.key}`);
  if ((data.reservations?.criticalConflicts ?? 0) > 0) blockingItems.push('Не устранены критические пересечения броней');
  if (data.reservations?.mappingsComplete === false) blockingItems.push('Не все брони связаны с объектами и помещениями');
  if (!data.reservations?.ledgerInitialized && data.reservations?.choice !== 'skip') blockingItems.push('Единый календарь ещё не подготовлен');
  if (!data.reservations?.directIntakeReady) blockingItems.push('Прямое добавление брони ещё не готово');
  const initializedModules = modules.filter((m) => m.status === 'initialized').map((m) => m.key);
  const channelManagerReady = data.channelManager?.status === 'synchronized' || (data.channelManager?.provider === 'manual_import' && data.channelManager.snapshotReady === true);
  if (!channelManagerReady) warnings.push('Менеджер каналов не подключён: доступен только ручной и прямой пилот');
  const propertiesTotal = data.properties?.length ?? 0;
  const readyPropertyKeys = new Set((data.properties ?? []).filter((p) => verification.filter((v) => v.propertyKey === p.key).every((v) => v.status === 'passed')).map((p) => p.key));
  const staffTotal = data.staff?.length ?? 0;
  const staffReady = (data.staff ?? []).filter((s) => s.name && s.role && s.contact && s.propertyKeys?.length).length;
  const status = active ? (blockingItems.length ? 'degraded' : 'pilot_active') : blockingItems.length ? (issues.length ? 'blocked' : progress.percentage < 80 ? 'collecting_data' : 'needs_verification') : 'ready_for_pilot';
  return { status, percentage: Math.round(((progress.percentage * 10) + (initializedModules.length / 14 * 100) + (channelManagerReady ? 100 : 0)) / 12), blockingItems: [...new Set(blockingItems)], warnings, initializedModules, connectedIntegrations: channelManagerReady ? [data.channelManager?.provider ?? 'manual_import'] : [], propertiesReady: readyPropertyKeys.size, propertiesTotal, staffReady, staffTotal, communicationReady: initializedModules.includes('communication_policies'), bookingIntakeReady: initializedModules.includes('booking_intake'), channelManagerReady, nextAction: blockingItems[0] ?? (active ? 'Следить только за исключениями' : 'Активировать пилот может администратор операций') };
}

export const communicationPolicyDefaults = {
  automatic: ['booking_acknowledgement', 'missing_non_sensitive_guest_data', 'arrival_time_request', 'worker_task_assignment', 'worker_reminder', 'internal_status_update', 'overdue_task_notification'],
  reviewRequired: ['documents', 'contracts', 'deposit', 'mvd', 'access_codes', 'sensitive_checkin_instructions', 'refunds', 'complaints', 'conflict_messages'],
  sendingEnabled: false,
} as const;

export function acceptAdapterBatch(previousCheckpoint: string | undefined, batch: AdapterBatch) {
  if (previousCheckpoint === batch.checkpoint) return { applied: false, checkpoint: previousCheckpoint, records: [] as unknown[] };
  return { applied: true, checkpoint: batch.checkpoint, records: batch.records };
}

export function taskLinkScopeAllows(link: { propertyKey: string; taskId: string; revokedAt?: string; expiresAt: string }, propertyKey: string, taskId: string, now = Date.now()) {
  return !link.revokedAt && new Date(link.expiresAt).getTime() > now && link.propertyKey === propertyKey && link.taskId === taskId;
}
