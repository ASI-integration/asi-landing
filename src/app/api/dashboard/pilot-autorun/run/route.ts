import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAccess, requireBookingOpsApiAccount } from '../../booking-ops/access';
import {
  createPilotAutorunFallbackIfNeeded,
  runPilotAutorunBatch,
  runPilotAutorunForBooking,
  runPilotAutorunForLead,
  runPilotAutorunForPropertySetup,
  type PilotAutorunOptions,
  type PilotAutorunScopeType,
} from '@/lib/booking-ops/pilot-autorun-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseScope(value: unknown): PilotAutorunScopeType {
  const scope = String(value ?? '').trim();
  if (!['lead', 'property_setup', 'booking', 'batch'].includes(scope)) throw new Error('Недопустимая область автозапуска.');
  return scope as PilotAutorunScopeType;
}

function parseRef(value: unknown, scope: PilotAutorunScopeType): string {
  const ref = String(value ?? '').trim();
  if (scope !== 'batch' && (!ref || ref.length > 200)) throw new Error('Укажите корректный ID области запуска.');
  return scope === 'batch' ? (ref || 'batch') : ref;
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>;
    const scope = parseScope(body.scope);
    const ref = parseRef(body.ref, scope);
    let authorizedRef = ref;
    let accountId: string | undefined;
    if (scope === 'booking') {
      const access = await requireBookingOpsApiAccess(auth.session, ref);
      if (!access.ok) return access.response;
      authorizedRef = access.bookingId;
      accountId = access.accountId;
    } else if (scope === 'batch') {
      const access = await requireBookingOpsApiAccount(auth.session);
      if (!access.ok) return access.response;
      accountId = access.accountId;
      if (body.action === 'fallback' && !ref.startsWith(`batch:${accountId}:`)) {
        return NextResponse.json({ ok: false, message: 'Нет доступа к пакетному запуску.' }, { status: 403 });
      }
    }
    if (body.action === 'fallback') {
      const status = await createPilotAutorunFallbackIfNeeded(
        { scopeType: scope, scopeRef: authorizedRef },
        typeof body.reason === 'string' ? body.reason : 'Требуется ручная проверка.',
      );
      return NextResponse.json({ ok: true, result: status });
    }
    const options: PilotAutorunOptions = {
      accountId,
      dryRun: body.dryRun === true,
      maxSteps: typeof body.maxSteps === 'number' ? body.maxSteps : undefined,
      allowSafeCommunicationQueue: body.allowSafeCommunicationQueue !== false,
      allowScopedAutoSend: body.allowScopedAutoSend === true,
      forceRecompute: body.forceRecompute === true,
      scope: scope === 'property_setup' ? 'property' : scope === 'batch' ? 'all' : scope,
    };
    const result = scope === 'lead'
      ? await runPilotAutorunForLead(authorizedRef, options)
      : scope === 'property_setup'
        ? await runPilotAutorunForPropertySetup(authorizedRef, options)
        : scope === 'booking'
          ? await runPilotAutorunForBooking(authorizedRef, options)
          : await runPilotAutorunBatch(options);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось выполнить автозапуск.' }, { status: 400 });
  }
}
