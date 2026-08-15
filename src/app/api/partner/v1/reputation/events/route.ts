import { NextResponse } from 'next/server';
import {
  PartnerAuthenticationError,
  authenticatePartnerRequest,
  type AuthenticatedPartnerPrincipal,
} from '@/lib/partner-communication/auth';
import {
  PartnerReputationContractError,
  validateTrustedPartnerReviewEvent,
} from '@/lib/partner-reputation/contract';
import {
  PartnerReputationError,
  processPartnerReviewEvent,
} from '@/lib/partner-reputation/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 16_384;

type Dependencies = {
  authenticate(headers: Headers): Promise<AuthenticatedPartnerPrincipal>;
  process: typeof processPartnerReviewEvent;
};

function declaredPayloadTooLarge(req: Request): boolean {
  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  return Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES;
}

async function boundedJson(req: Request): Promise<unknown> {
  if (declaredPayloadTooLarge(req)) throw new Error('partner_payload_too_large');
  if (!req.body) throw new Error('partner_contract_invalid');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error('partner_payload_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handlePartnerReputationEvent(
  req: Request,
  dependencies: Dependencies = { authenticate: authenticatePartnerRequest, process: processPartnerReviewEvent },
): Promise<NextResponse> {
  if (declaredPayloadTooLarge(req)) {
    return NextResponse.json({ ok: false, error: 'partner_payload_too_large' }, { status: 413 });
  }
  let principal: AuthenticatedPartnerPrincipal;
  try {
    principal = await dependencies.authenticate(req.headers);
  } catch (error) {
    if (!(error instanceof PartnerAuthenticationError)) {
      // Database and credential-state failures remain collapsed at the boundary.
    }
    return NextResponse.json({ ok: false, error: 'partner_authentication_failed' }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await boundedJson(req);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'partner_payload_too_large';
    return NextResponse.json({ ok: false, error: tooLarge ? 'partner_payload_too_large' : 'partner_contract_invalid' }, { status: tooLarge ? 413 : 400 });
  }

  try {
    const context = validateTrustedPartnerReviewEvent(input);
    if (context.identity.partnerId !== principal.partnerId || context.identity.accountId !== principal.externalPartnerAccountId) {
      return NextResponse.json({ ok: false, error: 'partner_identity_mismatch' }, { status: 403 });
    }
    const response = await dependencies.process(principal, context);
    return NextResponse.json(response, { status: response.duplicate ? 200 : 202 });
  } catch (error) {
    if (error instanceof PartnerReputationContractError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 400 });
    }
    if (error instanceof PartnerReputationError) {
      if (error.code === 'partner_event_conflict' || error.code === 'partner_review_conflict') {
        return NextResponse.json({ ok: false, error: error.code }, { status: 409 });
      }
      if (error.code === 'partner_reputation_scope_invalid') {
        return NextResponse.json({ ok: false, error: error.code }, { status: 403 });
      }
    }
    return NextResponse.json({ ok: false, error: 'partner_review_processing_failed' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  return handlePartnerReputationEvent(req);
}
