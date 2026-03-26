/**
 * Identity Resolution Tests — updated for G1 Supabase-backed persistence.
 *
 * The old in-memory merge model is replaced by a tg_guest_identities table.
 * These tests verify the DB-backed upsert + resolve behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ─────────────────────────────────────────────────────────────

const upsertedRows: Record<string, unknown[]> = {};
const insertedRows: Record<string, unknown[]> = {};
const selectRows:   Record<string, unknown[]> = { tg_guest_identities: [] };

function makeTableProxy(table: string) {
  const rows = () => selectRows[table] ?? [];

  const buildQuery = (filters: Array<{ col: string; val: unknown }>) => {
    const applyFilters = () =>
      rows().filter(r => {
        const row = r as Record<string, unknown>;
        return filters.every(f => row[f.col] == f.val);
      });

    const q: Record<string, unknown> = {};
    q.eq      = (col: string, val: unknown) => buildQuery([...filters, { col, val }]);
    q.select  = () => buildQuery(filters);
    q.order   = () => buildQuery(filters);
    q.limit   = () => buildQuery(filters);
    q.maybySingle = async () => {
      const found = applyFilters();
      return { data: found[0] ?? null, error: null };
    };
    q.maybeSingle = async () => {
      const found = applyFilters();
      return { data: found[0] ?? null, error: null };
    };
    q.single = async () => {
      const found = applyFilters();
      return found[0] ? { data: found[0], error: null } : { data: null, error: { message: 'not found' } };
    };
    q.then = (cb: (v: unknown) => unknown) => cb({ data: applyFilters(), error: null });
    return q;
  };

  return {
    upsert: async (row: unknown) => {
      (upsertedRows[table] ??= []).push(row);
      // Simulate upsert: add to selectRows so resolveGuestIdentity can find it
      const r = row as Record<string, unknown>;
      const existing = (selectRows[table] ?? []).findIndex(
        (s: unknown) => {
          const sr = s as Record<string, unknown>;
          return r.telegram_chat_id != null && sr.telegram_chat_id == r.telegram_chat_id;
        },
      );
      if (existing >= 0) {
        (selectRows[table] as Record<string, unknown>[])[existing] = {
          ...(selectRows[table] as Record<string, unknown>[])[existing],
          ...r,
        };
      } else {
        (selectRows[table] ??= []).push(r);
      }
      return { error: null };
    },
    insert: async (row: unknown) => {
      (insertedRows[table] ??= []).push(row);
      (selectRows[table] ??= []).push(row);
      return { error: null };
    },
    select: (_cols?: string) => buildQuery([]),
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => makeTableProxy(table) },
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { createOrMergeIdentity, resolveGuestIdentity } from '../identity';

function resetAll() {
  for (const key of Object.keys(upsertedRows)) delete upsertedRows[key];
  for (const key of Object.keys(insertedRows)) delete insertedRows[key];
  selectRows['tg_guest_identities'] = [];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Identity Resolution — Supabase-backed (G1)', () => {
  beforeEach(resetAll);

  it('createOrMergeIdentity upserts a new Telegram identity', async () => {
    const identity = await createOrMergeIdentity({
      channel: 'telegram',
      externalUserId: '10000',
      chatId: '10000',
      receivedAt: new Date(),
    });

    expect(identity.guestId).toBe('tg_10000');
    expect(identity.knownChatIds).toContain('10000');

    const rows = upsertedRows['tg_guest_identities'] ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0] as Record<string, unknown>;
    expect(row.telegram_chat_id).toBe(10000);
    expect(row.guest_id).toBe('tg_10000');
  });

  it('resolveGuestIdentity returns null when chat not in DB', async () => {
    const result = await resolveGuestIdentity({
      channel: 'telegram',
      externalUserId: '99999',
      chatId: '99999',
      receivedAt: new Date(),
    });
    expect(result).toBeNull();
  });

  it('resolveGuestIdentity returns identity after createOrMerge (cold-start simulation)', async () => {
    // First message — creates row
    await createOrMergeIdentity({
      channel: 'telegram',
      externalUserId: '10000',
      chatId: '10000',
      receivedAt: new Date(),
    });

    // Simulate cold start: resolve looks up by chatId
    const resolved = await resolveGuestIdentity({
      channel: 'telegram',
      externalUserId: '10000',
      chatId: '10000',
      receivedAt: new Date(),
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.guestId).toBe('tg_10000');
    expect(resolved!.knownChatIds).toContain('10000');
  });

  it('createOrMergeIdentity preserves explicit existingId', async () => {
    const identity = await createOrMergeIdentity(
      {
        channel: 'telegram',
        externalUserId: '20000',
        chatId: '20000',
        receivedAt: new Date(),
      },
      'custom_guest_id',
    );

    expect(identity.guestId).toBe('custom_guest_id');
    const row = (upsertedRows['tg_guest_identities'] ?? [])[0] as Record<string, unknown>;
    expect(row.guest_id).toBe('custom_guest_id');
  });

  it('resolveGuestIdentity finds by email', async () => {
    selectRows['tg_guest_identities'] = [
      { id: 'uuid-1', guest_id: 'guest_email_user', email: 'alice@example.com', telegram_chat_id: null },
    ];

    const result = await resolveGuestIdentity({
      channel: 'email',
      externalUserId: 'alice@example.com',
      email: 'alice@example.com',
      receivedAt: new Date(),
    });

    expect(result).not.toBeNull();
    expect(result!.guestId).toBe('guest_email_user');
    expect(result!.knownEmails).toContain('alice@example.com');
  });
});
