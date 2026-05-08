import { NextResponse } from 'next/server';
import { addOperationNote } from '@/lib/operations/repository';
import { operationsApiErrorResponse, readJsonObject, requireOperationsContext } from '@/lib/operations/api';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const noteBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!noteBody) {
    return NextResponse.json({ ok: false, error: 'note_body_required' }, { status: 400 });
  }

  try {
    const note = await addOperationNote(auth.ctx, params.id, noteBody);
    return NextResponse.json({ ok: true, note }, { status: 201 });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}

