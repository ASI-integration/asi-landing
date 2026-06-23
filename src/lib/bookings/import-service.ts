import { createPilotBooking } from '@/lib/bookings/repository';
import {
  bookingImportSummaryRu,
  parseBookingTextImport,
  type BookingTextImportCandidate,
  type PropertyLookup,
} from '@/lib/bookings/text-import';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import { buildAutoOpsDedupKey, createOpsOperatorTask } from '@/lib/ops-board/repository';

export type BookingImportResult = {
  ok: boolean;
  created: boolean;
  needsReview: boolean;
  bookingId: string | null;
  candidate: BookingTextImportCandidate;
  message: string;
  sync?: { created: number; scanned: number; updated: number };
  error?: string;
};

async function createBookingReviewOpsTask(candidate: BookingTextImportCandidate): Promise<void> {
  const sourceId = candidate.reservationRef ?? `booking_review:${Date.now().toString(36)}`;
  await createOpsOperatorTask({
    taskType: 'other',
    taskStatus: 'needs_operator',
    source: 'crm',
    title: 'Уточнить данные брони',
    description: 'Уточнить данные брони после импорта текста',
    objectId: candidate.propertyId,
    objectLabel: candidate.propertyLabel,
    guestName: candidate.guestName,
    dedupKey: buildAutoOpsDedupKey({
      source: 'booking',
      sourceId,
      taskType: 'other',
    }),
    metadata: {
      booking_import_review: true,
      missing_fields: candidate.missingFields,
      import_preview: bookingImportSummaryRu(candidate),
    },
    updateIfExists: {
      description: `Уточнить данные брони: ${candidate.missingFields.join(', ')}`,
      lastEventText: bookingImportSummaryRu(candidate),
    },
  });
}

export async function importBookingFromText(input: {
  text: string;
  properties: PropertyLookup[];
  forceCreate?: boolean;
}): Promise<BookingImportResult> {
  const candidate = parseBookingTextImport({
    text: input.text,
    properties: input.properties,
  });

  const needsReview = candidate.confidence !== 'high' && !input.forceCreate;
  if (needsReview) {
    await createBookingReviewOpsTask(candidate);
    const sync = await syncAutoOpsTasks();
    return {
      ok: true,
      created: false,
      needsReview: true,
      bookingId: null,
      candidate,
      message: 'Проверьте распознанные данные перед созданием брони.',
      sync,
    };
  }

  if (!candidate.propertyId) {
    await createBookingReviewOpsTask(candidate);
    const sync = await syncAutoOpsTasks();
    return {
      ok: false,
      created: false,
      needsReview: true,
      bookingId: null,
      candidate,
      message: 'Не удалось определить объект. Передано на проверку.',
      sync,
      error: 'property_not_found',
    };
  }

  const result = await createPilotBooking({
    propertyId: candidate.propertyId,
    guestName: candidate.guestName,
    guestContact: candidate.guestContact,
    checkIn: candidate.checkIn,
    checkOut: candidate.checkOut,
    channel: candidate.channel,
    status: 'confirmed',
    comment: candidate.comment,
    reservationRef: candidate.reservationRef,
  });

  if (!result.ok || !result.booking) {
    return {
      ok: false,
      created: false,
      needsReview: false,
      bookingId: null,
      candidate,
      message: 'Не удалось создать бронь.',
      error: result.error,
    };
  }

  const sync = await syncAutoOpsTasks();
  return {
    ok: true,
    created: Boolean(result.created),
    needsReview: false,
    bookingId: result.booking.id,
    candidate,
    message: 'Бронь создана. OPS-задачи обновлены.',
    sync,
  };
}
