import { describe, expect, it } from 'vitest';
import { parseJsonString, readResponseJson } from '../safeResponseJson';

describe('safeResponseJson', () => {
  it('parseJsonString returns fallback for empty or invalid JSON', () => {
    expect(parseJsonString('', { ok: false })).toEqual({ ok: false });
    expect(parseJsonString('   ', { ok: false })).toEqual({ ok: false });
    expect(parseJsonString('not-json', { ok: false })).toEqual({ ok: false });
    expect(parseJsonString('{"ok":true}', { ok: false })).toEqual({ ok: true });
  });

  it('readResponseJson handles empty response bodies', async () => {
    const res = new Response('', { status: 500, headers: { 'Content-Type': 'application/json' } });
    await expect(readResponseJson(res, { user: null })).resolves.toEqual({ user: null });
  });

  it('readResponseJson parses valid JSON bodies', async () => {
    const res = new Response(JSON.stringify({ user: { id: '1', email: 'a@b.c' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(readResponseJson(res, { user: null })).resolves.toEqual({
      user: { id: '1', email: 'a@b.c' },
    });
  });
});
