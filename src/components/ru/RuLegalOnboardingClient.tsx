'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RuCommercialTimeline } from './RuCommercialTimeline';
import type {
  RuLegalDocument,
  RuLegalDocumentType,
  RuLegalOnboardingState,
} from '@/lib/ru-legal';
import { RU_SETUP_PATH } from '@/lib/rental-connect/model';
import { readResponseJson } from '@/lib/safeResponseJson';

type Props = {
  initialState: RuLegalOnboardingState;
  offer: RuLegalDocument;
  consent: RuLegalDocument;
};

function formatAcceptedAt(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

function LegalDocumentBody({ document }: { document: RuLegalDocument }) {
  return (
    <div className="mt-7 max-h-[46vh] overflow-y-auto border-y border-asi-border py-6 pr-3 text-sm leading-relaxed text-asi-navy/75">
      <p className="font-serif text-2xl text-asi-navy">{document.title}</p>
      <p className="mt-2 font-medium text-asi-navy">{document.subtitle}</p>
      <p className="mt-1 text-asi-navy/60">Редакция {document.version}</p>
      <div className="mt-7 space-y-7">
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-serif text-xl text-asi-navy">{section.heading}</h2>
            <div className="mt-3 space-y-3">
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function RuLegalOnboardingClient({ initialState, offer, consent }: Props) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeDocument = state.accepted.offer ? consent : offer;
  const documentType: RuLegalDocumentType = activeDocument.type;

  const acceptedOfferText = useMemo(() => {
    const acceptedAt = state.accepted.offer?.acceptedAt;
    return acceptedAt ? formatAcceptedAt(acceptedAt) : null;
  }, [state.accepted.offer?.acceptedAt]);

  useEffect(() => {
    if (!state.complete) return;
    const timer = window.setTimeout(() => router.replace(RU_SETUP_PATH), 1800);
    return () => window.clearTimeout(timer);
  }, [router, state.complete]);

  async function accept() {
    if (!checked || busy || !state.isOwner) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/ru/legal/acceptances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType }),
      });
      const data = await readResponseJson(response, {} as { code?: string; state?: RuLegalOnboardingState });
      if (!response.ok || !data.state) {
        setError(
          data.code === 'RU_LEGAL_LOCALIZATION_REVIEW_REQUIRED'
            ? 'Сохранение юридического согласия пока недоступно до завершения проверки размещения данных.'
            : data.code === 'RU_LEGAL_OWNER_REQUIRED'
              ? 'Принять документы может только владелец аккаунта.'
              : 'Не удалось сохранить действие. Попробуйте ещё раз.',
        );
        return;
      }
      setState(data.state);
      setChecked(false);
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  if (state.complete) {
    return (
      <section className="border border-asi-border bg-asi-paper p-6 sm:p-9" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">Юридические документы приняты</p>
        <h1 className="mt-3 font-serif text-3xl sm:text-4xl text-asi-navy">Договор заключён</h1>
        <div className="mt-7"><RuCommercialTimeline compact /></div>
        <p className="mt-6 text-sm text-asi-navy/65">Открываем подключение объекта…</p>
      </section>
    );
  }

  return (
    <section className="border border-asi-border bg-asi-paper p-6 sm:p-9">
      {documentType === 'offer' ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">Шаг 1 из 2</p>
          <h1 className="mt-3 font-serif text-3xl sm:text-4xl text-asi-navy">Договор на подключение ASI</h1>
          <div className="mt-7"><RuCommercialTimeline compact /></div>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-asi-navy/75">
            Без оплаты на старте. Сначала подключаем и настраиваем объект, затем даём 14 дней полноценной работы ASI.
          </p>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">Шаг 2 из 2</p>
          <h1 className="mt-3 font-serif text-3xl sm:text-4xl text-asi-navy">Согласие на обработку персональных данных</h1>
          {acceptedOfferText ? (
            <div className="mt-5 border-l-2 border-asi-gold pl-4 text-sm text-asi-navy/70">
              <p className="font-semibold text-asi-navy">Договор заключён: {acceptedOfferText}</p>
              <p className="mt-1">Редакция: {offer.version}</p>
            </div>
          ) : null}
        </>
      )}

      <LegalDocumentBody document={activeDocument} />

      {documentType === 'personal_data_consent' ? (
        <p className="mt-5 text-sm text-asi-navy/65">
          Подробнее: <Link className="underline underline-offset-2" href="/ru/privacy">Политика конфиденциальности</Link>.
        </p>
      ) : null}

      {!state.isOwner ? (
        <p className="mt-6 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
          Принять документы может только владелец аккаунта. Попросите владельца завершить юридическое подключение.
        </p>
      ) : (
        <label className="mt-6 flex items-start gap-3 text-sm leading-relaxed text-asi-navy">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 h-5 w-5 accent-asi-navy"
          />
          <span>
            {documentType === 'offer'
              ? `Я прочитал и полностью принимаю Договор-оферту ASI редакции ${offer.version}`
              : 'Я даю согласие на обработку персональных данных'}
          </span>
        </label>
      )}

      {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
      <button
        type="button"
        disabled={!checked || busy || !state.isOwner}
        onClick={() => void accept()}
        className="mt-6 inline-flex min-h-12 items-center justify-center bg-asi-navy px-7 py-3.5 text-sm font-semibold tracking-wide text-asi-ivory disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy
          ? 'СОХРАНЯЕМ…'
          : documentType === 'offer'
            ? 'ПРИНЯТЬ ДОГОВОР →'
            : 'ДАТЬ СОГЛАСИЕ И ПРОДОЛЖИТЬ →'}
      </button>
    </section>
  );
}
