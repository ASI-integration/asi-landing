import * as fs from 'fs';
import * as path from 'path';

export type FailureRecord = {
  type: 'outbound_delivery_failed' | 'inbound_processing_failed';
  ts: string;
  sessionId?: string;
  chat_id?: number;
  update_id?: number;
  channel?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  reason: string;
  attempts: number;
};

const isTest = process.env.NODE_ENV === 'test';
const BASE_DIR =
  process.env.COMM_STATE_DIR ??
  process.env.CONVERSATION_SESSION_DIR ??
  process.env.SESSION_STORE_DIR ??
  '/tmp';
const FILE_PATH = path.join(BASE_DIR, 'asi-comm-dlq.jsonl');

function safeMkdirp(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }
}

export function writeFailure(record: FailureRecord): void {
  if (isTest) return;
  safeMkdirp(BASE_DIR);
  try {
    fs.appendFileSync(FILE_PATH, JSON.stringify(record) + '\n', 'utf-8');
  } catch {
    // best-effort
  }
}

