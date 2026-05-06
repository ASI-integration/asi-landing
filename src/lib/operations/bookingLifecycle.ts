import type {
  BookingOperation,
  CleaningTask,
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
