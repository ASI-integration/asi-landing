'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CRM_FILTER_LABELS,
  CRM_ROLE_LABELS,
  CRM_STATUS_LABELS,
} from '@/lib/crm/labels';
import type {
  CrmContactViewModel,
  CrmFilter,
  CrmPropertyAutomationSummary,
  CrmRole,
  CrmStatus,
} from '@/lib/crm/types';
import { CRM_ROLES, CRM_STATUSES } from '@/lib/crm/types';

type CrmListResponse = {
  ok: boolean;
  contacts?: CrmContactViewModel[];
  needsReaction?: CrmContactViewModel[];
  propertyOptions?: CrmPropertyAutomationSummary[];
  error?: string;
};

type CrmMutationResponse = {
  ok: boolean;
  contact?: CrmContactViewModel;
  error?: string;
};

type PilotDecision = 'select' | 'waitlist' | 'not_fit';

const FILTERS: CrmFilter[] = [
  'all',
  'new',
  'needs_reaction',
  'pilot_candidates',
  'pilot_selected',
  'testing',
  'pilot_active',
  'escalations',
];

function formatDateRu(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortText(value: string | null | undefined, max = 72): string {
  const text = (value ?? '').trim();
  if (!text) return '—';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

export function CrmDashboardClient() {
  const [contacts, setContacts] = useState<CrmContactViewModel[]>([]);
  const [needsReaction, setNeedsReaction] = useState<CrmContactViewModel[]>([]);
  const [propertyOptions, setPropertyOptions] = useState<CrmPropertyAutomationSummary[]>([]);
  const [filter, setFilter] = useState<CrmFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [editStatus, setEditStatus] = useState<CrmStatus>('new');
  const [editNotes, setEditNotes] = useState('');
  const [editNextAction, setEditNextAction] = useState('');
  const [editPropertyId, setEditPropertyId] = useState('');

  const [createName, setCreateName] = useState('');
  const [createContact, setCreateContact] = useState('');
  const [createRole, setCreateRole] = useState<CrmRole>('lead');
  const [createStatus, setCreateStatus] = useState<CrmStatus>('new');
  const [createNotes, setCreateNotes] = useState('');
  const [createNextAction, setCreateNextAction] = useState('');

  const selected = useMemo(
    () => contacts.find((contact) => contact.id === selectedId) ?? null,
    [contacts, selectedId],
  );

  const load = useCallback(async (activeFilter: CrmFilter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/crm?filter=${activeFilter}`);
      const json = (await res.json()) as CrmListResponse;
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Не удалось загрузить CRM');
        setContacts([]);
        setNeedsReaction([]);
        setPropertyOptions([]);
        return;
      }
      setContacts(json.contacts ?? []);
      setNeedsReaction(json.needsReaction ?? []);
      setPropertyOptions(json.propertyOptions ?? []);
    } catch {
      setError('Ошибка сети при загрузке CRM');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  useEffect(() => {
    if (!selected) return;
    setEditStatus(selected.effectiveStatus);
    setEditNotes(selected.notes);
    setEditNextAction(selected.nextActionIsSuggested ? '' : selected.nextAction);
    setEditPropertyId(selected.propertyId ?? '');
  }, [selected]);

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const propertyChanged = editPropertyId.trim() !== (selected.propertyId ?? '');
      const status = propertyChanged && editPropertyId.trim() && editStatus === selected.status
        ? 'creating_object'
        : editStatus;
      const res = await fetch('/api/dashboard/crm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selected.id,
          status,
          notes: editNotes,
          nextAction: editNextAction,
          propertyId: editPropertyId.trim() || null,
          awaitingReply: false,
        }),
      });
      const json = (await res.json()) as CrmMutationResponse;
      if (!res.ok || !json.ok || !json.contact) {
        setError(json.error ?? 'Не удалось сохранить');
        return;
      }
      setContacts((prev) => prev.map((item) => (item.id === json.contact!.id ? json.contact! : item)));
      await load(filter);
    } catch {
      setError('Ошибка сети при сохранении');
    } finally {
      setSaving(false);
    }
  }

  async function handlePilotDecision(decision: PilotDecision) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/crm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selected.id,
          pilotDecision: decision,
        }),
      });
      const json = (await res.json()) as CrmMutationResponse;
      if (!res.ok || !json.ok || !json.contact) {
        setError(json.error ?? 'Не удалось обновить решение по пилоту');
        return;
      }
      setSelectedId(json.contact.id);
      await load(filter);
    } catch {
      setError('Ошибка сети при обновлении решения по пилоту');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          contact: createContact.trim() || null,
          role: createRole,
          status: createStatus,
          notes: createNotes.trim(),
          nextAction: createNextAction.trim(),
        }),
      });
      const json = (await res.json()) as CrmMutationResponse;
      if (!res.ok || !json.ok || !json.contact) {
        setError(json.error ?? 'Не удалось создать запись');
        return;
      }
      setShowCreate(false);
      setCreateName('');
      setCreateContact('');
      setCreateNotes('');
      setCreateNextAction('');
      setSelectedId(json.contact.id);
      await load(filter);
    } catch {
      setError('Ошибка сети при создании');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">CRM</h1>
          <p className="mt-2 text-lg text-slate-500 leading-relaxed">
            Лиды, владельцы, тестовые гости, объекты, эскалации и следующие шаги.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((value) => !value)}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showCreate ? 'Скрыть форму' : 'Новая запись'}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Создать запись вручную</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-600">Имя</span>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Контакт</span>
              <input
                value={createContact}
                onChange={(e) => setCreateContact(e.target.value)}
                placeholder="Telegram, email или телефон"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Роль</span>
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as CrmRole)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {CRM_ROLES.map((role) => (
                  <option key={role} value={role}>{CRM_ROLE_LABELS[role]}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Статус</span>
              <select
                value={createStatus}
                onChange={(e) => setCreateStatus(e.target.value as CrmStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {CRM_STATUSES.map((status) => (
                  <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">Заметка</span>
            <textarea
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Следующий шаг</span>
            <input
              value={createNextAction}
              onChange={(e) => setCreateNextAction(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {creating ? 'Создаём…' : 'Создать'}
          </button>
        </form>
      )}

      {needsReaction.length > 0 && filter !== 'needs_reaction' && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-base font-semibold text-amber-900">Нужна реакция ({needsReaction.length})</h2>
          <ul className="mt-3 space-y-2">
            {needsReaction.slice(0, 5).map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center gap-2 text-sm text-amber-950">
                <button
                  type="button"
                  onClick={() => setSelectedId(contact.id)}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {contact.name}
                </button>
                <span className="text-amber-800">{contact.needsReactionReasons.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              filter === item
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {CRM_FILTER_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {loading ? (
            <p className="p-6 text-slate-500">Загрузка…</p>
          ) : contacts.length === 0 ? (
            <p className="p-6 text-slate-500">Записей пока нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Имя</th>
                    <th className="px-4 py-3 font-medium">Роль</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Объект</th>
                    <th className="px-4 py-3 font-medium">Последнее</th>
                    <th className="px-4 py-3 font-medium">Эск.</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      onClick={() => setSelectedId(contact.id)}
                      className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${
                        selectedId === contact.id ? 'bg-slate-100' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{contact.name}</div>
                        <div className="text-xs text-slate-500">
                          {contact.telegramDisplay ?? contact.contact ?? contact.sourceLabel}
                        </div>
                      </td>
                      <td className="px-4 py-3">{contact.roleLabel}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                          contact.needsReaction ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {contact.effectiveStatusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {contact.propertySummary?.title ?? (contact.propertyId ? shortText(contact.propertyId, 16) : '—')}
                        {contact.propertyCount != null ? ` (${contact.propertyCount})` : ''}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{shortText(contact.lastMessage, 48)}</div>
                        <div className="text-xs text-slate-400">{formatDateRu(contact.lastActivityAt)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{contact.unresolvedEscalationCount || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          {!selected ? (
            <p className="text-slate-500">Выберите запись в списке слева.</p>
          ) : (
            <>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{selected.name}</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {selected.roleLabel} · {selected.sourceLabel}
                  {selected.telegramDisplay ? ` · ${selected.telegramDisplay}` : ''}
                </p>
                {selected.telegramChatId && (
                  <p className="text-xs text-slate-400 mt-1">Telegram chat: {selected.telegramChatId}</p>
                )}
              </div>

              {selected.needsReaction && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                  {selected.needsReactionReasons.join(' · ')}
                </div>
              )}

              {selected.pilotApplication && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">
                  <h3 className="font-semibold">Заявка в пилот</h3>
                  <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-emerald-800">Город</dt>
                      <dd className="font-medium">{selected.pilotApplication.city || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-emerald-800">Объектов</dt>
                      <dd className="font-medium">{selected.pilotApplication.propertyCount ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-emerald-800">Менеджер каналов</dt>
                      <dd className="font-medium">{selected.pilotApplication.channelManager || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-emerald-800">Реальные брони</dt>
                      <dd className="font-medium">{selected.pilotApplication.hasActiveBookings || '—'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-emerald-800">Площадки</dt>
                      <dd className="font-medium">
                        {selected.pilotApplication.platforms.length > 0
                          ? selected.pilotApplication.platforms.join(', ')
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-emerald-800">Хочет тестировать</dt>
                      <dd className="font-medium">{selected.pilotApplication.testFocus || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-emerald-800">Обратная связь</dt>
                      <dd className="font-medium">{selected.pilotApplication.feedbackReady || '—'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-emerald-800">Предложенный следующий шаг</dt>
                      <dd className="font-medium">
                        {selected.pilotApplication.suggestedNextAction || selected.nextAction}
                      </dd>
                    </div>
                  </dl>
                  {selected.status === 'pilot_candidate' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handlePilotDecision('select')}
                        disabled={saving}
                        className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                      >
                        Выбрать в пилот
                      </button>
                      <button
                        type="button"
                        onClick={() => void handlePilotDecision('waitlist')}
                        disabled={saving}
                        className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        В лист ожидания
                      </button>
                      <button
                        type="button"
                        onClick={() => void handlePilotDecision('not_fit')}
                        disabled={saving}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Не подходит сейчас
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!selected.pilotApplication && selected.status === 'pilot_candidate' && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">
                  <h3 className="font-semibold">Решение по пилоту</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePilotDecision('select')}
                      disabled={saving}
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      Выбрать в пилот
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePilotDecision('waitlist')}
                      disabled={saving}
                      className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                    >
                      В лист ожидания
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePilotDecision('not_fit')}
                      disabled={saving}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Не подходит сейчас
                    </button>
                  </div>
                </div>
              )}

              {selected.status === 'pilot_selected' && !selected.propertyId && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-950">
                  <h3 className="font-semibold">Следующий шаг: создать объект</h3>
                  <p className="mt-1">Создайте первый объект и заполните базовые данные.</p>
                  <Link
                    href={`/dashboard/properties?crmContactId=${encodeURIComponent(selected.id)}`}
                    className="mt-2 inline-flex text-blue-700 hover:underline"
                  >
                    Перейти к объектам
                  </Link>
                </div>
              )}

              <div className="grid gap-3">
                <label className="block text-sm">
                  <span className="text-slate-600">Статус</span>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as CrmStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    {CRM_STATUSES.map((status) => (
                      <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Заметки</span>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Следующий шаг</span>
                  <input
                    value={editNextAction}
                    onChange={(e) => setEditNextAction(e.target.value)}
                    placeholder={selected.nextActionIsSuggested ? selected.nextAction : undefined}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                  {selected.nextActionIsSuggested && (
                    <p className="mt-1 text-xs text-slate-500">
                      ASI предлагает: {selected.nextAction}
                      {selected.nextActionHref ? (
                        <>
                          {' · '}
                          <Link href={selected.nextActionHref} className="text-blue-700 hover:underline">
                            Открыть шаг
                          </Link>
                        </>
                      ) : null}
                    </p>
                  )}
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Связанный объект</span>
                  <select
                    value={editPropertyId}
                    onChange={(e) => setEditPropertyId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">Не выбран</option>
                    {selected.propertyId && !propertyOptions.some((property) => property.id === selected.propertyId) ? (
                      <option value={selected.propertyId}>{selected.propertyId}</option>
                    ) : null}
                    {propertyOptions.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.title} · {property.readinessCompleted}/{property.readinessTotal}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selected.propertySummary && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{selected.propertySummary.title}</p>
                      <p className="mt-0.5 text-slate-600">{selected.propertySummary.location}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-slate-700">
                      {selected.propertySummary.readinessCompleted}/{selected.propertySummary.readinessTotal}
                    </span>
                  </div>
                  {selected.propertySummary.missingOperationalItems.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-slate-700">
                      {selected.propertySummary.missingOperationalItems.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-2">
                          <span>{item.label}</span>
                          <Link href={item.actionHref} className="text-blue-700 hover:underline">
                            {item.actionLabel}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-3 space-y-2 text-emerald-800">
                      <p>Паспорт объекта готов для автопилота.</p>
                      <p className="font-medium text-slate-900">
                        Следующий шаг: запустить guest_test
                      </p>
                      <code className="block rounded-md bg-white px-3 py-2 text-slate-800">
                        /guest_test {selected.propertySummary.id}
                      </code>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 text-sm">
                {selected.propertyId && (
                  <>
                    <Link
                      href={selected.propertySummary?.setupHref ?? `/dashboard/properties/${selected.propertyId}/setup`}
                      className="text-blue-700 hover:underline"
                    >
                      Настройка объекта
                    </Link>
                    <Link
                      href={selected.propertySummary?.channelManagerHref ?? `/dashboard/channel-manager?property=${selected.propertyId}`}
                      className="text-blue-700 hover:underline"
                    >
                      Channel Manager
                    </Link>
                    {selected.propertySummary?.guestTestHref && (
                      <Link
                        href={selected.propertySummary.guestTestHref}
                        className="text-blue-700 hover:underline"
                      >
                        Тест гостя
                      </Link>
                    )}
                  </>
                )}
                {selected.leadId && (
                  <Link href="/dashboard/leads" className="text-blue-700 hover:underline">
                    Заявка в лидах
                  </Link>
                )}
              </div>

              {selected.missingDataFields.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  <p className="font-medium">ASI не смогла ответить — не хватает данных:</p>
                  <ul className="mt-1 space-y-1">
                    {selected.missingDataActions.map((action) => (
                      <li key={`${action.setupStep}:${action.label}`} className="flex items-center justify-between gap-2">
                        <span>{action.label}</span>
                        {action.setupHref ? (
                          <Link href={action.setupHref} className="text-blue-700 hover:underline">
                            Открыть setup
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-slate-800">Последние события</h3>
                {selected.recentEvents.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">Событий пока нет.</p>
                ) : (
                  <ul className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                    {selected.recentEvents.map((event) => (
                      <li key={event.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-slate-800">{event.label}</span>
                          <span className="text-xs text-slate-400 shrink-0">{formatDateRu(event.createdAt)}</span>
                        </div>
                        {event.messageText && (
                          <p className="mt-1 text-slate-600">{shortText(event.messageText, 120)}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
