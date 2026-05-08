import { NextResponse } from 'next/server';
import { appendOperationAuditEvent } from '@/lib/operations/repository';
import { operationsApiErrorResponse, readJsonObject, requireOperationsContext } from '@/lib/operations/api';
import type { OperationsAuditEvent, OperationsAuditEventType } from '@/lib/operations/types';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const eventType = optionalString(body.eventType) as OperationsAuditEventType | undefined;
  const label = optionalString(body.label);

  if (!eventType || !label) {
    return NextResponse.json({ ok: false, error: 'audit_fields_required' }, { status: 400 });
  }

  try {
    const event = await appendOperationAuditEvent(auth.ctx, params.id, {
      eventType,
      label,
      detail: optionalString(body.detail),
      tone: (optionalString(body.tone) as OperationsAuditEvent['tone'] | undefined) ?? 'normal',
      issueId: optionalString(body.issueId),
    });
    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}

