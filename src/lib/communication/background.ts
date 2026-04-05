/**
 * Safe execution of background (fire-and-forget) tasks.
 *
 * Every task is:
 *   - Logged at start, success, and failure with structured context
 *   - Registered in a module-level tracker keyed by task ID
 *   - Awaitable via flushBackgroundTasks() for serverless lifecycle safety
 *
 * Usage:
 *   runInBackground(
 *     { correlationId: '9001', module: 'orchestrator', taskName: 'transitionStatus', triggerId: '42' },
 *     () => transitionSessionStatus(chatId, SessionStatus.Active),
 *   );
 *
 * Serverless lifecycle boundary:
 *   // In your API route handler, before returning the Response:
 *   await flushBackgroundTasks();
 *   // — or pass it to the runtime's waitUntil() for non-blocking flush:
 *   ctx.waitUntil(flushBackgroundTasks());
 */

import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackgroundContext {
  /** Ties this task to the inbound request (e.g. Telegram update_id, HTTP trace-id). */
  correlationId: string;
  /** Owning module (e.g. 'orchestrator', 'events'). */
  module: string;
  /** Human-readable task name (e.g. 'transitionSessionStatus'). */
  taskName: string;
  /** Optional: ID of the domain event that triggered this task. */
  eventId?: string;
  /** Optional: ID of the record that triggered this task (reservation_id, chat_id, …). */
  triggerId?: string;
}

export interface BackgroundTask {
  readonly id: string;
  readonly context: BackgroundContext;
  readonly startedAt: number;
  /** Resolves (never rejects) — errors are caught and logged internally. */
  readonly promise: Promise<void>;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  settledAt?: number;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, BackgroundTask>();

// ─── Core ─────────────────────────────────────────────────────────────────────

export function runInBackground(
  context: BackgroundContext,
  fn: () => Promise<unknown>,
): BackgroundTask {
  const id        = randomUUID();
  const startedAt = Date.now();
  const tag       = `${context.module}/${context.taskName}`;

  console.log(`[Background:start] ${tag}`, {
    id,
    correlationId: context.correlationId,
    ...(context.eventId   ? { eventId:   context.eventId }   : {}),
    ...(context.triggerId ? { triggerId: context.triggerId } : {}),
  });

  // Placeholder — promise reference is patched below before any async work runs.
  const task: BackgroundTask = {
    id,
    context,
    startedAt,
    promise:    Promise.resolve(), // overwritten synchronously before first tick
    status:     'pending',
  };

  registry.set(id, task);

  const fullPromise: Promise<void> = fn()
    .then(() => {
      const settled = Date.now();
      task.status    = 'success';
      task.settledAt = settled;
      console.log(`[Background:success] ${tag}`, {
        id,
        correlationId: context.correlationId,
        durationMs:    settled - startedAt,
      });
    })
    .catch((err: unknown) => {
      const settled  = Date.now();
      const errorMsg = err instanceof Error ? err.message : String(err);
      task.status    = 'failed';
      task.error     = errorMsg;
      task.settledAt = settled;
      console.error(`[Background:failure] ${tag}`, {
        id,
        correlationId: context.correlationId,
        ...(context.eventId   ? { eventId:   context.eventId }   : {}),
        ...(context.triggerId ? { triggerId: context.triggerId } : {}),
        error:      errorMsg,
        durationMs: settled - startedAt,
      });
    });

  // Patch promise reference — synchronous, before any microtask yields.
  (task as { promise: Promise<void> }).promise = fullPromise;

  return task;
}

// ─── Lifecycle helpers ────────────────────────────────────────────────────────

/**
 * Await all currently-registered background tasks.
 *
 * Call this at the serverless lifecycle boundary — before returning the HTTP
 * response (or via waitUntil() in Edge/Worker runtimes) — to guarantee that
 * fire-and-forget work completes within the request lifetime.
 *
 * After all tasks settle, resolved/failed entries are evicted from the
 * registry to prevent unbounded growth across warm serverless invocations.
 */
export async function flushBackgroundTasks(): Promise<void> {
  const snapshot = Array.from(registry.values());
  if (snapshot.length === 0) return;
  await Promise.allSettled(snapshot.map(t => t.promise));
  for (const t of snapshot) {
    if (t.status !== 'pending') registry.delete(t.id);
  }
}

/** Number of tasks still in-flight. Useful for health checks / observability. */
export function getPendingTaskCount(): number {
  return Array.from(registry.values()).filter(t => t.status === 'pending').length;
}

/** Reset registry — for testing only. */
export function _resetRegistryForTesting(): void {
  registry.clear();
}
