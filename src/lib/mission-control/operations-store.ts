import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveMissionControlStateDir } from './store';
import { parseOperationsPayload, type OperationsPayload, type OperationsStored } from './operations';
const file = () => path.join(resolveMissionControlStateDir(), 'operations.json');
export async function readOperations(): Promise<OperationsStored | null> {
  try {
    const h = await fs.open(file(), 'r');
    let raw: string;
    try { if ((await h.stat()).size > 12_288) return null; raw = await h.readFile('utf8'); } finally { await h.close(); }
    const parsed = JSON.parse(raw);
    const payload = parseOperationsPayload({schemaVersion:parsed.schemaVersion, observedAt:parsed.observedAt, records:parsed.records});
    if (!payload || typeof parsed.receivedAt !== 'string' || !Number.isFinite(Date.parse(parsed.receivedAt))) return null;
    return {...payload,receivedAt:parsed.receivedAt};
  } catch { return null; }
}
// One existing status directory, separate file; never overwrite project/task state.
async function writeOperations(payload: OperationsPayload): Promise<void> {
  const now = Date.now();
  if (Math.abs(now - Date.parse(payload.observedAt)) > 120_000) throw Error('STALE_OBSERVATION');
  const dir = resolveMissionControlStateDir(); await fs.mkdir(dir, {recursive:true});
  const temp = file() + '.' + randomUUID() + '.tmp';
  try {
    const previous = await readOperations();
    if (previous && Date.parse(previous.observedAt) >= Date.parse(payload.observedAt)) throw Error('OLD_OBSERVATION');
    await fs.writeFile(temp, JSON.stringify({...payload,receivedAt:new Date(now).toISOString()}), {mode:0o600,flag:'wx'});
    await fs.rename(temp, file());
  } finally { await fs.rm(temp,{force:true}); }
}

// Serialize this web process, without a persistent lock that can survive a crash.
// Atomic rename keeps cross-process readers on complete snapshots. This telemetry
// is never a task claim; a new report repairs a lost concurrent observation.
let pending: Promise<void> = Promise.resolve();
export function saveOperations(payload: OperationsPayload): Promise<void> {
  const result = pending.then(() => writeOperations(payload));
  pending = result.catch(() => undefined);
  return result;
}
