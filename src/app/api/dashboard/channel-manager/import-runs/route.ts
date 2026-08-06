import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  completeChannelImportRun,
  failChannelImportRun,
  findSecretPath,
  listChannelImportRuns,
  registerManualChannelSnapshot,
  startChannelImportRun,
  type ChannelImportType,
  type ManualChannelSnapshot,
} from '@/lib/booking-ops/channel-manager-access-import';
import {
  getChannelLiveCoreStatus,
  hashCursorCheckpoint,
  runChannelManagerInitialSync,
  runChannelManagerIncrementalSync,
  toSafeIncrementalRunSummary,
  type ManualChannelIncrementalDelta,
} from '@/lib/booking-ops/channel-manager-live-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession(); if ('error' in auth) return auth.error;
  try {
    const connectionId = new URL(req.url).searchParams.get('connectionId') ?? undefined;
    const payload: Record<string, unknown> = {
      ok: true,
      runs: await listChannelImportRuns(connectionId),
    };
    if (connectionId) {
      payload.liveCore = await getChannelLiveCoreStatus(connectionId);
    }
    return NextResponse.json(payload);
  }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить запуски.' }, { status: 400 }); }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession(); if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (findSecretPath(body)) {
      return NextResponse.json({
        ok: false,
        message: 'Не вставляйте пароль или API-токен сюда. Передайте доступ через согласованный безопасный канал.',
      }, { status: 400 });
    }
    const action = String(body.action ?? '');
    if (action === 'upload_manual_snapshot') {
      const result = await registerManualChannelSnapshot(String(body.connectionId ?? ''), body.snapshot as ManualChannelSnapshot, body.metadata as Record<string, unknown> | undefined);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === 'run_initial_sync') {
      const result = await runChannelManagerInitialSync({
        connectionId: String(body.connectionId ?? ''),
        snapshot: body.snapshot as ManualChannelSnapshot | undefined,
        reuseImportedRows: body.reuseImportedRows === true,
        metadata: body.metadata as Record<string, unknown> | undefined,
      });
      return NextResponse.json({
        ok: result.status !== 'failed',
        ...result,
        message: result.safeError?.message,
      }, { status: result.status === 'failed' ? 400 : 200 });
    }
    if (action === 'run_incremental_sync') {
      if (!body.delta || typeof body.delta !== 'object') {
        return NextResponse.json({
          ok: false,
          message: 'Для incremental sync нужен явный нормализованный delta JSON.',
        }, { status: 400 });
      }
      // ownerSetupId / ownerId / accountId are intentionally ignored — scope is server-derived.
      const result = await runChannelManagerIncrementalSync({
        connectionId: String(body.connectionId ?? ''),
        delta: body.delta as ManualChannelIncrementalDelta,
        metadata: body.metadata as Record<string, unknown> | undefined,
      });
      return NextResponse.json({
        ok: result.status !== 'failed',
        run: toSafeIncrementalRunSummary(result.run),
        stage: result.stage,
        status: result.status,
        counters: result.counters,
        warnings: result.warnings,
        safeError: result.safeError,
        retryable: result.retryable,
        cursorCommitted: result.cursorCommitted === true,
        cursorPresent: Boolean(result.committedCursor?.checkpoint),
        cursorUpdatedAt: result.committedCursor?.updatedAt ?? null,
        cursorSourceRunId: result.committedCursor?.sourceRunId ?? null,
        cursorCheckpointHash: result.committedCursor?.checkpoint
          ? hashCursorCheckpoint(result.committedCursor.checkpoint)
          : null,
        replayed: result.replayed === true,
        message: result.safeError?.message,
      }, { status: result.status === 'failed' ? 400 : 200 });
    }
    if (action === 'run_dry_import') {
      const run = await startChannelImportRun(String(body.connectionId ?? ''), (body.importType ?? 'manual_snapshot') as ChannelImportType, { dryRun: true, metadata: body.metadata as Record<string, unknown> | undefined });
      return NextResponse.json({ ok: true, run });
    }
    if (action === 'start_import') {
      const run = await startChannelImportRun(String(body.connectionId ?? ''), (body.importType ?? 'full') as ChannelImportType, { executeProvider: true, metadata: body.metadata as Record<string, unknown> | undefined });
      return NextResponse.json({ ok: true, run });
    }
    if (action === 'complete_manual_import') {
      const run = await completeChannelImportRun(String(body.importRunId ?? ''), body.result as Parameters<typeof completeChannelImportRun>[1], body.metadata as Record<string, unknown> | undefined);
      return NextResponse.json({ ok: true, run });
    }
    if (action === 'fail_import') {
      const run = await failChannelImportRun(String(body.importRunId ?? ''), String(body.reason ?? 'Импорт остановлен оператором.'), body.metadata as Record<string, unknown> | undefined);
      return NextResponse.json({ ok: true, run });
    }
    return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось выполнить импорт.' }, { status: 400 }); }
}
