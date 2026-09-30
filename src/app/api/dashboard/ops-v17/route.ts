import { NextResponse } from 'next/server';
import { requireCabinetSession } from '@/lib/cabinet/api-auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { getWorkspace, saveOnboardingStep } from '@/lib/ops-v17/service';
import { onboardingSteps, type OnboardingData, type OnboardingStep } from '@/lib/ops-v17/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireOwnerWorkspace() {
  const auth = await requireCabinetSession();
  if ('error' in auth) return auth;
  const accountId = await resolveAccountIdForUser(auth.session.userId!);
  if (!accountId || accountId === 'legacy') {
    return { error: NextResponse.json({ ok: false, message: 'account_workspace_unavailable' }, { status: 403 }) };
  }
  return { session: auth.session, accountId };
}

export async function GET() {
  const auth = await requireOwnerWorkspace();
  if ('error' in auth) return auth.error;
  return NextResponse.json({ ok: true, workspace: await getWorkspace(auth.accountId) });
}

export async function PATCH(req: Request) {
  const auth = await requireOwnerWorkspace();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as { step?: OnboardingStep; data?: Partial<OnboardingData> };
    if (!body.step || !onboardingSteps.includes(body.step)) throw new Error('invalid_step');
    const onboarding = await saveOnboardingStep({
      accountId: auth.accountId,
      actorId: auth.session.userId!,
      step: body.step,
      patch: body.data ?? {},
    });
    return NextResponse.json({ ok: true, onboarding });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'save_failed' }, { status: 400 });
  }
}
