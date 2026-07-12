import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getWorkspace, saveOnboardingStep } from '@/lib/ops-v17/service';
import { onboardingSteps, type OnboardingData, type OnboardingStep } from '@/lib/ops-v17/types';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
function accountId(session: { userId?: string | null }) { return session.userId ?? ''; }
export async function GET() { const auth = await requireCrmOperatorSession(); if ('error' in auth) return auth.error; return NextResponse.json({ ok: true, workspace: await getWorkspace(accountId(auth.session)) }); }
export async function PATCH(req: Request) { const auth = await requireCrmOperatorSession(); if ('error' in auth) return auth.error; try { const body = await req.json() as { step?: OnboardingStep; data?: Partial<OnboardingData> }; if (!body.step || !onboardingSteps.includes(body.step)) throw new Error('invalid_step'); const onboarding = await saveOnboardingStep({ accountId: accountId(auth.session), actorId: auth.session.userId!, step: body.step, patch: body.data ?? {} }); return NextResponse.json({ ok: true, onboarding }); } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'save_failed' }, { status: 400 }); } }
