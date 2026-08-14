import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { handleVoiceTranscript } from '@/lib/communication/voice/orchestrator';
import type { VoiceChannel, VoiceInput } from '@/lib/communication/voice/types';
import { VOICE_CHANNEL_CAPABILITIES } from '@/lib/communication/voice/capabilities';

export const runtime = 'nodejs';

function isVoiceChannel(v: unknown): v is VoiceChannel {
  return v === 'whatsapp_voice' || v === 'telegram_voice' || v === 'phone';
}

export async function POST(req: Request): Promise<Response> {
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const channel = body?.channel;
  const actorId = body?.actorId;
  const transcript = body?.transcript;

  if (!isVoiceChannel(channel)) {
    return NextResponse.json({ error: 'channel must be one of whatsapp_voice | telegram_voice | phone' }, { status: 400 });
  }
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

  const input: VoiceInput = {
    channel,
    actorId: typeof actorId === 'string' && actorId.trim() ? actorId.trim() : undefined,
    transcript: transcript.trim(),
    transcriptConfidence: typeof body?.transcriptConfidence === 'number' ? body.transcriptConfidence : undefined,
    audioRef: typeof body?.audioRef === 'string' ? body.audioRef : undefined,
    language: typeof body?.language === 'string' ? body.language : undefined,
  };

  const result = await handleVoiceTranscript(input);

  return NextResponse.json({
    ok: true,
    capabilities: VOICE_CHANNEL_CAPABILITIES[channel],
    normalizedInput: input,
    voiceSession: result.session,
    voiceTurn: result.turn,
    brain: {
      outcome: result.brain.outcome,
      escalation: result.brain.escalation ?? null,
      reply: result.brain.reply ?? null,
    },
    voiceOutput: result.output,
  });
}

