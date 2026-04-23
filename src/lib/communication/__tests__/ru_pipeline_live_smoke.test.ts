import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

import { processMessage } from '@/lib/communication/orchestrator';

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

describe('RU Telegram live-data smoke', () => {
  it('computes replies using live Supabase (dry-run)', async () => {
    if (process.env.RUN_LIVE_SMOKE !== '1') {
      // This test depends on real network + real Supabase credentials.
      // Keep it opt-in so CI/dev unit runs remain deterministic.
      return;
    }
    const envPath = process.env.RU_ENV_PATH || '.env.ru.production.pulled';
    const env = parseEnvFile(envPath);

    // Configure runtime env for this test process.
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';

    // RU-only diagnostics + deterministic mode.
    process.env.RU_TELEGRAM_DEBUG = '1';
    process.env.RU_TELEGRAM_FORCE_RU = '1';
    process.env.TELEGRAM_DRY_RUN = '1';

    const chatId = Number.parseInt(String(env.TELEGRAM_CHAT_ID), 10);
    expect(Number.isFinite(chatId)).toBe(true);

    const cases = [
      { id: 'start', text: '/start' },
      { id: 'late_checkin', text: 'Мы приедем поздно, после полуночи. Как заселиться?' },
      { id: 'access_code', text: 'Нужен код доступа/код замка для заселения сегодня' },
      { id: 'lock_not_working', text: 'Замок не работает, не можем открыть дверь, срочно!' },
      { id: 'unknown', text: 'Просто проверка связи. Что вы умеете?' },
    ] as const;

    const results: Array<{ id: string; reply: string | null }> = [];

    for (const c of cases) {
      const res = await processMessage({
        channel: 'telegram',
        externalUserId: String(chatId),
        chatId: String(chatId),
        messageText: c.text,
        receivedAt: new Date(),
        update_id: Date.now(),
      });

      results.push({ id: c.id, reply: (res as any).reply ?? null });
      expect(res.outcome).toBe('replied');
      expect((res as any).reply?.length ?? 0).toBeGreaterThan(0);
    }

    // High-signal output for the verification run.
    console.log(JSON.stringify({ envPath, chatId, results }, null, 2));
  }, 60_000);
});

