import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { readRequestJson } from '@/lib/safeRequestJson';
import {
  CHANNEL_MANAGER_ACCESS_SITUATION_VALUES,
  CHANNEL_MANAGER_CONNECTION_METHOD_VALUES,
  handleChannelManagerConnectionAction,
  loadChannelManagerConnectionContext,
  type ChannelManagerConnectionAction,
} from '@/lib/channel-manager-connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDashboardSession(): Promise<NextResponse | null> {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json({ ok: false, message: 'Доступ не настроен.' }, { status: 401 });
  }
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ ok: false, message: 'Войдите в личный кабинет.' }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const authError = await requireDashboardSession();
  if (authError) return authError;

  const url = new URL(req.url);
  const contactId = url.searchParams.get('contactId')?.trim() ?? '';
  const objectId = url.searchParams.get('objectId')?.trim() ?? '';
  if (!contactId || !objectId) {
    return NextResponse.json({ ok: false, message: 'Укажите contactId и objectId.' }, { status: 400 });
  }

  const result = await loadChannelManagerConnectionContext({ contactId, objectId });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    flowReady: result.flowReady,
    objectTitle: result.objectTitle,
    connection: result.connection,
    contact: result.contact,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const authError = await requireDashboardSession();
  if (authError) return authError;

  const body = await readRequestJson(req);
  if (!body.ok) {
    return NextResponse.json({ ok: false, message: 'Проверьте данные запроса.' }, { status: 400 });
  }

  const raw = body.data as Record<string, unknown>;
  const contactId = String(raw.contactId ?? '').trim();
  const objectId = String(raw.objectId ?? '').trim();
  const action = String(raw.action ?? '').trim() as ChannelManagerConnectionAction;

  if (!contactId || !objectId || !action) {
    return NextResponse.json({ ok: false, message: 'Укажите contactId, objectId и action.' }, { status: 400 });
  }

  const methodRaw = String(raw.method ?? '').trim();
  const accessRaw = String(raw.access ?? '').trim();
  const customName = String(raw.customName ?? '').trim();

  const method = CHANNEL_MANAGER_CONNECTION_METHOD_VALUES.includes(methodRaw as never)
    ? (methodRaw as (typeof CHANNEL_MANAGER_CONNECTION_METHOD_VALUES)[number])
    : undefined;
  const access = CHANNEL_MANAGER_ACCESS_SITUATION_VALUES.includes(accessRaw as never)
    ? (accessRaw as (typeof CHANNEL_MANAGER_ACCESS_SITUATION_VALUES)[number])
    : undefined;

  const result = await handleChannelManagerConnectionAction({
    contactId,
    objectId,
    action,
    method,
    access,
    customName: customName || undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    connection: result.connection,
    contact: result.contact,
  });
}
