import { NextResponse } from 'next/server';
import {
  buildPilotApplicationTelegramLink,
  buildPilotCabinetConnectHref,
} from '@/lib/crm/pilot-onboarding';
import {
  normalizePilotApplication,
  upsertPilotApplication,
} from '@/lib/crm/pilot-intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError('Не удалось прочитать заявку. Проверьте форму и попробуйте ещё раз.', 400);
  }

  const application = normalizePilotApplication(body);
  if (!application.name) return jsonError('Укажите имя.', 400);
  if (!application.city) return jsonError('Укажите город.', 400);
  if (application.platforms.length === 0) return jsonError('Выберите хотя бы одну площадку.', 400);

  try {
    const contact = await upsertPilotApplication(application);
    return NextResponse.json({
      ok: true,
      contactId: contact.id,
      nextAction: contact.nextAction,
      telegramLink: buildPilotApplicationTelegramLink(contact.id),
      cabinetHref: buildPilotCabinetConnectHref(contact.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[pilot-intake] submit failed', { error: message });
    return jsonError('Не удалось сохранить заявку. Попробуйте ещё раз или напишите в Telegram.', 500);
  }
}
