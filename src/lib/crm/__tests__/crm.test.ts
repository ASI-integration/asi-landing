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

  it('does not mark contact as needs reaction after operator reply closes escalation', () => {
    const contact = normalizeCrmContactRow(
      {
        id: 'guest-1',
        name: 'Гость',
        role: 'guest',
        source: 'test',
        contact: null,
        telegram_user_id: '9101',
        telegram_username: null,
        telegram_chat_id: '8101',
        status: 'testing_communication',
        property_id: 'prop-1',
        property_count: null,
        notes: '',
        next_action: 'Продолжить тест гостя',
        next_action_due_at: null,
        last_message: 'Ответ оператора',
        last_activity_at: '2026-06-18T10:10:00.000Z',
        lead_id: null,
        awaiting_reply: false,
        created_at: '2026-06-18T10:00:00.000Z',
        updated_at: '2026-06-18T10:10:00.000Z',
      },
      [
        event({
          id: 'esc-1',
          event_type: 'operator_followup_required',
          message_text: 'Можно поздний выезд?',
          acknowledged_at: '2026-06-18T10:05:00.000Z',
        }),
        event({
          id: 'reply-1',
          event_type: 'operator_reply_sent',
          message_text: 'Можно выехать до 13:00.',
          created_at: '2026-06-18T10:05:00.000Z',
        }),
      ],
    );

    expect(contact.hasOperatorFollowupPending).toBe(false);
    expect(contact.unresolvedEscalationCount).toBe(0);
    expect(contact.needsReaction).toBe(false);
    expect(matchesCrmFilter(contact, 'needs_reaction')).toBe(false);
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

  it('ignores non-uuid property ids for automation summaries lookup', () => {
    const propertyUuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(propertyUuidRe.test('test-prop-tg-live')).toBe(false);
    expect(propertyUuidRe.test('fa9e8871-2d50-4aaa-aa49-d7565430ee35')).toBe(true);
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

  it('shows pilot candidates from pilot form applications', () => {
    const contact = normalizeCrmContactRow(
      {
        id: 'pilot-1',
        name: 'ASI Pilot Smoke',
        role: 'owner',
        source: 'pilot_form',
        contact: '@pilot_owner',
        telegram_user_id: null,
        telegram_username: 'pilot_owner',
        telegram_chat_id: null,
        status: 'pilot_candidate',
        property_id: null,
        property_count: 2,
        notes: '',
        next_action: 'Оценить кандидата в пилот',
        next_action_due_at: null,
        last_message: 'Заявка в закрытый пилот ASI',
        last_activity_at: '2026-06-16T10:00:00.000Z',
        lead_id: null,
        awaiting_reply: false,
        created_at: '2026-06-16T09:00:00.000Z',
        updated_at: '2026-06-16T10:00:00.000Z',
      },
      [event({
        event_type: 'pilot_application_submitted',
        metadata: {
          source: 'pilot_form',
          city: 'Kazan',
          property_count: 2,
          channel_manager_label: 'Нет',
          platform_labels: ['Суточно.ру'],
          has_active_bookings_label: 'Да',
          test_focus_label: 'Коммуникации',
          feedback_ready_label: 'Да',
          role_label: 'Владелец',
          telegram_contact: '@pilot_owner',
          suggested_next_action: 'Оценить кандидата в пилот',
        },
      })],
    );

    expect(contact.source).toBe('pilot_form');
    expect(contact.status).toBe('pilot_candidate');
    expect(contact.pilotApplication).toMatchObject({
      city: 'Kazan',
      propertyCount: 2,
      telegramContact: '@pilot_owner',
    });
    expect(matchesCrmFilter(contact, 'pilot_candidates')).toBe(true);
  });

  it('filters contacts selected for pilot by dedicated event', () => {
    const contact = normalizeCrmContactRow(
      {
        id: 'pilot-2',
        name: 'ASI Selected Pilot',
        role: 'owner',
        source: 'pilot_form',
        contact: '@selected_owner',
        telegram_user_id: null,
        telegram_username: 'selected_owner',
        telegram_chat_id: null,
        status: 'creating_object',
        property_id: 'prop-1',
        property_count: 1,
        notes: '',
        next_action: '',
        next_action_due_at: null,
        last_message: 'Создан объект',
        last_activity_at: '2026-06-17T10:00:00.000Z',
        lead_id: null,
        awaiting_reply: false,
        created_at: '2026-06-16T09:00:00.000Z',
        updated_at: '2026-06-17T10:00:00.000Z',
      },
      [event({ event_type: 'pilot_selected' })],
    );

    expect(matchesCrmFilter(contact, 'pilot_selected')).toBe(true);
    expect(matchesCrmFilter(contact, 'pilot_candidates')).toBe(true);
  });
});
