'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CRM_LEAD_STATUSES,
  SUPPORT_REQUEST_STATUSES,
  type CrmLeadStatus,
  type LeadSource,
  type LeadSupportRequest,
  type LeadViewModel,
  type SupportRequestStatus,
} from '@/lib/dashboard/leads';

type LeadsResponse = {
  ok: boolean;
  leads?: LeadViewModel[];
  supportRequests?: LeadSupportRequest[];
  error?: string;
};

type PatchResponse = {
  ok: boolean;
  lead?: LeadViewModel;
  error?: string;
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  site: 'site',
  tenchat: 'tenchat',
  dzen: 'dzen',
  support: 'support',
  unknown: 'unknown',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  qualified: 'Квалифицирована',
  needs_pms_access: 'Нужен доступ к PMS/МК',
  ready_for_setup: 'Готов к подключению',
  manual_reply_needed: 'Нужен ручной ответ',
  pilot_candidate: 'Кандидат в пилот',
  not_fit: 'Не подходит',
  archived: 'Архив',
  contacted: 'Связались',
  demo_offered: 'Демо предложено',
  closed: 'Закрыта',
};

const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  new: 'new',
  in_progress: 'in_progress',
  answered: 'answered',
  archived: 'archived',
};

function formatDateRu(iso: string | null | undefined): string {
  if (!iso) return 'не указано';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'не указано';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function listText(values: string[]): string {
  return values.length ? values.join(', ') : 'не указано';
}

function textOrEmpty(value: string): string {
  return value || 'не указано';
}

function statusTone(status: string): string {
  if (status === 'ready_for_setup' || status === 'qualified' || status === 'pilot_candidate') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  }
  if (status === 'manual_reply_needed' || status === 'needs_pms_access') {
    return 'bg-amber-50 text-amber-800 border-amber-100';
  }
  if (status === 'not_fit' || status === 'archived' || status === 'closed') {
    return 'bg-slate-100 text-slate-600 border-slate-200';
  }
  return 'bg-blue-50 text-blue-700 border-blue-100';
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-relaxed text-slate-900">{children}</dd>
    </div>
  );
}

export function LeadsDashboardClient() {
  const [leads, setLeads] = useState<LeadViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'leads' | 'support'>('leads');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [pmsFilter, setPmsFilter] = useState('');
  const [potentialFilter, setPotentialFilter] = useState('');
  const [supportOnly, setSupportOnly] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedId) ?? leads[0] ?? null,
    [leads, selectedId],
  );

  const supportRequests = useMemo(
    () => leads.flatMap((lead) => lead.supportRequests),
    [leads],
  );

  const filterOptions = useMemo(() => {
    const pms = Array.from(new Set(leads.flatMap((lead) => lead.pms))).sort();
    const potentials = Array.from(new Set(leads.map((lead) => lead.leadPotential).filter(Boolean))).sort();
    return { pms, potentials };
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (statusFilter && lead.status !== statusFilter) return false;
      if (sourceFilter && lead.source !== sourceFilter) return false;
      if (pmsFilter && !lead.pms.includes(pmsFilter)) return false;
      if (potentialFilter && lead.leadPotential !== potentialFilter) return false;
      if (supportOnly && !lead.hasSupportRequest) return false;
      return true;
    });
  }, [leads, pmsFilter, potentialFilter, sourceFilter, statusFilter, supportOnly]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dashboard/leads?limit=250', { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as LeadsResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось загрузить заявки');
      const nextLeads = data.leads ?? [];
      setLeads(nextLeads);
      setSelectedId((current) => current ?? nextLeads[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function patchLead(
    leadId: string,
    patch: {
      status?: CrmLeadStatus;
      adminNote?: string;
      supportRequestIndex?: number;
      supportStatus?: SupportRequestStatus;
    },
  ) {
    setSavingId(leadId);
    setError('');
    try {
      const res = await fetch('/api/dashboard/leads', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId, ...patch }),
      });
      const data = (await res.json().catch(() => ({}))) as PatchResponse;
      if (!res.ok || !data.ok || !data.lead) throw new Error(data.error || 'Не удалось сохранить изменения');
      setLeads((current) => current.map((lead) => (lead.id === leadId ? data.lead! : lead)));
      setSelectedId(data.lead.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения');
    } finally {
      setSavingId(null);
    }
  }

  async function handleCopy(lead: LeadViewModel) {
    await copyToClipboard(lead.copySummary);
    setCopiedId(lead.id);
    window.setTimeout(() => setCopiedId((current) => (current === lead.id ? null : current)), 1500);
  }

  return (
    <div className="max-w-[1500px] space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Заявки</h1>
          <p className="mt-2 max-w-3xl text-base leading-relaxed text-slate-600">
            Лиды из Telegram bot и вопросы поддержки в одном рабочем списке.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('leads')}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === 'leads' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Заявки
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('support')}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === 'support' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Поддержка
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Обновить
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm font-medium text-slate-700">
            Статус
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">Все статусы</option>
              {CRM_LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Источник
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">Все источники</option>
              {(['site', 'tenchat', 'dzen', 'support', 'unknown'] as LeadSource[]).map((source) => (
                <option key={source} value={source}>{SOURCE_LABELS[source]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            PMS/МК
            <select
              value={pmsFilter}
              onChange={(event) => setPmsFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">Все PMS/МК</option>
              {filterOptions.pms.map((pms) => (
                <option key={pms} value={pms}>{pms}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Потенциал
            <select
              value={potentialFilter}
              onChange={(event) => setPotentialFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">Любой</option>
              {filterOptions.potentials.map((potential) => (
                <option key={potential} value={potential}>{potential}</option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={supportOnly}
              onChange={(event) => setSupportOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Только с вопросами поддержки
          </label>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center rounded-md border border-slate-200 bg-white">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
        </div>
      ) : activeTab === 'support' ? (
        <SupportRequestsTable
          requests={supportRequests}
          savingId={savingId}
          onOpenLead={(leadId) => {
            setSelectedId(leadId);
            setActiveTab('leads');
          }}
          onUpdateStatus={(request, status) => patchLead(request.leadId, {
            supportRequestIndex: request.index,
            supportStatus: status,
          })}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <LeadsTable
            leads={filteredLeads}
            savingId={savingId}
            selectedId={selectedLead?.id ?? null}
            copiedId={copiedId}
            onOpen={(leadId) => setSelectedId(leadId)}
            onCopy={(lead) => void handleCopy(lead)}
            onStatusChange={(leadId, status) => patchLead(leadId, { status })}
          />
          <LeadDetailPanel
            lead={selectedLead}
            saving={Boolean(selectedLead && savingId === selectedLead.id)}
            noteValue={selectedLead ? noteDrafts[selectedLead.id] ?? selectedLead.adminNote : ''}
            onNoteChange={(value) => {
              if (!selectedLead) return;
              setNoteDrafts((current) => ({ ...current, [selectedLead.id]: value }));
            }}
            onSaveNote={() => {
              if (!selectedLead) return;
              void patchLead(selectedLead.id, { adminNote: noteDrafts[selectedLead.id] ?? selectedLead.adminNote });
            }}
            onCopy={(lead) => void handleCopy(lead)}
          />
        </div>
      )}
    </div>
  );
}

function LeadsTable({
  leads,
  savingId,
  selectedId,
  copiedId,
  onOpen,
  onCopy,
  onStatusChange,
}: {
  leads: LeadViewModel[];
  savingId: string | null;
  selectedId: string | null;
  copiedId: string | null;
  onOpen: (leadId: string) => void;
  onCopy: (lead: LeadViewModel) => void;
  onStatusChange: (leadId: string, status: CrmLeadStatus) => void;
}) {
  if (!leads.length) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Нет заявок по выбранным фильтрам.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[1120px] w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3">Источник</th>
              <th className="px-4 py-3">Имя</th>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Объектов</th>
              <th className="px-4 py-3">Типы объектов</th>
              <th className="px-4 py-3">PMS/МК</th>
              <th className="px-4 py-3">Что хочет автоматизировать</th>
              <th className="px-4 py-3">Потенциал</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Поддержка</th>
              <th className="px-4 py-3">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {leads.map((lead) => (
              <tr key={lead.id} className={lead.id === selectedId ? 'bg-blue-50/40' : undefined}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateRu(lead.createdAt)}</td>
                <td className="px-4 py-3 text-slate-700">{SOURCE_LABELS[lead.source]}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{lead.name}</td>
                <td className="px-4 py-3 text-slate-600">{lead.telegramUsername ? `@${lead.telegramUsername}` : 'не указан'}</td>
                <td className="px-4 py-3 text-slate-700">{textOrEmpty(lead.objectCountRange)}</td>
                <td className="max-w-[220px] px-4 py-3 text-slate-700">{listText(lead.objectTypes)}</td>
                <td className="max-w-[180px] px-4 py-3 text-slate-700">{listText(lead.pms)}</td>
                <td className="max-w-[260px] px-4 py-3 text-slate-700">{listText(lead.automationProcesses)}</td>
                <td className="px-4 py-3 text-slate-700">{textOrEmpty(lead.leadPotential)}</td>
                <td className="px-4 py-3">
                  <select
                    value={CRM_LEAD_STATUSES.includes(lead.status as CrmLeadStatus) ? lead.status : ''}
                    disabled={savingId === lead.id}
                    onChange={(event) => onStatusChange(lead.id, event.target.value as CrmLeadStatus)}
                    className="w-[180px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
                  >
                    {!CRM_LEAD_STATUSES.includes(lead.status as CrmLeadStatus) ? (
                      <option value="">{STATUS_LABELS[lead.status] ?? lead.status}</option>
                    ) : null}
                    {CRM_LEAD_STATUSES.map((status) => (
                      <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  {lead.hasSupportRequest ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      есть
                    </span>
                  ) : (
                    <span className="text-slate-400">нет</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(lead.id)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      Открыть
                    </button>
                    <a
                      href={lead.telegramUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Telegram
                    </a>
                    <button
                      type="button"
                      onClick={() => onCopy(lead)}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {copiedId === lead.id ? 'Скопировано' : 'Сводка'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadDetailPanel({
  lead,
  saving,
  noteValue,
  onNoteChange,
  onSaveNote,
  onCopy,
}: {
  lead: LeadViewModel | null;
  saving: boolean;
  noteValue: string;
  onNoteChange: (value: string) => void;
  onSaveNote: () => void;
  onCopy: (lead: LeadViewModel) => void;
}) {
  if (!lead) {
    return (
      <aside className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Выберите заявку, чтобы открыть карточку.
      </aside>
    );
  }

  return (
    <aside className="rounded-md border border-slate-200 bg-white p-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-96px)] xl:overflow-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{lead.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{lead.telegramUsername ? `@${lead.telegramUsername}` : lead.telegramUserId}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(lead.status)}`}>
          {STATUS_LABELS[lead.status] ?? lead.status}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={lead.telegramUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Открыть Telegram
        </a>
        <button
          type="button"
          onClick={() => onCopy(lead)}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Скопировать сводку
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-4">
        <DetailField label="Telegram ID">{textOrEmpty(lead.telegramUserId)}</DetailField>
        <DetailField label="Telegram username">{lead.telegramUsername ? `@${lead.telegramUsername}` : 'не указан'}</DetailField>
        <DetailField label="Ссылка на пользователя Telegram">
          <a href={lead.telegramUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
            {lead.telegramUrl}
          </a>
        </DetailField>
        <DetailField label="Источник">{SOURCE_LABELS[lead.source]}</DetailField>
        <DetailField label="Дата создания">{formatDateRu(lead.createdAt)}</DetailField>
        <DetailField label="object_count_range">{textOrEmpty(lead.objectCountRange)}</DetailField>
        <DetailField label="object_types">{listText(lead.objectTypes)}</DetailField>
        <DetailField label="channels">{listText(lead.channels)}</DetailField>
        <DetailField label="pms">{listText(lead.pms)}</DetailField>
        <DetailField label="automation_processes">{listText(lead.automationProcesses)}</DetailField>
        <DetailField label="time_consumers">{listText(lead.timeConsumers)}</DetailField>
        <DetailField label="other_texts">
          {Object.keys(lead.otherTexts).length ? (
            <div className="space-y-1">
              {Object.entries(lead.otherTexts).map(([key, values]) => (
                <div key={key}>
                  <span className="font-medium">{key}:</span> {values.join(', ')}
                </div>
              ))}
            </div>
          ) : 'не указано'}
        </DetailField>
        <DetailField label="comment">{textOrEmpty(lead.comment)}</DetailField>
        <DetailField label="ai_summary">{textOrEmpty(lead.aiSummary)}</DetailField>
        <DetailField label="lead_type">{textOrEmpty(lead.leadType)}</DetailField>
        <DetailField label="lead_potential">{textOrEmpty(lead.leadPotential)}</DetailField>
        <DetailField label="recommended_next_step">{textOrEmpty(lead.recommendedNextStep)}</DetailField>
      </dl>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <label className="text-sm font-semibold text-slate-900">
          Заметка администратора
          <textarea
            rows={4}
            value={noteValue}
            onChange={(event) => onNoteChange(event.target.value)}
            className="mt-2 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            placeholder="Добавить заметку"
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={onSaveNote}
          className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Сохранение...' : 'Сохранить заметку'}
        </button>
      </div>

      {lead.supportRequests.length ? (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <h3 className="text-sm font-bold text-slate-900">support_requests</h3>
          <div className="mt-3 space-y-3">
            {lead.supportRequests.map((request) => (
              <div key={request.id} className="rounded-md border border-amber-100 bg-amber-50 p-3">
                <div className="flex items-center justify-between gap-3 text-xs text-amber-800">
                  <span>{formatDateRu(request.receivedAt)}</span>
                  <span className="font-semibold">{request.status}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-900">{request.text}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function SupportRequestsTable({
  requests,
  savingId,
  onOpenLead,
  onUpdateStatus,
}: {
  requests: LeadSupportRequest[];
  savingId: string | null;
  onOpenLead: (leadId: string) => void;
  onUpdateStatus: (request: LeadSupportRequest, status: SupportRequestStatus) => void;
}) {
  if (!requests.length) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Вопросов поддержки пока нет.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Дата вопроса</th>
              <th className="px-4 py-3">Текст вопроса</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Связанный лид</th>
              <th className="px-4 py-3">Контекст лида</th>
              <th className="px-4 py-3">Telegram</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((request) => (
              <tr key={request.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateRu(request.receivedAt)}</td>
                <td className="max-w-[360px] px-4 py-3 text-slate-900">{request.text}</td>
                <td className="px-4 py-3">
                  <select
                    value={request.status}
                    disabled={savingId === request.leadId}
                    onChange={(event) => onUpdateStatus(request, event.target.value as SupportRequestStatus)}
                    className="w-[150px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
                  >
                    {SUPPORT_REQUEST_STATUSES.map((status) => (
                      <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenLead(request.leadId)}
                    className="text-sm font-semibold text-blue-700 hover:underline"
                  >
                    {request.leadName}
                  </button>
                </td>
                <td className="max-w-[300px] px-4 py-3 text-slate-700">
                  {request.leadContext ? (
                    <div className="space-y-1">
                      <div>Объектов: {request.leadContext.object_count_range || 'не указано'}</div>
                      <div>PMS/МК: {listText(request.leadContext.pms)}</div>
                      <div>Процессы: {listText(request.leadContext.automation_processes)}</div>
                    </div>
                  ) : 'не указано'}
                </td>
                <td className="px-4 py-3">
                  <a
                    href={request.telegramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-700 hover:underline"
                  >
                    {request.telegramUsername ? `@${request.telegramUsername}` : request.telegramUserId}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
