import { NextResponse } from 'next/server';
import { requireCabinetSession } from '@/lib/cabinet/api-auth';
import { readRequestJson } from '@/lib/safeRequestJson';
import {
  RU_LEGAL_LOCALIZATION_GATE_CODE,
  acceptCurrentRuLegalDocument,
  getRuLegalOnboardingStateForUser,
  isRuLegalDocumentType,
} from '@/lib/ru-legal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireCabinetSession();
  if ('error' in auth) return auth.error;
  const state = await getRuLegalOnboardingStateForUser(auth.session.userId);
  if (!state) {
    return NextResponse.json({ ok: false, code: 'RU_ACCOUNT_MEMBERSHIP_REQUIRED' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, state });
}

export async function POST(req: Request) {
  const auth = await requireCabinetSession();
  if ('error' in auth) return auth.error;

  const parsed = await readRequestJson<{ documentType?: unknown }>(req);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== 'object') {
    return NextResponse.json({ ok: false, code: 'INVALID_BODY' }, { status: 400 });
  }
  const keys = Object.keys(parsed.data as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'documentType' || !isRuLegalDocumentType(parsed.data.documentType)) {
    return NextResponse.json({ ok: false, code: 'INVALID_LEGAL_ACCEPTANCE_REQUEST' }, { status: 400 });
  }

  try {
    const accepted = await acceptCurrentRuLegalDocument({
      userId: auth.session.userId,
      email: auth.session.email,
      documentType: parsed.data.documentType,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip'),
      userAgent: req.headers.get('user-agent'),
    });
    const state = await getRuLegalOnboardingStateForUser(auth.session.userId);
    return NextResponse.json({ ok: true, accepted, state });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'RU_LEGAL_ACCEPTANCE_FAILED';
    if (code === RU_LEGAL_LOCALIZATION_GATE_CODE) {
      return NextResponse.json({ ok: false, code }, { status: 503 });
    }
    if (code === 'RU_LEGAL_OWNER_REQUIRED') {
      return NextResponse.json({ ok: false, code }, { status: 403 });
    }
    if (code === 'RU_LEGAL_OFFER_REQUIRED') {
      return NextResponse.json({ ok: false, code }, { status: 428 });
    }
    if (code === 'RU_ACCOUNT_MEMBERSHIP_REQUIRED') {
      return NextResponse.json({ ok: false, code }, { status: 403 });
    }
    console.error('[ru-legal] acceptance failed', error);
    return NextResponse.json({ ok: false, code: 'RU_LEGAL_ACCEPTANCE_FAILED' }, { status: 503 });
  }
}
