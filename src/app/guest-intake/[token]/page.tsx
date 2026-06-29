'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { readResponseJson } from '@/lib/safeResponseJson';

type IntakePayload = {
  ok: boolean;
  message?: string;
  intake?: {
    status: string;
    missingFields: string[];
    validationErrors: string[];
    fieldLabels: Record<string, string>;
    propertyLabel: string;
    fallbackReason: string | null;
  };
};

type FormDraft = {
  guestName: string;
  phone: string;
  email: string;
  telegram: string;
  arrivalDetails: string;
  documentRefs: string;
  companionGuestDataPresent: boolean;
  contractConfirmed: boolean;
  depositConfirmed: boolean;
  mvdDataPresent: boolean;
  guestCannotProceed: boolean;
  fallbackReason: string;
};

const initialDraft: FormDraft = {
  guestName: '',
  phone: '',
  email: '',
  telegram: '',
  arrivalDetails: '',
  documentRefs: '',
  companionGuestDataPresent: false,
  contractConfirmed: false,
  depositConfirmed: false,
  mvdDataPresent: false,
  guestCannotProceed: false,
  fallbackReason: '',
};

function splitRefs(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function GuestIntakePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [payload, setPayload] = useState<IntakePayload>({ ok: false });
  const [draft, setDraft] = useState<FormDraft>(initialDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/guest-intake/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await readResponseJson<IntakePayload>(res, { ok: false });
        if (!cancelled) setPayload(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const missing = useMemo(
    () => new Set(payload.intake?.missingFields ?? []),
    [payload.intake?.missingFields],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const body = {
        guestName: missing.has('guest_name') ? draft.guestName : undefined,
        phone: missing.has('guest_phone') || missing.has('guest_contact') ? draft.phone : undefined,
        email: missing.has('guest_email') || missing.has('guest_contact') ? draft.email : undefined,
        telegram: missing.has('guest_contact') ? draft.telegram : undefined,
        arrivalDetails: missing.has('arrival_details') ? draft.arrivalDetails : undefined,
        documentAttachmentRefs: missing.has('documents') ? splitRefs(draft.documentRefs) : undefined,
        companionGuestDataPresent: missing.has('companion_guest_data')
          ? draft.companionGuestDataPresent
          : undefined,
        contractConfirmed: missing.has('contract_confirmation')
          ? draft.contractConfirmed
          : undefined,
        depositConfirmed: missing.has('deposit_confirmation')
          ? draft.depositConfirmed
          : undefined,
        mvdDataPresent: missing.has('mvd_data') ? draft.mvdDataPresent : undefined,
        guestCannotProceed: draft.guestCannotProceed,
        fallbackReason: draft.guestCannotProceed ? draft.fallbackReason : undefined,
      };
      const res = await fetch(`/api/guest-intake/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readResponseJson<IntakePayload>(res, { ok: false });
      setPayload(data);
      setMessage(data.message || (data.ok ? 'Данные сохранены.' : 'Не удалось сохранить данные.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">Загрузка формы…</p>
        </section>
      </main>
    );
  }

  if (!payload.ok || !payload.intake) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold">Форма не найдена</h1>
          <p className="mt-2 text-sm text-slate-600">Попросите оператора прислать новую ссылку.</p>
        </section>
      </main>
    );
  }

  const complete = payload.intake.status === 'completed';
  const fallback = payload.intake.status === 'fallback_required';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">Данные для заезда</h1>
        <p className="mt-2 text-sm text-slate-600">
          Объект: {payload.intake.propertyLabel}. Заполните только недостающие данные.
        </p>

        {message ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {message}
          </p>
        ) : null}

        {complete ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Спасибо, обязательные данные получены.
          </p>
        ) : fallback ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Оператор поможет завершить подготовку.
          </p>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(event) => void onSubmit(event)}>
            {missing.has('guest_name') ? (
              <TextField label="Имя гостя" value={draft.guestName} onChange={(guestName) => setDraft({ ...draft, guestName })} />
            ) : null}
            {missing.has('guest_phone') || missing.has('guest_contact') ? (
              <TextField label="Телефон" value={draft.phone} onChange={(phone) => setDraft({ ...draft, phone })} />
            ) : null}
            {missing.has('guest_email') || missing.has('guest_contact') ? (
              <TextField label="E-mail" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} />
            ) : null}
            {missing.has('guest_contact') ? (
              <TextField label="Telegram" value={draft.telegram} onChange={(telegram) => setDraft({ ...draft, telegram })} />
            ) : null}
            {missing.has('arrival_details') ? (
              <TextField label="Время заезда" value={draft.arrivalDetails} onChange={(arrivalDetails) => setDraft({ ...draft, arrivalDetails })} />
            ) : null}
            {missing.has('documents') ? (
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Ссылки или номера файлов документов</span>
                <textarea
                  value={draft.documentRefs}
                  onChange={(event) => setDraft({ ...draft, documentRefs: event.target.value })}
                  className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            ) : null}
            {missing.has('companion_guest_data') ? (
              <CheckField label="Данные второго гостя готовы" checked={draft.companionGuestDataPresent} onChange={(companionGuestDataPresent) => setDraft({ ...draft, companionGuestDataPresent })} />
            ) : null}
            {missing.has('contract_confirmation') ? (
              <CheckField label="Договор подтверждён" checked={draft.contractConfirmed} onChange={(contractConfirmed) => setDraft({ ...draft, contractConfirmed })} />
            ) : null}
            {missing.has('deposit_confirmation') ? (
              <CheckField label="Депозит подтверждён" checked={draft.depositConfirmed} onChange={(depositConfirmed) => setDraft({ ...draft, depositConfirmed })} />
            ) : null}
            {missing.has('mvd_data') ? (
              <CheckField label="Данные МВД готовы" checked={draft.mvdDataPresent} onChange={(mvdDataPresent) => setDraft({ ...draft, mvdDataPresent })} />
            ) : null}

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <CheckField label="Не получается заполнить форму" checked={draft.guestCannotProceed} onChange={(guestCannotProceed) => setDraft({ ...draft, guestCannotProceed })} />
              {draft.guestCannotProceed ? (
                <TextField label="Что не получается" value={draft.fallbackReason} onChange={(fallbackReason) => setDraft({ ...draft, fallbackReason })} />
              ) : null}
            </div>

            {payload.intake.validationErrors.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {payload.intake.validationErrors.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? 'Сохранение…' : 'Отправить данные'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300"
      />
      <span>{label}</span>
    </label>
  );
}
