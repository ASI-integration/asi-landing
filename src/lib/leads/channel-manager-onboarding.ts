export const CHANNEL_MANAGER_ONBOARDING_VERSION = 'v1' as const;

export const CHANNEL_MANAGER_ONBOARDING_STATUSES = [
  'not_started',
  'needs_access',
  'access_instructions_sent',
  'waiting_for_client',
  'access_received_offline',
  'test_object_needed',
  'test_object_selected',
  'ready_for_setup',
  'setup_in_progress',
  'ready_for_test',
  'blocked_manual_call',
  'completed',
] as const;

export type ChannelManagerOnboardingStatus = (typeof CHANNEL_MANAGER_ONBOARDING_STATUSES)[number];

export const CHANNEL_MANAGER_ONBOARDING_STATUS_LABELS: Record<ChannelManagerOnboardingStatus, string> = {
  not_started: 'не начато',
  needs_access: 'нужен доступ',
  access_instructions_sent: 'инструкция отправлена',
  waiting_for_client: 'ждём клиента',
  access_received_offline: 'доступ получен',
  test_object_needed: 'нужен тестовый объект',
  test_object_selected: 'тестовый объект выбран',
  ready_for_setup: 'готов к настройке',
  setup_in_progress: 'настройка в процессе',
  ready_for_test: 'готов к тесту',
  blocked_manual_call: 'нужен ручной созвон',
  completed: 'подключение завершено',
};

export function formatChannelManagerOnboardingStatus(status: ChannelManagerOnboardingStatus): string {
  return CHANNEL_MANAGER_ONBOARDING_STATUS_LABELS[status];
}

export type ChannelManagerName = 'RealtyCalendar' | 'Bnovo' | 'TravelLine' | 'Shelter' | 'Другой';

export type ChannelManagerTestObject = {
  name: string | null;
  external_id: string | null;
  notes: string | null;
};

export type ChannelManagerOnboarding = {
  version: typeof CHANNEL_MANAGER_ONBOARDING_VERSION;
  manager: ChannelManagerName;
  status: ChannelManagerOnboardingStatus;
  test_object: ChannelManagerTestObject;
  required_access: string[];
  checklist: string[];
  client_instruction: string;
  admin_note: string | null;
  manual_call_needed: boolean;
  manual_call_reason: string | null;
  updated_at: string;
};

export type ChannelManagerOnboardingInput = {
  answers?: Record<string, unknown> | null;
  pms?: string[] | null;
  leadStatus?: string | null;
  now?: string;
};

const UNKNOWN_MANAGER_REASON = 'Нужно уточнить менеджер каналов и способ подключения.';

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

function asBoolean(value: unknown): boolean {
  return value === true;
}

function includesAny(values: string[] | undefined | null, needles: string[]): boolean {
  const text = (values ?? []).join(' ').toLowerCase();
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

export function isChannelManagerOnboardingStatus(value: unknown): value is ChannelManagerOnboardingStatus {
  return CHANNEL_MANAGER_ONBOARDING_STATUSES.includes(value as ChannelManagerOnboardingStatus);
}

export function resolveChannelManagerName(pms?: string[] | null): ChannelManagerName | null {
  if (includesAny(pms, ['realtycalendar', 'realty calendar'])) return 'RealtyCalendar';
  if (includesAny(pms, ['bnovo'])) return 'Bnovo';
  if (includesAny(pms, ['travelline', 'travel line'])) return 'TravelLine';
  if (includesAny(pms, ['shelter'])) return 'Shelter';
  if (includesAny(pms, ['другой менеджер каналов', 'другой pms', 'менеджер каналов'])) return 'Другой';
  return null;
}

function managerAccessName(manager: ChannelManagerName): string {
  return manager === 'Другой' ? 'менеджеру каналов' : manager;
}

function requiredAccessForManager(manager: ChannelManagerName): string[] {
  if (manager === 'Другой') {
    return [
      'Уточнить, какой менеджер каналов используется.',
      'Уточнить, есть ли безопасный способ подключения без отправки паролей.',
      'Выбрать один тестовый объект.',
      'Зафиксировать ответственного за объект.',
    ];
  }

  const accessTarget = managerAccessName(manager);
  const items = [
    `Уточнить способ доступа к ${accessTarget}.`,
    `Получить приглашение, безопасный доступ или API-ключ к ${accessTarget}, если он предусмотрен.`,
    'Выбрать один тестовый объект.',
    'Проверить список подключённых каналов.',
    'Запустить тестовый сценарий автоматизации.',
    'Зафиксировать результат.',
  ];

  if (manager === 'TravelLine') {
    items.splice(1, 0, 'Проверить доступные способы интеграции TravelLine.');
  }

  return items;
}

function instructionForManager(manager: ChannelManagerName): string {
  if (manager === 'Другой') {
    return 'Сначала нужно уточнить, какой менеджер каналов используется и есть ли у него способ подключения без звонка: приглашение, API-ключ или роль пользователя.';
  }

  return [
    'Для безопасного подключения начнём с одного тестового объекта.',
    '',
    'Пожалуйста, подготовьте:',
    '',
    '1. название тестового объекта;',
    '2. список каналов, которые уже подключены;',
    `3. способ доступа к ${manager}: приглашение, роль пользователя или API-ключ, если он предусмотрен;`,
    '4. контакт ответственного за объект.',
    '',
    'Пароли в Telegram отправлять не нужно. Если потребуется доступ, согласуем безопасный способ отдельно.',
  ].join('\n');
}

export function buildChannelManagerOnboarding(
  manager: ChannelManagerName,
  now = new Date().toISOString(),
): ChannelManagerOnboarding {
  const unknown = manager === 'Другой';
  const requiredAccess = requiredAccessForManager(manager);
  return {
    version: CHANNEL_MANAGER_ONBOARDING_VERSION,
    manager,
    status: unknown ? 'blocked_manual_call' : 'needs_access',
    test_object: {
      name: null,
      external_id: null,
      notes: null,
    },
    required_access: requiredAccess,
    checklist: requiredAccess,
    client_instruction: instructionForManager(manager),
    admin_note: null,
    manual_call_needed: unknown,
    manual_call_reason: unknown ? UNKNOWN_MANAGER_REASON : null,
    updated_at: now,
  };
}

function shouldCreateOnboarding(answers: Record<string, unknown>, pms: string[], leadStatus?: string | null): boolean {
  const automation = asRecord(answers.automation);
  return (
    asString(automation.lead_scenario) === 'has_pms'
    || leadStatus === 'needs_pms_access'
    || leadStatus === 'needs_channel_manager_access'
    || resolveChannelManagerName(pms) !== null
  );
}

function parseTestObject(value: unknown): ChannelManagerTestObject {
  const testObject = asRecord(value);
  return {
    name: asString(testObject.name) || null,
    external_id: asString(testObject.external_id) || null,
    notes: asString(testObject.notes) || null,
  };
}

export function parseChannelManagerOnboarding(value: unknown): ChannelManagerOnboarding | null {
  const onboarding = asRecord(value);
  if (!Object.keys(onboarding).length) return null;
  const manager = resolveChannelManagerName([asString(onboarding.manager)]) ?? 'Другой';
  const status = isChannelManagerOnboardingStatus(onboarding.status)
    ? onboarding.status
    : manager === 'Другой'
      ? 'blocked_manual_call'
      : 'needs_access';
  return {
    version: CHANNEL_MANAGER_ONBOARDING_VERSION,
    manager,
    status,
    test_object: parseTestObject(onboarding.test_object),
    required_access: asStringArray(onboarding.required_access),
    checklist: asStringArray(onboarding.checklist),
    client_instruction: asString(onboarding.client_instruction) || instructionForManager(manager),
    admin_note: asString(onboarding.admin_note) || null,
    manual_call_needed: asBoolean(onboarding.manual_call_needed) || status === 'blocked_manual_call',
    manual_call_reason: asString(onboarding.manual_call_reason) || (manager === 'Другой' ? UNKNOWN_MANAGER_REASON : null),
    updated_at: asString(onboarding.updated_at) || new Date().toISOString(),
  };
}

export function ensureChannelManagerOnboarding(input: ChannelManagerOnboardingInput): Record<string, unknown> | null {
  const answers = asRecord(input.answers);
  const pms = input.pms ?? [
    ...asStringArray(answers.pms),
    ...asStringArray(asRecord(answers.ai_normalized).pms),
  ];
  const existing = parseChannelManagerOnboarding(answers.channel_manager_onboarding);
  if (existing) return { ...answers, channel_manager_onboarding: existing };
  if (!shouldCreateOnboarding(answers, pms, input.leadStatus)) return null;

  const manager = resolveChannelManagerName(pms) ?? 'Другой';
  return {
    ...answers,
    channel_manager_onboarding: buildChannelManagerOnboarding(manager, input.now),
  };
}

export function updateChannelManagerOnboarding(
  answersJson: Record<string, unknown> | null,
  patch: {
    status?: ChannelManagerOnboardingStatus;
    testObject?: Partial<ChannelManagerTestObject>;
    adminNote?: string;
    now?: string;
  },
): Record<string, unknown> {
  const answers = asRecord(answersJson);
  const ensured = ensureChannelManagerOnboarding({ answers, now: patch.now }) ?? answers;
  const current = parseChannelManagerOnboarding(ensured.channel_manager_onboarding)
    ?? buildChannelManagerOnboarding(resolveChannelManagerName(asStringArray(answers.pms)) ?? 'Другой', patch.now);
  const status = patch.status ?? current.status;
  return {
    ...ensured,
    channel_manager_onboarding: {
      ...current,
      status,
      test_object: {
        ...current.test_object,
        ...(patch.testObject ?? {}),
      },
      admin_note: patch.adminNote !== undefined ? patch.adminNote.trim() || null : current.admin_note,
      manual_call_needed: status === 'blocked_manual_call' ? true : current.manual_call_needed,
      manual_call_reason: status === 'blocked_manual_call'
        ? current.manual_call_reason ?? UNKNOWN_MANAGER_REASON
        : current.manual_call_reason,
      updated_at: patch.now ?? new Date().toISOString(),
    },
  };
}

export function crmStatusForOnboarding(status: ChannelManagerOnboardingStatus): string | null {
  if (status === 'needs_access') return 'needs_pms_access';
  if (status === 'access_instructions_sent') return 'instruction_sent';
  if (status === 'access_received_offline') return 'access_received';
  if (status === 'test_object_selected') return 'test_object_selected';
  if (status === 'ready_for_setup') return 'ready_for_setup';
  if (status === 'blocked_manual_call') return 'manual_reply_needed';
  if (status === 'completed') return 'qualified';
  return null;
}
