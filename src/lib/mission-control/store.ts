import 'server-only';

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MISSION_CONTROL_PROJECT_IDS,
  MISSION_CONTROL_PROJECT_NAMES,
  type MissionControlDashboardProject,
  type MissionControlProjectId,
  type MissionControlStatusPayload,
  type MissionControlStoredStatus,
} from './types';

const STALE_AFTER_MS = 2 * 60 * 1000;

export function resolveMissionControlStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.COMM_STATE_DIR?.trim()
    || env.STATE_DIR?.trim()
    || path.join(os.tmpdir(), 'asi-state');
  return path.join(root, 'mission-control');
}

function statusPath(projectId: MissionControlProjectId): string {
  return path.join(resolveMissionControlStateDir(), `${projectId}.json`);
}

export async function saveMissionControlStatus(
  payload: MissionControlStatusPayload,
): Promise<MissionControlStoredStatus> {
  const dir = resolveMissionControlStateDir();
  await fs.mkdir(dir, { recursive: true });

  const stored: MissionControlStoredStatus = {
    ...payload,
    receivedAt: new Date().toISOString(),
  };

  const target = statusPath(payload.projectId);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, target);
  return stored;
}

async function readStored(projectId: MissionControlProjectId): Promise<MissionControlStoredStatus | null> {
  try {
    const raw = await fs.readFile(statusPath(projectId), 'utf8');
    const parsed = JSON.parse(raw) as MissionControlStoredStatus;
    if (parsed.projectId !== projectId || typeof parsed.updatedAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function idleProject(projectId: MissionControlProjectId, nowIso: string): MissionControlDashboardProject {
  return {
    projectId,
    name: MISSION_CONTROL_PROJECT_NAMES[projectId],
    status: 'idle',
    stage: 'Нет данных',
    progressPercent: null,
    stageProgressPercent: null,
    completedItems: 0,
    totalItems: 0,
    currentItem: '',
    speed: '',
    eta: '',
    lastEvent: 'Источник статуса ещё не подключён.',
    updatedAt: nowIso,
    receivedAt: nowIso,
    stale: true,
    ageSeconds: 0,
  };
}

export async function getMissionControlDashboard(): Promise<MissionControlDashboardProject[]> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  return Promise.all(MISSION_CONTROL_PROJECT_IDS.map(async (projectId) => {
    const stored = await readStored(projectId);
    if (!stored) return idleProject(projectId, nowIso);

    const updatedAtMs = Date.parse(stored.updatedAt);
    const ageMs = Number.isFinite(updatedAtMs) ? Math.max(0, now - updatedAtMs) : STALE_AFTER_MS + 1;

    return {
      ...stored,
      name: MISSION_CONTROL_PROJECT_NAMES[projectId],
      stale: ageMs > STALE_AFTER_MS,
      ageSeconds: Math.floor(ageMs / 1000),
    };
  }));
}
