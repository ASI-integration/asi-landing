'use client';

import { useCallback, useEffect, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import { labelMissingField, ownerSetupStatusLabel } from '@/lib/booking-ops/owner-object-setup-display';
import type { OwnerSetupStatus } from '@/lib/booking-ops/owner-object-setup-display';

type OwnerSetupSummary = {
  id: string;
  status: OwnerSetupStatus;
  readinessScore: number;
  missingFields: string[];
  publicSetupUrl: string | null;
  pilotGroup: string | null;
};

type PropertySetupSummary = {
  id: string;
  status: string;
  title: string | null;
  readinessScore: number;
  missingFields: string[];
  photosStatus: string;
  rulesStatus: string;
  pricingStatus: string;
  wifiStatus: string;
  channelAccessStatus: string;
  channelHandoffStatus: string | null;
};

type SetupApiResponse = {
  ok: boolean;
  message?: string;
  ownerSetup?: OwnerSetupSummary | null;
  propertySetups?: PropertySetupSummary[];
  blockers?: { nextAction: string | null; blockers: string[] } | null;
  nextAction?: string | null;
};

type Props = {
  leadId: string;
};

export function CrmOwnerSetupPanel({ leadId }: Props) {
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<SetupApiResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/leads/${encodeURIComponent(leadId)}/owner-setup`, {
        credentials: 'include',
      });
      const payload = await readResponseJson<SetupApiResponse>(res, { ok: false });
      setData(payload);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(
    action: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    setActing(true);
    setMessage(null);
    try {
      const ownerSetupId = data?.ownerSetup?.id;
      const propertySetupId = data?.propertySetups?.[0]?.id;
      const res = await fetch('/api/dashboard/property-setup/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ownerSetupId, propertySetupId, ...extra }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(res, { ok: false });
      if (!payload.ok) {
        setMessage(payload.message ?? 'Не удалось выполнить действие.');
        return;
      }
      setMessage('Готово.');
      await load();
    } catch {
      setMessage('Ошибка сети.');
    } finally {
      setActing(false);
    }
  }

  async function initialize(): Promise<void> {
    setActing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/dashboard/leads/${encodeURIComponent(leadId)}/owner-setup/initialize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(res, { ok: false });
      if (!payload.ok) {
        setMessage(payload.message ?? 'Не удалось инициализировать.');
        return;
      }
      setMessage('Настройка владельца создана.');
      await load();
    } finally {
      setActing(false);
    }
  }

  const owner = data?.ownerSetup ?? null;
  const property = data?.propertySetups?.[0] ?? null;
  const nextAction = data?.nextAction ?? data?.blockers?.nextAction ?? null;

  return (
    <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-800">
          Настройка объекта (автопилот)
        </span>
        <button
          type="button"
          className="text-xs text-indigo-700 underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Свернуть' : 'Подробнее'}
        </button>
      </div>

      {loading ? (
        <div className="mt-2 text-xs text-slate-500">Загрузка статуса…</div>
      ) : !owner ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600">Профиль настройки не создан.</span>
          <button
            type="button"
            disabled={acting}
            onClick={() => void initialize()}
            className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-medium text-indigo-800 disabled:opacity-50"
          >
            Инициализировать
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white px-2 py-0.5 text-indigo-900">
              {ownerSetupStatusLabel(owner.status)}
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-slate-700">
              Готовность: {owner.readinessScore}%
            </span>
            {owner.pilotGroup ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-slate-600">
                {owner.pilotGroup}
              </span>
            ) : null}
          </div>
          {owner.missingFields.length > 0 ? (
            <div className="text-xs text-amber-800">
              Не хватает: {owner.missingFields.map(labelMissingField).join(', ')}
            </div>
          ) : null}
          {nextAction ? (
            <div className="text-xs font-medium text-indigo-900">Следующий шаг: {nextAction}</div>
          ) : null}
          {owner.publicSetupUrl ? (
            <div className="text-xs text-slate-600">Ссылка для владельца создана (токен).</div>
          ) : null}

          {expanded && property ? (
            <div className="rounded border border-white bg-white/80 p-2 text-xs text-slate-700">
              <div className="font-medium">{property.title ?? 'Объект без названия'}</div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <span>Фото: {property.photosStatus}</span>
                <span>Правила: {property.rulesStatus}</span>
                <span>Цена: {property.pricingStatus}</span>
                <span>Wi-Fi: {property.wifiStatus}</span>
                <span>Доступ МК: {property.channelAccessStatus}</span>
                <span>Handoff: {property.channelHandoffStatus ?? '—'}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1">
            {!property ? (
              <button
                type="button"
                disabled={acting}
                onClick={() => void runAction('start_data_collection')}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
              >
                Начать сбор
              </button>
            ) : null}
            <button
              type="button"
              disabled={acting || !property}
              onClick={() => void runAction('request_missing_data')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
            >
              Запросить данные
            </button>
            <button
              type="button"
              disabled={acting || !property}
              onClick={() => void runAction('request_photos')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
            >
              Запросить фото
            </button>
            <button
              type="button"
              disabled={acting || !property}
              onClick={() => void runAction('request_channel_access')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
            >
              Запросить доступ МК
            </button>
            <button
              type="button"
              disabled={acting || !property}
              onClick={() => void runAction('mark_channel_access_received', { safeAccessRef: 'operator_confirmed' })}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
            >
              Доступ получен
            </button>
            <button
              type="button"
              disabled={acting || !property}
              onClick={() => void runAction('mark_test_object_selected')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
            >
              Тестовый объект
            </button>
          </div>
        </div>
      )}

      {message ? <div className="mt-2 text-xs text-slate-600">{message}</div> : null}
    </div>
  );
}
