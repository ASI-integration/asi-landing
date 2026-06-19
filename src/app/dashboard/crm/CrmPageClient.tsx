'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CRM_COMMUNICATION_STATUS_LABELS,
  CRM_COMMUNICATION_STATUS_VALUES,
  CRM_ROLE_LABELS,
  CRM_ROLE_VALUES,
  CRM_SOURCE_LABELS,
  CRM_SOURCE_VALUES,
  CRM_STATUS_LABELS,
  CRM_STATUS_VALUES,
  CrmCommunicationStatus,
  CrmContact,
  CrmRole,
  CrmSource,
  CrmStatus,
} from '@/lib/crm/types';
import { readResponseJson } from '@/lib/safeResponseJson';

type Draft = {
  name: string;
  phone: string;
  telegramUsername: string;
  email: string;
  role: CrmRole;
  source: CrmSource;
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
  role: 'unknown',
  source: 'manual',
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

export default function CrmPageClient() {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [statusFilter, setStatusFilter] = useState<CrmStatus | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<CrmSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
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
      await loadContacts();
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
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {showForm ? 'Закрыть форму' : 'Добавить лида'}
        </button>
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
            <label className="text-sm font-medium text-slate-700">
              Имя
              <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Телефон
              <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Telegram
              <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.telegramUsername} onChange={(e) => setDraft({ ...draft, telegramUsername: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Email
              <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Роль
              <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as CrmRole })}>
                {CRM_ROLE_VALUES.map((value) => <option key={value} value={value}>{CRM_ROLE_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Источник
              <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as CrmSource })}>
                {CRM_SOURCE_VALUES.map((value) => <option key={value} value={value}>{CRM_SOURCE_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Объектов
              <input type="number" min="0" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.objectsCount} onChange={(e) => setDraft({ ...draft, objectsCount: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Город
              <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Дата следующего действия
              <input type="datetime-local" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.nextActionAt} onChange={(e) => setDraft({ ...draft, nextActionAt: e.target.value })} />
            </label>
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Следующий шаг
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.nextStep} onChange={(e) => setDraft({ ...draft, nextStep: e.target.value })} />
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
                    </div>
                    <div className="mt-2 grid gap-1 text-sm text-slate-600">
                      <div>{contact.phone || 'телефон не указан'}</div>
                      <div>{contact.telegramUsername ? `@${contact.telegramUsername}` : 'Telegram не указан'}</div>
                      <div>{contact.email || 'email не указан'}</div>
                      <div>{contact.city || 'город не указан'} · объектов: {contact.objectsCount}</div>
                    </div>
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
                    <label className="block text-xs font-medium uppercase text-slate-500">
                      Следующий шаг
                      <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={edit.nextStep} onChange={(e) => setEdits((prev) => ({ ...prev, [contact.id]: { ...edit, nextStep: e.target.value } }))} />
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
