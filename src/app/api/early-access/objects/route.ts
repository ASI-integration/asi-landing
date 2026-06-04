import { NextResponse } from 'next/server';
import {
  getPilotObjectSummary,
  normalizePilotObjectInput,
  savePilotObjectIntake,
} from '@/lib/communication/pilot-object-intake';

export const runtime = 'nodejs';

function clientError(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return clientError('Не удалось прочитать данные анкеты.');
  }

  const input = normalizePilotObjectInput(body && typeof body === 'object' ? body : {});
  if (!input.city || !input.objectName || !input.ownerContact) {
    return clientError('Укажите город, название объекта и контакт владельца или управляющего.');
  }

  try {
    const object = await savePilotObjectIntake(input);
    return NextResponse.json({
      ok: true,
      message: 'Анкета сохранена. Данные можно использовать для ответов AI-бота.',
      object,
    });
  } catch (error) {
    console.error('[early-access] object.save_failed', error);
    return clientError('Не удалось сохранить анкету. Попробуйте ещё раз или напишите нам в Telegram.', 500);
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const objectId = new URL(req.url).searchParams.get('objectId') ?? '';
  if (!objectId.trim()) return clientError('Укажите идентификатор объекта.');

  try {
    const object = await getPilotObjectSummary(objectId);
    if (!object) return clientError('Объект не найден.', 404);
    return NextResponse.json({ ok: true, object });
  } catch (error) {
    console.error('[early-access] object.get_failed', error);
    return clientError('Не удалось загрузить объект для проверки.', 500);
  }
}
