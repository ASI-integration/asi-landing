import { describe, expect, it } from 'vitest';
import type { CrmEventRow } from '../types';
import {
  computeNeedsReaction,
  matchesCrmFilter,
  normalizeCrmContactRow,
} from '../view-model';

function event(partial: Partial<CrmEventRow> & Pick<CrmEventRow, 'event_type'>): CrmEventRow {
  return {
    id: partial.id ?? 'evt-1',
    contact_id: partial.contact_id ?? 'contact-1',
    event_type: partial.event_type,
    message_text: partial.message_text ?? null,
    property_id: partial.property_id ?? null,
    metadata: partial.metadata ?? {},
    acknowledged_at: partial.acknowledged_at ?? null,
    created_at: partial.created_at ?? '2026-06-15T10:00:00.000Z',
  };
}

describe('crm view-model', () => {
  it('marks contact as needs reaction when escalation is unresolved', () => {
    const reaction = computeNeedsReaction({
      status: 'qualified',
      awaitingReply: false,
      nextAction: 'Позвонить',
      nextActionDueAt: null,
      events: [event({ event_type: 'escalation' })],
    });
    expect(reaction.needsReaction).toBe(true);
    expect(reaction.unresolvedEscalationCount).toBe(1);
  });

  it('marks contact as needs reaction when next step is empty', () => {
    const reaction = computeNeedsReaction({
      status: 'new',
      awaitingReply: false,
      nextAction: '',
      nextActionDueAt: null,
      events: [],
    });
    expect(reaction.needsReaction).toBe(true);
  });

  it('normalizes contact row with russian labels', () => {
    const contact = normalizeCrmContactRow(
      {
        id: 'c1',
        name: 'Иван',
        role: 'lead',
        source: 'telegram',
        contact: null,
        telegram_user_id: '123456789',
        telegram_username: 'ivan_test',
        telegram_chat_id: '123456789',
        status: 'new',
        property_id: null,
        property_count: 3,
        notes: '',
        next_action: '',
        next_action_due_at: null,
        last_message: 'Хочу подключить ASI',
        last_activity_at: '2026-06-15T10:00:00.000Z',
        lead_id: null,
        awaiting_reply: false,
        created_at: '2026-06-15T09:00:00.000Z',
        updated_at: '2026-06-15T10:00:00.000Z',
      },
      [event({
        event_type: 'missing_data',
        metadata: { missing_fields: ['wifi_password', 'address'] },
      })],
    );

    expect(contact.roleLabel).toBe('Лид');
    expect(contact.statusLabel).toBe('Новый');
    expect(contact.telegramDisplay).toBe('@ivan_test');
    expect(contact.missingDataFields).toEqual(['wifi_password', 'address']);
    expect(contact.missingDataActions).toEqual([
      expect.objectContaining({ label: 'Пароль Wi-Fi', setupHref: null }),
      expect.objectContaining({ label: 'Адрес объекта', setupHref: null }),
    ]);
    expect(contact.effectiveStatus).toBe('needs_reaction');
    expect(contact.nextAction).toBe('Заполнить: Пароль Wi-Fi');
    expect(contact.needsReaction).toBe(true);
  });

  it('filters testing contacts', () => {
    const contact = normalizeCrmContactRow(
      {
        id: 'c2',
        name: 'Тест',
        role: 'guest',
        source: 'test',
        contact: null,
        telegram_user_id: '1',
        telegram_username: null,
        telegram_chat_id: '1',
        status: 'testing_communication',
        property_id: 'test-prop',
        property_count: null,
        notes: '',
        next_action: 'Проверить Wi-Fi',
        next_action_due_at: null,
        last_message: null,
        last_activity_at: null,
        lead_id: null,
        awaiting_reply: false,
        created_at: '2026-06-15T09:00:00.000Z',
        updated_at: '2026-06-15T09:00:00.000Z',
      },
      [],
    );

    expect(matchesCrmFilter(contact, 'testing')).toBe(true);
    expect(matchesCrmFilter(contact, 'pilot_active')).toBe(false);
  });
});
