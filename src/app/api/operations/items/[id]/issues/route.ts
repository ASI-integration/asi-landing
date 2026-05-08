import { NextResponse } from 'next/server';
import { createOperationIssue } from '@/lib/operations/repository';
import { operationsApiErrorResponse, readJsonObject, requireOperationsContext } from '@/lib/operations/api';
import type { OperationsIssueType, OperationsIssueUrgency } from '@/lib/operations/types';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const title = optionalString(body.title);
  const issueType = optionalString(body.issueType) as OperationsIssueType | undefined;
  const urgency = optionalString(body.urgency) as OperationsIssueUrgency | undefined;

  if (!title || !issueType || !urgency) {
    return NextResponse.json({ ok: false, error: 'issue_fields_required' }, { status: 400 });
  }

  try {
    const issue = await createOperationIssue(auth.ctx, params.id, {
      title,
      issueType,
      urgency,
      note: optionalString(body.note),
    });
    return NextResponse.json({ ok: true, issue }, { status: 201 });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}

