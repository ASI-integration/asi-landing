import { describe, expect, it } from 'vitest';
import {
  answersJsonWithAdminNote,
  answersJsonWithSupportStatus,
  buildLeadCopySummary,
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
    expect(lead.objectCountRange).toBe('6-20');
    expect(lead.pms).toEqual(['RealtyCalendar']);
    expect(lead.comment).toBe('Нужен быстрый запуск');
    expect(lead.copySummary).toContain('PMS/МК: RealtyCalendar');
    expect(lead.copySummary).toContain('AI-сводка: Есть портфель');
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
});
