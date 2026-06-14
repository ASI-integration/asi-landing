import { computeLeadAutomation, type LeadAutomation } from '@/lib/leads/automation';

export const CRM_LEAD_STATUSES = [
  'new',
  'qualified',
  'needs_pms_access',
  'ready_for_setup',
  'manual_reply_needed',
  'pilot_candidate',
  'not_fit',
  'archived',
] as const;

export const LEGACY_LEAD_STATUSES = ['contacted', 'demo_offered', 'closed'] as const;

export const ALL_LEAD_STATUSES = [...CRM_LEAD_STATUSES, ...LEGACY_LEAD_STATUSES] as const;

export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];
export type LeadStatus = (typeof ALL_LEAD_STATUSES)[number];

export const SUPPORT_REQUEST_STATUSES = ['new', 'in_progress', 'answered', 'archived'] as const;

export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];

export type LeadSource = 'site' | 'tenchat' | 'dzen' | 'support' | 'unknown';

export type LeadAnswersJson = Record<string, unknown>;

export type LeadDbRow = {
  id: string;
  telegram_user_id: string | null;
  telegram_username: string | null;
  first_name: string | null;
  source: string | null;
  answers_json: LeadAnswersJson | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
};

export type LeadSupportRequest = {
  id: string;
  leadId: string;
  index: number;
  receivedAt: string | null;
  text: string;
  status: SupportRequestStatus;
  source: LeadSource;
  leadName: string;
  telegramUserId: string;
  telegramUsername: string | null;
  telegramUrl: string;
  leadContext: {
    object_count_range: string;
    object_types: string[];
    pms: string[];
    automation_processes: string[];
  } | null;
};

export type LeadViewModel = {
  id: string;
  createdAt: string;
  updatedAt: string | null;
  source: LeadSource;
  name: string;
  telegramUserId: string;
  telegramUsername: string | null;
  telegramUrl: string;
  objectCountRange: string;
  objectTypes: string[];
  channels: string[];
  pms: string[];
  automationProcesses: string[];
  timeConsumers: string[];
  otherTexts: Record<string, string[]>;
  comment: string;
  aiSummary: string;
  leadType: string;
  leadPotential: string;
  recommendedNextStep: string;
  status: string;
  adminNote: string;
  supportRequests: LeadSupportRequest[];
  hasSupportRequest: boolean;
  automation: LeadAutomation;
  isTestLead: boolean;
  copySummary: string;
};

const EMPTY = 'не указано';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeSource(rowSource: unknown, answers: Record<string, unknown>, hasSupportRequest: boolean): LeadSource {
  const answerSource = asString(answers.source).toLowerCase();
  const source = asString(rowSource).toLowerCase();
  const value = answerSource || source;
  if (value === 'support' || (hasSupportRequest && !['site', 'tenchat', 'dzen'].includes(value))) return 'support';
  if (value === 'site' || value === 'tenchat' || value === 'dzen') return value;
  return 'unknown';
}

function normalizeSupportStatus(value: unknown): SupportRequestStatus {
  const status = asString(value);
  return SUPPORT_REQUEST_STATUSES.includes(status as SupportRequestStatus)
    ? (status as SupportRequestStatus)
    : 'new';
}

function telegramUrl(userId: string, username: string | null): string {
  return username ? `https://t.me/${username.replace(/^@+/, '')}` : `tg://user?id=${encodeURIComponent(userId)}`;
}

function listText(values: string[]): string {
  return values.length ? values.join(', ') : EMPTY;
}

function parseOtherTexts(value: unknown): Record<string, string[]> {
  const record = asRecord(value);
  const result: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(record)) {
    const values = asStringArray(raw);
    if (values.length) result[key] = values;
  }
  return result;
}

function isTestSourceValue(value: unknown): boolean {
  const source = asString(value).toLowerCase();
  return source === 'test' || source === 'smoke' || source.includes('asi_prod_smoke');
}

function isTestLeadRow(
  row: LeadDbRow,
  answers: Record<string, unknown>,
  name: string,
  telegramUsername: string | null,
): boolean {
  const textValues = [
    name,
    telegramUsername ?? '',
    asString(row.telegram_username),
    asString(row.first_name),
  ];
  if (textValues.some((value) => value.toLowerCase().includes('asi_prod_smoke'))) return true;

  return [
    row.source,
    answers.source,
    answers.utm_source,
    answers.lead_source,
  ].some(isTestSourceValue);
}

function contextFromRecord(value: unknown): LeadSupportRequest['leadContext'] {
  const context = asRecord(value);
  const objectCount = asString(context.object_count_range);
  const objectTypes = asStringArray(context.object_types);
  const pms = asStringArray(context.pms);
  const automationProcesses = asStringArray(context.automation_processes);
  if (!objectCount && !objectTypes.length && !pms.length && !automationProcesses.length) return null;
  return {
    object_count_range: objectCount,
    object_types: objectTypes,
    pms,
    automation_processes: automationProcesses,
  };
}

function parseSupportRequests(
  lead: Pick<LeadViewModel, 'id' | 'name' | 'telegramUserId' | 'telegramUsername' | 'telegramUrl'>,
  answers: Record<string, unknown>,
  source: LeadSource,
): LeadSupportRequest[] {
  const requests = Array.isArray(answers.support_requests) ? answers.support_requests : [];
  return requests
    .map((raw, index): LeadSupportRequest | null => {
      const request = asRecord(raw);
      const text = asString(request.text);
      if (!text) return null;
      const receivedAt = asString(request.received_at) || asString(request.created_at) || null;
      const requestSource = normalizeSource(request.source, answers, true);
      return {
        id: `${lead.id}:${index}`,
        leadId: lead.id,
        index,
        receivedAt,
        text,
        status: normalizeSupportStatus(request.status),
        source: requestSource === 'unknown' ? source : requestSource,
        leadName: lead.name,
        telegramUserId: lead.telegramUserId,
        telegramUsername: lead.telegramUsername,
        telegramUrl: lead.telegramUrl,
        leadContext: contextFromRecord(request.lead_context) ?? contextFromRecord(answers.support_lead_context),
      };
    })
    .filter((request): request is LeadSupportRequest => Boolean(request));
}

export function normalizeLeadRow(row: LeadDbRow): LeadViewModel {
  const answers = asRecord(row.answers_json);
  const telegramUsername = asString(row.telegram_username).replace(/^@+/, '') || null;
  const telegramUserId = asString(row.telegram_user_id);
  const name = asString(row.first_name) || telegramUsername || telegramUserId || 'Без имени';
  const base = {
    id: row.id,
    name,
    telegramUserId,
    telegramUsername,
    telegramUrl: telegramUrl(telegramUserId, telegramUsername),
  };
  const provisionalSupport = Array.isArray(answers.support_requests) && answers.support_requests.length > 0;
  const source = normalizeSource(row.source, answers, provisionalSupport);

  const objectTypes = unique([
    ...asStringArray(answers.object_types),
    ...asStringArray(asRecord(answers.ai_normalized).object_types),
  ]);
  const channels = unique([
    ...asStringArray(answers.channels),
    ...asStringArray(asRecord(answers.ai_normalized).channels),
  ]);
  const pms = unique([
    ...asStringArray(answers.pms),
    ...asStringArray(asRecord(answers.ai_normalized).pms),
  ]);
  const automationProcesses = unique([
    ...asStringArray(answers.automation_processes),
    ...asStringArray(asRecord(answers.ai_normalized).automation_processes),
  ]);
  const timeConsumers = unique([
    ...asStringArray(answers.time_consumers),
    ...asStringArray(asRecord(answers.ai_normalized).time_consumers),
  ]);
  const otherTexts = parseOtherTexts(answers.other_texts);
  const comment = asString(answers.comment) || (otherTexts.comment ?? []).join(' / ');
  const adminNote = asString(answers.admin_note);
  const supportRequests = parseSupportRequests(base, answers, source);
  const hasOpenSupportRequest = supportRequests.some(
    (request) => request.status === 'new' || request.status === 'in_progress',
  );
  const automation = computeLeadAutomation({
    objectCountRange: asString(answers.object_count_range),
    objectTypes,
    channels,
    pms,
    automationProcesses,
    timeConsumers,
    comment,
    otherTexts,
    leadPotential: asString(answers.lead_potential),
    source,
    hasSupportRequest: supportRequests.length > 0,
    hasOpenSupportRequest,
  });
  const lead: LeadViewModel = {
    ...base,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: supportRequests.length && source === 'unknown' ? 'support' : source,
    objectCountRange: asString(answers.object_count_range),
    objectTypes,
    channels,
    pms,
    automationProcesses,
    timeConsumers,
    otherTexts,
    comment,
    aiSummary: asString(answers.ai_summary),
    leadType: asString(answers.lead_type),
    leadPotential: asString(answers.lead_potential),
    recommendedNextStep: asString(answers.recommended_next_step),
    status: asString(row.status) || 'new',
    adminNote,
    supportRequests,
    hasSupportRequest: supportRequests.length > 0,
    automation,
    isTestLead: isTestLeadRow(row, answers, name, telegramUsername),
    copySummary: '',
  };
  lead.copySummary = buildLeadCopySummary(lead);
  return lead;
}

export function buildLeadCopySummary(lead: Pick<LeadViewModel,
  'name' | 'telegramUsername' | 'objectCountRange' | 'pms' | 'automationProcesses' | 'aiSummary' | 'recommendedNextStep'
>): string {
  const username = lead.telegramUsername ? ` (@${lead.telegramUsername})` : '';
  return [
    `Лид: ${lead.name}${username}`,
    `Объектов: ${lead.objectCountRange || EMPTY}`,
    `Менеджер каналов: ${listText(lead.pms)}`,
    `Хочет автоматизировать: ${listText(lead.automationProcesses)}`,
    `AI-сводка: ${lead.aiSummary || EMPTY}`,
    `Следующий шаг: ${lead.recommendedNextStep || EMPTY}`,
  ].join('\n');
}

function createdTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function getLatestLeadsByTelegramId<T extends Pick<LeadViewModel, 'id' | 'telegramUserId' | 'createdAt'>>(
  leads: readonly T[],
): T[] {
  const latestByKey = new Map<string, T>();

  for (const lead of leads) {
    const key = lead.telegramUserId ? `telegram:${lead.telegramUserId}` : `lead:${lead.id}`;
    const current = latestByKey.get(key);
    if (!current || createdTime(lead.createdAt) > createdTime(current.createdAt)) {
      latestByKey.set(key, lead);
    }
  }

  return Array.from(latestByKey.values()).sort((left, right) => createdTime(right.createdAt) - createdTime(left.createdAt));
}

export function getLeadHistoryByTelegramId<T extends Pick<LeadViewModel, 'id' | 'telegramUserId' | 'createdAt'>>(
  leads: readonly T[],
  lead: T | null,
): T[] {
  if (!lead) return [];
  if (!lead.telegramUserId) return [lead];

  return leads
    .filter((candidate) => candidate.telegramUserId === lead.telegramUserId)
    .sort((left, right) => createdTime(right.createdAt) - createdTime(left.createdAt));
}

export function isCrmLeadStatus(value: unknown): value is CrmLeadStatus {
  return CRM_LEAD_STATUSES.includes(value as CrmLeadStatus);
}

export function isSupportRequestStatus(value: unknown): value is SupportRequestStatus {
  return SUPPORT_REQUEST_STATUSES.includes(value as SupportRequestStatus);
}

export function answersJsonWithAdminNote(answersJson: LeadAnswersJson | null, adminNote: string): LeadAnswersJson {
  return {
    ...asRecord(answersJson),
    admin_note: adminNote.trim(),
  };
}

export function answersJsonWithSupportStatus(
  answersJson: LeadAnswersJson | null,
  index: number,
  status: SupportRequestStatus,
): LeadAnswersJson | null {
  const answers = asRecord(answersJson);
  const requests = Array.isArray(answers.support_requests) ? answers.support_requests : [];
  if (!Number.isInteger(index) || index < 0 || index >= requests.length) return null;
  return {
    ...answers,
    support_requests: requests.map((request, currentIndex) => (
      currentIndex === index ? { ...asRecord(request), status } : request
    )),
  };
}
