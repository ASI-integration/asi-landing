import { NextResponse } from 'next/server';
import { closeOperationIssue } from '@/lib/operations/repository';
import { operationsApiErrorResponse, readJsonObject, requireOperationsContext } from '@/lib/operations/api';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const action = typeof body.action === 'string' ? body.action : 'close';
  const status = typeof body.status === 'string' ? body.status : undefined;

  if (action !== 'close' && status !== 'resolved') {
    return NextResponse.json({ ok: false, error: 'unsupported_issue_action' }, { status: 400 });
  }

  try {
    const issue = await closeOperationIssue(auth.ctx, params.id);
    if (!issue) return NextResponse.json({ ok: false, error: 'issue_not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, issue });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}

