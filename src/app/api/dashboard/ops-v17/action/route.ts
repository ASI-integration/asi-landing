import { NextResponse } from 'next/server';
import { requireCabinetSession } from '@/lib/cabinet/api-auth';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { activatePilot, bootstrapPilot, createVerificationIssue } from '@/lib/ops-v17/service';

async function requireOwnerWorkspace() {
  const auth = await requireCabinetSession();
  if ('error' in auth) return auth;
  const accountId = await resolveAccountIdForUser(auth.session.userId!);
  if (!accountId || accountId === 'legacy') {
    return { error: NextResponse.json({ ok: false, message: 'account_workspace_unavailable' }, { status: 403 }) };
  }
  return { session: auth.session, accountId };
}

export async function POST(req: Request) {
  const body = await req.json() as Record<string, unknown>;
  try {
    if (body.action === 'bootstrap') {
      const auth = await requireOpsAdminSession();
      if ('error' in auth) return auth.error;
      const accountId = await resolveAccountIdForUser(auth.session.userId!);
      if (!accountId || accountId === 'legacy') {
        return NextResponse.json({ ok: false, message: 'account_workspace_unavailable' }, { status: 403 });
      }
      const result = await bootstrapPilot({
        accountId,
        actorId: auth.session.userId!,
        confirm: body.confirm === true,
      });
      return NextResponse.json({ ok: true, result });
    }

    const auth = await requireOwnerWorkspace();
    if ('error' in auth) return auth.error;

    const result = body.action === 'activate'
      ? await activatePilot(auth.accountId, auth.session.userId!)
      : body.action === 'verification_issue'
        ? await createVerificationIssue({
            accountId: auth.accountId,
            actorId: auth.session.userId!,
            itemKey: String(body.itemKey),
            propertyKey: String(body.propertyKey),
            notes: typeof body.notes === 'string' ? body.notes : undefined,
            blocking: body.blocking !== false,
          })
        : (() => { throw new Error('invalid_action'); })();

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'action_failed' }, { status: 400 });
  }
}
