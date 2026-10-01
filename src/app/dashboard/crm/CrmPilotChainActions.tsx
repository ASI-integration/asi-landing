'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CrmContact } from '@/lib/crm/types';
import { extractLinkedObjectId } from '@/lib/pilot-chain/note-blocks';
import { resolvePilotChainNextActions } from '@/lib/pilot-chain/next-actions';

type Props = {
  contact: CrmContact;
};

type CommercialPilotState = {
  status: string;
  timestamps: {
    readyAt: string | null;
    pilotStartedAt: string | null;
    pilotEndsAt: string | null;
  };
};

export function CrmPilotChainActions({ contact }: Props) {
  const actions = resolvePilotChainNextActions(contact);
  const propertyId = extractLinkedObjectId(contact);
  const [pilotState, setPilotState] = useState<CommercialPilotState | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [pilotMessage, setPilotMessage] = useState('');
  const [pilotBusy, setPilotBusy] = useState(false);

  const loadPilot = useCallback(async () => {
    if (!propertyId) return;
    try {
      const res = await fetch(`/api/dashboard/ru-commercial-pilot?propertyId=${encodeURIComponent(propertyId)}`, { credentials: 'include', cache: 'no-store' });
      const payload = await res.json();
      if (res.ok && payload.ok) {
        setPilotState(payload.state ?? null);
        setCanManage(payload.canManage === true);
      }
    } catch {
      // The commercial lifecycle panel is supplemental to the existing CRM actions.
    }
  }, [propertyId]);

  useEffect(() => { void loadPilot(); }, [loadPilot]);

  async function runPilotAction(action: 'derive_ready' | 'start_pilot') {
    if (!propertyId) return;
    setPilotBusy(true); setPilotMessage('');
    try {
      const res = await fetch('/api/dashboard/ru-commercial-pilot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, propertyId }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) {
        setPilotMessage(payload.code === 'RU_LEGAL_ACCEPTANCE_REQUIRED'
          ? 'Сначала владелец должен принять актуальные условия.'
          : payload.reason === 'readiness_not_satisfied'
            ? 'Объект ещё не прошёл все рабочие проверки.'
            : 'Действие пока недоступно.');
        return;
      }
      setPilotState(payload.state ?? null);
      setPilotMessage(action === 'start_pilot' ? '14-дневный пилот запущен.' : 'Готовность пересчитана.');
    } finally {
      setPilotBusy(false);
    }
  }

  if (actions.length === 0 && !propertyId) return null;

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
      {actions.length ? <>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Следующий шаг пилота</div>
        <ul className="mt-2 space-y-1.5">
          {actions.map((action) => (
            <li key={action.key} className="flex flex-wrap items-center gap-2">
              {action.done ? (
                <span className="text-emerald-700">✓ {action.labelRu}</span>
              ) : action.href ? (
                <Link href={action.href} className="font-semibold text-blue-700 hover:text-blue-900">
                  {action.labelRu}
                </Link>
              ) : (
                <span className="text-slate-700">{action.labelRu}</span>
              )}
            </li>
          ))}
        </ul>
      </> : null}

      {propertyId ? <div className={actions.length ? 'mt-3 border-t border-slate-100 pt-3' : ''}>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Коммерческий пилот</div>
        <p className="mt-1 text-xs text-slate-700">
          {pilotState?.status === 'pilot_active'
            ? '14-дневный период идёт.'
            : pilotState?.status === 'ready'
              ? 'Рабочая готовность подтверждена. Можно запускать 14 дней.'
              : pilotState?.status === 'setup'
                ? 'Объект на настройке. Пересчитайте готовность после проверки.'
                : pilotState?.status
                  ? `Статус: ${pilotState.status}`
                  : 'Коммерческий цикл ещё не подтверждён.'}
        </p>
        {pilotState?.timestamps.pilotEndsAt ? <p className="mt-1 text-xs text-slate-500">Окончание: {new Date(pilotState.timestamps.pilotEndsAt).toLocaleDateString('ru-RU')}</p> : null}
        {canManage && pilotState?.status === 'setup' ? <button type="button" disabled={pilotBusy} onClick={() => void runPilotAction('derive_ready')} className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">Проверить готовность</button> : null}
        {canManage && pilotState?.status === 'ready' ? <button type="button" disabled={pilotBusy} onClick={() => void runPilotAction('start_pilot')} className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900 disabled:opacity-50">Запустить 14 дней</button> : null}
        {pilotMessage ? <p className="mt-2 text-xs text-slate-600">{pilotMessage}</p> : null}
      </div> : null}
    </div>
  );
}
