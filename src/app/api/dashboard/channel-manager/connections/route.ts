import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  addChannelManagerNote,
  blockChannelManagerConnection,
  initializeChannelManagerConnection,
  listChannelManagerConnections,
  markChannelManagerAccessInvalid,
  markChannelManagerAccessReceived,
  requestChannelManagerAccess,
  type ChannelManagerProvider,
} from '@/lib/booking-ops/channel-manager-access-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeConnection(connection: Awaited<ReturnType<typeof listChannelManagerConnections>>[number]) {
  const { safeAccessRef: _safeAccessRef, metadata: _metadata, ...safe } = connection;
  return { ...safe, safeAccessConfigured: Boolean(connection.safeAccessRef) };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const propertySetupId = new URL(req.url).searchParams.get('propertySetupId') ?? undefined;
  try {
    const connections = await listChannelManagerConnections(propertySetupId);
    return NextResponse.json({ ok: true, connections: connections.map(safeConnection) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить подключения.' }, { status: 400 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const propertySetupId = String(body.propertySetupId ?? '');
    const connectionId = String(body.connectionId ?? '');
    const provider = String(body.provider ?? 'manual') as ChannelManagerProvider;
    let connection;
    if (action === 'initialize_connection') connection = await initializeChannelManagerConnection(propertySetupId, provider, body.metadata as Record<string, unknown> | undefined);
    else if (action === 'request_access') connection = await requestChannelManagerAccess(propertySetupId, provider, body.metadata as Record<string, unknown> | undefined);
    else if (action === 'mark_access_received') connection = await markChannelManagerAccessReceived(connectionId, typeof body.safeAccessRef === 'string' ? body.safeAccessRef : null, body.metadata as Record<string, unknown> | undefined);
    else if (action === 'mark_access_invalid') connection = await markChannelManagerAccessInvalid(connectionId, String(body.reason ?? 'Доступ недействителен.'), body.metadata as Record<string, unknown> | undefined);
    else if (action === 'block_connection') connection = await blockChannelManagerConnection(connectionId, String(body.reason ?? 'Заблокировано оператором.'));
    else if (action === 'add_note') connection = await addChannelManagerNote(connectionId, String(body.note ?? ''));
    else return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
    return NextResponse.json({ ok: true, connection: safeConnection(connection) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось выполнить действие.' }, { status: 400 });
  }
}
