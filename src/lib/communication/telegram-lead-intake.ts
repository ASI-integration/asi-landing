import { normalizeAsiFeedbackLeadSource, type AsiFeedbackLeadSource } from '@/config/publicTelegram';
import {
  computeLeadAutomation,
  serializeLeadAutomation,
  type LeadAutomation,
  type LeadAutomationInput,
  type LeadScenario,
  type ManualReplyReason,
  type PmsState,
} from '@/lib/leads/automation';
import { callLLM } from '@/lib/openai';
import { supabase } from '@/lib/supabase';
import {
  answerTelegramCallbackQuery,
  editTelegramMessageText,
  replyToTelegram,
  sendTelegramMessageToChat,
  type TelegramSendOptions,
} from '@/lib/telegram';
import { MessageCategory, ProcessOutcome, type ProcessResult, type TelegramUpdate } from './types';

type LeadFlowStep =
  | 'menu'
  | 'object_count'
  | 'object_types'
  | 'channels'
  | 'pms'
  | 'automation_processes'
  | 'time_consumers'
  | 'comment'
  | 'support'
  | 'completed';

type LeadMultiStep = 'object_types' | 'channels' | 'automation_processes' | 'time_consumers';
type LeadOtherStep = LeadMultiStep | 'pms';
type LeadQuestionStep = Exclude<LeadFlowStep, 'menu' | 'support' | 'completed'>;
type LeadPotential = 'низкий' | 'средний' | 'высокий';
type LeadType =
  | 'новичок без PMS/МК'
  | 'посуточник с PMS/МК'
  | 'управляющий несколькими объектами'
  | 'мини-отель / апарт-отель'
  | 'коммерческая недвижимость'
  | 'смешанный портфель';
type RecommendedNextStep =
  | 'предложить демо коммуникационного модуля'
  | 'предложить разбор операционки'
  | 'предложить помощь с подключением каналов'
  | 'предложить сбор данных по объектам'
  | 'пока только сохранить лид';

type LeadAiNormalized = {
  object_types?: string[];
  channels?: string[];
  pms?: string[];
  automation_processes?: string[];
  time_consumers?: string[];
};

type SupportRequestSource = AsiFeedbackLeadSource | 'support';

type SupportLeadContext = {
  object_count_range?: string;
  object_types?: string[];
  pms?: string[];
  automation_processes?: string[];
};

type SupportRequest = {
  source: SupportRequestSource;
  text: string;
  status: 'new';
  received_at: string;
  lead_context?: SupportLeadContext;
  support_ai_intent: string | null;
  support_ai_summary: string | null;
  support_auto_reply_eligible: boolean;
};

type LeadAnswers = {
  object_count_range?: string;
  object_types?: string[];
  channels?: string[];
  pms?: string[];
  automation_processes?: string[];
  time_consumers?: string[];
  other_texts?: Partial<Record<LeadOtherStep | 'comment', string[]>>;
  comment?: string;
  ai_normalized?: LeadAiNormalized;
  ai_summary?: string;
  lead_type?: LeadType;
  lead_potential?: LeadPotential;
  recommended_next_step?: RecommendedNextStep;
  source?: SupportRequestSource;
  support_requests?: SupportRequest[];
  support_lead_context?: SupportLeadContext;
  automation?: {
    version?: string;
    lead_scenario?: LeadScenario;
    pms_state?: PmsState;
    manual_reply_needed?: boolean;
    manual_reply_reason?: ManualReplyReason;
    recommended_next_step?: string;
    onboarding_checklist?: string[];
    suggested_status?: string;
  };
  flow?: {
    step: LeadFlowStep;
    awaiting_text_for?: LeadOtherStep | 'comment';
    completed_at?: string;
  };
};

type LeadRow = {
  id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  first_name: string | null;
  source: AsiFeedbackLeadSource;
  answers_json: LeadAnswers | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type TelegramLeadUser = {
  telegram_user_id: string;
  telegram_username: string | null;
  first_name: string | null;
  chat_id: number;
};

type LeadOption = {
  id: string;
  label: string;
};

type ParsedCallback =
  | { kind: 'select'; step: 'object_count' | 'pms'; id: string }
  | { kind: 'toggle'; step: LeadMultiStep; id: string }
  | { kind: 'done'; step: LeadMultiStep }
  | { kind: 'other'; step: LeadOtherStep }
  | { kind: 'start_lead' }
  | { kind: 'support' }
  | { kind: 'skip_comment' }
  | { kind: 'back' };

const START_RE = /^\/start(?:@\w+)?(?:\s+(.+))?$/i;
const SUPPORT_COMMAND_RE = /^\/support(?:@\w+)?$/i;
const CALLBACK_PREFIX = 'ali2';

const STEP_ORDER: LeadFlowStep[] = [
  'object_count',
  'object_types',
  'channels',
  'pms',
  'automation_processes',
  'time_consumers',
  'comment',
  'completed',
];

const STEP_LABELS: Record<LeadQuestionStep, string> = {
  object_count: 'Сколько объектов у вас сейчас?',
  object_types: 'Какой тип объектов у вас основной? Можно выбрать несколько.',
  channels: 'Какие каналы уже используете? Можно выбрать несколько.',
  pms: 'Используете ли PMS или менеджер каналов?',
  automation_processes: 'Какие процессы хотите автоматизировать? Можно выбрать несколько.',
  time_consumers: 'Что сейчас больше всего съедает время? Можно выбрать несколько.',
  comment: 'Можно коротко описать ситуацию своими словами или нажать «Пропустить».',
};

const GUEST_COMMUNICATION_AUTOREPLIES = 'Общение с гостями и автоответы';
const LEGACY_GUEST_COMMUNICATION_PROCESS_LABELS = new Set([
  'Общение с гостями',
  'Повторяющиеся вопросы',
]);

const OPTIONS: Record<Exclude<LeadQuestionStep, 'comment'>, LeadOption[]> = {
  object_count: [
    { id: '1', label: '1' },
    { id: '2_5', label: '2-5' },
    { id: '6_20', label: '6-20' },
    { id: '20_plus', label: '20+' },
  ],
  object_types: [
    { id: 'apartments', label: 'Квартиры' },
    { id: 'apart_homes', label: 'Апартаменты' },
    { id: 'houses', label: 'Дома / коттеджи' },
    { id: 'mini_hotel', label: 'Мини-отель / апарт-отель' },
    { id: 'commercial', label: 'Коммерческая недвижимость' },
    { id: 'mixed', label: 'Смешанный портфель' },
    { id: 'other', label: 'Другое' },
  ],
  channels: [
    { id: 'avito', label: 'Авито' },
    { id: 'sutochno', label: 'Суточно' },
    { id: 'ostrovok', label: 'Островок' },
    { id: 'yandex_travel', label: 'Яндекс Путешествия' },
    { id: 'cian', label: 'Циан' },
    { id: 'own_site', label: 'Свой сайт' },
    { id: 'social', label: 'Соцсети / мессенджеры' },
    { id: 'none', label: 'Пока не используем' },
    { id: 'other', label: 'Другое' },
  ],
  pms: [
    { id: 'bnovo', label: 'Bnovo' },
    { id: 'realtycalendar', label: 'RealtyCalendar' },
    { id: 'travelline', label: 'TravelLine' },
    { id: 'shelter', label: 'Shelter' },
    { id: 'other', label: 'Другой PMS / менеджер каналов' },
    { id: 'manual', label: 'Нет, всё ведём вручную' },
    { id: 'choosing', label: 'Только выбираем / подключаем' },
  ],
  automation_processes: [
    { id: 'guest_messages', label: GUEST_COMMUNICATION_AUTOREPLIES },
    { id: 'checkin', label: 'Инструкции по заселению' },
    { id: 'cleaning_tasks', label: 'Уборки и задачи персоналу' },
    { id: 'readiness', label: 'Контроль готовности объекта' },
    { id: 'pricing_load', label: 'Цены и загрузка' },
    { id: 'content_data', label: 'Фото, описания и данные объектов' },
    { id: 'reports', label: 'Отчётность' },
    { id: 'ota_channels', label: 'Подключение каналов / OTA' },
    { id: 'pms_work', label: 'Работа с PMS / менеджером каналов' },
    { id: 'other', label: 'Другое' },
  ],
  time_consumers: [
    { id: 'messages', label: 'Переписка с гостями' },
    { id: 'checkin', label: 'Заселение и инструкции' },
    { id: 'cleaning', label: 'Координация уборок' },
    { id: 'listing_updates', label: 'Обновление данных на площадках' },
    { id: 'prices', label: 'Контроль цен и загрузки' },
    { id: 'reports', label: 'Отчёты' },
    { id: 'new_objects', label: 'Подключение новых объектов' },
    { id: 'dont_know', label: 'Не понимаю, с чего начать' },
    { id: 'other', label: 'Другое' },
  ],
};

const MULTI_STEPS = new Set<LeadFlowStep>(['object_types', 'channels', 'automation_processes', 'time_consumers']);

const FINAL_REPLY =
  'Спасибо, заявку получил. По вашим ответам видно, какие процессы можно автоматизировать в первую очередь. Мы свяжемся с вами или предложим демо, если формат подходит для пилота ASI.';

const FINAL_REPLY_HAS_PMS =
  'Спасибо, заявку получил. Вижу, что у вас уже есть PMS/МК. Следующий шаг — выбрать один тестовый объект и подготовить доступ или приглашение к системе, чтобы проверить автоматизацию без риска для всех объектов.';

const FINAL_REPLY_NO_PMS =
  'Спасибо, заявку получил. Судя по ответам, сначала нужно выстроить базовую схему: объекты, каналы и процессы. Мы можем начать с одного тестового объекта и постепенно довести до подключения PMS/МК.';

const MAIN_MENU_REPLY = 'Выберите, что хотите сделать:';

const SUPPORT_PROMPT =
  'Напишите вопрос одним сообщением. Я передам его администратору ASI. Позже часть ответов будет обрабатываться автоматически.';

const SUPPORT_CONFIRMATION =
  'Спасибо, вопрос получил. Передал администратору ASI. Если вопрос требует ручного ответа, мы свяжемся с вами.';

const STORAGE_ERROR_REPLY =
  'Не удалось сохранить заявку. Попробуйте начать ещё раз позже или напишите нам обычным сообщением.';

function getAdminChatId(): string | null {
  const explicit = process.env.ASI_FEEDBACK_ADMIN_CHAT_ID?.trim();
  return explicit || null;
}

function getAsiFeedbackTelegramSendOptions(): TelegramSendOptions {
  return {
    botToken: process.env.ASI_FEEDBACK_BOT_TOKEN?.trim() || null,
    tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN',
  };
}

function extractMessage(update: TelegramUpdate) {
  return update.message ?? update.edited_message ?? null;
}

export function parseAsiFeedbackStartSource(text: string): AsiFeedbackLeadSource | null {
  const match = text.trim().match(START_RE);
  if (!match) return null;
  return normalizeAsiFeedbackLeadSource(match[1] ?? 'unknown');
}

function getTelegramLeadUser(update: TelegramUpdate): TelegramLeadUser | null {
  const message = extractMessage(update) ?? update.callback_query?.message ?? null;
  const from = update.callback_query?.from ?? message?.from;
  const userId = from?.id ?? message?.chat?.id;
  const chatId = message?.chat?.id;
  if (!userId || !chatId) return null;

  return {
    telegram_user_id: String(userId),
    telegram_username: from?.username?.trim() || null,
    first_name: from?.first_name?.trim() || null,
    chat_id: chatId,
  };
}

function callbackData(callback: ParsedCallback): string {
  if (callback.kind === 'select') return `${CALLBACK_PREFIX}:s:${callback.step}:${callback.id}`;
  if (callback.kind === 'toggle') return `${CALLBACK_PREFIX}:t:${callback.step}:${callback.id}`;
  if (callback.kind === 'done') return `${CALLBACK_PREFIX}:d:${callback.step}`;
  if (callback.kind === 'other') return `${CALLBACK_PREFIX}:o:${callback.step}`;
  if (callback.kind === 'start_lead') return `${CALLBACK_PREFIX}:lead`;
  if (callback.kind === 'support') return `${CALLBACK_PREFIX}:support`;
  if (callback.kind === 'skip_comment') return `${CALLBACK_PREFIX}:skip`;
  return `${CALLBACK_PREFIX}:back`;
}

function parseCallbackData(data: string | undefined): ParsedCallback | null {
  const parts = String(data ?? '').split(':');
  if (parts[0] !== CALLBACK_PREFIX) return null;

  if (parts[1] === 's' && (parts[2] === 'object_count' || parts[2] === 'pms') && parts[3]) {
    return { kind: 'select', step: parts[2], id: parts[3] };
  }
  if (parts[1] === 't' && isMultiStep(parts[2]) && parts[3]) {
    return { kind: 'toggle', step: parts[2], id: parts[3] };
  }
  if (parts[1] === 'd' && isMultiStep(parts[2])) return { kind: 'done', step: parts[2] };
  if (parts[1] === 'o' && isOtherStep(parts[2])) return { kind: 'other', step: parts[2] };
  if (parts[1] === 'lead') return { kind: 'start_lead' };
  if (parts[1] === 'support') return { kind: 'support' };
  if (parts[1] === 'skip') return { kind: 'skip_comment' };
  if (parts[1] === 'back') return { kind: 'back' };
  return null;
}

function isMultiStep(value: unknown): value is LeadMultiStep {
  return value === 'object_types' || value === 'channels' || value === 'automation_processes' || value === 'time_consumers';
}

function isOtherStep(value: unknown): value is LeadOtherStep {
  return isMultiStep(value) || value === 'pms';
}

function optionLabel(step: Exclude<LeadQuestionStep, 'comment'>, id: string): string | null {
  const label = OPTIONS[step].find((option) => option.id === id)?.label;
  if (label) return label;
  if (step === 'automation_processes' && id === 'faq') return GUEST_COMMUNICATION_AUTOREPLIES;
  return null;
}

function stepAnswerKey(step: LeadMultiStep): keyof Pick<LeadAnswers, 'object_types' | 'channels' | 'automation_processes' | 'time_consumers'> {
  return step;
}

function selectedForStep(answers: LeadAnswers, step: LeadMultiStep): string[] {
  const value = answers[stepAnswerKey(step)];
  if (step === 'automation_processes') return normalizeAutomationProcesses(value);
  return Array.isArray(value) ? value : [];
}

function setSelectedForStep(answers: LeadAnswers, step: LeadMultiStep, selected: string[]): LeadAnswers {
  return {
    ...answers,
    [stepAnswerKey(step)]: step === 'automation_processes' ? normalizeAutomationProcesses(selected) : selected,
  };
}

function nextStep(step: LeadFlowStep): LeadFlowStep {
  const idx = STEP_ORDER.indexOf(step);
  return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)] ?? 'completed';
}

function previousStep(step: LeadFlowStep): LeadFlowStep {
  const idx = STEP_ORDER.indexOf(step);
  return STEP_ORDER[Math.max(idx - 1, 0)] ?? 'object_count';
}

function withFlow(answers: LeadAnswers, step: LeadFlowStep, extra: Partial<NonNullable<LeadAnswers['flow']>> = {}): LeadAnswers {
  return {
    ...answers,
    flow: {
      step,
      ...extra,
    },
  };
}

function addOtherText(answers: LeadAnswers, step: LeadOtherStep | 'comment', text: string): LeadAnswers {
  const clean = text.trim();
  if (!clean) return answers;
  const current = answers.other_texts?.[step] ?? [];
  return {
    ...answers,
    other_texts: {
      ...(answers.other_texts ?? {}),
      [step]: [...current, clean].slice(-5),
    },
  };
}

function chunkRows(buttons: Array<{ text: string; callback_data: string }>, columns = 2) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += columns) rows.push(buttons.slice(i, i + columns));
  return rows;
}

function mainMenuKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: 'Оставить заявку', callback_data: callbackData({ kind: 'start_lead' }) }],
      [{ text: 'Задать вопрос / поддержка', callback_data: callbackData({ kind: 'support' }) }],
    ],
  };
}

function supportKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: 'Оставить заявку', callback_data: callbackData({ kind: 'start_lead' }) }],
      [{ text: 'Назад', callback_data: callbackData({ kind: 'back' }) }],
    ],
  };
}

function keyboardForStep(step: LeadFlowStep, answers: LeadAnswers): Record<string, unknown> | null {
  if (step === 'menu') return mainMenuKeyboard();
  if (step === 'support') return supportKeyboard();
  if (step === 'completed') return null;
  if (step === 'comment') {
    return {
      inline_keyboard: [
        [
          { text: 'Пропустить', callback_data: callbackData({ kind: 'skip_comment' }) },
          { text: 'Назад', callback_data: callbackData({ kind: 'back' }) },
        ],
      ],
    };
  }

  if (step === 'object_count' || step === 'pms') {
    const selected = step === 'object_count' ? answers.object_count_range : answers.pms?.[0];
    const rows = chunkRows(
      OPTIONS[step].map((option) => ({
        text: `${selected === option.label ? '✓ ' : ''}${option.label}`,
        callback_data:
          option.id === 'other' && step === 'pms'
            ? callbackData({ kind: 'other', step })
            : callbackData({ kind: 'select', step, id: option.id }),
      })),
      2,
    );
    if (step !== 'object_count') rows.push([{ text: 'Назад', callback_data: callbackData({ kind: 'back' }) }]);
    return { inline_keyboard: rows };
  }

  const selected = new Set(selectedForStep(answers, step));
  const rows = chunkRows(
    OPTIONS[step].map((option) => ({
      text: `${selected.has(option.label) ? '✓ ' : ''}${option.label}`,
      callback_data:
        option.id === 'other'
          ? callbackData({ kind: 'other', step })
          : callbackData({ kind: 'toggle', step, id: option.id }),
    })),
    2,
  );
  rows.push([
    { text: 'Готово', callback_data: callbackData({ kind: 'done', step }) },
    { text: 'Назад', callback_data: callbackData({ kind: 'back' }) },
  ]);
  return { inline_keyboard: rows };
}

function questionText(step: LeadFlowStep, answers: LeadAnswers): string {
  if (step === 'menu') return MAIN_MENU_REPLY;
  if (step === 'support') return SUPPORT_PROMPT;
  if (step === 'completed') return FINAL_REPLY;
  const selected = isMultiStep(step) ? selectedForStep(answers, step) : [];
  if (!selected.length) return STEP_LABELS[step];
  return `${STEP_LABELS[step]}\n\nВыбрано: ${selected.join(', ')}`;
}

async function sendQuestion(user: TelegramLeadUser, step: LeadFlowStep, answers: LeadAnswers, updateId?: number): Promise<void> {
  await replyToTelegram(
    user.chat_id,
    questionText(step, answers),
    { handler: 'asi_feedback_lead_intake/question', update_id: updateId },
    { ...getAsiFeedbackTelegramSendOptions(), replyMarkup: keyboardForStep(step, answers) },
  );
}

async function updateQuestionMessage(
  user: TelegramLeadUser,
  update: TelegramUpdate,
  step: LeadFlowStep,
  answers: LeadAnswers,
): Promise<void> {
  const messageId = update.callback_query?.message?.message_id;
  if (messageId) {
    const edited = await editTelegramMessageText(
      user.chat_id,
      messageId,
      questionText(step, answers),
      { ...getAsiFeedbackTelegramSendOptions(), replyMarkup: keyboardForStep(step, answers) },
    );
    if (edited) return;
  }

  await sendQuestion(user, step, answers, update.update_id);
}

async function sendMainMenu(user: TelegramLeadUser, answers: LeadAnswers, updateId?: number): Promise<void> {
  await sendQuestion(user, 'menu', withFlow(answers, 'menu'), updateId);
}

function isCompleted(lead: LeadRow): boolean {
  return lead.answers_json?.flow?.step === 'completed';
}

async function findActiveLead(telegramUserId: string): Promise<LeadRow | null> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
      .eq('telegram_user_id', telegramUserId)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('[asi-feedback] failed to load active lead', {
        telegram_user_id: telegramUserId,
        error: error.message,
      });
      return null;
    }

    return ((data ?? []) as LeadRow[]).find((lead) => !isCompleted(lead)) ?? null;
  } catch (error) {
    console.error('[asi-feedback] failed to load active lead', {
      telegram_user_id: telegramUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function findLatestLead(telegramUserId: string): Promise<LeadRow | null> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
      .eq('telegram_user_id', telegramUserId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[asi-feedback] failed to load latest lead', {
        telegram_user_id: telegramUserId,
        error: error.message,
      });
      return null;
    }

    return ((data ?? []) as LeadRow[])[0] ?? null;
  } catch (error) {
    console.error('[asi-feedback] failed to load latest lead', {
      telegram_user_id: telegramUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function createLead(
  user: TelegramLeadUser,
  source: AsiFeedbackLeadSource,
  initialStep: LeadFlowStep = 'menu',
): Promise<LeadRow | null> {
  const answers: LeadAnswers = {
    source,
    object_types: [],
    channels: [],
    pms: [],
    automation_processes: [],
    time_consumers: [],
    other_texts: {},
    flow: { step: initialStep },
  };

  try {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        telegram_user_id: user.telegram_user_id,
        telegram_username: user.telegram_username,
        first_name: user.first_name,
        source,
        answers_json: answers,
        status: 'new',
      })
      .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
      .single();

    if (error) {
      console.error('[asi-feedback] failed to create lead', {
        telegram_user_id: user.telegram_user_id,
        source,
        error: error.message,
      });
      return null;
    }

    return data as LeadRow;
  } catch (error) {
    console.error('[asi-feedback] failed to create lead', {
      telegram_user_id: user.telegram_user_id,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function updateLead(
  lead: LeadRow,
  user: TelegramLeadUser,
  answers: LeadAnswers,
  extra: { status?: string } = {},
): Promise<LeadRow | null> {
  try {
    const update: Record<string, unknown> = {
      telegram_username: user.telegram_username,
      first_name: user.first_name,
      answers_json: answers,
      updated_at: new Date().toISOString(),
    };
    if (extra.status && extra.status !== lead.status) update.status = extra.status;
    const { data, error } = await supabase
      .from('leads')
      .update(update)
      .eq('id', lead.id)
      .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
      .single();

    if (error) {
      console.error('[asi-feedback] failed to update lead', {
        lead_id: lead.id,
        telegram_user_id: user.telegram_user_id,
        error: error.message,
      });
      return null;
    }

    return data as LeadRow;
  } catch (error) {
    console.error('[asi-feedback] failed to update lead', {
      lead_id: lead.id,
      telegram_user_id: user.telegram_user_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function normalizeKnownOtherText(step: LeadOtherStep, text: string): string[] {
  const lower = text.toLowerCase();
  if (step === 'object_types') {
    if (/дом|коттедж|таунхаус/.test(lower)) return ['Дома / коттеджи'];
    if (/гостев|мини.?гост|мини.?отел|апарт.?отел/.test(lower)) return ['Мини-отель / апарт-отель'];
    if (/помещ|коммерц|офис|склад/.test(lower)) return ['Коммерческая недвижимость'];
  }
  if (step === 'channels') {
    return OPTIONS.channels.filter((option) => option.id !== 'other' && lower.includes(option.label.toLowerCase())).map((option) => option.label);
  }
  if (step === 'automation_processes' || step === 'time_consumers') {
    const catalog = OPTIONS[step];
    return catalog
      .filter((option) => option.id !== 'other' && lower.includes(option.label.toLowerCase().split(' ')[0]))
      .map((option) => option.label);
  }
  return [];
}

function applyNormalizedOther(answers: LeadAnswers, step: LeadOtherStep, text: string, normalized: string[]): LeadAnswers {
  let next = addOtherText(answers, step, text);
  if (step === 'pms') {
    next = { ...next, pms: ['Другой PMS / менеджер каналов'] };
    return next;
  }

  const selected = new Set(selectedForStep(next, step));
  for (const item of normalized) selected.add(item);
  if (!normalized.length) selected.add('Другое');
  return setSelectedForStep(next, step, Array.from(selected));
}

function deterministicNormalizeOther(step: LeadOtherStep, text: string): string[] {
  const known = normalizeKnownOtherText(step, text);
  return known.length ? known : [];
}

async function aiNormalizeOther(step: LeadOtherStep, text: string): Promise<string[]> {
  const fallback = deterministicNormalizeOther(step, text);
  try {
    const allowed = step === 'pms'
      ? OPTIONS.pms.map((option) => option.label)
      : OPTIONS[step].map((option) => option.label);
    const response = await callLLM({
      model: process.env.LEAD_INTAKE_AI_MODEL?.trim() || undefined,
      systemPrompt:
        'Ты внутренний нормализатор анкеты ASI. Верни только JSON вида {"items":["..."]}. Не веди диалог. Используй только разрешенные варианты, если текст явно подходит.',
      userMessage: JSON.stringify({ step, text, allowed }),
    });
    if (!response) return fallback;
    const parsed = JSON.parse(response.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) as { items?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items.map(String) : [];
    const allowedSet = new Set(allowed);
    const clean = items.filter((item) => allowedSet.has(item)).slice(0, 5);
    return clean.length ? clean : fallback;
  } catch (error) {
    console.warn('[asi-feedback] AI other normalization fallback used', {
      step,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function includesAny(values: string[] | undefined, needles: string[]): boolean {
  const text = (values ?? []).join(' ').toLowerCase();
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function normalizeAutomationProcesses(values: string[] | undefined): string[] {
  const normalized: string[] = [];
  for (const value of values ?? []) {
    const next = LEGACY_GUEST_COMMUNICATION_PROCESS_LABELS.has(value)
      ? GUEST_COMMUNICATION_AUTOREPLIES
      : value;
    if (!normalized.includes(next)) normalized.push(next);
  }
  return normalized;
}

function normalizeLeadAnswers(answers: LeadAnswers): LeadAnswers {
  return {
    ...answers,
    automation_processes: normalizeAutomationProcesses(answers.automation_processes),
  };
}

function objectCountWeight(range?: string): number {
  if (range === '20+') return 4;
  if (range === '6-20') return 3;
  if (range === '2-5') return 2;
  if (range === '1') return 1;
  return 0;
}

function inferLeadType(answers: LeadAnswers): LeadType {
  const objectTypes = answers.object_types ?? [];
  const pms = answers.pms ?? [];
  if (includesAny(objectTypes, ['Смешанный'])) return 'смешанный портфель';
  if (includesAny(objectTypes, ['Коммерческая'])) return 'коммерческая недвижимость';
  if (includesAny(objectTypes, ['Мини-отель', 'апарт-отель'])) return 'мини-отель / апарт-отель';
  if (objectCountWeight(answers.object_count_range) >= 2) return 'управляющий несколькими объектами';
  if (includesAny(pms, ['Нет, всё ведём вручную', 'Только выбираем'])) return 'новичок без PMS/МК';
  return 'посуточник с PMS/МК';
}

function inferLeadPotential(answers: LeadAnswers): LeadPotential {
  const count = objectCountWeight(answers.object_count_range);
  const selectedPainCount = (answers.automation_processes?.length ?? 0) + (answers.time_consumers?.length ?? 0);
  if (count >= 3 || selectedPainCount >= 6 || includesAny(answers.object_types, ['Мини-отель', 'Коммерческая', 'Смешанный'])) return 'высокий';
  if (count >= 2 || selectedPainCount >= 3) return 'средний';
  return 'низкий';
}

function inferRecommendedNextStep(answers: LeadAnswers): RecommendedNextStep {
  if (includesAny(answers.channels, ['Пока не используем']) || includesAny(answers.automation_processes, ['Подключение каналов'])) {
    return 'предложить помощь с подключением каналов';
  }
  if (includesAny(answers.automation_processes, ['Фото', 'данные объектов']) || includesAny(answers.time_consumers, ['Подключение новых объектов'])) {
    return 'предложить сбор данных по объектам';
  }
  if (includesAny(answers.automation_processes, ['Общение', 'Повторяющиеся вопросы', 'Инструкции']) || includesAny(answers.time_consumers, ['Переписка', 'Заселение'])) {
    return 'предложить демо коммуникационного модуля';
  }
  if ((answers.automation_processes?.length ?? 0) || (answers.time_consumers?.length ?? 0)) return 'предложить разбор операционки';
  return 'пока только сохранить лид';
}

function buildFallbackSummary(answers: LeadAnswers): string {
  const wants = answers.automation_processes?.length ? answers.automation_processes.join(', ') : 'процессы не выбраны';
  const pains = answers.time_consumers?.length ? answers.time_consumers.join(', ') : 'не указано';
  return `Объектов: ${answers.object_count_range ?? 'не указано'}. Интерес: ${wants}. Больше всего времени занимает: ${pains}.`;
}

async function finalizeAnswers(answers: LeadAnswers): Promise<LeadAnswers> {
  const normalizedAnswers = normalizeLeadAnswers(answers);
  const base: LeadAnswers = {
    ...normalizedAnswers,
    lead_type: inferLeadType(normalizedAnswers),
    lead_potential: inferLeadPotential(normalizedAnswers),
    recommended_next_step: inferRecommendedNextStep(normalizedAnswers),
  };
  const fallbackSummary = buildFallbackSummary(base);

  try {
    const response = await callLLM({
      model: process.env.LEAD_INTAKE_AI_MODEL?.trim() || undefined,
      systemPrompt:
        'Ты внутренний аналитик ASI. Верни только JSON: {"ai_summary":"короткая сводка","lead_type":"...","lead_potential":"низкий|средний|высокий","recommended_next_step":"..."}. Не пиши пользователю.',
      userMessage: JSON.stringify({
        answers: base,
        allowed: {
          lead_type: [
            'новичок без PMS/МК',
            'посуточник с PMS/МК',
            'управляющий несколькими объектами',
            'мини-отель / апарт-отель',
            'коммерческая недвижимость',
            'смешанный портфель',
          ],
          lead_potential: ['низкий', 'средний', 'высокий'],
          recommended_next_step: [
            'предложить демо коммуникационного модуля',
            'предложить разбор операционки',
            'предложить помощь с подключением каналов',
            'предложить сбор данных по объектам',
            'пока только сохранить лид',
          ],
        },
      }),
    });
    if (!response) {
      return withFlow({ ...base, ai_summary: fallbackSummary, ai_normalized: buildAiNormalized(base) }, 'completed', {
        completed_at: new Date().toISOString(),
      });
    }

    const parsed = JSON.parse(response.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) as Partial<LeadAnswers>;
    const next: LeadAnswers = {
      ...base,
      ai_summary: typeof parsed.ai_summary === 'string' && parsed.ai_summary.trim() ? parsed.ai_summary.trim().slice(0, 500) : fallbackSummary,
      lead_type: isLeadType(parsed.lead_type) ? parsed.lead_type : base.lead_type,
      lead_potential: isLeadPotential(parsed.lead_potential) ? parsed.lead_potential : base.lead_potential,
      recommended_next_step: isRecommendedNextStep(parsed.recommended_next_step) ? parsed.recommended_next_step : base.recommended_next_step,
      ai_normalized: buildAiNormalized(base),
    };
    return withFlow(next, 'completed', { completed_at: new Date().toISOString() });
  } catch (error) {
    console.warn('[asi-feedback] AI lead summary fallback used', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withFlow({ ...base, ai_summary: fallbackSummary, ai_normalized: buildAiNormalized(base) }, 'completed', {
      completed_at: new Date().toISOString(),
    });
  }
}

function buildAiNormalized(answers: LeadAnswers): LeadAiNormalized {
  return {
    object_types: answers.object_types ?? [],
    channels: answers.channels ?? [],
    pms: answers.pms ?? [],
    automation_processes: answers.automation_processes ?? [],
    time_consumers: answers.time_consumers ?? [],
  };
}

function isLeadType(value: unknown): value is LeadType {
  return [
    'новичок без PMS/МК',
    'посуточник с PMS/МК',
    'управляющий несколькими объектами',
    'мини-отель / апарт-отель',
    'коммерческая недвижимость',
    'смешанный портфель',
  ].includes(String(value));
}

function isLeadPotential(value: unknown): value is LeadPotential {
  return value === 'низкий' || value === 'средний' || value === 'высокий';
}

function isRecommendedNextStep(value: unknown): value is RecommendedNextStep {
  return [
    'предложить демо коммуникационного модуля',
    'предложить разбор операционки',
    'предложить помощь с подключением каналов',
    'предложить сбор данных по объектам',
    'пока только сохранить лид',
  ].includes(String(value));
}

function formatList(value: string[] | undefined): string {
  return value?.length ? value.join(', ') : 'не указано';
}

function formatAdminNotification(lead: LeadRow): string {
  const answers = lead.answers_json ?? {};
  const username = lead.telegram_username ? `@${lead.telegram_username}` : 'username не указан';
  const userLink = lead.telegram_username
    ? `https://t.me/${lead.telegram_username}`
    : `telegram_user_id=${lead.telegram_user_id}`;
  const comment = answers.comment || answers.other_texts?.comment?.join(' / ') || 'нет';
  const automation = answers.automation;
  const automationStep = automation?.recommended_next_step || answers.recommended_next_step || 'не определён';

  return [
    'Новая заявка ASI',
    `Источник: ${lead.source}`,
    `Имя: ${lead.first_name ?? 'не указано'} (${username})`,
    `Объектов: ${answers.object_count_range ?? 'не указано'}`,
    `Типы объектов: ${formatList(answers.object_types)}`,
    `Каналы: ${formatList(answers.channels)}`,
    `PMS/МК: ${formatList(answers.pms)}`,
    `Что хочет автоматизировать: ${formatList(answers.automation_processes)}`,
    `Что съедает время: ${formatList(answers.time_consumers)}`,
    `Комментарий: ${comment}`,
    `AI-сводка: ${answers.ai_summary ?? 'не сформирована'}`,
    `Тип лида: ${answers.lead_type ?? 'не определён'}`,
    `Потенциал: ${answers.lead_potential ?? 'не определён'}`,
    `Сценарий: ${automation?.lead_scenario ?? 'не определён'}`,
    `Нужен ручной ответ: ${automation?.manual_reply_needed ? 'да' : 'нет'}`,
    `Статус: ${automation?.suggested_status ?? lead.status}`,
    `Следующий шаг: ${automationStep}`,
    `Пользователь: ${userLink}`,
  ].join('\n');
}

async function notifyAdmin(lead: LeadRow): Promise<void> {
  const adminChatId = getAdminChatId();
  if (!adminChatId) {
    console.warn('[asi-feedback] admin chat id is not configured');
    return;
  }

  await sendTelegramMessageToChat(adminChatId, formatAdminNotification(lead), getAsiFeedbackTelegramSendOptions());
}

function leadContextFromAnswers(answers: LeadAnswers | null | undefined): SupportLeadContext | undefined {
  if (!answers) return undefined;
  const context: SupportLeadContext = {
    object_count_range: answers.object_count_range,
    object_types: answers.object_types,
    pms: answers.pms,
    automation_processes: answers.automation_processes,
  };
  const hasContext = Boolean(
    context.object_count_range ||
      context.object_types?.length ||
      context.pms?.length ||
      context.automation_processes?.length,
  );
  return hasContext ? context : undefined;
}

function buildSupportRequest(
  text: string,
  source: SupportRequestSource,
  context?: SupportLeadContext,
): SupportRequest {
  return {
    source,
    text: text.trim(),
    status: 'new',
    received_at: new Date().toISOString(),
    ...(context ? { lead_context: context } : {}),
    support_ai_intent: null,
    support_ai_summary: null,
    support_auto_reply_eligible: false,
  };
}

function withSupportRequest(answers: LeadAnswers, request: SupportRequest): LeadAnswers {
  return withFlow(
    {
      ...answers,
      support_requests: [...(answers.support_requests ?? []), request].slice(-10),
    },
    'menu',
  );
}

function supportSourceForLead(lead: LeadRow | null, fallback: SupportRequestSource = 'support'): SupportRequestSource {
  const source = lead?.answers_json?.source ?? lead?.source ?? fallback;
  return source === 'support' ? 'support' : normalizeAsiFeedbackLeadSource(source);
}

function telegramUserLink(user: TelegramLeadUser): string {
  return user.telegram_username
    ? `https://t.me/${user.telegram_username}`
    : `tg://user?id=${user.telegram_user_id}`;
}

function formatSupportAdminNotification(
  lead: LeadRow,
  user: TelegramLeadUser,
  request: SupportRequest,
): string {
  const username = user.telegram_username ? `@${user.telegram_username}` : 'не указан';
  const context = request.lead_context;
  const contextLines = context
    ? [
        '',
        'Контекст лида:',
        `Объектов: ${context.object_count_range ?? 'не указано'}`,
        `Тип объектов: ${formatList(context.object_types)}`,
        `PMS/МК: ${formatList(context.pms)}`,
        `Что хотел автоматизировать: ${formatList(context.automation_processes)}`,
      ]
    : [];

  return [
    'Новый вопрос в поддержку ASI',
    `Источник: ${request.source}`,
    `Имя: ${user.first_name ?? lead.first_name ?? 'не указано'}`,
    `Username: ${username}`,
    `Telegram ID: ${user.telegram_user_id}`,
    `Текст вопроса: ${request.text}`,
    `Пользователь: ${telegramUserLink(user)}`,
    `Статус: ${request.status}`,
    ...contextLines,
  ].join('\n');
}

async function notifySupportAdmin(
  lead: LeadRow,
  user: TelegramLeadUser,
  request: SupportRequest,
): Promise<void> {
  const adminChatId = getAdminChatId();
  if (!adminChatId) {
    console.warn('[asi-feedback] admin chat id is not configured');
    return;
  }

  await sendTelegramMessageToChat(
    adminChatId,
    formatSupportAdminNotification(lead, user, request),
    getAsiFeedbackTelegramSendOptions(),
  );
}

function automationInputFromAnswers(
  answers: LeadAnswers,
  overrides: Partial<Pick<LeadAutomationInput, 'hasSupportRequest' | 'hasOpenSupportRequest'>> = {},
): LeadAutomationInput {
  const supportRequests = answers.support_requests ?? [];
  return {
    objectCountRange: answers.object_count_range,
    objectTypes: answers.object_types,
    channels: answers.channels,
    pms: answers.pms,
    automationProcesses: answers.automation_processes,
    timeConsumers: answers.time_consumers,
    comment: answers.comment,
    otherTexts: answers.other_texts as Record<string, string[]> | undefined,
    leadPotential: answers.lead_potential,
    source: answers.source,
    hasSupportRequest: overrides.hasSupportRequest ?? supportRequests.length > 0,
    hasOpenSupportRequest: overrides.hasOpenSupportRequest,
  };
}

function withAutomation(answers: LeadAnswers, automation: LeadAutomation): LeadAnswers {
  return {
    ...answers,
    automation: serializeLeadAutomation(automation),
  };
}

function finalReplyForAutomation(automation: LeadAutomation): string {
  if (automation.pmsState === 'has_pms') return FINAL_REPLY_HAS_PMS;
  if (automation.pmsState === 'no_pms_manual' || automation.pmsState === 'choosing_pms') return FINAL_REPLY_NO_PMS;
  return FINAL_REPLY;
}

async function completeLead(
  lead: LeadRow,
  user: TelegramLeadUser,
  answers: LeadAnswers,
): Promise<{ lead: LeadRow | null; automation: LeadAutomation }> {
  const finalized = await finalizeAnswers(answers);
  const automation = computeLeadAutomation(automationInputFromAnswers(finalized));
  const withAuto = withAutomation(finalized, automation);
  // Only set the auto status when the row is still untouched ('new').
  // An admin-changed status must never be overwritten by automation.
  const status = lead.status === 'new' ? automation.suggestedStatus : undefined;
  const updated = await updateLead(lead, user, withAuto, { status });
  return { lead: updated, automation };
}

async function persistOrReplyError(
  lead: LeadRow,
  user: TelegramLeadUser,
  answers: LeadAnswers,
  updateId?: number,
): Promise<LeadRow | null> {
  const updatedLead = await updateLead(lead, user, answers);
  if (updatedLead) return updatedLead;
  await replyToTelegram(user.chat_id, STORAGE_ERROR_REPLY, {
    handler: 'asi_feedback_lead_intake/storage_error',
    update_id: updateId,
  }, getAsiFeedbackTelegramSendOptions());
  return null;
}

async function ensureLeadForSupport(
  user: TelegramLeadUser,
  source: SupportRequestSource,
): Promise<LeadRow | null> {
  const activeLead = await findActiveLead(user.telegram_user_id);
  if (activeLead) return activeLead;

  const rowSource = source === 'support' ? 'unknown' : normalizeAsiFeedbackLeadSource(source);
  return createLead(user, rowSource, 'support');
}

async function beginSupportFlow(
  update: TelegramUpdate,
  user: TelegramLeadUser,
  lead: LeadRow | null,
  source: SupportRequestSource = 'support',
): Promise<ProcessResult> {
  const previousLead = lead ? null : await findLatestLead(user.telegram_user_id);
  const supportLead = lead ?? (await ensureLeadForSupport(user, source));
  if (!supportLead) {
    await replyToTelegram(user.chat_id, STORAGE_ERROR_REPLY, {
      handler: 'asi_feedback_lead_intake/storage_error',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Error,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: STORAGE_ERROR_REPLY,
    };
  }

  const nextAnswers = withFlow(
    {
      ...(supportLead.answers_json ?? {}),
      source: source === 'support' ? 'support' : supportSourceForLead(supportLead, source),
      support_lead_context: leadContextFromAnswers(lead?.answers_json ?? previousLead?.answers_json),
    },
    'support',
  );
  const updatedLead = await persistOrReplyError(supportLead, user, nextAnswers, update.update_id);
  if (!updatedLead) {
    return {
      outcome: ProcessOutcome.Error,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: STORAGE_ERROR_REPLY,
    };
  }

  await sendQuestion(user, 'support', updatedLead.answers_json ?? nextAnswers, update.update_id);
  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply: SUPPORT_PROMPT,
  };
}

async function handleSupportText(
  update: TelegramUpdate,
  lead: LeadRow,
  user: TelegramLeadUser,
  text: string,
): Promise<ProcessResult> {
  const latestLead = await findLatestLead(user.telegram_user_id);
  const contextSource = latestLead?.id === lead.id ? lead : latestLead;
  const request = buildSupportRequest(
    text,
    supportSourceForLead(lead, 'support'),
    lead.answers_json?.support_lead_context ?? leadContextFromAnswers(contextSource?.answers_json),
  );
  const requestAnswers = withSupportRequest(lead.answers_json ?? {}, request);
  const automation = computeLeadAutomation(
    automationInputFromAnswers(requestAnswers, { hasSupportRequest: true, hasOpenSupportRequest: true }),
  );
  const nextAnswers = withAutomation(requestAnswers, automation);
  // A new support request needs a manual reply, but never overwrite an
  // admin-set status: only auto-set when the row is still 'new'.
  const status = lead.status === 'new' ? 'manual_reply_needed' : undefined;
  const updatedLead = await updateLead(lead, user, nextAnswers, { status });
  if (!updatedLead) {
    await replyToTelegram(user.chat_id, STORAGE_ERROR_REPLY, {
      handler: 'asi_feedback_lead_intake/storage_error',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: ProcessOutcome.Error,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: STORAGE_ERROR_REPLY,
    };
  }

  await notifySupportAdmin(updatedLead, user, request);
  await replyToTelegram(user.chat_id, SUPPORT_CONFIRMATION, {
    handler: 'asi_feedback_lead_intake/support_completed',
    update_id: update.update_id,
  }, { ...getAsiFeedbackTelegramSendOptions(), replyMarkup: mainMenuKeyboard() });

  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply: SUPPORT_CONFIRMATION,
  };
}

async function handleTextAnswer(
  update: TelegramUpdate,
  lead: LeadRow,
  user: TelegramLeadUser,
  text: string,
): Promise<ProcessResult> {
  const current = lead.answers_json ?? {};
  const awaiting = current.flow?.awaiting_text_for;
  if (!awaiting) {
    await sendQuestion(user, current.flow?.step ?? 'object_count', current, update.update_id);
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: questionText(current.flow?.step ?? 'object_count', current),
    };
  }

  if (awaiting === 'comment') {
    const answers: LeadAnswers = addOtherText({ ...current, comment: text.trim() }, 'comment', text);
    const { lead: updatedLead, automation } = await completeLead(lead, user, answers);
    if (!updatedLead) {
      await replyToTelegram(user.chat_id, STORAGE_ERROR_REPLY, {
        handler: 'asi_feedback_lead_intake/storage_error',
        update_id: update.update_id,
      }, getAsiFeedbackTelegramSendOptions());
      return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    }
    const finalReply = finalReplyForAutomation(automation);
    await replyToTelegram(user.chat_id, finalReply, {
      handler: 'asi_feedback_lead_intake/completed',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    await notifyAdmin(updatedLead);
    return { outcome: ProcessOutcome.Replied, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: finalReply };
  }

  const normalized = await aiNormalizeOther(awaiting, text);
  const nextAnswers = withFlow(applyNormalizedOther(current, awaiting, text, normalized), awaiting);
  const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
  if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };

  await sendQuestion(user, awaiting, updatedLead.answers_json ?? nextAnswers, update.update_id);
  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply: questionText(awaiting, updatedLead.answers_json ?? nextAnswers),
  };
}

async function handleCallback(update: TelegramUpdate, lead: LeadRow, user: TelegramLeadUser): Promise<ProcessResult | null> {
  const callback = update.callback_query;
  const action = parseCallbackData(callback?.data);
  if (!callback || !action) return null;

  await answerTelegramCallbackQuery(callback.id, getAsiFeedbackTelegramSendOptions());

  const current = lead.answers_json ?? {};
  let nextAnswers = { ...current };
  let reply = '';

  if (action.kind === 'start_lead') {
    nextAnswers = withFlow(nextAnswers, 'object_count');
    const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
    if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    await updateQuestionMessage(user, update, 'object_count', updatedLead.answers_json ?? nextAnswers);
    return { outcome: ProcessOutcome.Replied, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: questionText('object_count', updatedLead.answers_json ?? nextAnswers) };
  }

  if (action.kind === 'support') {
    return beginSupportFlow(update, user, lead, supportSourceForLead(lead, 'support'));
  }

  if (action.kind === 'back') {
    const currentStep = current.flow?.step ?? 'object_count';
    if (currentStep === 'support' || currentStep === 'menu') {
      nextAnswers = withFlow(nextAnswers, 'menu');
      const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
      if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
      await updateQuestionMessage(user, update, 'menu', updatedLead.answers_json ?? nextAnswers);
      return { outcome: ProcessOutcome.Replied, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: MAIN_MENU_REPLY };
    }
    const step = previousStep(currentStep);
    nextAnswers = withFlow(nextAnswers, step);
    const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
    if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    await updateQuestionMessage(user, update, step, updatedLead.answers_json ?? nextAnswers);
    return { outcome: ProcessOutcome.Replied, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: questionText(step, updatedLead.answers_json ?? nextAnswers) };
  }

  if (action.kind === 'select') {
    const label = optionLabel(action.step, action.id);
    if (!label) return null;
    if (action.step === 'object_count') nextAnswers.object_count_range = label;
    if (action.step === 'pms') nextAnswers.pms = [label];
    const step = nextStep(action.step);
    nextAnswers = withFlow(nextAnswers, step);
    const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
    if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    await updateQuestionMessage(user, update, step, updatedLead.answers_json ?? nextAnswers);
    reply = questionText(step, updatedLead.answers_json ?? nextAnswers);
  }

  if (action.kind === 'toggle') {
    const label = optionLabel(action.step, action.id);
    if (!label) return null;
    const selected = new Set(selectedForStep(nextAnswers, action.step));
    if (selected.has(label)) selected.delete(label);
    else selected.add(label);
    nextAnswers = withFlow(setSelectedForStep(nextAnswers, action.step, Array.from(selected)), action.step);
    const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
    if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    await updateQuestionMessage(user, update, action.step, updatedLead.answers_json ?? nextAnswers);
    reply = questionText(action.step, updatedLead.answers_json ?? nextAnswers);
  }

  if (action.kind === 'done') {
    const step = nextStep(action.step);
    nextAnswers = withFlow(nextAnswers, step);
    const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
    if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    await updateQuestionMessage(user, update, step, updatedLead.answers_json ?? nextAnswers);
    reply = questionText(step, updatedLead.answers_json ?? nextAnswers);
  }

  if (action.kind === 'other') {
    nextAnswers = withFlow(nextAnswers, action.step, { awaiting_text_for: action.step });
    const updatedLead = await persistOrReplyError(lead, user, nextAnswers, update.update_id);
    if (!updatedLead) return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    reply = 'Напишите свой вариант одним сообщением. Я добавлю его к анкете.';
    await replyToTelegram(user.chat_id, reply, {
      handler: 'asi_feedback_lead_intake/other_text',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
  }

  if (action.kind === 'skip_comment') {
    const { lead: updatedLead, automation } = await completeLead(lead, user, nextAnswers);
    if (!updatedLead) {
      await replyToTelegram(user.chat_id, STORAGE_ERROR_REPLY, {
        handler: 'asi_feedback_lead_intake/storage_error',
        update_id: update.update_id,
      }, getAsiFeedbackTelegramSendOptions());
      return { outcome: ProcessOutcome.Error, update_id: update.update_id, chat_id: user.chat_id, category: MessageCategory.Start, reply: STORAGE_ERROR_REPLY };
    }
    reply = finalReplyForAutomation(automation);
    await replyToTelegram(user.chat_id, reply, {
      handler: 'asi_feedback_lead_intake/completed',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    await notifyAdmin(updatedLead);
  }

  return {
    outcome: ProcessOutcome.Replied,
    update_id: update.update_id,
    chat_id: user.chat_id,
    category: MessageCategory.Start,
    reply,
  };
}

export async function processTelegramLeadIntakeUpdate(update: TelegramUpdate): Promise<ProcessResult | null> {
  const message = extractMessage(update);
  const text = (message?.text ?? '').trim();
  const user = getTelegramLeadUser(update);
  if (!user) return null;

  const supportRequested = SUPPORT_COMMAND_RE.test(text) || text.trim().toLowerCase().match(START_RE)?.[1]?.trim().toLowerCase() === 'support';
  if (supportRequested) {
    return beginSupportFlow(update, user, null, 'support');
  }

  const startSource = text ? parseAsiFeedbackStartSource(text) : null;
  if (startSource) {
    const lead = await createLead(user, startSource);
    if (!lead) {
      await replyToTelegram(user.chat_id, STORAGE_ERROR_REPLY, {
        handler: 'asi_feedback_lead_intake/storage_error',
        update_id: update.update_id,
      }, getAsiFeedbackTelegramSendOptions());
      return {
        outcome: ProcessOutcome.Error,
        update_id: update.update_id,
        chat_id: user.chat_id,
        category: MessageCategory.Start,
        reply: STORAGE_ERROR_REPLY,
      };
    }

    await sendMainMenu(user, lead.answers_json ?? {}, update.update_id);
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: MAIN_MENU_REPLY,
    };
  }

  const activeLead = await findActiveLead(user.telegram_user_id);
  if (!activeLead) return null;

  const currentStep = activeLead.answers_json?.flow?.step ?? 'object_count';
  if (currentStep === 'completed') return null;

  if (update.callback_query) return handleCallback(update, activeLead, user);
  if (!text) return null;
  if (currentStep === 'support') return handleSupportText(update, activeLead, user, text);
  if (currentStep === 'menu') {
    await sendMainMenu(user, activeLead.answers_json ?? {}, update.update_id);
    return {
      outcome: ProcessOutcome.Replied,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply: MAIN_MENU_REPLY,
    };
  }

  return handleTextAnswer(update, activeLead, user, text);
}
