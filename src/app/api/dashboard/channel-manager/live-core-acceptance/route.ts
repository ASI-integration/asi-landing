import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import {
  cleanupLiveCoreAcceptanceHarness,
  describeLiveCoreAcceptanceUnavailable,
  runChannelManagerLiveCoreAcceptance,
} from '@/lib/booking-ops/channel-manager-live-core-acceptance';
import { probeChannelLiveCoreSchema } from '@/lib/booking-ops/channel-manager-live-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  try {
    const schema = await probeChannelLiveCoreSchema();
    return NextResponse.json({
      ok: true,
      schemaReady: schema.ready === true,
      schema,
      unavailableReason: describeLiveCoreAcceptanceUnavailable(schema),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error instanceof Error ? error.message : 'Не удалось проверить схему Live Core.',
    }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const action = String(body.action ?? 'run');

  try {
    if (action === 'cleanup') {
      if (body.confirm !== true) {
        return NextResponse.json({
          ok: false,
          message: 'Для удаления тестового контура нужно явное подтверждение.',
        }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
      const result = await cleanupLiveCoreAcceptanceHarness();
      return NextResponse.json({ ok: true, cleanup: result }, { headers: { 'cache-control': 'no-store' } });
    }

    if (action !== 'run') {
      return NextResponse.json({
        ok: false,
        message: 'Неизвестное действие acceptance harness.',
      }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    const evidence = await runChannelManagerLiveCoreAcceptance();
    return NextResponse.json({
      ok: true,
      evidence,
      message: evidence.passed ? 'Acceptance пройден' : evidence.blocker,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error instanceof Error ? error.message : 'Acceptance harness не выполнен.',
    }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
