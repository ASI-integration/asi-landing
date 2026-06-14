import { describe, expect, it } from 'vitest';
import {
  answersJsonWithAdminNote,
  answersJsonWithSupportStatus,
  buildLeadCopySummary,
  getLatestLeadsByTelegramId,
  getLeadHistoryByTelegramId,
  normalizeLeadRow,
  type LeadDbRow,
} from '../leads';

function row(overrides: Partial<LeadDbRow> = {}): LeadDbRow {
  return {
    id: 'lead-1',
    telegram_user_id: '12345',
    telegram_username: 'owner_ru',
    first_name: 'Анна',
    source: 'site',
    answers_json: {},
    status: 'new',
    created_at: '2026-06-13T10:00:00.000Z',
    updated_at: '2026-06-13T10:05:00.000Z',
    ...overrides,
  };
}

describe('dashboard leads parser', () => {
  it('normalizes structured lead intake answers for the CRM table and detail card', () => {
    const lead = normalizeLeadRow(row({
      answers_json: {
        object_count_range: '6-20',
        object_types: ['Квартиры'],
        channels: ['Авито'],
        pms: ['RealtyCalendar'],
        automation_processes: ['Общение с гостями и автоответы'],
        time_consumers: ['Переписка с гостями'],
        other_texts: { comment: ['Нужен быстрый запуск'] },
        ai_normalized: { pms: ['RealtyCalendar'] },
        ai_summary: 'Есть портфель, хочет убрать ручные ответы.',
        lead_type: 'управляющий несколькими объектами',
        lead_potential: 'высокий',
        recommended_next_step: 'предложить демо',
      },
    }));

    expect(lead.source).toBe('site');
    expect(lead.isTestLead).toBe(false);
    expect(lead.objectCountRange).toBe('6-20');
    expect(lead.pms).toEqual(['RealtyCalendar']);
    expect(lead.comment).toBe('Нужен быстрый запуск');
    expect(lead.copySummary).toContain('Менеджер каналов: RealtyCalendar');
    expect(lead.copySummary).toContain('AI-сводка: Есть портфель');
  });

  it('computes rule-based automation for the lead and keeps the admin-set status', () => {
    const lead = normalizeLeadRow(row({
      status: 'archived',
      answers_json: {
        object_count_range: '6-20',
        object_types: ['Квартиры'],
        pms: ['RealtyCalendar'],
        automation_processes: ['Общение с гостями и автоответы'],
      },
    }));

    expect(lead.status).toBe('archived');
    expect(lead.automation.scenario).toBe('has_pms');
    expect(lead.automation.suggestedStatus).toBe('needs_pms_access');
    expect(lead.automation.nextStep).toContain('RealtyCalendar');
    expect(lead.automation.onboardingChecklist).toContain('Выбрать тестовый объект');
  });

  it('marks leads with open support requests as needing a manual reply', () => {
    const lead = normalizeLeadRow(row({
      source: 'unknown',
      answers_json: {
        source: 'support',
        support_requests: [{ text: 'Вопрос', status: 'new', received_at: '2026-06-13T11:00:00.000Z' }],
      },
    }));

    expect(lead.automation.manualReplyNeeded).toBe(true);
    expect(lead.automation.manualReplyReason).toBe('support_question');
  });

  it('parses support requests and preserves lead context when present', () => {
    const lead = normalizeLeadRow(row({
      source: 'unknown',
      answers_json: {
        source: 'support',
        support_requests: [
          {
            text: 'Можно ли подключить RealtyCalendar?',
            received_at: '2026-06-13T11:00:00.000Z',
            status: 'new',
            lead_context: {
              object_count_range: '2-5',
              pms: ['RealtyCalendar'],
              automation_processes: ['Подключение каналов / OTA'],
            },
          },
        ],
      },
    }));

    expect(lead.source).toBe('support');
    expect(lead.hasSupportRequest).toBe(true);
    expect(lead.supportRequests[0]).toMatchObject({
      text: 'Можно ли подключить RealtyCalendar?',
      status: 'new',
      source: 'support',
      leadContext: {
        object_count_range: '2-5',
        pms: ['RealtyCalendar'],
      },
    });
  });

  it('stores admin notes and support statuses inside answers_json', () => {
    const withNote = answersJsonWithAdminNote({}, '  Перезвонить завтра  ');
    expect(withNote.admin_note).toBe('Перезвонить завтра');

    const withSupportStatus = answersJsonWithSupportStatus({
      support_requests: [{ text: 'Вопрос', status: 'new' }],
    }, 0, 'answered');

    expect(withSupportStatus?.support_requests).toEqual([{ text: 'Вопрос', status: 'answered' }]);
  });

  it('builds a short copy summary with safe fallbacks', () => {
    expect(buildLeadCopySummary({
      name: 'Анна',
      telegramUsername: null,
      objectCountRange: '',
      pms: [],
      automationProcesses: ['Гостевые сообщения'],
      aiSummary: '',
      recommendedNextStep: 'Нужен ручной ответ',
    })).toContain('Объектов: не указано');
  });

  it('marks smoke and test-source leads without removing their data', () => {
    const smokeLead = normalizeLeadRow(row({
      telegram_username: 'asi_prod_smoke_owner',
      answers_json: {
        object_count_range: '1',
        pms: ['Bnovo'],
      },
    }));
    const sourceTestLead = normalizeLeadRow(row({
      id: 'lead-2',
      telegram_username: 'owner_ru',
      first_name: 'Анна',
      source: 'test',
      answers_json: {
        source: 'site',
        ai_summary: 'Тестовая проверка production формы.',
      },
    }));

    expect(smokeLead.isTestLead).toBe(true);
    expect(smokeLead.pms).toEqual(['Bnovo']);
    expect(sourceTestLead.isTestLead).toBe(true);
    expect(sourceTestLead.aiSummary).toBe('Тестовая проверка production формы.');
  });

  it('keeps only the latest visible row per Telegram ID and preserves history', () => {
    const older = normalizeLeadRow(row({
      id: 'lead-old',
      created_at: '2026-06-13T09:00:00.000Z',
      answers_json: { source: 'site', recommended_next_step: 'старый шаг' },
    }));
    const latest = normalizeLeadRow(row({
      id: 'lead-new',
      created_at: '2026-06-13T12:00:00.000Z',
      answers_json: { source: 'support', recommended_next_step: 'новый шаг' },
    }));
    const otherUser = normalizeLeadRow(row({
      id: 'lead-other',
      telegram_user_id: '67890',
      telegram_username: 'other_owner',
      created_at: '2026-06-13T11:00:00.000Z',
    }));

    expect(getLatestLeadsByTelegramId([older, latest, otherUser]).map((lead) => lead.id)).toEqual([
      'lead-new',
      'lead-other',
    ]);
    expect(getLeadHistoryByTelegramId([older, latest, otherUser], latest).map((lead) => lead.id)).toEqual([
      'lead-new',
      'lead-old',
    ]);
  });
});
