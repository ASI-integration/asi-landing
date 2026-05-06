import { describe, expect, it } from 'vitest';
import {
  bookingOperations,
  cleaningTasks,
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
  propertyListingIntakes,
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
    expect(getDistributionReadinessLabel(listing)).toBe('Готова, есть каналы с ручной проверкой');
    expect(summary).toEqual({
      total: 4,
      connected: 3,
      synced: 1,
      queued: 1,
      needsAttention: 1,
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
});
