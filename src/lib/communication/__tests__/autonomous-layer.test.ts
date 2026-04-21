import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  __resetAutonomousSessionStoreForTests,
  getOrCreateAutonomousSession,
  mergeAutonomousSessionFromInbound,
} from '../conversation-session-store';
import { decideAutonomousRoute } from '../decision-engine';
import { evaluateAutonomousEscalation, getAutonomousIntentEscalationThreshold } from '../escalation-engine';
import {
  AutonomousSessionStatus,
  EscalationReason,
  IntentCategory,
  Lang,
  MessageCategory,
} from '../types';

describe('conversation-session-store', () => {
  beforeEach(() => __resetAutonomousSessionStoreForTests());
  afterEach(() => __resetAutonomousSessionStoreForTests());

  it('infers staff role for Telegram group chat ids', () => {
    const s = getOrCreateAutonomousSession(-100123, 'telegram');
    expect(s.role).toBe('staff');
  });

  it('merges clues into collected_data', () => {
    mergeAutonomousSessionFromInbound({
      chatId: 42,
      channel: 'telegram',
      identity: undefined,
      intent: IntentCategory.BookingInquiry,
      intentConfidence: 0.8,
      lang: 'en' as Lang,
      mergedClues: { guestName: 'Ann', propertyLocation: 'Main St 1' },
    });
    const s = getOrCreateAutonomousSession(42, 'telegram');
    expect(s.collected_data.guest_name).toBe('Ann');
    expect(s.collected_data.property_location).toBe('Main St 1');
    expect(s.status).toBe(AutonomousSessionStatus.Collecting);
  });
});

describe('escalation-engine', () => {
  const prev = process.env.AUTONOMOUS_INTENT_ESCALATION_THRESHOLD;

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTONOMOUS_INTENT_ESCALATION_THRESHOLD;
    else process.env.AUTONOMOUS_INTENT_ESCALATION_THRESHOLD = prev;
  });

  it('returns null for /start classification', () => {
    expect(
      evaluateAutonomousEscalation({
        text: 'hello',
        intent: IntentCategory.Unknown,
        intentConfidence: 0.1,
        classificationCategory: MessageCategory.Start,
      }),
    ).toBeNull();
  });

  it('escalates on low intent confidence', () => {
    process.env.AUTONOMOUS_INTENT_ESCALATION_THRESHOLD = '0.5';
    const r = evaluateAutonomousEscalation({
      text: 'something vague',
      intent: IntentCategory.GeneralQuestion,
      intentConfidence: 0.35,
      classificationCategory: MessageCategory.GuestMessage,
    });
    expect(r?.reason).toBe(EscalationReason.LowIntentConfidence);
    expect(r?.summary).toContain('0.350');
  });

  it('escalates on payment + complaint combo', () => {
    const r = evaluateAutonomousEscalation({
      text: 'I want a refund, payment was wrong and this is a scam',
      intent: IntentCategory.PaymentRequest,
      intentConfidence: 0.9,
      classificationCategory: MessageCategory.GuestMessage,
    });
    expect(r?.reason).toBe(EscalationReason.PaymentComplaint);
  });

  it('exposes default threshold', () => {
    delete process.env.AUTONOMOUS_INTENT_ESCALATION_THRESHOLD;
    expect(getAutonomousIntentEscalationThreshold()).toBe(0.42);
  });
});

describe('decision-engine', () => {
  it('asks for missing booking fields when unmatched', () => {
    const d = decideAutonomousRoute({
      lang: 'en' as Lang,
      classificationCategory: MessageCategory.Booking,
      intent: IntentCategory.BookingInquiry,
      intentConfidence: 0.9,
      reservationStatus: 'unmatched',
      collected_data: {},
      sessionStatus: AutonomousSessionStatus.Collecting,
      text: 'I want to book',
    });
    expect(d.action).toBe('ask');
    if (d.action === 'ask') {
      expect(d.missing.length).toBeGreaterThan(0);
      expect(d.messageEn).toMatch(/booking/i);
    }
  });

  it('proceeds when all booking fields are present', () => {
    const d = decideAutonomousRoute({
      lang: 'en' as Lang,
      classificationCategory: MessageCategory.Booking,
      intent: IntentCategory.BookingInquiry,
      intentConfidence: 0.9,
      reservationStatus: 'unmatched',
      collected_data: {
        guest_name: 'Bob',
        property_location: 'X',
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-05',
        guests: '2',
      },
      sessionStatus: AutonomousSessionStatus.Collecting,
      text: 'book please',
    });
    expect(d.action).toBe('proceed');
    expect(d.action === 'proceed' && d.fulfilled).toBe(true);
  });

  it('asks for dates and guests after name+location are collected', () => {
    const d = decideAutonomousRoute({
      lang: 'en' as Lang,
      classificationCategory: MessageCategory.Booking,
      intent: IntentCategory.BookingInquiry,
      intentConfidence: 0.9,
      reservationStatus: 'unmatched',
      collected_data: {
        guest_name: 'Bob',
        property_location: 'X',
      },
      sessionStatus: AutonomousSessionStatus.Collecting,
      text: 'book please',
    });
    expect(d.action).toBe('ask');
    if (d.action === 'ask') {
      expect(d.missing).toContain('check_in_date');
    }
  });
});
