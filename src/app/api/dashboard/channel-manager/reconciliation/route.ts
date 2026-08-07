import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { findSecretPath } from '@/lib/booking-ops/channel-manager-access-import';
import {
  APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
  getChannelManagerReconciliationStatus,
  listRecentChannelManagerReconciliations,
  runChannelManagerReconciliationPreview,
  runChannelManagerReconciliationRecovery,
  type SafeReconciliationReport,
} from '@/lib/booking-ops/channel-manager-reconciliation';
import { hashCommittedIncrementalCursor } from '@/lib/booking-ops/channel-manager-live-core';
import { getChannelManagerConnectionStatus } from '@/lib/booking-ops/channel-manager-access-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toApiReport(report: SafeReconciliationReport): Record<string, unknown> {
  const items = report.items ?? [];
  const byCategory: Record<string, number> = {};
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  }
  return {
    runId: report.runId,
    connectionId: report.connectionId,
    mode: report.mode,
    status: report.status,
    snapshotKind: report.snapshotKind,
    snapshotHashPrefix: report.snapshotHashPrefix,
    reportHashPrefix: report.reportHashPrefix,
    reportHash: report.reportHash,
    counts: report.counts,
    categorySummaries: byCategory,
    blockerSummaries: items
      .filter((item) => item.severity === 'blocker' || item.status === 'blocked')
      .slice(0, 20)
      .map((item) => ({
        category: item.category,
        status: item.status,
        message: item.safeMessage,
      })),
    repairableCount: report.repairableCount,
    appliedCount: items.filter((item) => item.status === 'applied').length,
    skippedCount: items.filter((item) => item.status === 'skipped').length,
    blockedCount: items.filter((item) => item.status === 'blocked').length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    cursorChangedSincePreview: report.cursorChangedSincePreview,
    nextAction: report.nextAction,
    safeSummary: report.safeSummary,
    safeError: report.safeError,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    items: items.map((item) => ({
      id: item.id,
      category: item.category,
      severity: item.severity,
      repairability: item.repairability,
      status: item.status,
      externalIdentityHash: item.externalIdentityHash,
      safeMessage: item.safeMessage,
      appliedAt: item.appliedAt,
    })),
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const url = new URL(req.url);
    const connectionId = url.searchParams.get('connectionId') ?? '';
    const runId = url.searchParams.get('runId');
    if (!connectionId) {
      return NextResponse.json({ ok: false, message: 'Нужен connectionId.' }, { status: 400 });
    }
    if (runId) {
      const report = await getChannelManagerReconciliationStatus(connectionId, runId);
      if (!report) {
        return NextResponse.json({ ok: false, message: 'Отчёт сверки не найден.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, report: toApiReport(report) });
    }
    const recent = await listRecentChannelManagerReconciliations(connectionId, 10);
    return NextResponse.json({
      ok: true,
      recent: recent.map(toApiReport),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error instanceof Error ? error.message : 'Не удалось загрузить сверку.',
    }, { status: 400 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (findSecretPath(body)) {
      return NextResponse.json({
        ok: false,
        message: 'Не вставляйте пароль или API-токен сюда. Передайте доступ через согласованный безопасный канал.',
      }, { status: 400 });
    }

    // Reject body-supplied owner/account/property scope — server derives contour.
    if (
      body.ownerSetupId != null
      || body.ownerId != null
      || body.accountId != null
      || body.propertyId != null
      || body.propertySetupId != null
    ) {
      return NextResponse.json({
        ok: false,
        message: 'Контур account/property задаётся сервером. Не передавайте owner/account/property в теле запроса.',
      }, { status: 400 });
    }

    const action = String(body.action ?? '');
    const connectionId = String(body.connectionId ?? '');
    if (!connectionId) {
      return NextResponse.json({ ok: false, message: 'Нужен connectionId.' }, { status: 400 });
    }

    if (action === 'preview') {
      const report = await runChannelManagerReconciliationPreview({
        connectionId,
        snapshot: body.snapshot,
      });
      return NextResponse.json({
        ok: true,
        report: toApiReport(report),
        message: report.safeSummary,
      });
    }

    if (action === 'apply_safe_repairs') {
      const report = await runChannelManagerReconciliationRecovery({
        connectionId,
        reconciliationRunId: String(body.reconciliationRunId ?? body.runId ?? ''),
        reportHash: String(body.reportHash ?? ''),
        confirmationPhrase: String(body.confirmationPhrase ?? ''),
        snapshot: body.snapshot,
      });
      return NextResponse.json({
        ok: report.status !== 'failed',
        report: toApiReport(report),
        confirmationPhraseRequired: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        message: report.safeSummary ?? report.safeError?.message,
      }, { status: report.status === 'failed' ? 400 : 200 });
    }

    if (action === 'get_status') {
      const report = await getChannelManagerReconciliationStatus(
        connectionId,
        body.runId ? String(body.runId) : undefined,
      );
      if (!report) {
        return NextResponse.json({ ok: false, message: 'Отчёт сверки не найден.' }, { status: 404 });
      }
      const connection = await getChannelManagerConnectionStatus({ connectionId });
      const currentCursorHash = connection
        ? hashCommittedIncrementalCursor(connection.metadata)
        : null;
      return NextResponse.json({
        ok: true,
        report: toApiReport({
          ...report,
          cursorChangedSincePreview: report.committedCursorHashAtPreview != null
            && currentCursorHash !== report.committedCursorHashAtPreview,
        }),
      });
    }

    if (action === 'list_recent') {
      const recent = await listRecentChannelManagerReconciliations(connectionId, 10);
      return NextResponse.json({ ok: true, recent: recent.map(toApiReport) });
    }

    return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code ?? '')
      : '';
    return NextResponse.json({
      ok: false,
      code: code || undefined,
      message: error instanceof Error ? error.message : 'Не удалось выполнить сверку.',
    }, { status: 400 });
  }
}
