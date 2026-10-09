import { NextResponse } from 'next/server';
import { readBoundedRequestJson } from '@/lib/safeRequestJson';
import { createCrmContact } from '@/lib/crm/repository';
import { normalizePublicPilotLead } from '@/lib/early-access/public-pilot-lead';
import { processPublicPilotLead } from '@/lib/early-access/public-lead-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PUBLIC_LEAD_BODY_BYTES = 4096;

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await readBoundedRequestJson(req, MAX_PUBLIC_LEAD_BODY_BYTES);
  if (!parsed.ok && parsed.reason === 'too_large') {
    return NextResponse.json({ ok: false, message: 'Слишком большая заявка.' }, { status: 413 });
  }
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: 'Проверьте форму заявки.' }, { status: 400 });
  }
  const normalized = normalizePublicPilotLead(parsed.data);
  if (!normalized.ok) {
    return NextResponse.json({ ok: false, message: normalized.message }, { status: 400 });
  }
  try {
    const result = await processPublicPilotLead(normalized.input, async () => {
      // A successful response requires a persisted, operator-visible CRM record.
      const lead = await createCrmContact(normalized.input);
      if (!lead.id) throw new Error('CRM write did not return a lead id');
    });
    if (!result.allowed) {
      return NextResponse.json({ ok: false, message: 'Слишком много заявок. Попробуйте позже.' }, {
        status: 429,
        headers: { 'Retry-After': String(result.retryAfterSeconds) },
      });
    }
    // Never expose the internal CRM identifier through the anonymous endpoint.
    return NextResponse.json({ ok: true }, { status: result.replayed ? 200 : 201 });
  } catch {
    // Do not disclose DB/contacts; avoid falsely claiming that a lead was recorded.
    return NextResponse.json({
      ok: false, message: 'Заявку пока не удалось сохранить. Попробуйте позже или напишите в поддержку.',
    }, { status: 503 });
  }
}
