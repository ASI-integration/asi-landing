import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import {
  getOwnerSetupStatus,
  getPropertySetupById,
  initializeOwnerSetupFromLead,
  requestMissingPropertySetupData,
  requestPropertyPhotos,
  validatePropertySetup,
} from './owner-object-setup-autopilot';
import {
  generateTariffGrid,
  getPricingProfileBySetup,
  initializePricingProfile,
  type PricingProfile,
} from './pricing-intelligence-autopilot';
import { getAudienceProfile, inferPropertyAudience } from './property-audience-intelligence';
import {
  getMarketSignalBlockers,
  initializeMarketSignalSource,
} from './market-signals-ingestion';
import {
  getChannelManagerConnectionStatus,
  initializeChannelManagerConnection,
  type ChannelManagerProvider,
} from './channel-manager-access-import';
import {
  buildPublicationPackage,
  getPublicationReadinessStatus,
  initializePublicationPackage,
} from './channel-publishing-preparation';
import { getBookingOpsRecord, listBookingOpsRecords, syncBookingOpsTasksForRecordId } from './repository';
import { initializeBookingOpsCoreLoop } from './core-loop-initialization';
import { initializeCheckinExecutionBaseline } from './checkin-execution-autopilot';
import { initializeInStayCheckoutBaseline } from './instay-checkout-autopilot';
import { recomputeBookingCheckinReadiness } from './pre-checkin-control-center';
import { listBookingOpsTasksForRecord } from './tasks';
import { syncBookingOpsCommunications } from './communication-orchestrator';
import {
  checkBookingOverbookingRisk,
  getAvailabilityStatus,
} from './availability-overbooking-protection';

export type PilotAutorunScopeType = 'lead' | 'property_setup' | 'booking' | 'batch';
export type PilotAutorunStatusValue =
  | 'queued' | 'running' | 'completed' | 'completed_with_warnings'
  | 'blocked' | 'failed' | 'dry_run';

export type PilotAutorunScope = {
  scopeType: PilotAutorunScopeType;
  scopeRef: string;
};

export type PilotAutorunOptions = {
  dryRun?: boolean;
  maxSteps?: number;
  scope?: 'lead' | 'property' | 'booking' | 'all';
  allowSafeCommunicationQueue?: boolean;
  allowScopedAutoSend?: boolean;
  forceRecompute?: boolean;
};

export type PilotAutorunStep = {
  key: string;
  status: 'planned' | 'completed' | 'skipped' | 'blocked' | 'warning' | 'failed';
  summary: string;
};

export type PilotAutorunResult = {
  runId: string;
  scope: PilotAutorunScope;
  status: PilotAutorunStatusValue;
  stepsAttempted: string[];
  stepsCompleted: string[];
  blockers: string[];
  warnings: string[];
  nextRequiredActions: string[];
  safeSummary: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
};

export type PilotAutorunStatus = PilotAutorunResult & { metadata: Record<string, unknown> };

type MutableRun = Omit<PilotAutorunResult, 'status' | 'safeSummary' | 'finishedAt'> & {
  events: PilotAutorunStep[];
  stepLimit: number;
};

const DEFAULT_MAX_STEPS = 30;
const MAX_BATCH_SIZE = 25;
const SENSITIVE_KEY = /(password|secret|token|credential|api[_-]?key|authorization)/iu;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeText(value: unknown, fallback = 'Шаг требует проверки оператором.'): string {
  const valueText = text(value) || fallback;
  if (SENSITIVE_KEY.test(valueText)) return fallback;
  return valueText.replace(/[\r\n]+/gu, ' ').slice(0, 500);
}

function safeMetadata(value?: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !SENSITIVE_KEY.test(key)));
}

function normalizeScope(scope: PilotAutorunScope): PilotAutorunScope {
  const scopeRef = text(scope.scopeRef);
  if (!scopeRef || scopeRef.length > 200) throw new Error('Укажите корректный ID области запуска.');
  if (!['lead', 'property_setup', 'booking', 'batch'].includes(scope.scopeType)) {
    throw new Error('Недопустимая область автозапуска.');
  }
  return { scopeType: scope.scopeType, scopeRef };
}

function maxSteps(options?: PilotAutorunOptions): number {
  const value = Number(options?.maxSteps ?? DEFAULT_MAX_STEPS);
  return Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : DEFAULT_MAX_STEPS;
}

async function createRun(scope: PilotAutorunScope, options?: PilotAutorunOptions): Promise<MutableRun> {
  const now = new Date().toISOString();
  const run: MutableRun = {
    runId: randomUUID(), scope, stepsAttempted: [], stepsCompleted: [], blockers: [], warnings: [],
    nextRequiredActions: [], dryRun: options?.dryRun === true, startedAt: now, events: [],
    stepLimit: maxSteps(options),
  };
  const { error } = await supabase.from('booking_pilot_autorun_runs').insert({
    id: run.runId, scope_type: scope.scopeType, scope_ref: scope.scopeRef,
    status: run.dryRun ? 'queued' : 'running', started_at: now,
    metadata: safeMetadata({
      dry_run: run.dryRun,
      max_steps: maxSteps(options),
      allow_safe_communication_queue: options?.allowSafeCommunicationQueue !== false,
      allow_scoped_auto_send: options?.allowScopedAutoSend === true,
      force_recompute: options?.forceRecompute === true,
      external_api_calls: false,
      ota_push: false,
      message_delivery: false,
    }),
  });
  if (error) throw new Error(error.message);
  return run;
}

async function addEvent(run: MutableRun, event: PilotAutorunStep): Promise<void> {
  run.events.push(event);
  const { error } = await supabase.from('booking_pilot_autorun_step_events').upsert({
    id: randomUUID(), run_id: run.runId, step_key: event.key, status: event.status,
    safe_summary: safeText(event.summary), metadata: {},
  }, { onConflict: 'run_id,step_key' });
  if (error) run.warnings.push('Не удалось сохранить подробный аудит одного шага.');
}

async function executeStep(
  run: MutableRun,
  key: string,
  drySummary: string,
  action: () => Promise<string | void>,
): Promise<boolean> {
  if (run.stepsAttempted.length >= run.stepLimit) {
    if (!run.warnings.includes('Достигнут лимит шагов запуска.')) run.warnings.push('Достигнут лимит шагов запуска.');
    return false;
  }
  run.stepsAttempted.push(key);
  if (run.dryRun) {
    await addEvent(run, { key, status: 'planned', summary: drySummary });
    return true;
  }
  try {
    const summary = await action();
    run.stepsCompleted.push(key);
    await addEvent(run, { key, status: 'completed', summary: summary ?? drySummary });
    return true;
  } catch (error) {
    const message = safeText(error instanceof Error ? error.message : error);
    run.warnings.push(`${key}: ${message}`);
    await addEvent(run, { key, status: 'failed', summary: message });
    return false;
  }
}

function addBlocker(run: MutableRun, blocker: string, nextAction?: string): void {
  const safe = safeText(blocker);
  if (!run.blockers.includes(safe)) run.blockers.push(safe);
  if (nextAction && !run.nextRequiredActions.includes(nextAction)) run.nextRequiredActions.push(nextAction);
}

function finalStatus(run: MutableRun): PilotAutorunStatusValue {
  if (run.dryRun) return 'dry_run';
  if (run.stepsCompleted.length === 0 && run.blockers.length > 0) return 'blocked';
  if (run.stepsCompleted.length === 0 && run.events.some((event) => event.status === 'failed')) return 'failed';
  if (run.warnings.length > 0 || run.blockers.length > 0) return 'completed_with_warnings';
  return 'completed';
}

async function finishRun(run: MutableRun): Promise<PilotAutorunResult> {
  const finishedAt = new Date().toISOString();
  const status = finalStatus(run);
  const safeSummary = run.dryRun
    ? `Пробный запуск: запланировано шагов ${run.stepsAttempted.length}, блокеров ${run.blockers.length}.`
    : `Автозапуск: выполнено шагов ${run.stepsCompleted.length}, блокеров ${run.blockers.length}.`;
  const { error } = await supabase.from('booking_pilot_autorun_runs').update({
    status, steps_attempted: run.stepsAttempted, steps_completed: run.stepsCompleted,
    blockers: run.blockers, warnings: run.warnings, safe_summary: safeSummary,
    finished_at: finishedAt, updated_at: finishedAt,
    metadata: {
      next_required_actions: run.nextRequiredActions,
      dry_run: run.dryRun,
      external_api_calls: false,
      ota_push: false,
      real_messages_sent: false,
    },
  }).eq('id', run.runId);
  if (error) throw new Error(error.message);
  return {
    runId: run.runId, scope: run.scope, status, stepsAttempted: run.stepsAttempted,
    stepsCompleted: run.stepsCompleted, blockers: run.blockers, warnings: run.warnings,
    nextRequiredActions: run.nextRequiredActions, safeSummary, dryRun: run.dryRun,
    startedAt: run.startedAt, finishedAt,
  };
}

function hasPricingGuardrails(profile: PricingProfile | null): boolean {
  return Boolean(profile && profile.basePrice && profile.minPrice && profile.maxPrice
    && profile.minPrice <= profile.basePrice && profile.basePrice <= profile.maxPrice);
}

function providerFromSetup(metadata: Record<string, unknown>): ChannelManagerProvider | null {
  const candidate = text(metadata.channel_manager_provider ?? metadata.provider).toLowerCase();
  return ['manual', 'bnovo', 'realtycalendar', 'travelline', 'other'].includes(candidate)
    ? candidate as ChannelManagerProvider
    : null;
}

export async function runPilotAutorunForLead(
  leadId: string,
  options?: PilotAutorunOptions,
): Promise<PilotAutorunResult> {
  const scope = normalizeScope({ scopeType: 'lead', scopeRef: leadId });
  const run = await createRun(scope, options);
  let status = await getOwnerSetupStatus({ leadId: scope.scopeRef });
  if (!status.ownerSetup) {
    await executeStep(run, 'lead.initialize_owner_setup', 'Будет создан профиль владельца и черновик запроса данных.', async () => {
      await initializeOwnerSetupFromLead(scope.scopeRef, { pilot_autorun_run_id: run.runId });
      return 'Профиль владельца создан; сообщение сохранено как черновик.';
    });
    if (!run.dryRun) status = await getOwnerSetupStatus({ leadId: scope.scopeRef });
  } else {
    await addEvent(run, { key: 'lead.initialize_owner_setup', status: 'skipped', summary: 'Профиль владельца уже существует.' });
  }

  if (status.ownerSetup && options?.allowSafeCommunicationQueue !== false
    && !status.communications.some((item) => item.messageType === 'owner_setup_started')) {
    await executeStep(run, 'lead.queue_owner_setup_intent', 'Будет создан безопасный черновик начала настройки.', async () => {
      const now = new Date().toISOString();
      const { error } = await supabase.from('booking_owner_setup_communication_intents').insert({
        id: randomUUID(), owner_setup_id: status.ownerSetup!.id, property_setup_id: null,
        owner_id: status.ownerSetup!.ownerId, property_id: null, message_type: 'owner_setup_started',
        channel: 'telegram', status: 'draft_ready',
        message_text: 'Здравствуйте! Начинаем подготовку объекта к работе в ASI. Пришлите, пожалуйста, данные реального тестового объекта.',
        message_template_key: 'owner_setup_started', metadata: { pilot_autorun_run_id: run.runId },
        created_at: now, updated_at: now,
      });
      if (error) throw new Error(error.message);
      return 'Черновик начала настройки создан; сообщение не отправлялось.';
    });
  }

  const property = status.propertySetups[0] ?? null;
  if (!property) {
    addBlocker(run, 'Не выбран реальный тестовый объект.', 'Выбрать объект пилота и начать сбор данных.');
    await addEvent(run, { key: 'lead.real_property_required', status: 'blocked', summary: 'Объект не создаётся без подтверждённых данных.' });
  } else {
    run.nextRequiredActions.push('Продолжить автозапуск для профиля объекта.');
  }
  return finishRun(run);
}

export async function runPilotAutorunForPropertySetup(
  propertySetupId: string,
  options?: PilotAutorunOptions,
): Promise<PilotAutorunResult> {
  const scope = normalizeScope({ scopeType: 'property_setup', scopeRef: propertySetupId });
  const run = await createRun(scope, options);
  let setup = await getPropertySetupById(scope.scopeRef);
  if (!setup) {
    addBlocker(run, 'Профиль объекта не найден.', 'Проверить ID профиля объекта.');
    return finishRun(run);
  }

  const availability = await getAvailabilityStatus({ propertySetupId: scope.scopeRef });
  if (availability.conflicts.length > 0) {
    addBlocker(run, `Активных конфликтов доступности: ${availability.conflicts.length}.`, 'Проверить доступность и пересечения дат.');
  }

  await executeStep(run, 'property.validate_setup', 'Будет пересчитана готовность объекта.', async () => {
    setup = await validatePropertySetup(scope.scopeRef);
    return 'Готовность объекта пересчитана.';
  });

  const missing = setup?.missingFields ?? [];
  if (missing.length > 0) {
    addBlocker(run, `Не заполнено полей объекта: ${missing.join(', ')}.`, 'Запросить недостающие данные у владельца.');
    if (options?.allowSafeCommunicationQueue !== false) {
      const ownerStatus = setup.ownerSetupId ? await getOwnerSetupStatus({ ownerSetupId: setup.ownerSetupId }) : null;
      const hasMissingRequest = ownerStatus?.communications.some((item) => item.messageType === 'request_property_missing_data');
      if (!hasMissingRequest) {
        await executeStep(run, 'property.queue_missing_data_intent', 'Будет создан безопасный черновик запроса данных.', async () => {
          await requestMissingPropertySetupData(scope.scopeRef, { pilot_autorun_run_id: run.runId });
          return 'Создан черновик запроса недостающих данных.';
        });
      }
      if (setup.photosStatus === 'missing') {
        const hasPhotoRequest = ownerStatus?.communications.some((item) => item.messageType === 'request_property_photos');
        if (!hasPhotoRequest) await executeStep(run, 'property.queue_photo_intent', 'Будет создан безопасный черновик запроса фотографий.', async () => {
          await requestPropertyPhotos(scope.scopeRef, { pilot_autorun_run_id: run.runId });
          return 'Создан черновик запроса фотографий.';
        });
      }
    }
  }

  let pricing = await getPricingProfileBySetup(scope.scopeRef);
  if (missing.length === 0 || pricing) {
    await executeStep(run, 'property.initialize_pricing', 'Будет создан профиль цен без выдуманных значений.', async () => {
      pricing = await initializePricingProfile(scope.scopeRef, { pilot_autorun_run_id: run.runId });
      return pricing.missingFields.length ? 'Профиль цен создан; недостающие ограничения оставлены явными.' : 'Профиль цен готов.';
    });
  } else {
    await addEvent(run, { key: 'property.initialize_pricing', status: 'blocked', summary: 'Профиль цен не создаётся до заполнения обязательных данных объекта.' });
  }

  const audience = await getAudienceProfile(scope.scopeRef);
  if (!audience || options?.forceRecompute) {
    await executeStep(run, 'property.infer_audience', 'Будет рассчитана аудитория по имеющимся данным.', async () => {
      await inferPropertyAudience(scope.scopeRef, { pilot_autorun_run_id: run.runId });
      return 'Аудитория рассчитана по имеющимся данным.';
    });
  } else await addEvent(run, { key: 'property.infer_audience', status: 'skipped', summary: 'Профиль аудитории уже существует.' });

  const { data: existingSources } = await supabase.from('booking_market_signal_sources')
    .select('id').eq('property_setup_id', scope.scopeRef).limit(1);
  if (!existingSources?.length) {
    await executeStep(run, 'property.initialize_market_source', 'Будет создан ручной источник рыночных сигналов.', async () => {
      await initializeMarketSignalSource(scope.scopeRef, 'manual', 'manual', { pilot_autorun_run_id: run.runId });
      return 'Ручной источник сигналов подготовлен; внешний поставщик не подключался.';
    });
  } else await addEvent(run, { key: 'property.initialize_market_source', status: 'skipped', summary: 'Источник сигналов уже существует.' });

  const marketBlockers = await getMarketSignalBlockers(scope.scopeRef);
  if (hasPricingGuardrails(pricing) && marketBlockers.length === 0) {
    const dateFrom = new Date().toISOString().slice(0, 10);
    const dateToValue = new Date(); dateToValue.setUTCDate(dateToValue.getUTCDate() + 29);
    await executeStep(run, 'property.generate_tariff_grid', 'Будет рассчитана тарифная сетка на 30 дней.', async () => {
      await generateTariffGrid(pricing!.id, dateFrom, dateToValue.toISOString().slice(0, 10));
      return 'Тарифная сетка рассчитана без отправки цен во внешние каналы.';
    });
  } else {
    const reason = !hasPricingGuardrails(pricing) ? 'Не заданы базовая, минимальная и максимальная цены.' : marketBlockers.join(', ');
    addBlocker(run, reason, 'Заполнить ценовые ограничения и рыночные сигналы.');
    await addEvent(run, { key: 'property.generate_tariff_grid', status: 'blocked', summary: 'Тарифная сетка не создана без обязательных данных.' });
  }

  const provider = providerFromSetup(setup.metadata);
  const connection = await getChannelManagerConnectionStatus({ propertySetupId: scope.scopeRef });
  if (!connection && provider) {
    await executeStep(run, 'property.initialize_provider_onboarding', 'Будет создан контур подключения выбранного провайдера.', async () => {
      await initializeChannelManagerConnection(scope.scopeRef, provider, { pilot_autorun_run_id: run.runId });
      return 'Подготовлен ручной контур провайдера; реальный API не вызывался.';
    });
  } else if (!connection) {
    addBlocker(run, 'Провайдер менеджера каналов не выбран.', 'Выбрать провайдера или ручной режим.');
  }

  let publication = await getPublicationReadinessStatus(scope.scopeRef);
  await executeStep(run, 'property.initialize_publication_package', 'Будет создан черновик пакета публикации.', async () => {
    publication = await initializePublicationPackage(scope.scopeRef, provider ?? 'manual', { pilot_autorun_run_id: run.runId });
    return 'Черновик пакета публикации создан.';
  });
  await executeStep(run, 'property.validate_publication_package', 'Будет проверена готовность пакета без публикации.', async () => {
    publication = await buildPublicationPackage(scope.scopeRef, { packageId: publication?.id, provider: provider ?? 'manual', metadata: { pilot_autorun_run_id: run.runId } });
    return publication.status === 'ready_for_publication'
      ? 'Пакет прошёл проверку готовности; публикация не выполнялась.'
      : 'Пакет проверен; недостающие данные сохранены явно.';
  });
  if (publication?.missingFields.length) addBlocker(run, `Пакет публикации не готов: ${publication.missingFields.join(', ')}.`, 'Заполнить данные пакета публикации.');
  if (options?.allowScopedAutoSend) run.warnings.push('Автоотправка не выполнялась: orchestrator только ставит безопасные намерения в очередь.');
  return finishRun(run);
}

export async function runPilotAutorunForBooking(
  bookingId: string,
  options?: PilotAutorunOptions,
): Promise<PilotAutorunResult> {
  const scope = normalizeScope({ scopeType: 'booking', scopeRef: bookingId });
  const run = await createRun(scope, options);
  const record = await getBookingOpsRecord(scope.scopeRef);
  if (!record) {
    addBlocker(run, 'Операционная бронь не найдена.', 'Проверить ID операционной брони.');
    return finishRun(run);
  }
  const availability = await checkBookingOverbookingRisk(record.id, { checkType: 'pre_autorun' });
  await addEvent(run, {
    key: 'booking.check_availability',
    status: availability.status === 'no_conflict' ? 'completed' : 'blocked',
    summary: availability.safeSummary,
  });
  run.stepsAttempted.push('booking.check_availability');
  if (availability.status !== 'no_conflict') {
    addBlocker(
      run,
      availability.blockers[0] ?? 'Доступность не подтверждена.',
      'Проверить даты и конфликты доступности вручную.',
    );
    return finishRun(run);
  }
  run.stepsCompleted.push('booking.check_availability');
  await executeStep(run, 'booking.initialize_lifecycle_legal', 'Будут созданы lifecycle и ручные legal/payment/MVD placeholders.', async () => {
    await initializeBookingOpsCoreLoop(record.id);
    return 'Lifecycle и ручные legal/payment/MVD контуры инициализированы.';
  });
  await executeStep(run, 'booking.initialize_checkin', 'Будет создан базовый контур заезда.', async () => {
    await initializeCheckinExecutionBaseline(record.id); return 'Контур заезда инициализирован.';
  });
  await executeStep(run, 'booking.initialize_checkout', 'Будет создан базовый контур проживания и выезда.', async () => {
    await initializeInStayCheckoutBaseline(record.id); return 'Контур проживания и выезда инициализирован.';
  });
  await executeStep(run, 'booking.recompute_precheckin', 'Будет пересчитана готовность к заезду.', async () => {
    await recomputeBookingCheckinReadiness(record.id); return 'Готовность к заезду пересчитана.';
  });
  if (record.propertyId && record.checkInAt && record.checkOutAt) {
    await executeStep(run, 'booking.sync_ops_tasks', 'Будут синхронизированы операционные задачи.', async () => {
      const result = await syncBookingOpsTasksForRecordId(record.id);
      if (!result.ok) throw new Error(result.error);
      return 'Операционные задачи синхронизированы без дублей.';
    });
  } else addBlocker(run, 'Для операционных задач нужны объект и даты проживания.', 'Указать объект, дату заезда и дату выезда.');

  if (options?.allowSafeCommunicationQueue !== false) {
    await executeStep(run, 'booking.queue_safe_communications', 'Будут созданы и классифицированы безопасные черновики.', async () => {
      const tasks = await listBookingOpsTasksForRecord(record.id);
      if (!tasks.ok) throw new Error(tasks.error);
      const result = await syncBookingOpsCommunications({ record, tasks: tasks.tasks });
      if (!result.ok) throw new Error(result.error);
      return 'Коммуникации поставлены в очередь и проверены политикой; отправка не выполнялась.';
    });
  }
  if (record.isBlocked) addBlocker(run, record.blockerReason || 'Бронь заблокирована.', 'Создать ручной fallback и снять реальный блокер.');
  if (options?.allowScopedAutoSend) run.warnings.push('Даже при разрешённой области сообщения не отправлялись: нужен отдельный исполнитель с действующим policy scope.');
  return finishRun(run);
}

export async function runPilotAutorunBatch(options?: PilotAutorunOptions): Promise<PilotAutorunResult> {
  const scope = normalizeScope({ scopeType: 'batch', scopeRef: `batch:${new Date().toISOString().slice(0, 10)}` });
  const run = await createRun(scope, options);
  const requested = options?.scope ?? 'all';
  if (requested === 'booking' || requested === 'all') {
    const records = await listBookingOpsRecords({ limit: MAX_BATCH_SIZE });
    if (!records.ok) addBlocker(run, 'Не удалось загрузить операционные брони.', 'Повторить пакетный запуск.');
    for (const record of records.records.slice(0, MAX_BATCH_SIZE)) {
      const key = `batch.booking.${record.id}`;
      await executeStep(run, key, `Будет проверена бронь ${record.id}.`, async () => {
        const result = await runPilotAutorunForBooking(record.id, options);
        return `Бронь проверена: ${result.status}.`;
      });
    }
  }
  if (requested === 'lead' || requested === 'property') {
    run.warnings.push('Для пакетной обработки заявок и объектов требуется явный список ID; массовое создание не выполнялось.');
  }
  return finishRun(run);
}

function mapRunRow(row: Record<string, unknown>): PilotAutorunStatus {
  const metadata = (row.metadata as Record<string, unknown>) ?? {};
  return {
    runId: String(row.id),
    scope: { scopeType: row.scope_type as PilotAutorunScopeType, scopeRef: String(row.scope_ref) },
    status: row.status as PilotAutorunStatusValue,
    stepsAttempted: Array.isArray(row.steps_attempted) ? row.steps_attempted.map(String) : [],
    stepsCompleted: Array.isArray(row.steps_completed) ? row.steps_completed.map(String) : [],
    blockers: Array.isArray(row.blockers) ? row.blockers.map(String) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    nextRequiredActions: Array.isArray(metadata.next_required_actions) ? metadata.next_required_actions.map(String) : [],
    safeSummary: text(row.safe_summary), dryRun: metadata.dry_run === true,
    startedAt: text(row.started_at), finishedAt: text(row.finished_at), metadata,
  };
}

export async function getPilotAutorunStatus(scope: PilotAutorunScope): Promise<PilotAutorunStatus | null> {
  const normalized = normalizeScope(scope);
  const { data, error } = await supabase.from('booking_pilot_autorun_runs').select('*')
    .eq('scope_type', normalized.scopeType).eq('scope_ref', normalized.scopeRef)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRunRow(data as Record<string, unknown>) : null;
}

export async function getPilotAutorunBlockers(scope: PilotAutorunScope): Promise<string[]> {
  return (await getPilotAutorunStatus(scope))?.blockers ?? [];
}

export async function explainPilotAutorun(scope: PilotAutorunScope): Promise<{
  status: PilotAutorunStatus | null;
  explanation: string;
  safety: { externalApiCalls: false; otaPush: false; realMessagesSent: false; globalAutoSend: false };
}> {
  const status = await getPilotAutorunStatus(scope);
  const explanation = status
    ? `${status.safeSummary} Следующее действие: ${status.nextRequiredActions[0] ?? 'проверить текущий статус.'}`
    : 'Автозапуск для этой области ещё не выполнялся.';
  return { status, explanation, safety: { externalApiCalls: false, otaPush: false, realMessagesSent: false, globalAutoSend: false } };
}

export async function createPilotAutorunFallbackIfNeeded(
  scope: PilotAutorunScope,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<PilotAutorunStatus> {
  const normalized = normalizeScope(scope);
  const safeReason = safeText(reason, 'Требуется ручная проверка.');
  let status = await getPilotAutorunStatus(normalized);
  if (!status) {
    const run = await createRun(normalized, { dryRun: false });
    addBlocker(run, safeReason, 'Оператору проверить блокер и продолжить вручную.');
    await addEvent(run, { key: 'fallback.manual_review', status: 'blocked', summary: safeReason });
    await finishRun(run);
  } else if (!status.blockers.includes(safeReason)) {
    const blockers = [...status.blockers, safeReason];
    const now = new Date().toISOString();
    const { error } = await supabase.from('booking_pilot_autorun_runs').update({
      status: 'blocked', blockers, updated_at: now,
      metadata: { ...safeMetadata(status.metadata), ...safeMetadata(metadata), next_required_actions: ['Оператору проверить блокер и продолжить вручную.'] },
    }).eq('id', status.runId);
    if (error) throw new Error(error.message);
  }
  status = await getPilotAutorunStatus(normalized);
  if (!status) throw new Error('Не удалось создать fallback.');
  return status;
}
