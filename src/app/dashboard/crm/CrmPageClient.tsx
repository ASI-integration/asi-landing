'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CRM_COMMUNICATION_STATUS_LABELS,
  CRM_COMMUNICATION_STATUS_VALUES,
  CRM_ONBOARDING_STATUS_LABELS,
  CRM_ROLE_LABELS,
  CRM_SOURCE_LABELS,
  CRM_SOURCE_VALUES,
  CRM_STATUS_LABELS,
  CRM_STATUS_VALUES,
  CrmCommunicationStatus,
  CrmContact,
  CrmSource,
  CrmStatus,
} from '@/lib/crm/types';
import { getCrmSuggestions, resolveCrmRoleInput, resolveCrmSourceInput } from '@/lib/crm/suggestions';
import { sanitizeCrmMessageTextForDisplay } from '@/lib/crm/message-display';
import { readResponseJson } from '@/lib/safeResponseJson';
import { CrmSuggestInput } from './CrmSuggestInput';

type Draft = {
  name: string;
  phone: string;
  telegramUsername: string;
  email: string;
  role: string;
  source: string;
  objectsCount: string;
  city: string;
  note: string;
  status: CrmStatus;
  communicationStatus: CrmCommunicationStatus;
  nextStep: string;
  nextActionAt: string;
};

const emptyDraft: Draft = {
  name: '',
  phone: '',
  telegramUsername: '',
  email: '',
  role: CRM_ROLE_LABELS.unknown,
  source: CRM_SOURCE_LABELS.manual,
  objectsCount: '0',
  city: '',
  note: '',
  status: 'new_lead',
  communicationStatus: 'no_contact',
  nextStep: '',
  nextActionAt: '',
};

function formatDate(value: string | null): string {
  if (!value) return 'не задано';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
    new Date(value)
  );
}

function toInputDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function onboardingBadgeClass(status: string): string {
  switch (status) {
    case 'ready_for_channel_manager':
    case 'channel_manager_started':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'needs_operator':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'missing_required_data':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

export default function CrmPageClient() {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [suggestionContacts, setSuggestionContacts] = useState<CrmContact[]>([]);
  const [statusFilter, setStatusFilter] = useState<CrmStatus | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<CrmSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [edits, setEdits] = useState<Record<string, { note: string; nextStep: string; nextActionAt: string }>>({});

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (statusFilter !== 'all') query.set('status', statusFilter);
    if (sourceFilter !== 'all') query.set('source', sourceFilter);
    if (search.trim()) query.set('search', search.trim());
    return query.toString();
  }, [search, sourceFilter, statusFilter]);

  const loadSuggestionContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/crm', { credentials: 'include' });
      const data = await readResponseJson(res, { ok: false, contacts: [] as CrmContact[], message: '' });
      if (res.ok && data.ok) {
        setSuggestionContacts(data.contacts);
      }
    } catch {
      // Подсказки не блокируют основной экран CRM.
    }
  }, []);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/crm${params ? `?${params}` : ''}`, { credentials: 'include' });
      const data = await readResponseJson(res, { ok: false, contacts: [] as CrmContact[], message: '' });
      if (!res.ok || !data.ok) {
        setMessage(data.message || 'Не удалось загрузить CRM.');
        return;
      }
      setContacts(data.contacts);
      setEdits(
        Object.fromEntries(
          data.contacts.map((contact) => [
            contact.id,
            {
              note: contact.note,
              nextStep: contact.nextStep,
              nextActionAt: toInputDate(contact.nextActionAt),
            },
          ])
        )
      );
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    void loadSuggestionContacts();
  }, [loadSuggestionContacts]);

  const nameSuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'name', draft.name),
    [draft.name, suggestionContacts]
  );
  const phoneSuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'phone', draft.phone),
    [draft.phone, suggestionContacts]
  );
  const telegramSuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'telegramUsername', draft.telegramUsername),
    [draft.telegramUsername, suggestionContacts]
  );
  const emailSuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'email', draft.email),
    [draft.email, suggestionContacts]
  );
  const roleSuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'role', draft.role),
    [draft.role, suggestionContacts]
  );
  const sourceSuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'source', draft.source),
    [draft.source, suggestionContacts]
  );
  const citySuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'city', draft.city),
    [draft.city, suggestionContacts]
  );
  const nextStepSuggestions = useMemo(
    () => getCrmSuggestions(suggestionContacts, 'nextStep', draft.nextStep),
    [draft.nextStep, suggestionContacts]
  );

  async function deleteContact(contact: CrmContact) {
    const confirmed = window.confirm(`Удалить лида «${contact.name}»? Это действие нельзя отменить.`);
    if (!confirmed) return;

    setDeletingId(contact.id);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/crm/${encodeURIComponent(contact.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await readResponseJson(res, { ok: false, message: '' });
      if (!res.ok || !data.ok) {
        setMessage(data.message || 'Не удалось удалить лида.');
        return;
      }
      setContacts((prev) => prev.filter((item) => item.id !== contact.id));
      setSuggestionContacts((prev) => prev.filter((item) => item.id !== contact.id));
      setEdits((prev) => {
        const next = { ...prev };
        delete next[contact.id];
        return next;
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function patchContact(id: string, patch: Partial<CrmContact> & { nextActionAt?: string | null }) {
    setSavingId(id);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/crm/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      const data = await readResponseJson(res, { ok: false, contact: null as CrmContact | null, message: '' });
      if (!res.ok || !data.ok || !data.contact) {
        setMessage(data.message || 'Не удалось сохранить изменения.');
        return;
      }
      setContacts((prev) => prev.map((contact) => (contact.id === id ? data.contact! : contact)));
      setEdits((prev) => ({
        ...prev,
        [id]: {
          note: data.contact!.note,
          nextStep: data.contact!.nextStep,
          nextActionAt: toInputDate(data.contact!.nextActionAt),
        },
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingId('new');
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...draft,
          role: resolveCrmRoleInput(draft.role),
          source: resolveCrmSourceInput(draft.source),
          objectsCount: Number.parseInt(draft.objectsCount || '0', 10),
          nextActionAt: draft.nextActionAt || null,
        }),
      });
      const data = await readResponseJson(res, { ok: false, contact: null as CrmContact | null, message: '' });
      if (!res.ok || !data.ok || !data.contact) {
        setMessage(data.message || 'Не удалось добавить лида.');
        return;
      }
      setDraft(emptyDraft);
      setShowForm(false);
      await Promise.all([loadContacts(), loadSuggestionContacts()]);
    } finally {
      setSavingId(null);
    }
  }

  const dueCount = contacts.filter((contact) => contact.nextActionAt && new Date(contact.nextActionAt) <= new Date()).length;
  const problemCount = contacts.filter(
    (contact) => contact.communicationStatus === 'has_problem' || contact.communicationStatus === 'needs_manual_reaction'
  ).length;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">CRM раннего доступа</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Лиды, владельцы, объекты, этап подключения и следующий ручной шаг.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/crm/queue"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Очередь CRM
          </Link>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {showForm ? 'Закрыть форму' : 'Добавить лида'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase text-slate-500">всего лидов</div>
          <div className="mt-2 text-2xl font-bold text-slate-950">{contacts.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase text-slate-500">нужно написать</div>
          <div className="mt-2 text-2xl font-bold text-slate-950">{dueCount}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase text-slate-500">проблемы</div>
          <div className="mt-2 text-2xl font-bold text-slate-950">{problemCount}</div>
        </div>
      </div>

      {showForm ? (
        <form onSubmit={createContact} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-medium text-slate-700" htmlFor="crm-draft-name">
              Имя
              <CrmSuggestInput
                id="crm-draft-name"
                listId="crm-suggest-name"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={draft.name}
                onChange={(name) => setDraft({ ...draft, name })}
                suggestions={nameSuggestions}
                autoComplete="name"
              />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="crm-draft-phone">
              Телефон
              <CrmSuggestInput
                id="crm-draft-phone"
                listId="crm-suggest-phone"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={draft.phone}
                onChange={(phone) => setDraft({ ...draft, phone })}
                suggestions={phoneSuggestions}
                autoComplete="tel"
              />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="crm-draft-telegram">
              Telegram
              <CrmSuggestInput
                id="crm-draft-telegram"
                listId="crm-suggest-telegram"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={draft.telegramUsername}
                onChange={(telegramUsername) => setDraft({ ...draft, telegramUsername })}
                suggestions={telegramSuggestions}
                autoComplete="off"
              />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="crm-draft-email">
              Email
              <CrmSuggestInput
                id="crm-draft-email"
                listId="crm-suggest-email"
                type="email"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={draft.email}
                onChange={(email) => setDraft({ ...draft, email })}
                suggestions={emailSuggestions}
                autoComplete="email"
              />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="crm-draft-role">
              Роль
              <CrmSuggestInput
                id="crm-draft-role"
                listId="crm-suggest-role"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={draft.role}
                onChange={(role) => setDraft({ ...draft, role })}
                suggestions={roleSuggestions}
                autoComplete="off"
              />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="crm-draft-source">
              Источник
              <CrmSuggestInput
                id="crm-draft-source"
                listId="crm-suggest-source"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={draft.source}
                onChange={(source) => setDraft({ ...draft, source })}
                suggestions={sourceSuggestions}
                autoComplete="off"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Объектов
              <input type="number" min="0" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.objectsCount} onChange={(e) => setDraft({ ...draft, objectsCount: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="crm-draft-city">
              Город
              <CrmSuggestInput
                id="crm-draft-city"
                listId="crm-suggest-city"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                value={draft.city}
                onChange={(city) => setDraft({ ...draft, city })}
                suggestions={citySuggestions}
                autoComplete="address-level2"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Дата следующего действия
              <input type="datetime-local" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.nextActionAt} onChange={(e) => setDraft({ ...draft, nextActionAt: e.target.value })} />
            </label>
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="crm-draft-next-step">
            Следующий шаг
            <CrmSuggestInput
              id="crm-draft-next-step"
              listId="crm-suggest-next-step"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={draft.nextStep}
              onChange={(nextStep) => setDraft({ ...draft, nextStep })}
              suggestions={nextStepSuggestions}
              autoComplete="off"
            />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Заметка
            <textarea className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <button type="submit" disabled={savingId === 'new'} className="mt-3 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">
            {savingId === 'new' ? 'Сохранение...' : 'Сохранить лида'}
          </button>
        </form>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
        <input
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Поиск по имени, телефону, Telegram"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CrmStatus | 'all')}>
          <option value="all">все статусы</option>
          {CRM_STATUS_VALUES.map((value) => <option key={value} value={value}>{CRM_STATUS_LABELS[value]}</option>)}
        </select>
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as CrmSource | 'all')}>
          <option value="all">все источники</option>
          {CRM_SOURCE_VALUES.map((value) => <option key={value} value={value}>{CRM_SOURCE_LABELS[value]}</option>)}
        </select>
      </div>

      {message ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{message}</div> : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Загрузка CRM...</div>
        ) : contacts.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Лиды не найдены.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {contacts.map((contact) => {
              const edit = edits[contact.id] ?? { note: contact.note, nextStep: contact.nextStep, nextActionAt: toInputDate(contact.nextActionAt) };
              return (
                <section key={contact.id} className="grid gap-4 p-4 lg:grid-cols-[1.2fr_0.9fr_1.1fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-950">{contact.name}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{CRM_ROLE_LABELS[contact.role]}</span>
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">{CRM_SOURCE_LABELS[contact.source]}</span>
                      <button
                        type="button"
                        disabled={deletingId === contact.id || savingId === contact.id}
                        onClick={() => void deleteContact(contact)}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:text-red-300"
                      >
                        {deletingId === contact.id ? 'Удаление...' : 'Удалить'}
                      </button>
                    </div>
                    <div className="mt-2 grid gap-1 text-sm text-slate-600">
                      <div>{contact.phone || 'телефон не указан'}</div>
                      <div>{contact.telegramUsername ? `@${contact.telegramUsername}` : 'Telegram не указан'}</div>
                      <div>{contact.email || 'email не указан'}</div>
                      <div>{contact.city || 'город не указан'} · объектов: {contact.objectsCount}</div>
                    </div>
                    {contact.onboarding ? (
                      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-1 text-xs font-medium ${onboardingBadgeClass(contact.onboarding.status)}`}>
                            {CRM_ONBOARDING_STATUS_LABELS[contact.onboarding.status]}
                          </span>
                          {contact.onboarding.channelManagerHref ? (
                            <a className="text-xs font-semibold text-blue-700 hover:text-blue-900" href={contact.onboarding.channelManagerHref}>
                              Открыть Менеджер Каналов
                            </a>
                          ) : null}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Не хватает: {contact.onboarding.missing.length ? contact.onboarding.missing.join(', ') : 'ничего'}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Последнее сообщение:{' '}
                          {sanitizeCrmMessageTextForDisplay(contact.onboarding.lastMessage) || 'нет текста'}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-medium uppercase text-slate-500">
                      Статус
                      <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={contact.status} disabled={savingId === contact.id} onChange={(e) => void patchContact(contact.id, { status: e.target.value as CrmStatus })}>
                        {CRM_STATUS_VALUES.map((value) => <option key={value} value={value}>{CRM_STATUS_LABELS[value]}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs font-medium uppercase text-slate-500">
                      Коммуникация
                      <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={contact.communicationStatus} disabled={savingId === contact.id} onChange={(e) => void patchContact(contact.id, { communicationStatus: e.target.value as CrmCommunicationStatus })}>
                        {CRM_COMMUNICATION_STATUS_VALUES.map((value) => <option key={value} value={value}>{CRM_COMMUNICATION_STATUS_LABELS[value]}</option>)}
                      </select>
                    </label>
                    <div className="text-xs text-slate-500">Последний контакт: {formatDate(contact.lastContactAt)}</div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-medium uppercase text-slate-500" htmlFor={`crm-edit-next-step-${contact.id}`}>
                      Следующий шаг
                      <CrmSuggestInput
                        id={`crm-edit-next-step-${contact.id}`}
                        listId={`crm-suggest-next-step-${contact.id}`}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        value={edit.nextStep}
                        onChange={(nextStep) => setEdits((prev) => ({ ...prev, [contact.id]: { ...edit, nextStep } }))}
                        suggestions={getCrmSuggestions(suggestionContacts, 'nextStep', edit.nextStep)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="block text-xs font-medium uppercase text-slate-500">
                      Когда написать
                      <input type="datetime-local" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={edit.nextActionAt} onChange={(e) => setEdits((prev) => ({ ...prev, [contact.id]: { ...edit, nextActionAt: e.target.value } }))} />
                    </label>
                    <label className="block text-xs font-medium uppercase text-slate-500">
                      Заметка
                      <textarea className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={edit.note} onChange={(e) => setEdits((prev) => ({ ...prev, [contact.id]: { ...edit, note: e.target.value } }))} />
                    </label>
                    <button
                      type="button"
                      disabled={savingId === contact.id}
                      onClick={() => void patchContact(contact.id, { note: edit.note, nextStep: edit.nextStep, nextActionAt: edit.nextActionAt || null })}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:text-slate-400"
                    >
                      {savingId === contact.id ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
