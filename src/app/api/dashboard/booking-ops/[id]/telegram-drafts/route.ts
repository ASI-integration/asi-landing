import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  createTelegramDraftFromBookingOpsAction,
  listBookingOpsTelegramDrafts,
  updateBookingOpsTelegramDraftStatus,
} from '@/lib/booking-ops/telegram-drafts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const result = await listBookingOpsTelegramDrafts(context.params.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error || 'Не удалось загрузить черновики Telegram.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, drafts: result.drafts });
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const result = await createTelegramDraftFromBookingOpsAction(
    context.params.id,
    String(body.actionId ?? body.action_id ?? ''),
    { createdBy: auth.session.email },
  );
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'database_error' ? 500 : 400;
    return NextResponse.json({ ok: false, message: result.message }, { status });
  }
  return NextResponse.json({ ok: true, draft: result.draft }, { status: 201 });
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const result = await updateBookingOpsTelegramDraftStatus(
    context.params.id,
    String(body.draftId ?? body.draft_id ?? ''),
    String(body.status ?? ''),
  );
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'invalid_status' ? 400 : 500;
    return NextResponse.json(
      { ok: false, message: result.error === 'invalid_status' ? 'Недопустимый статус черновика.' : result.error },
      { status },
    );
  }
  return NextResponse.json({ ok: true, draft: result.draft });
}
