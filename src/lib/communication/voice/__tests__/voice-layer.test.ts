import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleVoiceTranscript } from '../orchestrator';
import { VOICE_CHANNEL_CAPABILITIES } from '../capabilities';
import { canTransitionVoiceState, transitionVoiceState } from '../state-machine';
import { formatVoiceSafeText } from '../formatter';
import { __resetVoiceSessionStoreForTests } from '../session-store';
import { __resetEscalationReviewStoreForTests, listEscalationReviews } from '../../operator-review';

describe('voice layer', () => {
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    envSnapshot.COMM_ESCALATE_CONFIDENCE_THRESHOLD = process.env.COMM_ESCALATE_CONFIDENCE_THRESHOLD;
    process.env.COMM_ESCALATE_CONFIDENCE_THRESHOLD = '0';
    __resetVoiceSessionStoreForTests();
    __resetEscalationReviewStoreForTests();
  });

  afterEach(() => {
    process.env.COMM_ESCALATE_CONFIDENCE_THRESHOLD = envSnapshot.COMM_ESCALATE_CONFIDENCE_THRESHOLD;
  });

  it('capability map is seeded for all channels', () => {
    expect(VOICE_CHANNEL_CAPABILITIES.telegram_voice.supportsTranscriptInput).toBe(true);
    expect(VOICE_CHANNEL_CAPABILITIES.whatsapp_voice.supportsAudioReply).toBe(true);
    expect(VOICE_CHANNEL_CAPABILITIES.phone.supportsLiveCall).toBe(true);
  });

  it('state transitions are deterministic', () => {
    expect(canTransitionVoiceState('listening', 'processing')).toBe(true);
    expect(() => transitionVoiceState('listening', 'handoff')).toThrow(/invalid_voice_state_transition/i);
  });

  it('formats voice-safe output (one question, no links)', () => {
    const out = formatVoiceSafeText(
      'Here is a list:\n- item 1\n- item 2\n\nSee https://example.com for details. Also: what time?',
      { maxChars: 280 },
    );
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out).not.toMatch(/https?:\/\//i);
    expect(out).toMatch(/\?$/);
  });

  it('routes transcript through communication brain and returns voice-safe reply', async () => {
    const r = await handleVoiceTranscript({
      channel: 'telegram_voice',
      actorId: 'test-user-1',
      transcript: '/start',
    });

    expect(r.brain.outcome).toBe('replied');
    expect(r.output.text.length).toBeGreaterThan(0);
    expect(r.output.text.length).toBeLessThanOrEqual(360);
    expect(r.output.mode).toBe('speak');
    expect(r.session.state).toBe('awaiting_user');
  });

  it('escalation creates/uses operator review and returns handoff voice output', async () => {
    const r = await handleVoiceTranscript({
      channel: 'telegram_voice',
      actorId: 'test-user-2',
      transcript: 'urgent lock failed, cannot get in, need help now',
    });

    expect(r.output.shouldEscalate).toBe(true);
    expect(r.output.mode).toBe('handoff');
    expect(r.session.state).toBe('handoff');

    const reviews = listEscalationReviews({ limit: 50 });
    const voiceReview = reviews.find(x => x.channel === 'telegram_voice' && x.targetId === 'test-user-2');
    expect(voiceReview).toBeTruthy();
    expect(voiceReview?.source?.source).toBe('voice');
    expect(String(voiceReview?.source?.transcript ?? '')).toMatch(/urgent lock failed/i);
  });
});

