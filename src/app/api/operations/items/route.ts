import { NextResponse } from 'next/server';
import {
  createOperationItem,
  listOperationItems,
  type CreateOperationItemInput,
} from '@/lib/operations/repository';
import { operationsApiErrorResponse, readJsonObject, requireOperationsContext } from '@/lib/operations/api';
import type { OperationsAutomationMode, OperationsSourceChannel, OperationsWorkflowStage } from '@/lib/operations/types';

export const dynamic = 'force-dynamic';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseCreateInput(body: Record<string, unknown>): CreateOperationItemInput | null {
  const guest = body.guest as Record<string, unknown> | undefined;
  const objectLabel = optionalString(body.objectLabel);
  const sourceChannel = optionalString(body.sourceChannel) as OperationsSourceChannel | undefined;
  const guestName = optionalString(guest?.name);
  const guestChannel = optionalString(guest?.channel) as OperationsSourceChannel | undefined;

  if (!guestName || !guestChannel || !sourceChannel || !objectLabel) return null;

  const bookingDates = body.bookingDates as Record<string, unknown> | undefined;

  return {
    guest: {
      name: guestName,
      email: optionalString(guest?.email),
      phone: optionalString(guest?.phone),
      channel: guestChannel,
      externalContactId: optionalString(guest?.externalContactId),
    },
    sourceChannel,
    objectLabel,
    propertyId: optionalString(body.propertyId),
    objectId: optionalString(body.objectId),
    bookingDates: bookingDates
      ? {
          checkIn: optionalString(bookingDates.checkIn),
          checkOut: optionalString(bookingDates.checkOut),
          nights: typeof bookingDates.nights === 'number' ? bookingDates.nights : undefined,
        }
      : undefined,
    stage: optionalString(body.stage) as OperationsWorkflowStage | undefined,
    automationMode: optionalString(body.automationMode) as OperationsAutomationMode | undefined,
    communicationReviewId: optionalString(body.communicationReviewId),
    communicationSessionId: optionalString(body.communicationSessionId),
  };
}

export async function GET() {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  try {
    const state = await listOperationItems(auth.ctx);
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  const input = parseCreateInput(await readJsonObject(req));
  if (!input) {
    return NextResponse.json({ ok: false, error: 'invalid_operation_item' }, { status: 400 });
  }

  try {
    const item = await createOperationItem(auth.ctx, input);
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}

