import { NextResponse } from 'next/server';
import {
  PartnerAuthenticationError,
  authenticatePartnerRequest,
  type AuthenticatedPartnerPrincipal,
} from '@/lib/partner-communication/auth';
import {
  isPartnerCommunicationContractError,
  validateTrustedPartnerCommunicationEvent,
} from '@/lib/partner-communication/contract';
import { PartnerInboxError, processPartnerInboxEvent } from '@/lib/partner-communication/inbox';
import {
  PartnerRecoveryError,
  processPartnerRecoveryEvent,
  validateTrustedPartnerRecoveryEvent,
} from '@/lib/partner-communication/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 16_384;

type Dependencies = {
  authenticate(headers: Headers): Promise<AuthenticatedPartnerPrincipal>;
  process: typeof processPartnerInboxEvent;
  processRecovery?: typeof processPartnerRecoveryEvent;
};

function declaredPayloadTooLarge(req: Request): boolean {
  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  return Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES;
}

async function boundedJson(req: Request): Promise<unknown> {
  if (declaredPayloadTooLarge(req)) {
    throw new Error('partner_payload_too_large');
  }
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

export async function handlePartnerCommunicationEvent(
  req: Request,
  dependencies: Dependencies = {
    authenticate: authenticatePartnerRequest,
    process: processPartnerInboxEvent,
    processRecovery: processPartnerRecoveryEvent,
  },
): Promise<NextResponse> {
  if (declaredPayloadTooLarge(req)) {
    return NextResponse.json({ ok: false, error: 'partner_payload_too_large' }, { status: 413 });
  }
  let principal: AuthenticatedPartnerPrincipal;
  try {
    principal = await dependencies.authenticate(req.headers);
  } catch (error) {
    if (!(error instanceof PartnerAuthenticationError)) {
      // Collapse database and credential-state failures into the same safe boundary.
    }
    return NextResponse.json({ ok: false, error: 'partner_authentication_failed' }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await boundedJson(req);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'partner_payload_too_large';
    return NextResponse.json(
      { ok: false, error: tooLarge ? 'partner_payload_too_large' : 'partner_contract_invalid' },
      { status: tooLarge ? 413 : 400 },
    );
  }

  try {
    const eventType = input && typeof input === 'object' && !Array.isArray(input)
      ? (input as { eventType?: unknown }).eventType
      : null;
    const context = eventType === 'operation.updated' || eventType === 'guest.resolution.confirmed'
      ? validateTrustedPartnerRecoveryEvent(input)
      : validateTrustedPartnerCommunicationEvent(input);
    if (
      context.identity.partnerId !== principal.partnerId
      || context.identity.accountId !== principal.externalPartnerAccountId
    ) {
      return NextResponse.json({ ok: false, error: 'partner_identity_mismatch' }, { status: 403 });
    }
    const response = context.eventType === 'guest.message.received'
      ? await dependencies.process(principal, context)
      : await (dependencies.processRecovery ?? processPartnerRecoveryEvent)(principal, context);
    return NextResponse.json(response, { status: response.duplicate ? 200 : 202 });
  } catch (error) {
    if (isPartnerCommunicationContractError(error)) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'partner_contract_invalid') {
      return NextResponse.json({ ok: false, error: 'partner_contract_invalid' }, { status: 400 });
    }
    if ((error instanceof PartnerInboxError || error instanceof PartnerRecoveryError)
      && error.code === 'partner_event_conflict') {
      return NextResponse.json({ ok: false, error: error.code }, { status: 409 });
    }
    if (error instanceof PartnerRecoveryError
      && (error.code === 'partner_recovery_scope_invalid' || error.code === 'partner_recovery_transition_invalid')) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'partner_event_processing_failed' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  return handlePartnerCommunicationEvent(req);
}
