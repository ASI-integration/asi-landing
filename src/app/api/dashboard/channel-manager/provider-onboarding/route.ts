import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  CHANNEL_MANAGER_ONBOARDING_STATUS_LABELS,
  findSecretPath,
  listChannelManagerConnections,
  parseChannelManagerProvider,
  performChannelManagerProviderOnboardingAction,
  type ChannelManagerConnection,
  type ChannelManagerOnboardingStatus,
  type ChannelManagerProviderOnboardingAction,
  type ManualChannelSnapshot,
} from '@/lib/booking-ops/channel-manager-access-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set<ChannelManagerProviderOnboardingAction>([
  'select_provider', 'request_account_creation', 'mark_account_created', 'request_access',
  'mark_access_received', 'mark_operator_review', 'mark_import_ready', 'upload_manual_snapshot',
  'run_reconciliation', 'mark_pilot_activation_pending', 'mark_connected_placeholder',
  'block_connection', 'add_note',
]);

function safeConnection(connection: ChannelManagerConnection) {
  const { safeAccessRef: _safeAccessRef, metadata: _metadata, ...safe } = connection;
  const status = connection.status as ChannelManagerOnboardingStatus;
  return {
    ...safe,
    safeAccessConfigured: Boolean(connection.safeAccessRef),
    statusLabel: CHANNEL_MANAGER_ONBOARDING_STATUS_LABELS[status] ?? connection.status,
    realApiSyncEnabled: false,
    manualSnapshotAvailable: true,
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const propertySetupId = new URL(req.url).searchParams.get('propertySetupId') ?? undefined;
    const connections = await listChannelManagerConnections(propertySetupId);
    return NextResponse.json({
      ok: true,
      connections: connections.map(safeConnection),
      capabilities: { realApiSyncEnabled: false, manualSnapshotAvailable: true, providerReady: true },
      warning: 'Не вставляйте пароль или API-токен сюда. Передайте доступ через согласованный безопасный канал.',
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить подключение.' }, { status: 400 });
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
    const action = String(body.action ?? '') as ChannelManagerProviderOnboardingAction;
    if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
    const result = await performChannelManagerProviderOnboardingAction({
      action,
      propertySetupId: typeof body.propertySetupId === 'string' ? body.propertySetupId : undefined,
      connectionId: typeof body.connectionId === 'string' ? body.connectionId : undefined,
      provider: body.provider === undefined ? undefined : parseChannelManagerProvider(body.provider),
      safeAccessRef: typeof body.safeAccessRef === 'string' ? body.safeAccessRef : null,
      snapshot: body.snapshot as ManualChannelSnapshot | undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      metadata: body.metadata as Record<string, unknown> | undefined,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      connection: safeConnection(result.connection),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось выполнить действие.' }, { status: 400 });
  }
}
