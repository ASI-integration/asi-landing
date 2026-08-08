import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE = 'telegram-voice-acceptance-v1.json';

export type TelegramVoiceAcceptanceEvidence = {
  schemaVersion: 'asi.telegram.voice.acceptance.v1';
  chatIdHash: string;
  messageDate: string;
  recordedAt: string;
  updateId: number;
  messageId: number;
  kind: 'voice' | 'audio';
  fileId: string;
};

type EvidenceWriteResult =
  | { status: 'written'; stateFile: string }
  | {
      status: 'ignored';
      reason: 'test_chat_not_configured' | 'chat_mismatch' | 'missing_message_date' | 'older_than_recorded';
    }
  | { status: 'failed'; reason: 'state_write_failed' };

type Environment = Record<string, string | undefined>;

function communicationStateDir(env: Environment): string {
  const configured =
    env.COMM_STATE_DIR ??
    env.SESSION_STORE_DIR ??
    env.CONVERSATION_SESSION_DIR ??
    env.STATE_DIR;
  return configured?.trim() || path.join(process.cwd(), '.asi-comm-state');
}

export function telegramAcceptanceChatHash(chatId: string | number): string {
  return createHash('sha256').update(`asi.telegram.test-chat.v1:${String(chatId).trim()}`).digest('hex');
}

export function recordTelegramVoiceAcceptanceEvidence(
  params: {
    chatId: number;
    updateId: number;
    messageId: number;
    messageDateUnixSeconds?: number;
    kind: 'voice' | 'audio';
    fileId: string;
  },
  options: { env?: Environment; now?: Date } = {},
): EvidenceWriteResult {
  const env = options.env ?? process.env;
  const configuredTestChatId = String(env.TELEGRAM_TEST_CHAT_ID ?? '').trim();
  if (!configuredTestChatId) return { status: 'ignored', reason: 'test_chat_not_configured' };
  if (configuredTestChatId !== String(params.chatId)) return { status: 'ignored', reason: 'chat_mismatch' };

  const messageDateMs = Number(params.messageDateUnixSeconds) * 1000;
  if (!Number.isFinite(messageDateMs) || messageDateMs <= 0) {
    return { status: 'ignored', reason: 'missing_message_date' };
  }

  const stateDir = communicationStateDir(env);
  const stateFile = path.join(stateDir, TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE);
  const temporaryFile = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
  const evidence: TelegramVoiceAcceptanceEvidence = {
    schemaVersion: 'asi.telegram.voice.acceptance.v1',
    chatIdHash: telegramAcceptanceChatHash(configuredTestChatId),
    messageDate: new Date(messageDateMs).toISOString(),
    recordedAt: (options.now ?? new Date()).toISOString(),
    updateId: params.updateId,
    messageId: params.messageId,
    kind: params.kind,
    fileId: params.fileId,
  };

  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    try {
      const current = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Partial<TelegramVoiceAcceptanceEvidence>;
      const currentMessageDateMs = Date.parse(String(current.messageDate ?? ''));
      if (
        current.schemaVersion === evidence.schemaVersion &&
        current.chatIdHash === evidence.chatIdHash &&
        Number.isFinite(currentMessageDateMs) &&
        currentMessageDateMs > messageDateMs
      ) {
        return { status: 'ignored', reason: 'older_than_recorded' };
      }
    } catch {
      // Missing or invalid evidence is replaced atomically below.
    }
    fs.writeFileSync(temporaryFile, `${JSON.stringify(evidence)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryFile, stateFile);
    fs.chmodSync(stateFile, 0o600);
    return { status: 'written', stateFile };
  } catch {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // Best-effort cleanup; inbound processing must continue even if evidence persistence is unavailable.
    }
    return { status: 'failed', reason: 'state_write_failed' };
  }
}
