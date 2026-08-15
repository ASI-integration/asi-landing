import { NextResponse } from 'next/server';
import { PartnerAuthenticationError, authenticatePartnerRequest, type AuthenticatedPartnerPrincipal } from '@/lib/partner-communication/auth';
import { PartnerRevenueContractError, validatePartnerRevenueEvent } from '@/lib/partner-revenue/contract';
import { PartnerRevenueError, processPartnerRevenueEvent } from '@/lib/partner-revenue/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_REQUEST_BYTES = 32_768;

type Dependencies = {
  authenticate(headers: Headers): Promise<AuthenticatedPartnerPrincipal>;
  process: typeof processPartnerRevenueEvent;
};
function tooLarge(req: Request): boolean { const size = Number(req.headers.get('content-length') ?? '0'); return Number.isFinite(size) && size > MAX_REQUEST_BYTES; }
async function boundedJson(req: Request): Promise<unknown> {
  if (tooLarge(req)) throw new PartnerRevenueContractError('partner_payload_too_large');
  if (!req.body) throw new PartnerRevenueContractError('partner_contract_invalid');
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let received = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; received += value.byteLength; if (received > MAX_REQUEST_BYTES) { await reader.cancel(); throw new PartnerRevenueContractError('partner_payload_too_large'); } chunks.push(value); }
  const bytes = new Uint8Array(received); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PartnerRevenueContractError('partner_contract_invalid'); }
}

export async function handlePartnerRevenueEvent(req: Request, dependencies: Dependencies = { authenticate: authenticatePartnerRequest, process: processPartnerRevenueEvent }): Promise<NextResponse> {
  let principal: AuthenticatedPartnerPrincipal;
  try { principal = await dependencies.authenticate(req.headers); }
  catch (error) { if (!(error instanceof PartnerAuthenticationError)) { /* collapse persistence details */ } return NextResponse.json({ ok: false, error: 'partner_authentication_failed' }, { status: 401 }); }
  try {
    const context = validatePartnerRevenueEvent(await boundedJson(req));
    if (context.partner.partnerId !== principal.partnerId || context.partner.accountId !== principal.externalPartnerAccountId) return NextResponse.json({ ok: false, error: 'partner_identity_mismatch' }, { status: 403 });
    const response = await dependencies.process(principal, context);
    return NextResponse.json(response, { status: response.duplicate ? 200 : 202 });
  } catch (error) {
    if (error instanceof PartnerRevenueContractError) return NextResponse.json({ ok: false, error: error.code }, { status: error.code === 'partner_payload_too_large' ? 413 : 400 });
    if (error instanceof PartnerRevenueError) {
      const status = error.code === 'partner_event_conflict' ? 409
        : error.code === 'partner_revenue_scope_invalid' ? 403
          : ['pricing_not_ready', 'observation_not_available', 'recommendation_not_found'].includes(error.code) ? 409 : 500;
      return NextResponse.json({ ok: false, error: error.code }, { status });
    }
    return NextResponse.json({ ok: false, error: 'partner_revenue_processing_failed' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> { return handlePartnerRevenueEvent(req); }
