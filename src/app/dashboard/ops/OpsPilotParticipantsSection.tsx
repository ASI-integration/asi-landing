'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { OpsPilotOperatorAction, OpsPilotParticipant } from '@/lib/ops-pilot/types';

type PilotParticipantsResponse = {
  ok: boolean;
  message?: string;
  participants: OpsPilotParticipant[];
  refreshedAt?: string;
};

type ActionResponse = {
  ok: boolean;
  message?: string;
  participant?: OpsPilotParticipant;
};

function contactLine(participant: OpsPilotParticipant): string {
  const parts: string[] = [];
  if (participant.phone.trim()) parts.push(participant.phone.trim());
  if (participant.telegramUsername.trim()) parts.push(`@${participant.telegramUsername.replace(/^@/, '')}`);
  return parts.length > 0 ? parts.join(' · ') : 'контакт не указан';
}

const STAGE_TONE: Record<OpsPilotParticipant['stage'], string> = {
  needs_manual_control: 'border-rose-200 bg-rose-50 text-rose-900',
  ops_task_created: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  ready_for_cm_check: 'border-sky-200 bg-sky-50 text-sky-900',
  cm_preparing: 'border-violet-200 bg-violet-50 text-violet-900',
  object_filling: 'border-amber-200 bg-amber-50 text-amber-900',
  object_created: 'border-slate-200 bg-slate-50 text-slate-800',
  access_received: 'border-slate-200 bg-slate-50 text-slate-800',
  new_lead: 'border-slate-200 bg-slate-50 text-slate-700',
  ready_for_next_step: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

function ParticipantCard({
  participant,
  onAction,
  acting,
}: {
  participant: OpsPilotParticipant;
  onAction: (contactId: string, action: OpsPilotOperatorAction, note?: string) => Promise<void>;
  acting: string | null;
}) {
  const [note, setNote] = useState(participant.operatorNote);
  const isActing = acting === participant.contactId;

  useEffect(() => {
    setNote(participant.operatorNote);
  }, [participant.operatorNote]);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-slate-950">{participant.name}</h3>
          <p className="text-sm text-slate-600">{contactLine(participant)}</p>
          {participant.objectTitle ? (
            <p className="text-sm text-slate-500">{participant.objectTitle}</p>
          ) : null}
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${STAGE_TONE[participant.stage]}`}
        >
          {participant.stageLabelRu}
        </span>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <p>
          <span className="text-slate-500">Следующий шаг: </span>
          <span className="font-medium text-slate-900">{participant.nextActionRu}</span>
        </p>
        {participant.needsManualHelp ? (
          <p className="font-medium text-rose-800">Требуется внимание оператора</p>
        ) : null}
      </div>

      {participant.blockers.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-rose-800">
          {participant.blockers.map((blocker) => (
            <li key={blocker.key}>• {blocker.labelRu}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <Link href={participant.links.crmHref} className="rounded-md border border-slate-200 px-2 py-1 text-blue-700 hover:bg-slate-50">
          CRM
        </Link>
        {participant.links.objectHref ? (
          <Link href={participant.links.objectHref} className="rounded-md border border-slate-200 px-2 py-1 text-blue-700 hover:bg-slate-50">
            Объект
          </Link>
        ) : null}
        {participant.links.channelManagerHref ? (
          <Link
            href={participant.links.channelManagerHref}
            className="rounded-md border border-slate-200 px-2 py-1 text-blue-700 hover:bg-slate-50"
          >
            Менеджер каналов
          </Link>
        ) : null}
        {participant.links.opsTaskHref ? (
          <Link href={participant.links.opsTaskHref} className="rounded-md border border-slate-200 px-2 py-1 text-blue-700 hover:bg-slate-50">
            OPS-задача
          </Link>
        ) : null}
      </div>

      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isActing}
            onClick={() => void onAction(participant.contactId, 'mark_manual_control')}
            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
          >
            Нужен ручной контроль
          </button>
          <button
            type="button"
            disabled={isActing}
            onClick={() => void onAction(participant.contactId, 'mark_waiting_owner')}
            className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            Ожидаем владельца
          </button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Короткая заметка для оператора"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={isActing || !note.trim()}
            onClick={() => void onAction(participant.contactId, 'add_note', note)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Сохранить заметку
          </button>
        </div>
      </div>
    </article>
  );
}

export default function OpsPilotParticipantsSection() {
  const [participants, setParticipants] = useState<OpsPilotParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const loadParticipants = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/ops/pilot-participants', { credentials: 'include' });
      const payload = await readResponseJson<PilotParticipantsResponse>(res, {
        ok: false,
        participants: [],
      });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить пилотных участников.');
        return;
      }
      setParticipants(payload.participants);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

  const runAction = useCallback(
    async (contactId: string, action: OpsPilotOperatorAction, note?: string) => {
      setActingId(contactId);
      setMessage('');
      try {
        const res = await fetch('/api/ops/pilot-participants', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId, action, note }),
        });
        const payload = await readResponseJson<ActionResponse>(res, { ok: false });
        if (!res.ok || !payload.ok || !payload.participant) {
          setMessage(payload.message || 'Не удалось выполнить действие.');
          return;
        }
        setParticipants((current) =>
          current.map((item) => (item.contactId === contactId ? payload.participant! : item)),
        );
      } finally {
        setActingId(null);
      }
    },
    [],
  );

  const needsAttentionCount = participants.filter((item) => item.needsManualHelp).length;

  if (!loading && participants.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Участники пилота</h2>
          <p className="text-sm text-slate-500">
            {needsAttentionCount > 0
              ? `Нужна помощь: ${needsAttentionCount} из ${participants.length}`
              : `Активных участников: ${participants.length}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadParticipants()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Обновить
        </button>
      </div>

      {message ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{message}</div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[16vh] items-center justify-center p-6">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
        </div>
      ) : participants.length === 0 ? null : (
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          {participants.map((participant) => (
            <ParticipantCard
              key={participant.contactId}
              participant={participant}
              onAction={runAction}
              acting={actingId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
