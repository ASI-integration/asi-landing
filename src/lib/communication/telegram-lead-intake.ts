import { normalizeAsiFeedbackLeadSource, type AsiFeedbackLeadSource } from '@/config/publicTelegram';
import { supabase } from '@/lib/supabase';
import { replyToTelegram, sendTelegramMessageToChat, type TelegramSendOptions } from '@/lib/telegram';
import { MessageCategory, ProcessOutcome, type ProcessResult, type TelegramUpdate } from './types';

type LeadFlowStep =
  | 'object_count'
  | 'property_type'
  | 'channels'
  | 'main_pain'
  | 'pms'
  | 'completed';

type LeadAnswers = {
  object_count?: string;
  property_type?: string;
  channels?: string[];
  main_pain?: string;
  pms?: string;
  source?: AsiFeedbackLeadSource;
  flow?: {
    step: LeadFlowStep;
    completed_at?: string;
  };
  future_ai?: {
    lead_scoring_ready: false;
    ai_summary_ready: false;
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

const START_RE = /^\/start(?:@\w+)?(?:\s+(.+))?$/i;

const QUESTIONS: Record<Exclude<LeadFlowStep, 'completed'>, string> = {
  object_count:
    'Спасибо. Чтобы понять масштаб, напишите, сколько объектов у вас сейчас: например 1, 3-5, 20+.',
  property_type:
    'Какой тип объектов у вас основной? Квартиры, апартаменты, коммерческая недвижимость или смешанное портфолио?',
  channels:
    'Какие каналы уже используете? Можно перечислить через запятую: Авито, Суточно, Островок, Яндекс Путешествия, Циан, другое.',
  main_pain:
    'Какая главная боль сейчас? Сообщения гостей, овербукинг, цены, отчётность, фото/описания или другое?',
  pms:
    'Используете PMS или менеджер каналов? Например Bnovo, RealtyCalendar, TravelLine, другое или нет.',
};

const FINAL_REPLY =
  'Спасибо, заявку получил. По вашим ответам видно, какие процессы можно автоматизировать в первую очередь. Мы свяжемся с вами или предложим демо, если формат подходит для пилота ASI.';

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
  const message = extractMessage(update);
  const from = message?.from;
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

function nextStep(step: LeadFlowStep): LeadFlowStep {
  switch (step) {
    case 'object_count':
      return 'property_type';
    case 'property_type':
      return 'channels';
    case 'channels':
      return 'main_pain';
    case 'main_pain':
      return 'pms';
    case 'pms':
    case 'completed':
      return 'completed';
  }
}

function parseChannels(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function applyAnswer(answers: LeadAnswers, step: LeadFlowStep, text: string): LeadAnswers {
  const clean = text.trim();
  const patch: LeadAnswers = { ...answers };

  if (step === 'object_count') patch.object_count = clean;
  if (step === 'property_type') patch.property_type = clean;
  if (step === 'channels') patch.channels = parseChannels(clean);
  if (step === 'main_pain') patch.main_pain = clean;
  if (step === 'pms') patch.pms = clean;

  const next = nextStep(step);
  patch.flow = {
    step: next,
    ...(next === 'completed' ? { completed_at: new Date().toISOString() } : {}),
  };

  // Reserved contract for future scoring/AI summary; no AI logic runs here.
  patch.future_ai = {
    lead_scoring_ready: false,
    ai_summary_ready: false,
  };

  return patch;
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

async function createLead(user: TelegramLeadUser, source: AsiFeedbackLeadSource): Promise<LeadRow | null> {
  const answers: LeadAnswers = {
    source,
    flow: { step: 'object_count' },
    future_ai: {
      lead_scoring_ready: false,
      ai_summary_ready: false,
    },
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

async function updateLead(lead: LeadRow, user: TelegramLeadUser, answers: LeadAnswers): Promise<LeadRow | null> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .update({
        telegram_username: user.telegram_username,
        first_name: user.first_name,
        answers_json: answers,
        updated_at: new Date().toISOString(),
      })
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

function formatAdminNotification(lead: LeadRow): string {
  const answers = lead.answers_json ?? {};
  const username = lead.telegram_username ? `@${lead.telegram_username}` : 'username не указан';
  const channels = answers.channels?.length ? answers.channels.join(', ') : 'не указано';
  const userLink = lead.telegram_username
    ? `https://t.me/${lead.telegram_username}`
    : `telegram_user_id=${lead.telegram_user_id}`;

  return [
    'Новая заявка ASI Feedback',
    `Источник: ${lead.source}`,
    `Имя: ${lead.first_name ?? 'не указано'} (${username})`,
    `Объектов: ${answers.object_count ?? 'не указано'}`,
    `Тип объектов: ${answers.property_type ?? 'не указано'}`,
    `Каналы: ${channels}`,
    `Главная боль: ${answers.main_pain ?? 'не указано'}`,
    `PMS/МК: ${answers.pms ?? 'не указано'}`,
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

export async function processTelegramLeadIntakeUpdate(update: TelegramUpdate): Promise<ProcessResult | null> {
  const message = extractMessage(update);
  const text = (message?.text ?? '').trim();
  if (!message || !text) return null;

  const user = getTelegramLeadUser(update);
  if (!user) return null;

  const startSource = parseAsiFeedbackStartSource(text);
  if (startSource) {
    const lead = await createLead(user, startSource);
    const reply = lead ? QUESTIONS.object_count : STORAGE_ERROR_REPLY;
    await replyToTelegram(user.chat_id, reply, {
      handler: lead ? 'asi_feedback_lead_intake/start' : 'asi_feedback_lead_intake/storage_error',
      update_id: update.update_id,
    }, getAsiFeedbackTelegramSendOptions());
    return {
      outcome: lead ? ProcessOutcome.Replied : ProcessOutcome.Error,
      update_id: update.update_id,
      chat_id: user.chat_id,
      category: MessageCategory.Start,
      reply,
    };
  }

  const activeLead = await findActiveLead(user.telegram_user_id);
  if (!activeLead) return null;

  const currentStep = activeLead.answers_json?.flow?.step ?? 'object_count';
  if (currentStep === 'completed') return null;

  const answers = applyAnswer(activeLead.answers_json ?? {}, currentStep, text);
  const updatedLead = await updateLead(activeLead, user, answers);
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

  const completed = answers.flow?.step === 'completed';
  const reply = completed ? FINAL_REPLY : QUESTIONS[answers.flow?.step as Exclude<LeadFlowStep, 'completed'>];

  await replyToTelegram(user.chat_id, reply, {
    handler: completed ? 'asi_feedback_lead_intake/completed' : 'asi_feedback_lead_intake/next_question',
    update_id: update.update_id,
  }, getAsiFeedbackTelegramSendOptions());

  if (completed) {
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
