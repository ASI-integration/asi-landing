/**
 * Lead automation layer v1 (rule-based, no AI).
 *
 * Single source of truth for classifying a lead questionnaire into a scenario,
 * a CRM status suggestion, a precise next step, a manual-reply signal and an
 * onboarding checklist. Works fully without AI: any AI summary is only an
 * auxiliary layer applied elsewhere.
 */

export const AUTOMATION_VERSION = 'v1' as const;

export type LeadScenario =
  | 'has_pms'
  | 'no_pms_manual'
  | 'choosing_pms'
  | 'support_question'
  | 'high_value_operator'
  | 'small_host'
  | 'commercial_property'
  | 'mixed_portfolio'
  | 'unclear';

export type ManualReplyReason =
  | 'support_question'
  | 'needs_pms_access'
  | 'unclear_pms'
  | 'high_value_lead'
  | 'custom_other_text'
  | 'none';

export type PmsState = 'has_pms' | 'no_pms_manual' | 'choosing_pms' | 'unknown';

export type LeadPotential = 'низкий' | 'средний' | 'высокий';

/** Subset of CRM statuses the automation may suggest. */
export type AutomationStatus =
  | 'new'
  | 'qualified'
  | 'needs_pms_access'
  | 'manual_reply_needed'
  | 'pilot_candidate';

export type LeadAutomationInput = {
  objectCountRange?: string | null;
  objectTypes?: string[];
  channels?: string[];
  pms?: string[];
  automationProcesses?: string[];
  timeConsumers?: string[];
  comment?: string | null;
  otherTexts?: Record<string, string[]>;
  leadPotential?: string | null;
  source?: string | null;
  hasSupportRequest?: boolean;
  hasOpenSupportRequest?: boolean;
};

export type LeadAutomation = {
  version: typeof AUTOMATION_VERSION;
  scenario: LeadScenario;
  pmsState: PmsState;
  manualReplyNeeded: boolean;
  manualReplyReason: ManualReplyReason;
  potential: LeadPotential;
  nextStep: string;
  onboardingChecklist: string[];
  suggestedStatus: AutomationStatus;
};

const HAS_PMS_CHECKLIST = [
  'Уточнить PMS/МК',
  'Получить доступ / API / приглашение',
  'Выбрать тестовый объект',
  'Проверить список каналов',
  'Запустить тестовый сценарий автоматизации',
  'Зафиксировать результат',
];

const NO_PMS_CHECKLIST = [
  'Уточнить список объектов',
  'Уточнить каналы',
  'Выбрать PMS/МК или временный ручной режим',
  'Собрать данные тестового объекта',
  'Настроить базовый сценарий коммуникации',
  'Подготовить подключение каналов',
];

const SUPPORT_CHECKLIST = [
  'Прочитать вопрос',
  'Проверить контекст лида',
  'Ответить вручную или пометить как FAQ',
  'При необходимости перевести в заявку',
];

const CLARIFY_CHECKLIST = [
  'Запросить количество и тип объектов',
  'Уточнить используемые каналы',
  'Уточнить наличие PMS/МК',
];

const NEXT_STEP = {
  realtycalendar:
    'Запросить доступ или приглашение к RealtyCalendar и выбрать один тестовый объект для безопасного подключения.',
  bnovo:
    'Уточнить доступ к Bnovo и подготовить тестовый объект для проверки коммуникаций и операционных сценариев.',
  travelline:
    'Проверить доступные способы интеграции TravelLine и определить тестовый объект.',
  hasPmsGeneric:
    'Уточнить PMS/МК, запросить доступ или приглашение и выбрать один тестовый объект для безопасного подключения.',
  noPmsManual:
    'Помочь выбрать PMS/МК или начать с базовой структуры объекта и каналов.',
  choosingPms:
    'Собрать текущие каналы и требования, затем предложить подходящий сценарий подключения PMS/МК.',
  support:
    'Ответить на вопрос поддержки и при необходимости перевести в заявку.',
  clarify:
    'Запросить недостающие данные по объектам, каналам и PMS/МК, чтобы продолжить квалификацию.',
} as const;

function hasAny(values: string[] | undefined | null, needles: string[]): boolean {
  const text = (values ?? []).join(' ').toLowerCase();
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function objectCountWeight(range?: string | null): number {
  const value = (range ?? '').trim();
  if (value === '20+' || value.includes('20+')) return 4;
  if (value === '6-20') return 3;
  if (value === '2-5') return 2;
  if (value === '1') return 1;
  return 0;
}

function resolvePmsState(pms?: string[]): PmsState {
  if (hasAny(pms, ['вручную'])) return 'no_pms_manual';
  if (hasAny(pms, ['только выбираем', 'выбираем', 'подключаем'])) return 'choosing_pms';
  if (hasAny(pms, [
    'bnovo',
    'realtycalendar',
    'realty calendar',
    'travelline',
    'travel line',
    'shelter',
    'другой pms',
    'менеджер каналов',
  ])) {
    return 'has_pms';
  }
  return 'unknown';
}

function isUnrecognizedPms(pms?: string[]): boolean {
  return hasAny(pms, ['другой pms']);
}

function isMiniHotel(objectTypes?: string[]): boolean {
  return hasAny(objectTypes, ['мини-отель', 'мини отель', 'апарт-отель', 'апарт отель']);
}

function isCommercial(objectTypes?: string[]): boolean {
  return hasAny(objectTypes, ['коммерческ']);
}

function isMixedPortfolio(objectTypes?: string[]): boolean {
  return hasAny(objectTypes, ['смешан']);
}

function collectFreeText(input: LeadAutomationInput): string {
  const parts: string[] = [];
  if (input.comment) parts.push(input.comment);
  if (input.otherTexts) {
    for (const values of Object.values(input.otherTexts)) {
      if (Array.isArray(values)) parts.push(values.join(' '));
    }
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Detects an explicit large portfolio mentioned in free-text answers, e.g.
 * "30 объектов", "много квартир". Stays conservative: a number only counts
 * when it sits next to an object-like noun and is at least 6.
 */
function manyObjectsInFreeText(input: LeadAutomationInput): boolean {
  const text = collectFreeText(input);
  if (!text) return false;
  if (/много\s+(?:объект|кварти|апартам|номер)/.test(text)) return true;
  const match = text.match(/(\d{1,4})\s*(?:объект|кварти|апартам|номер)/);
  return Boolean(match && Number(match[1]) >= 6);
}

/**
 * A lead only qualifies as a high-value operator on strong structural signals:
 * 6–20 / 20+ objects, a mini/apart-hotel, a mixed portfolio, commercial real
 * estate with several objects, or an explicit large portfolio in free text.
 * A single object without these signals is never high value.
 */
function resolveHighValue(input: LeadAutomationInput, weight: number): boolean {
  if (weight >= 3) return true;
  if (isMiniHotel(input.objectTypes)) return true;
  if (isMixedPortfolio(input.objectTypes)) return true;
  if (isCommercial(input.objectTypes) && weight >= 2) return true;
  return manyObjectsInFreeText(input);
}

function resolvePotential(input: LeadAutomationInput, weight: number): LeadPotential {
  if (isMiniHotel(input.objectTypes)) return 'высокий';
  if (weight >= 3) return 'высокий';
  if (isCommercial(input.objectTypes) || isMixedPortfolio(input.objectTypes)) {
    return weight >= 2 ? 'высокий' : 'средний';
  }
  if (manyObjectsInFreeText(input)) return 'высокий';
  if (weight >= 2) return 'средний';
  if (weight === 1) {
    const painCount = (input.automationProcesses?.length ?? 0) + (input.timeConsumers?.length ?? 0);
    return painCount >= 3 ? 'средний' : 'низкий';
  }
  return 'низкий';
}

function hasCustomOtherText(otherTexts?: Record<string, string[]>): boolean {
  if (!otherTexts) return false;
  return Object.entries(otherTexts).some(
    ([key, values]) => key !== 'comment' && Array.isArray(values) && values.length > 0,
  );
}

function isInsufficient(input: LeadAutomationInput, pmsState: PmsState): boolean {
  return (
    pmsState === 'unknown' &&
    !((input.objectCountRange ?? '').trim()) &&
    !(input.objectTypes?.length ?? 0) &&
    !(input.automationProcesses?.length ?? 0) &&
    !(input.timeConsumers?.length ?? 0) &&
    !(input.channels?.length ?? 0)
  );
}

function resolveNextStep(pmsState: PmsState, pms: string[] | undefined, supportOnly: boolean, insufficient: boolean): string {
  if (supportOnly) return NEXT_STEP.support;
  if (pmsState === 'has_pms') {
    if (hasAny(pms, ['realtycalendar', 'realty calendar'])) return NEXT_STEP.realtycalendar;
    if (hasAny(pms, ['bnovo'])) return NEXT_STEP.bnovo;
    if (hasAny(pms, ['travelline', 'travel line'])) return NEXT_STEP.travelline;
    return NEXT_STEP.hasPmsGeneric;
  }
  if (pmsState === 'no_pms_manual') return NEXT_STEP.noPmsManual;
  if (pmsState === 'choosing_pms') return NEXT_STEP.choosingPms;
  if (insufficient) return NEXT_STEP.clarify;
  return NEXT_STEP.clarify;
}

function resolveChecklist(pmsState: PmsState, supportOnly: boolean, insufficient: boolean): string[] {
  if (supportOnly) return [...SUPPORT_CHECKLIST];
  if (pmsState === 'has_pms') return [...HAS_PMS_CHECKLIST];
  if (pmsState === 'no_pms_manual' || pmsState === 'choosing_pms') return [...NO_PMS_CHECKLIST];
  if (insufficient) return [...CLARIFY_CHECKLIST];
  return [...CLARIFY_CHECKLIST];
}

function resolveScenario(
  input: LeadAutomationInput,
  pmsState: PmsState,
  supportOnly: boolean,
  insufficient: boolean,
  highValue: boolean,
): LeadScenario {
  if (supportOnly) return 'support_question';
  if (insufficient) return 'unclear';
  if (hasAny(input.objectTypes, ['коммерческ'])) return 'commercial_property';
  if (hasAny(input.objectTypes, ['смешан'])) return 'mixed_portfolio';
  if (highValue) return 'high_value_operator';
  if (pmsState === 'has_pms') return 'has_pms';
  if (pmsState === 'choosing_pms') return 'choosing_pms';
  if (pmsState === 'no_pms_manual') return 'no_pms_manual';
  if (objectCountWeight(input.objectCountRange) === 1) return 'small_host';
  return 'unclear';
}

function resolveStatus(
  pmsState: PmsState,
  supportOnly: boolean,
  insufficient: boolean,
  highValue: boolean,
): AutomationStatus {
  if (supportOnly) return 'manual_reply_needed';
  if (insufficient) return 'new';
  if (pmsState === 'has_pms') return 'needs_pms_access';
  if (pmsState === 'no_pms_manual') return 'qualified';
  if (pmsState === 'choosing_pms') return 'qualified';
  if (highValue) return 'pilot_candidate';
  return 'new';
}

function resolveManualReply(
  input: LeadAutomationInput,
  supportSignal: boolean,
  highValue: boolean,
): { needed: boolean; reason: ManualReplyReason } {
  if (supportSignal) return { needed: true, reason: 'support_question' };
  if (highValue) return { needed: true, reason: 'high_value_lead' };
  // Commercial / mixed portfolios always need a human look, even with a single
  // object, because the operational picture is non-standard.
  if (isCommercial(input.objectTypes) || isMixedPortfolio(input.objectTypes)) {
    return { needed: true, reason: 'high_value_lead' };
  }
  if (isUnrecognizedPms(input.pms)) return { needed: true, reason: 'unclear_pms' };
  if (hasCustomOtherText(input.otherTexts)) return { needed: true, reason: 'custom_other_text' };
  return { needed: false, reason: 'none' };
}

export function computeLeadAutomation(input: LeadAutomationInput): LeadAutomation {
  const pmsState = resolvePmsState(input.pms);
  const insufficient = isInsufficient(input, pmsState);
  const hasSupport = Boolean(input.hasSupportRequest);
  const openSupport = input.hasOpenSupportRequest === undefined ? hasSupport : Boolean(input.hasOpenSupportRequest);
  // A lead is "support only" when it carries a support question but the
  // questionnaire itself is essentially empty (a pure support contact).
  const supportOnly = hasSupport && insufficient;
  const weight = objectCountWeight(input.objectCountRange);
  const highValue = resolveHighValue(input, weight);

  const scenario = resolveScenario(input, pmsState, supportOnly, insufficient, highValue);
  const { needed, reason } = resolveManualReply(input, openSupport || supportOnly, highValue);
  const potential = supportOnly || insufficient ? 'низкий' : resolvePotential(input, weight);

  return {
    version: AUTOMATION_VERSION,
    scenario,
    pmsState,
    manualReplyNeeded: needed,
    manualReplyReason: reason,
    potential,
    nextStep: resolveNextStep(pmsState, input.pms, supportOnly, insufficient),
    onboardingChecklist: resolveChecklist(pmsState, supportOnly, insufficient),
    suggestedStatus: resolveStatus(pmsState, supportOnly, insufficient, highValue),
  };
}

/** Snake_case serialization for safe storage inside `answers_json.automation`. */
export function serializeLeadAutomation(automation: LeadAutomation): Record<string, unknown> {
  return {
    version: automation.version,
    lead_scenario: automation.scenario,
    pms_state: automation.pmsState,
    manual_reply_needed: automation.manualReplyNeeded,
    manual_reply_reason: automation.manualReplyReason,
    potential: automation.potential,
    recommended_next_step: automation.nextStep,
    onboarding_checklist: automation.onboardingChecklist,
    suggested_status: automation.suggestedStatus,
  };
}
