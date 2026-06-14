'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CRM_LEAD_STATUSES,
  SUPPORT_REQUEST_STATUSES,
  getLatestLeadsByTelegramId,
  getLeadHistoryByTelegramId,
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
  site: 'Сайт',
  tenchat: 'TenChat',
  dzen: 'Дзен',
  support: 'Поддержка',
  unknown: 'Неизвестно',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  qualified: 'Квалифицирована',
  needs_pms_access: 'Нужен доступ к менеджеру каналов',
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
  new: 'Новый',
  in_progress: 'В работе',
  answered: 'Отвечен',
  archived: 'Архив',
};

const SCENARIO_LABELS: Record<string, string> = {
  has_pms: 'Есть менеджер каналов',
  no_pms_manual: 'Без менеджера каналов, всё ведётся вручную',
  choosing_pms: 'Менеджер каналов выбирается или подключается',
  support_question: 'Вопрос в поддержку',
  high_value_operator: 'Потенциально крупный управляющий',
  small_host: 'Небольшой владелец / управляющий',
  commercial_property: 'Коммерческая недвижимость',
  mixed_portfolio: 'Смешанный портфель объектов',
  unclear: 'Нужно уточнение',
};

const MANUAL_REPLY_REASON_LABELS: Record<string, string> = {
  support_question: 'Вопрос в поддержку',
  needs_pms_access: 'Нужен доступ к менеджеру каналов',
  unclear_pms: 'Неясно, какой менеджер каналов используется',
  high_value_lead: 'Потенциально важный лид',
  custom_other_text: 'Есть нестандартный ответ',
  repeated_prompt_injection: 'повторная проверка защиты',
  rate_limited: 'мягкое ограничение по частоте',
  none: 'Нет',
};

const POLICY_MISSING_FIELD_LABELS: Record<string, string> = {
  object_count_range: 'количество объектов',
  object_types: 'тип объектов',
  channels: 'каналы',
  pms: 'менеджер каналов',
  automation_processes: 'что хочет автоматизировать',
  time_consumers: 'что съедает время',
};

const POLICY_REASON_LABELS: Record<string, string> = {
  possible_prompt_injection_repeat: 'несколько подозрительных сообщений подряд',
  policy_security_review: 'нужна проверка безопасности',
  low_completeness: 'мало данных в анкете',
  possible_prompt_injection: 'есть флаги безопасности',
  repeated_prompt_injection: 'повторная проверка защиты',
  rate_limited: 'мягкое ограничение по частоте',
  lead_start_hourly_limit: 'слишком много новых заявок за час',
  lead_restart_hourly_limit: 'слишком много запусков за час',
  support_hourly_limit: 'слишком много вопросов за час',
  prompt_injection_temporary_limit: 'частые проверки защиты',
};

const SOFT_EMPTY = 'Пока не указано';

function formatDateRu(iso: string | null | undefined): string {
  if (!iso) return SOFT_EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return SOFT_EMPTY;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDateRu(iso: string | null | undefined): string {
  if (!iso) return SOFT_EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return SOFT_EMPTY;
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function listText(values: readonly string[], empty = SOFT_EMPTY): string {
  return values.length ? values.map(sanitizeVisibleText).join(', ') : empty;
}

function sanitizeVisibleText(value: string): string {
  return value
    .replace(/PMS\/МК/gi, 'Менеджер каналов')
    .replace(/PMS\s*\/\s*МК/gi, 'Менеджер каналов')
    .replace(/HPMs?\s*\/\s*PMS/gi, 'Менеджер каналов')
    .replace(/Другой PMS\s*\/\s*менеджер каналов/gi, 'Другой менеджер каналов')
    .replace(/Работа с PMS\s*\/\s*менеджером каналов/gi, 'Работа с менеджером каналов')
    .replace(/PMS\s*\/\s*менеджер каналов/gi, 'Менеджер каналов')
    .replace(/PMS\s*\/\s*менеджером каналов/gi, 'менеджером каналов')
    .replace(/\bPMS\b/g, 'менеджер каналов')
    .replace(/\bpms\b/g, 'менеджер каналов')
    .replace(/\bМК\b/g, 'менеджер каналов');
}

function textOrEmpty(value: string): string {
  return value || SOFT_EMPTY;
}

function shortText(value: string, maxLength = 84): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function latestSupportRequest(lead: LeadViewModel): LeadSupportRequest | null {
  return lead.supportRequests.reduce<LeadSupportRequest | null>((latest, request) => {
    if (!latest) return request;
    const latestTime = new Date(latest.receivedAt ?? '').getTime();
    const requestTime = new Date(request.receivedAt ?? '').getTime();
    if (Number.isNaN(requestTime)) return latest;
    if (Number.isNaN(latestTime)) return request;
    return requestTime > latestTime ? request : latest;
  }, null);
}

function hasLeadContext(
  context: LeadSupportRequest['leadContext'],
): context is NonNullable<LeadSupportRequest['leadContext']> {
  if (!context) return false;
  return Boolean(
    context.object_count_range
      || context.object_types.length
      || context.pms.length
      || context.automation_processes.length,
  );
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

function needsManualReply(lead: LeadViewModel): boolean {
  if (lead.automation.manualReplyNeeded) return true;
  if (lead.status === 'manual_reply_needed') return true;
  const supportRequest = latestSupportRequest(lead);
  return supportRequest?.status === 'new' || supportRequest?.status === 'in_progress';
}

function leadNextStep(lead: LeadViewModel): string {
  return lead.automation.nextStep || lead.recommendedNextStep;
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
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-6 text-slate-900">{children}</dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function TruncatedText({ value, empty = SOFT_EMPTY, className = '' }: { value: string; empty?: string; className?: string }) {
  const text = value || empty;
  return (
    <div title={text} className={`truncate ${value ? '' : 'text-slate-400'} ${className}`}>
      {text}
    </div>
  );
}

function ContextSummary({ context }: { context: LeadSupportRequest['leadContext'] }) {
  if (!hasLeadContext(context)) return <span className="text-slate-400">Пока не указано</span>;

  const parts = [
    context.object_count_range ? `Объектов: ${context.object_count_range}` : '',
    context.pms.length ? `Менеджер каналов: ${listText(context.pms)}` : '',
    context.automation_processes.length ? `Процессы: ${shortText(listText(context.automation_processes), 72)}` : '',
  ].filter(Boolean);

  return <span title={parts.join(' · ')}>{parts.join(' · ')}</span>;
}

function SupportLeadContext({ context }: { context: LeadSupportRequest['leadContext'] }) {
  if (!hasLeadContext(context)) return null;

  return (
    <div className="mt-3 rounded-md border border-amber-100 bg-white p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800">Контекст: менеджер каналов</h4>
      <dl className="mt-2 grid grid-cols-1 gap-2">
        {context.object_count_range ? (
          <DetailField label="Объекты">{context.object_count_range}</DetailField>
        ) : null}
        {context.object_types.length ? (
          <DetailField label="Типы объектов">{listText(context.object_types)}</DetailField>
        ) : null}
        {context.pms.length ? (
          <DetailField label="Менеджер каналов">{listText(context.pms)}</DetailField>
        ) : null}
        {context.automation_processes.length ? (
          <DetailField label="Что хочет автоматизировать">{listText(context.automation_processes)}</DetailField>
        ) : null}
      </dl>
    </div>
  );
}

function PolicyProcessingSection({ policy }: { policy: LeadViewModel['policy'] }) {
  if (!policy) return null;
  const hasSecurityFlags = policy.possible_prompt_injection || policy.security_flags.length > 0;
  const missing = policy.missing_required_fields.map((field) => POLICY_MISSING_FIELD_LABELS[field] ?? field);
  const rateLimitReason = policy.rate_limit_reason
    ? POLICY_REASON_LABELS[policy.rate_limit_reason] ?? policy.rate_limit_reason
    : SOFT_EMPTY;
  const reason = policy.manual_review_reason
    ? POLICY_REASON_LABELS[policy.manual_review_reason] ?? policy.manual_review_reason
    : policy.prompt_injection_reason
      ? POLICY_REASON_LABELS[policy.prompt_injection_reason] ?? 'есть флаги безопасности'
      : SOFT_EMPTY;

  return (
    <DetailSection title="Политика обработки">
      <dl className="grid grid-cols-1 gap-3">
        <DetailField label="Безопасность">
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            hasSecurityFlags ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
          }`}>
            {hasSecurityFlags ? 'есть флаги' : 'спокойно'}
          </span>
        </DetailField>
        <DetailField label="Качество заявки">{policy.lead_completeness_score}%</DetailField>
        <DetailField label="Мягкое ограничение">{policy.rate_limited ? 'Да' : 'Нет'}</DetailField>
        {policy.rate_limited || policy.rate_limit_reason ? (
          <DetailField label="Причина ограничения">{rateLimitReason}</DetailField>
        ) : null}
        {policy.rate_limit_until ? (
          <DetailField label="Ограничение до">{formatDateRu(policy.rate_limit_until)}</DetailField>
        ) : null}
        {policy.repeated_security_attempts_count > 0 ? (
          <DetailField label="Повторные проверки защиты">{policy.repeated_security_attempts_count}</DetailField>
        ) : null}
        {missing.length ? (
          <DetailField label="Не хватает данных">
            <ul className="mt-0.5 list-disc space-y-1 pl-5">
              {missing.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </DetailField>
        ) : null}
        <DetailField label="Нужна ручная проверка">{policy.manual_review_recommended ? 'Да' : 'Нет'}</DetailField>
        {(policy.manual_review_recommended || hasSecurityFlags) ? (
          <DetailField label="Причина">{reason}</DetailField>
        ) : null}
      </dl>
    </DetailSection>
  );
}

export function LeadsDashboardClient() {
  const [leads, setLeads] = useState<LeadViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSupportId, setSelectedSupportId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'leads' | 'support'>('leads');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [pmsFilter, setPmsFilter] = useState('');
  const [potentialFilter, setPotentialFilter] = useState('');
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  const [hideTestLeads, setHideTestLeads] = useState(true);
  const [manualReplyOnly, setManualReplyOnly] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visibleLeads = useMemo(
    () => leads.filter((lead) => !hideTestLeads || !lead.isTestLead),
    [hideTestLeads, leads],
  );

  const supportRequests = useMemo(
    () => visibleLeads.flatMap((lead) => lead.supportRequests),
    [visibleLeads],
  );

  const filterOptions = useMemo(() => {
    const pms = Array.from(new Set(visibleLeads.flatMap((lead) => lead.pms))).sort();
    const potentials = Array.from(new Set(visibleLeads.map((lead) => lead.leadPotential).filter(Boolean))).sort();
    return { pms, potentials };
  }, [visibleLeads]);

  const filteredLeads = useMemo(() => {
    return visibleLeads.filter((lead) => {
      if (statusFilter && lead.status !== statusFilter) return false;
      if (sourceFilter && lead.source !== sourceFilter) return false;
      if (pmsFilter && !lead.pms.includes(pmsFilter)) return false;
      if (potentialFilter && lead.leadPotential !== potentialFilter) return false;
      if (manualReplyOnly && !needsManualReply(lead)) return false;
      return true;
    });
  }, [manualReplyOnly, pmsFilter, potentialFilter, sourceFilter, statusFilter, visibleLeads]);

  const tableLeads = useMemo(
    () => (showLatestOnly ? getLatestLeadsByTelegramId(filteredLeads) : filteredLeads),
    [filteredLeads, showLatestOnly],
  );

  const selectedLead = useMemo(
    () => filteredLeads.find((lead) => lead.id === selectedId) ?? tableLeads[0] ?? null,
    [filteredLeads, selectedId, tableLeads],
  );

  const selectedHistory = useMemo(
    () => getLeadHistoryByTelegramId(visibleLeads, selectedLead),
    [selectedLead, visibleLeads],
  );

  const selectedSupportRequest = useMemo(
    () => supportRequests.find((request) => request.id === selectedSupportId) ?? supportRequests[0] ?? null,
    [selectedSupportId, supportRequests],
  );

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
    <div className="w-full max-w-none space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Заявки</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Рабочий список лидов и обращений поддержки.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('leads')}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === 'leads' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Заявки {tableLeads.length}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('support')}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === 'support' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Поддержка {supportRequests.length}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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

      <section className="rounded-md border border-slate-200 bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Статус
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
            >
              <option value="">Все статусы</option>
              {CRM_LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Источник
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
            >
              <option value="">Все источники</option>
              {(['site', 'tenchat', 'dzen', 'support', 'unknown'] as LeadSource[]).map((source) => (
                <option key={source} value={source}>{SOURCE_LABELS[source]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Менеджер каналов
            <select
              value={pmsFilter}
              onChange={(event) => setPmsFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
            >
              <option value="">Все менеджеры каналов</option>
              {filterOptions.pms.map((pms) => (
                <option key={pms} value={pms}>{pms}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Потенциал
            <select
              value={potentialFilter}
              onChange={(event) => setPotentialFilter(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
            >
              <option value="">Любой</option>
              {filterOptions.potentials.map((potential) => (
                <option key={potential} value={potential}>{potential}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={showLatestOnly}
              onChange={(event) => setShowLatestOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Только последние заявки
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={hideTestLeads}
              onChange={(event) => setHideTestLeads(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Скрыть тестовые
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={manualReplyOnly}
              onChange={(event) => setManualReplyOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Требуют ручного ответа
          </label>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center rounded-md border border-slate-200 bg-white">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
        </div>
      ) : activeTab === 'support' ? (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <SupportRequestsTable
            requests={supportRequests}
            savingId={savingId}
            selectedId={selectedSupportRequest?.id ?? null}
            onOpenRequest={(request) => {
              setSelectedSupportId(request.id);
              setSelectedId(request.leadId);
            }}
            onUpdateStatus={(request, status) => patchLead(request.leadId, {
              supportRequestIndex: request.index,
              supportStatus: status,
            })}
          />
          <SupportDetailPanel
            request={selectedSupportRequest}
            saving={Boolean(selectedSupportRequest && savingId === selectedSupportRequest.leadId)}
            onOpenLead={(leadId) => {
              setSelectedId(leadId);
              setActiveTab('leads');
            }}
            onUpdateStatus={(request, status) => patchLead(request.leadId, {
              supportRequestIndex: request.index,
              supportStatus: status,
            })}
          />
        </div>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <LeadsTable
            leads={tableLeads}
            allVisibleLeads={visibleLeads}
            savingId={savingId}
            selectedId={selectedLead?.id ?? null}
            onOpen={(leadId) => setSelectedId(leadId)}
            onStatusChange={(leadId, status) => patchLead(leadId, { status })}
          />
          <LeadDetailPanel
            lead={selectedLead}
            history={selectedHistory}
            copiedId={copiedId}
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
            onSelectHistory={(leadId) => setSelectedId(leadId)}
            onCopy={(lead) => void handleCopy(lead)}
          />
        </div>
      )}
    </div>
  );
}

function LeadsTable({
  leads,
  allVisibleLeads,
  savingId,
  selectedId,
  onOpen,
  onStatusChange,
}: {
  leads: LeadViewModel[];
  allVisibleLeads: LeadViewModel[];
  savingId: string | null;
  selectedId: string | null;
  onOpen: (leadId: string) => void;
  onStatusChange: (leadId: string, status: CrmLeadStatus) => void;
}) {
  if (!leads.length) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Нет заявок по выбранным фильтрам.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full table-fixed divide-y divide-slate-200 text-sm">
          <colgroup>
            <col className="w-[104px]" />
            <col className="w-[18%]" />
            <col className="w-[92px]" />
            <col className="w-[18%]" />
            <col className="w-[12%]" />
            <col className="w-[170px]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Дата</th>
              <th className="px-3 py-2">Клиент</th>
              <th className="px-3 py-2">Источник</th>
              <th className="px-3 py-2">Объекты / менеджер каналов</th>
              <th className="px-3 py-2">Потенциал</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Следующий шаг</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {leads.map((lead) => {
              const supportRequest = latestSupportRequest(lead);
              const manualReply = needsManualReply(lead);
              const historyCount = getLeadHistoryByTelegramId(allVisibleLeads, lead).length;
              return (
                <tr
                  key={lead.id}
                  onClick={() => onOpen(lead.id)}
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                    lead.id === selectedId
                      ? 'bg-blue-50/60'
                      : manualReply
                        ? 'bg-amber-50/60 border-l-2 border-amber-300'
                        : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-slate-600">
                    {formatShortDateRu(lead.createdAt)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div title={lead.name} className="truncate font-semibold text-slate-900">{lead.name}</div>
                    <div title={lead.telegramUsername ? `@${lead.telegramUsername}` : lead.telegramUserId} className="truncate text-xs text-slate-500">
                      {lead.telegramUsername ? `@${lead.telegramUsername}` : lead.telegramUserId}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {historyCount > 1 ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          еще {historyCount - 1}
                        </span>
                      ) : null}
                      {supportRequest ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          поддержка
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-slate-700">{SOURCE_LABELS[lead.source]}</td>
                  <td className="px-3 py-2 align-top text-slate-700">
                    <TruncatedText value={lead.objectCountRange} />
                    <TruncatedText value={listText(lead.pms, '')} empty="Менеджер каналов не указан" className="mt-0.5 text-xs text-slate-500" />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <TruncatedText value={lead.leadPotential} />
                  </td>
                  <td className="px-3 py-2 align-top" onClick={(event) => event.stopPropagation()}>
                    <select
                      value={CRM_LEAD_STATUSES.includes(lead.status as CrmLeadStatus) ? lead.status : ''}
                      disabled={savingId === lead.id}
                      onChange={(event) => onStatusChange(lead.id, event.target.value as CrmLeadStatus)}
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-900"
                    >
                      {!CRM_LEAD_STATUSES.includes(lead.status as CrmLeadStatus) ? (
                        <option value="">{STATUS_LABELS[lead.status] ?? lead.status}</option>
                      ) : null}
                      {CRM_LEAD_STATUSES.map((status) => (
                        <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                      ))}
                    </select>
                    {needsManualReply(lead) ? (
                      <div className="mt-1 text-[11px] font-semibold text-amber-700">нужен ответ</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-700">
                    <TruncatedText value={leadNextStep(lead)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadDetailPanel({
  lead,
  history,
  copiedId,
  saving,
  noteValue,
  onNoteChange,
  onSaveNote,
  onSelectHistory,
  onCopy,
}: {
  lead: LeadViewModel | null;
  history: LeadViewModel[];
  copiedId: string | null;
  saving: boolean;
  noteValue: string;
  onNoteChange: (value: string) => void;
  onSaveNote: () => void;
  onSelectHistory: (leadId: string) => void;
  onCopy: (lead: LeadViewModel) => void;
}) {
  if (!lead) {
    return (
      <aside className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Выберите заявку, чтобы открыть карточку.
      </aside>
    );
  }

  const supportRequest = latestSupportRequest(lead);

  return (
    <aside className="rounded-md border border-slate-200 bg-white p-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-92px)] 2xl:overflow-auto">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-bold text-slate-900" title={lead.name}>{lead.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <a href={lead.telegramUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">
            {lead.telegramUsername ? `@${lead.telegramUsername}` : lead.telegramUserId}
          </a>
          {lead.isTestLead ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">тест</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={lead.telegramUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
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

      <div className="mt-4 space-y-4">
        <DetailSection title="Статус">
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(lead.status)}`}>
            {STATUS_LABELS[lead.status] ?? lead.status}
          </span>
        </DetailSection>

        <DetailSection title="Автоматизация">
          <dl className="grid grid-cols-1 gap-3">
            <DetailField label="Сценарий">
              {SCENARIO_LABELS[lead.automation.scenario] ?? lead.automation.scenario}
            </DetailField>
            <DetailField label="Нужен ручной ответ">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                needsManualReply(lead) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
              }`}>
                {needsManualReply(lead) ? 'Да' : 'Нет'}
              </span>
            </DetailField>
            {lead.automation.manualReplyReason !== 'none' ? (
              <DetailField label="Причина">
                {MANUAL_REPLY_REASON_LABELS[lead.automation.manualReplyReason] ?? lead.automation.manualReplyReason}
              </DetailField>
            ) : null}
            <DetailField label="Следующий шаг">{textOrEmpty(leadNextStep(lead))}</DetailField>
            <DetailField label="Чеклист подключения">
              {lead.automation.onboardingChecklist.length ? (
                <ul className="mt-0.5 list-disc space-y-1 pl-5">
                  {lead.automation.onboardingChecklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-slate-400">{SOFT_EMPTY}</span>
              )}
            </DetailField>
          </dl>
        </DetailSection>

        <PolicyProcessingSection policy={lead.policy} />

        <DetailSection title="Потенциал">
          <p className="text-sm leading-6 text-slate-900">{textOrEmpty(lead.leadPotential)}</p>
        </DetailSection>

        {supportRequest ? (
          <DetailSection title="Вопрос поддержки">
            <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs text-amber-800">
                <span>{formatDateRu(supportRequest.receivedAt)}</span>
                <span className="font-semibold">{SUPPORT_STATUS_LABELS[supportRequest.status]}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-900">{supportRequest.text}</p>
              <SupportLeadContext context={supportRequest.leadContext} />
            </div>
          </DetailSection>
        ) : null}

        <DetailSection title="AI-сводка">
          <p className="text-sm leading-6 text-slate-900">{textOrEmpty(lead.aiSummary)}</p>
        </DetailSection>

        {lead.automationProcesses.length ? (
          <DetailSection title="Что хочет автоматизировать">
            <p className="text-sm leading-6 text-slate-900">{listText(lead.automationProcesses)}</p>
          </DetailSection>
        ) : null}

        {lead.timeConsumers.length ? (
          <DetailSection title="Что съедает время">
            <p className="text-sm leading-6 text-slate-900">{listText(lead.timeConsumers)}</p>
          </DetailSection>
        ) : null}

        {(lead.objectCountRange || lead.objectTypes.length || lead.channels.length || lead.pms.length) ? (
          <DetailSection title="Объекты / каналы / менеджер каналов">
            <dl className="grid grid-cols-1 gap-3">
              {lead.objectCountRange ? <DetailField label="Объекты">{lead.objectCountRange}</DetailField> : null}
              {lead.objectTypes.length ? <DetailField label="Типы объектов">{listText(lead.objectTypes)}</DetailField> : null}
              {lead.channels.length ? <DetailField label="Каналы">{listText(lead.channels)}</DetailField> : null}
              {lead.pms.length ? <DetailField label="Менеджер каналов">{listText(lead.pms)}</DetailField> : null}
            </dl>
          </DetailSection>
        ) : null}

        {lead.comment || lead.leadType || Object.keys(lead.otherTexts).length ? (
          <DetailSection title="Дополнительно">
            <dl className="grid grid-cols-1 gap-3">
              {lead.comment ? <DetailField label="Комментарий">{lead.comment}</DetailField> : null}
              {lead.leadType ? <DetailField label="Тип лида">{lead.leadType}</DetailField> : null}
              {Object.entries(lead.otherTexts).map(([key, values]) => (
                <DetailField key={key} label={key}>{values.join(', ')}</DetailField>
              ))}
            </dl>
          </DetailSection>
        ) : null}

        <DetailSection title="Заметка администратора">
          <textarea
            rows={4}
            value={noteValue}
            onChange={(event) => onNoteChange(event.target.value)}
            className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            placeholder="Добавить заметку"
          />
          <button
            type="button"
            disabled={saving}
            onClick={onSaveNote}
            className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </DetailSection>

        {history.length > 1 ? (
          <DetailSection title="История заявок">
            <div className="space-y-2">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectHistory(item.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                    item.id === lead.id ? 'border-blue-100 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <span className="font-semibold">{formatDateRu(item.createdAt)}</span>
                  <span className="ml-2 text-slate-500">{SOURCE_LABELS[item.source]}</span>
                  {item.recommendedNextStep ? (
                    <span className="mt-1 block truncate" title={item.recommendedNextStep}>{item.recommendedNextStep}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </DetailSection>
        ) : null}

        <DetailSection title="Служебные данные">
          <dl className="grid grid-cols-1 gap-3">
            <DetailField label="Telegram ID">{textOrEmpty(lead.telegramUserId)}</DetailField>
            {lead.telegramUsername ? <DetailField label="Telegram username">@{lead.telegramUsername}</DetailField> : null}
            <DetailField label="Source">{SOURCE_LABELS[lead.source]}</DetailField>
            <DetailField label="Создана">{formatDateRu(lead.createdAt)}</DetailField>
            {lead.updatedAt ? <DetailField label="Обновлена">{formatDateRu(lead.updatedAt)}</DetailField> : null}
            <DetailField label="ID заявки">{lead.id}</DetailField>
          </dl>
        </DetailSection>
      </div>
    </aside>
  );
}

function SupportRequestsTable({
  requests,
  savingId,
  selectedId,
  onOpenRequest,
  onUpdateStatus,
}: {
  requests: LeadSupportRequest[];
  savingId: string | null;
  selectedId: string | null;
  onOpenRequest: (request: LeadSupportRequest) => void;
  onUpdateStatus: (request: LeadSupportRequest, status: SupportRequestStatus) => void;
}) {
  if (!requests.length) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Вопросов поддержки пока нет.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full table-fixed divide-y divide-slate-200 text-sm">
          <colgroup>
            <col className="w-[104px]" />
            <col className="w-[17%]" />
            <col className="w-[28%]" />
            <col className="w-[150px]" />
            <col className="w-[26%]" />
            <col className="w-[120px]" />
          </colgroup>
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Дата</th>
              <th className="px-3 py-2">Клиент</th>
              <th className="px-3 py-2">Текст вопроса</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Контекст: менеджер каналов</th>
              <th className="px-3 py-2">Telegram</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((request) => (
              <tr
                key={request.id}
                onClick={() => onOpenRequest(request)}
                className={`cursor-pointer transition-colors hover:bg-amber-50/50 ${request.id === selectedId ? 'bg-amber-50' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-slate-600">{formatShortDateRu(request.receivedAt)}</td>
                <td className="px-3 py-2 align-top">
                  <div className="truncate font-semibold text-slate-900" title={request.leadName}>{request.leadName}</div>
                  <div className="truncate text-xs text-slate-500" title={request.telegramUsername ? `@${request.telegramUsername}` : request.telegramUserId}>
                    {request.telegramUsername ? `@${request.telegramUsername}` : request.telegramUserId}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-slate-900">
                  <div title={request.text} className="line-clamp-2 leading-5">{request.text}</div>
                </td>
                <td className="px-3 py-2 align-top" onClick={(event) => event.stopPropagation()}>
                  <select
                    value={request.status}
                    disabled={savingId === request.leadId}
                    onChange={(event) => onUpdateStatus(request, event.target.value as SupportRequestStatus)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-900"
                  >
                    {SUPPORT_REQUEST_STATUSES.map((status) => (
                      <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 align-top text-xs leading-5 text-slate-700">
                  <ContextSummary context={request.leadContext} />
                </td>
                <td className="px-3 py-2 align-top" onClick={(event) => event.stopPropagation()}>
                  <a
                    href={request.telegramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-slate-50"
                  >
                    Telegram
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

function SupportDetailPanel({
  request,
  saving,
  onOpenLead,
  onUpdateStatus,
}: {
  request: LeadSupportRequest | null;
  saving: boolean;
  onOpenLead: (leadId: string) => void;
  onUpdateStatus: (request: LeadSupportRequest, status: SupportRequestStatus) => void;
}) {
  if (!request) {
    return (
      <aside className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Выберите вопрос поддержки.
      </aside>
    );
  }

  return (
    <aside className="rounded-md border border-amber-100 bg-white p-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-92px)] 2xl:overflow-auto">
      <div className="space-y-4">
        <DetailSection title="Вопрос поддержки">
          <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-800">{formatDateRu(request.receivedAt)}</div>
            <p className="mt-2 text-sm leading-6 text-slate-950">{request.text}</p>
          </div>
        </DetailSection>

        <DetailSection title="Клиент">
          <h2 className="truncate text-lg font-bold text-slate-900" title={request.leadName}>{request.leadName}</h2>
          <a href={request.telegramUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-semibold text-blue-700 hover:underline">
            {request.telegramUsername ? `@${request.telegramUsername}` : request.telegramUserId}
          </a>
        </DetailSection>

        <DetailSection title="Статус">
          <select
            value={request.status}
            disabled={saving}
            onChange={(event) => onUpdateStatus(request, event.target.value as SupportRequestStatus)}
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900"
          >
            {SUPPORT_REQUEST_STATUSES.map((status) => (
              <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </DetailSection>

        <DetailSection title="Контекст: менеджер каналов">
          {hasLeadContext(request.leadContext) ? (
            <SupportLeadContext context={request.leadContext} />
          ) : (
            <p className="text-sm text-slate-500">Пока не указано</p>
          )}
        </DetailSection>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <a
            href={request.telegramUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Telegram
          </a>
          <button
            type="button"
            onClick={() => onOpenLead(request.leadId)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Открыть лид
          </button>
        </div>
      </div>
    </aside>
  );
}
