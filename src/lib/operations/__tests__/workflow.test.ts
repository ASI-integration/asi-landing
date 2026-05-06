import { describe, expect, it } from 'vitest';
import {
  bookingOperations,
  bridgeCommunicationToOperations,
  cleaningTasks,
  communicationBridgeMockMessages,
  createListingIntakeDraft,
  deriveBookingOperationTasks,
  getBookingOperationForScenario,
  getChannelSyncSummary,
  getCleaningTasksForBooking,
  getCommunicationEventsForBooking,
  getDistributionReadinessLabel,
  getMaintenanceTasksForBooking,
  getNextOperationPhase,
  getOperationLifecycleLabel,
  getOperationProgress,
  guestCommunicationEvents,
  isListingReadyForDistribution,
  maintenanceTasks,
  needsHumanHandoff,
  needsOperatorForBooking,
  operationPhases,
  operationScenarios,
  operatorEscalations,
  prepareChannelDistributionPackage,
  propertyListingIntakes,
  validateListingIntakeDraft,
} from '../index';
import type { OperationScenarioType } from '../types';

describe('operations workflow', () => {
  it('keeps the six phases in product order', () => {
    expect(operationPhases.map((phase) => phase.id)).toEqual([
      'booking_intake',
      'guest_classification',
      'pre_arrival',
      'stay_support',
      'checkout',
      'review_follow_up',
    ]);
  });

  it('computes next phase and terminal phase', () => {
    expect(getNextOperationPhase('booking_intake')?.id).toBe('guest_classification');
    expect(getNextOperationPhase('review_follow_up')).toBeNull();
  });

  it('reports progress from the current phase', () => {
    expect(getOperationProgress('stay_support')).toEqual({
      current: 4,
      total: 6,
      percent: 67,
    });
  });

  it('covers the MVP mock scenario types', () => {
    const types = new Set<OperationScenarioType>(operationScenarios.map((scenario) => scenario.type));

    expect(types).toEqual(
      new Set<OperationScenarioType>([
        'new_booking',
        'guest_question',
        'maintenance_issue',
        'checkout',
        'review_request',
        'operator_escalation',
      ]),
    );
  });

  it('marks only escalation scenarios for human handoff', () => {
    const handoffs = operationScenarios.filter(needsHumanHandoff);

    expect(handoffs.map((scenario) => scenario.type).sort()).toEqual([
      'maintenance_issue',
      'operator_escalation',
    ]);
    expect(handoffs.every((scenario) => getOperationLifecycleLabel(scenario) === 'Требуется оператор')).toBe(true);
  });

  it('models a listing intake that is ready for channel distribution', () => {
    const listing = propertyListingIntakes[0];
    const summary = getChannelSyncSummary(listing.distributionTargets);

    expect(isListingReadyForDistribution(listing)).toBe(true);
    expect(getDistributionReadinessLabel(listing)).toBe('Готова к распределению по каналам');
    expect(summary).toEqual({
      total: 5,
      connected: 4,
      synced: 1,
      queued: 2,
      needsAttention: 0,
    });
  });

  it('connects booking operations to cleaning, maintenance, and communication work', () => {
    const newBooking = bookingOperations.find((operation) => operation.id === 'booking-op-new-booking');
    const maintenanceBooking = bookingOperations.find((operation) => operation.id === 'booking-op-maintenance');

    expect(newBooking).toBeDefined();
    expect(maintenanceBooking).toBeDefined();
    expect(getCleaningTasksForBooking(newBooking!, cleaningTasks)).toHaveLength(1);
    expect(getCommunicationEventsForBooking(newBooking!, guestCommunicationEvents)[0]?.automated).toBe(true);
    expect(getMaintenanceTasksForBooking(maintenanceBooking!, maintenanceTasks)).toHaveLength(1);
    expect(needsOperatorForBooking(maintenanceBooking!, operatorEscalations)).toBe(true);
  });

  it('links every scenario to a booking operation mock', () => {
    const missingBookings = operationScenarios.filter(
      (scenario) => !getBookingOperationForScenario(scenario, bookingOperations),
    );

    expect(missingBookings).toEqual([]);
  });

  it('validates required listing intake fields', () => {
    const invalidDraft = createListingIntakeDraft({
      propertyNameRu: 'Тестовый объект',
    });
    const validDraft = createListingIntakeDraft({
      propertyNameRu: 'Квартира у метро',
      cityRu: 'Москва',
      addressRu: 'Тестовый район',
      descriptionRu: 'Описание для демо-карточки.',
      amenitiesRu: ['Wi-Fi'],
      houseRulesRu: ['Не курить'],
      checkInInstructionsRu: ['Заезд после 15:00'],
      checkOutInstructionsRu: ['Выезд до 12:00'],
      accessInfoRu: ['Ключ в smart-lock боксе'],
      cleaningRulesRu: ['Фото после уборки'],
      maintenanceContact: {
        roleRu: 'Домашний мастер',
        nameRu: 'Илья',
        phoneRu: '+7 *** ***-00-00',
      },
      photoTitlesRu: ['Гостиная'],
    });

    expect(validateListingIntakeDraft(invalidDraft).isValid).toBe(false);
    expect(validateListingIntakeDraft(invalidDraft).missingFieldsRu).toContain('Город');
    expect(validateListingIntakeDraft(validDraft)).toEqual({
      isValid: true,
      missingFieldsRu: [],
    });
  });

  it('creates a channel distribution package from a valid listing draft', () => {
    const listing = createListingIntakeDraft({
      propertyNameRu: 'Квартира для channel package',
      cityRu: 'Санкт-Петербург',
      addressRu: 'Центральный район',
      descriptionRu: 'Полная карточка для демо-синхронизации.',
      amenitiesRu: ['Wi-Fi', 'Кухня'],
      houseRulesRu: ['Тихие часы после 22:00'],
      checkInInstructionsRu: ['Код отправляется после брони'],
      checkOutInstructionsRu: ['Ключ оставить в боксе'],
      accessInfoRu: ['Smart-lock'],
      cleaningRulesRu: ['Проверить расходники'],
      maintenanceContact: {
        roleRu: 'Мастер',
        nameRu: 'Алексей',
        phoneRu: '+7 *** ***-11-11',
      },
      photoTitlesRu: ['Спальня', 'Кухня'],
    });
    const distributionPackage = prepareChannelDistributionPackage(listing);

    expect(distributionPackage.ready).toBe(true);
    expect(distributionPackage.statusRu).toBe('Готово к отправке на площадки');
    expect(distributionPackage.targets.map((target) => target.channelNameRu)).toEqual([
      'Авито',
      'Островок',
      'Яндекс Путешествия',
      'Суточно',
      'Booking / iCal placeholder',
    ]);
    expect(distributionPackage.targets.find((target) => target.channelNameRu === 'Booking / iCal placeholder')?.canQueueSync).toBe(false);
  });

  it('derives booking operation tasks from scenarios', () => {
    const newBookingScenario = operationScenarios.find((scenario) => scenario.type === 'new_booking');
    const checkoutScenario = operationScenarios.find((scenario) => scenario.type === 'checkout');
    const exceptionScenario = operationScenarios.find((scenario) => scenario.type === 'operator_escalation');

    const newBookingTasks = deriveBookingOperationTasks(
      newBookingScenario!,
      bookingOperations,
      cleaningTasks,
      maintenanceTasks,
      guestCommunicationEvents,
      operatorEscalations,
    );
    const checkoutTasks = deriveBookingOperationTasks(
      checkoutScenario!,
      bookingOperations,
      cleaningTasks,
      maintenanceTasks,
      guestCommunicationEvents,
      operatorEscalations,
    );
    const exceptionTasks = deriveBookingOperationTasks(
      exceptionScenario!,
      bookingOperations,
      cleaningTasks,
      maintenanceTasks,
      guestCommunicationEvents,
      operatorEscalations,
    );

    expect(newBookingTasks.guestCommunicationRequired).toBe(true);
    expect(newBookingTasks.cleaningTaskRequired).toBe(true);
    expect(checkoutTasks.reviewRequestRequired).toBe(true);
    expect(exceptionTasks.maintenanceTaskRequired).toBe(true);
    expect(exceptionTasks.operatorEscalationRequired).toBe(true);
  });

  it('maps early check-in communication to guest communication and pre-arrival action', () => {
    const result = bridgeCommunicationToOperations(
      communicationBridgeMockMessages.find((message) => message.id === 'early-checkin')!,
    );

    expect(result.classification.eventType).toBe('early_checkin_request');
    expect(result.classification.phaseId).toBe('pre_arrival');
    expect(result.createdActionLabelsRu).toContain('guest communication event');
    expect(result.createdActionLabelsRu).toContain('pre-arrival action');
    expect(result.operatorNeeded).toBe(false);
  });

  it('maps leak or breakage communication to urgent maintenance and escalation', () => {
    const result = bridgeCommunicationToOperations(
      communicationBridgeMockMessages.find((message) => message.id === 'leak')!,
    );

    expect(result.classification.eventType).toBe('maintenance_issue');
    expect(result.maintenanceTask?.titleRu).toBe('Home master task из сообщения гостя');
    expect(result.maintenanceTask?.priority).toBe('urgent');
    expect(result.operatorEscalation?.reasonRu).toContain('срочный maintenance issue');
    expect(result.operatorNeeded).toBe(true);
  });

  it('keeps Wi-Fi and access questions automatic', () => {
    const result = bridgeCommunicationToOperations(
      communicationBridgeMockMessages.find((message) => message.id === 'wifi-access')!,
    );

    expect(result.classification.eventType).toBe('guest_question');
    expect(result.guestCommunicationEvent.automated).toBe(true);
    expect(result.cleaningTask).toBeUndefined();
    expect(result.maintenanceTask).toBeUndefined();
    expect(result.operatorEscalation).toBeUndefined();
  });

  it('maps complaints to operator escalation', () => {
    const result = bridgeCommunicationToOperations(
      communicationBridgeMockMessages.find((message) => message.id === 'complaint')!,
    );

    expect(result.classification.eventType).toBe('complaint');
    expect(result.operatorEscalation?.decisionNeededRu).toContain('Разобрать жалобу');
    expect(result.operatorNeeded).toBe(true);
  });

  it('maps checkout questions to checkout support', () => {
    const result = bridgeCommunicationToOperations(
      communicationBridgeMockMessages.find((message) => message.id === 'checkout-question')!,
    );

    expect(result.classification.eventType).toBe('checkout_support');
    expect(result.classification.phaseId).toBe('checkout');
    expect(result.createdActionLabelsRu).toContain('checkout support action');
    expect(result.operatorNeeded).toBe(false);
  });

  it('maps review replies to follow-up and review action', () => {
    const result = bridgeCommunicationToOperations(
      communicationBridgeMockMessages.find((message) => message.id === 'review-follow-up')!,
    );

    expect(result.classification.eventType).toBe('review_follow_up');
    expect(result.classification.phaseId).toBe('review_follow_up');
    expect(result.reviewFollowUpActionRu).toContain('повторного контакта');
    expect(result.createdActionLabelsRu).toContain('review/follow-up action');
  });
});
