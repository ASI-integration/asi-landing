import { describe, expect, it } from 'vitest';
import {
  getBookingOpsActionTemplate,
  getBookingOpsActionTemplateById,
  planBookingOpsOperatorActionConfirm,
} from '../action-templates';
import type { BookingOpsRecord } from '../types';
import { BOOKING_OPS_OPERATOR_ACTIONS } from '../types';

const baseRecord: BookingOpsRecord = {
  id: 'ops-1',
  bookingId: 'booking-1',
  guestName: 'Иван Петров',
  guestPhone: '+79990000001',
  guestEmail: null,
  guestTelegram: null,
  propertyId: 'OBJ-1',
  propertyLabel: 'Апартаменты на Невском',
  otaSource: 'avito',
  checkInAt: '2026-07-01T14:00:00.000Z',
  checkOutAt: '2026-07-03T11:00:00.000Z',
  opsStatus: 'created',
  manualNextAction: null,
  isBlocked: false,
  blockerReason: null,
  documentsStatus: 'not_started',
  contractStatus: 'not_started',
  depositStatus: 'not_started',
  mvdStatus: 'not_required',
  checkinReadinessStatus: 'not_started',
  unitReadinessStatus: 'not_ready',
  notes: 'Заметка оператора',
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
};

describe('Booking Ops action templates v1', () => {
  it('generates a template for each supported operator action', () => {
    for (const actionId of BOOKING_OPS_OPERATOR_ACTIONS) {
      const record = recordForAction(actionId);
      const template = getBookingOpsActionTemplateById(record, actionId);
      expect(template.actionId).toBe(actionId);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.fieldsOnConfirm).toBeDefined();
    }
  });

  it('includes guest and property data in guest-facing copy text', () => {
    const template = getBookingOpsActionTemplateById(baseRecord, 'request_guest_documents');
    expect(template.messageTemplate).toContain('Иван Петров');
    expect(template.messageTemplate).toContain('Апартаменты на Невском');
    expect(template.isAllowed).toBe(true);
  });

  it('maps pilot dry-run demo values in guest-facing copy text', () => {
    const template = getBookingOpsActionTemplateById({
      ...baseRecord,
      guestName: 'ASI_BOOKING_OPS_PILOT_DRY_RUN_001',
      propertyLabel: 'Dry Run Apartments',
      guestPhone: '+79990000111',
      guestTelegram: 'tg_dry',
      documentsStatus: 'not_started',
      opsStatus: 'created',
    }, 'request_guest_documents');
    expect(template.messageTemplate).toContain('Тестовый гость');
    expect(template.messageTemplate).toContain('Тестовый объект');
    expect(template.messageTemplate).not.toContain('ASI_BOOKING_OPS_PILOT_DRY_RUN');
    expect(template.messageTemplate).not.toContain('Dry Run Apartments');
  });

  it('creates warnings and placeholders when property data is missing', () => {
    const sparse: BookingOpsRecord = {
      ...baseRecord,
      guestName: null,
      propertyId: null,
      propertyLabel: null,
      checkInAt: null,
    };
    const template = getBookingOpsActionTemplateById(sparse, 'prepare_checkin_instructions');
    expect(template.warnings.length).toBeGreaterThan(0);
    expect(template.messageTemplate).toContain('[имя гостя]');
    expect(template.messageTemplate).toContain('[объект]');
    expect(template.messageTemplate).toContain('[дата заезда]');
    expect(template.messageTemplate).toContain('[уточнить код замка или способ получения ключей]');
    expect(template.warnings).toContain('Для объекта нет карточки знаний — проверьте все заглушки перед отправкой.');
  });

  it('uses structured property knowledge in the check-in draft', () => {
    const template = getBookingOpsActionTemplateById({
      ...baseRecord,
      propertyKnowledgeMatch: 'property_id',
      propertyKnowledge: {
        propertyId: 'OBJ-1',
        propertyLabel: 'Апартаменты на Невском',
        address: 'Санкт-Петербург, Невский проспект, 10',
        entranceInstructions: 'Вход со двора через арку',
        floorApartment: '3 этаж, квартира 12',
        intercomCode: 'тест-12',
        keyPickupInstructions: 'Ключ в тестовом боксе',
        wifiName: 'ASI-Guest',
        wifiPassword: 'test-password',
        parkingInstructions: 'Гостевая парковка во дворе',
        houseRules: 'Не курить',
        quietHours: 'с 22:00 до 08:00',
        checkoutInstructions: 'Оставьте ключ на столе',
        emergencyInstructions: 'Напишите оператору в чате',
        cleaningLinenNotes: 'Смена белья после выезда',
        publicGuestNotes: 'Сохраните инструкцию до выезда',
        privateOperatorNotes: 'Только оператору',
        updatedAt: '2026-06-27T10:00:00.000Z',
      },
    }, 'prepare_checkin_instructions');

    expect(template.messageTemplate).toContain('Санкт-Петербург, Невский проспект, 10');
    expect(template.messageTemplate).toContain('ASI-Guest');
    expect(template.messageTemplate).toContain('Не курить');
    expect(template.messageTemplate).not.toContain('Только оператору');
    expect(template.warnings).not.toContain('Не указан адрес объекта.');
  });

  it('does not log sensitive property values while building a template', () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const calls: unknown[][] = [];
    console.log = (...args) => { calls.push(args); };
    console.warn = (...args) => { calls.push(args); };
    console.error = (...args) => { calls.push(args); };
    try {
      getBookingOpsActionTemplateById({
        ...baseRecord,
        propertyKnowledgeMatch: 'property_id',
        propertyKnowledge: {
          propertyId: 'OBJ-1', propertyLabel: 'Объект', address: 'Адрес',
          entranceInstructions: 'Вход', floorApartment: null, intercomCode: 'secret-code',
          keyPickupInstructions: 'Ключи', wifiName: 'Wi-Fi', wifiPassword: 'secret-password',
          parkingInstructions: null, houseRules: null, quietHours: null,
          checkoutInstructions: null, emergencyInstructions: null, cleaningLinenNotes: null,
          publicGuestNotes: null, privateOperatorNotes: 'private-note', updatedAt: null,
        },
      }, 'prepare_checkin_instructions');
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
    expect(calls).toEqual([]);
  });

  it('returns primary operator action from automation nextAction', () => {
    const template = getBookingOpsActionTemplate(baseRecord);
    expect(template?.actionId).toBe('request_guest_documents');
  });

  it('blocks mark_ready_for_checkin until prerequisites are complete', () => {
    const almostReady: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'confirmed',
      checkinReadinessStatus: 'ready',
      opsStatus: 'checkin_instructions_ready',
    };
    const allowed = getBookingOpsActionTemplateById(almostReady, 'mark_ready_for_checkin');
    expect(allowed.isAllowed).toBe(true);

    const incomplete: BookingOpsRecord = {
      ...almostReady,
      depositStatus: 'requested',
    };
    const blocked = getBookingOpsActionTemplateById(incomplete, 'mark_ready_for_checkin');
    expect(blocked.isAllowed).toBe(false);
    expect(blocked.blockedReason).toMatch(/депозит/i);
  });

  it('confirm plan updates only intended status fields', () => {
    const record: BookingOpsRecord = { ...baseRecord, documentsStatus: 'received' };
    const plan = planBookingOpsOperatorActionConfirm(record, 'verify_guest_documents');
    expect('input' in plan).toBe(true);
    if ('input' in plan) {
      expect(plan.input).toEqual({
        documentsStatus: 'verified',
        opsStatus: 'documents_received',
      });
      expect(plan.input).not.toHaveProperty('notes');
      expect(plan.input).not.toHaveProperty('contractStatus');
    }
  });

  it('confirm plan does not overwrite notes field', () => {
    const plan = planBookingOpsOperatorActionConfirm(baseRecord, 'request_guest_documents');
    expect('input' in plan).toBe(true);
    if ('input' in plan) {
      expect(plan.input).not.toHaveProperty('notes');
    }
  });

  it('blocks confirm when status already advanced', () => {
    const advanced: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
    };
    const template = getBookingOpsActionTemplateById(advanced, 'request_guest_documents');
    expect(template.isAllowed).toBe(false);
    expect(template.blockedReason).toMatch(/получены|проверены/i);
  });

  it('rejects invalid action id on confirm plan', () => {
    const plan = planBookingOpsOperatorActionConfirm(
      baseRecord,
      'request_guest_documents',
    );
    expect('input' in plan || 'error' in plan).toBe(true);

    const wrongStep = planBookingOpsOperatorActionConfirm(
      { ...baseRecord, documentsStatus: 'verified', contractStatus: 'prepared' },
      'request_guest_documents',
    );
    expect('error' in wrongStep).toBe(true);
  });
});

function recordForAction(actionId: (typeof BOOKING_OPS_OPERATOR_ACTIONS)[number]): BookingOpsRecord {
  switch (actionId) {
    case 'request_guest_documents':
      return baseRecord;
    case 'verify_guest_documents':
      return { ...baseRecord, documentsStatus: 'received' };
    case 'prepare_contract':
      return { ...baseRecord, documentsStatus: 'verified' };
    case 'send_contract':
      return { ...baseRecord, documentsStatus: 'verified', contractStatus: 'prepared' };
    case 'confirm_contract_signed':
      return {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'sent',
      };
    case 'request_deposit':
      return {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
      };
    case 'confirm_deposit':
      return {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'requested',
      };
    case 'prepare_mvd_report':
      return {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        mvdStatus: 'required',
      };
    case 'submit_mvd_report':
      return {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        mvdStatus: 'prepared',
      };
    case 'prepare_checkin_instructions':
      return {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        checkinReadinessStatus: 'in_progress',
      };
    case 'mark_ready_for_checkin':
      return {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        checkinReadinessStatus: 'ready',
        opsStatus: 'checkin_instructions_ready',
      };
    default:
      return baseRecord;
  }
}
