import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  completeChannelImportRun,
  failChannelImportRun,
  listChannelImportRuns,
  registerManualChannelSnapshot,
  startChannelImportRun,
  type ChannelImportType,
  type ManualChannelSnapshot,
} from '@/lib/booking-ops/channel-manager-access-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession(); if ('error' in auth) return auth.error;
  try { return NextResponse.json({ ok: true, runs: await listChannelImportRuns(new URL(req.url).searchParams.get('connectionId') ?? undefined) }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить запуски.' }, { status: 400 }); }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession(); if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>; const action = String(body.action ?? '');
    if (action === 'upload_manual_snapshot') {
      const result = await registerManualChannelSnapshot(String(body.connectionId ?? ''), body.snapshot as ManualChannelSnapshot, body.metadata as Record<string, unknown> | undefined);
      return NextResponse.json({ ok: true, ...result });
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
