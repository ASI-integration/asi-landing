import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import {
  cleanupLiveCoreSyntheticRecovery,
  describeLiveCoreAcceptanceUnavailable,
  previewLiveCoreSyntheticRecovery,
  runChannelManagerLiveCoreAcceptance,
  LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
} from '@/lib/booking-ops/channel-manager-live-core-acceptance';
import { cleanupLiveCoreAcceptanceHarnessV2 } from '@/lib/booking-ops/channel-manager-live-core-acceptance-cleanup-v2';
import { probeChannelLiveCoreSchema } from '@/lib/booking-ops/channel-manager-live-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  const message = error.message.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (/password|token|api[_-]?key|secret|authorization|bearer/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  try {
    const schema = await probeChannelLiveCoreSchema();
    const recovery = await previewLiveCoreSyntheticRecovery();
    return NextResponse.json({
      ok: true,
      schemaReady: schema.ready === true,
      schema,
      unavailableReason: describeLiveCoreAcceptanceUnavailable(schema),
      recovery,
      recoveryRequired: recovery.recoveryRequired,
      recoverySafeToCleanup: recovery.safeToCleanup,
      recoveryBlockerCode: recovery.blockerCode,
      recoveryBlockerSummary: recovery.blockerSummary,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: sanitizeErrorMessage(error, 'Не удалось проверить схему Live Core.'),
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
    if (action === 'preview_recovery') {
      const recovery = await previewLiveCoreSyntheticRecovery();
      return NextResponse.json({
        ok: true,
        recovery,
        message: recovery.recoveryRequired
          ? 'Найдены синтетические тестовые артефакты.'
          : 'Контур чист — очистка не требуется.',
      }, { headers: { 'cache-control': 'no-store' } });
    }

    if (action === 'cleanup_recovery') {
      const confirmPhrase = typeof body.confirmPhrase === 'string' ? body.confirmPhrase : null;
      const dryRun = body.dryRun !== false;
      const phraseMatches = confirmPhrase === LIVE_CORE_RECOVERY_CONFIRM_PHRASE;
      const confirmOk = phraseMatches || (body.confirm === true && Boolean(confirmPhrase) && phraseMatches);

      if (!dryRun && !confirmOk) {
        return NextResponse.json({
          ok: false,
          message: 'Для удаления синтетических артефактов нужна точная фраза подтверждения.',
        }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }

      const result = await cleanupLiveCoreSyntheticRecovery({
        confirmPhrase,
        dryRun,
        expectedBookingOpsRecordId: typeof body.expectedBookingOpsRecordId === 'string'
          ? body.expectedBookingOpsRecordId
          : null,
      });

      const ok = result.status === 'passed' || result.status === 'already_clean';
      return NextResponse.json({
        ok,
        cleanup: result,
        recovery: result.preview,
        message: ok
          ? (result.status === 'already_clean'
            ? 'Синтетические артефакты уже отсутствовали.'
            : (dryRun ? 'Просмотр очистки выполнен.' : 'Синтетические тестовые артефакты удалены.'))
          : (result.blockerSummary ?? result.safeError ?? 'Очистка не выполнена.'),
      }, {
        status: ok ? 200 : 500,
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (action === 'cleanup') {
      if (body.confirm !== true) {
        return NextResponse.json({
          ok: false,
          message: 'Для удаления тестового контура нужно явное подтверждение.',
        }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
      const result = await cleanupLiveCoreAcceptanceHarnessV2();
      return NextResponse.json({
        ok: result.cleanupPassed === true,
        cleanup: result,
        message: result.cleanupPassed ? 'Тестовый контур удалён.' : (result.blocker ?? 'Cleanup не подтверждён.'),
      }, {
        status: result.cleanupPassed ? 200 : 500,
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (action !== 'run') {
      return NextResponse.json({
        ok: false,
        message: 'Неизвестное действие acceptance harness.',
      }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    const evidence = await runChannelManagerLiveCoreAcceptance({
      injectFailureAfterBookingOpsCreate: body.injectFailureAfterBookingOpsCreate === true,
      recoveryConfirmPhrase: typeof body.recoveryConfirmPhrase === 'string'
        ? body.recoveryConfirmPhrase
        : null,
      skipRecoveryCleanup: body.skipRecoveryCleanup === true,
    });
    return NextResponse.json({
      ok: true,
      evidence,
      message: evidence.passed ? 'Acceptance пройден' : evidence.blocker,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: sanitizeErrorMessage(error, 'Acceptance harness не выполнен.'),
    }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}