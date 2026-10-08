import { NextResponse } from 'next/server';
import { readRequestJson } from '@/lib/safeRequestJson';
import { createCrmContact } from '@/lib/crm/repository';
import { normalizePublicPilotLead } from '@/lib/early-access/public-pilot-lead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  // Reject extremely large anonymous submissions before parsing (not a substitute for edge rate limiting).
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return NextResponse.json({ ok: false, message: 'Слишком большая заявка.' }, { status: 413 });
  }
  const parsed = await readRequestJson(req);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: 'Проверьте форму заявки.' }, { status: 400 });
  }
  const normalized = normalizePublicPilotLead(parsed.data);
  if (!normalized.ok) {
    return NextResponse.json({ ok: false, message: normalized.message }, { status: 400 });
  }
  try {
    // A successful response requires a persisted, operator-visible CRM record.
    const lead = await createCrmContact(normalized.input);
    if (!lead.id) throw new Error('CRM write did not return a lead id');
    return NextResponse.json({ ok: true, leadId: lead.id }, { status: 201 });
  } catch {
    // Do not disclose DB/contacts; avoid falsely claiming that a lead was recorded.
    return NextResponse.json({
      ok: false, message: 'Заявку пока не удалось сохранить. Попробуйте позже или напишите в поддержку.',
    }, { status: 503 });
  }
}
