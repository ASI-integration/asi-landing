import type {
  BookingOperation,
  CleaningTask,
  DerivedBookingOperationTasks,
  GuestCommunicationEvent,
  MaintenanceTask,
  OperationScenario,
  OperatorEscalation,
} from './types';

export function getBookingOperationForScenario(
  scenario: OperationScenario,
  bookingOperations: BookingOperation[],
): BookingOperation | null {
  if (!scenario.bookingOperationId) return null;
  return bookingOperations.find((operation) => operation.id === scenario.bookingOperationId) ?? null;
}

export function getCleaningTasksForBooking(booking: BookingOperation, tasks: CleaningTask[]) {
  return tasks.filter((task) => booking.cleaningTaskIds.includes(task.id));
}

export function getMaintenanceTasksForBooking(booking: BookingOperation, tasks: MaintenanceTask[]) {
  return tasks.filter((task) => booking.maintenanceTaskIds.includes(task.id));
}

export function getCommunicationEventsForBooking(
  booking: BookingOperation,
  events: GuestCommunicationEvent[],
) {
  return events.filter((event) => booking.communicationEventIds.includes(event.id));
}

export function getOperatorEscalationForBooking(
  booking: BookingOperation,
  escalations: OperatorEscalation[],
) {
  if (!booking.operatorEscalationId) return null;
  return escalations.find((escalation) => escalation.id === booking.operatorEscalationId) ?? null;
}

export function hasAutomatedGuestCommunication(
  booking: BookingOperation,
  events: GuestCommunicationEvent[],
): boolean {
  return getCommunicationEventsForBooking(booking, events).some((event) => event.automated);
}

export function needsOperatorForBooking(
  booking: BookingOperation,
  escalations: OperatorEscalation[],
): boolean {
  const escalation = getOperatorEscalationForBooking(booking, escalations);
  return booking.status === 'needs_human' || escalation?.status === 'open' || booking.nextAction.handoffRequired;
}

export function deriveBookingOperationTasks(
  scenario: OperationScenario,
  bookingOperations: BookingOperation[],
  cleaningTasks: CleaningTask[],
  maintenanceTasks: MaintenanceTask[],
  communicationEvents: GuestCommunicationEvent[],
  escalations: OperatorEscalation[],
): DerivedBookingOperationTasks {
  const booking = getBookingOperationForScenario(scenario, bookingOperations);

  if (!booking) {
    return {
      scenarioId: scenario.id,
      bookingOperationId: null,
      guestCommunicationRequired: false,
      cleaningTaskRequired: false,
      maintenanceTaskRequired: false,
      reviewRequestRequired: false,
      operatorEscalationRequired: false,
      taskLabelsRu: [],
    };
  }

  const derivedCleaningTasks = getCleaningTasksForBooking(booking, cleaningTasks);
  const derivedMaintenanceTasks = getMaintenanceTasksForBooking(booking, maintenanceTasks);
  const derivedCommunicationEvents = getCommunicationEventsForBooking(booking, communicationEvents);
  const escalation = getOperatorEscalationForBooking(booking, escalations);
  const reviewRequestRequired =
    scenario.type === 'checkout' || scenario.type === 'review_request' || booking.phaseId === 'review_follow_up';
  const operatorEscalationRequired = needsOperatorForBooking(booking, escalations);
  const taskLabelsRu = [
    derivedCommunicationEvents.length > 0 ? 'Коммуникация с гостем' : null,
    derivedCleaningTasks.length > 0 ? 'Задача клининга' : null,
    derivedMaintenanceTasks.length > 0 ? 'Задача home master' : null,
    reviewRequestRequired ? 'Запрос отзыва / follow-up' : null,
    escalation || operatorEscalationRequired ? 'Эскалация оператору' : null,
  ].filter((label): label is string => Boolean(label));

  return {
    scenarioId: scenario.id,
    bookingOperationId: booking.id,
    guestCommunicationRequired: derivedCommunicationEvents.length > 0,
    cleaningTaskRequired: derivedCleaningTasks.length > 0,
    maintenanceTaskRequired: derivedMaintenanceTasks.length > 0,
    reviewRequestRequired,
    operatorEscalationRequired,
    taskLabelsRu,
  };
}
