import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import {
  MISSION_CONTROL_PROJECT_IDS,
  type MissionControlProjectId,
  type MissionControlStatusKind,
  type MissionControlStatusPayload,
} from './types';

export const MISSION_CONTROL_MAX_BODY_BYTES = 12_288;

const STATUS_VALUES = new Set<MissionControlStatusKind>([
  'running',
  'waiting',
  'error',
  'done',
  'idle',
]);

const ALLOWED_KEYS = new Set([
  'projectId',
  'status',
  'stage',
  'progressPercent',
  'stageProgressPercent',
  'completedItems',
  'totalItems',
  'currentItem',
  'speed',
  'eta',
  'lastEvent',
  'updatedAt',
]);

const PROJECT_IDS = new Set<string>(MISSION_CONTROL_PROJECT_IDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSafeString(value: unknown, maxLength: number, allowEmpty = true): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) return null;
  if (trimmed.length > maxLength) return null;
  if (trimmed && containsForbiddenStringContent(trimmed)) return null;
  return trimmed;
}

function readPercent(value: unknown, nullable = false): number | null {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 10) / 10;
}

function readNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function parseMissionControlStatusPayload(body: unknown): MissionControlStatusPayload | null {
  if (!isPlainObject(body)) return null;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return null;
    const value = body[key];
    if (value !== null && typeof value === 'object') return null;
  }

  const projectId = typeof body.projectId === 'string' && PROJECT_IDS.has(body.projectId)
    ? body.projectId as MissionControlProjectId
    : null;
  const status = typeof body.status === 'string' && STATUS_VALUES.has(body.status as MissionControlStatusKind)
    ? body.status as MissionControlStatusKind
    : null;
  const stage = readSafeString(body.stage, 120, false);
  const progressPercent = readPercent(body.progressPercent, true);
  const stageProgressPercent = readPercent(body.stageProgressPercent, true);
  if (
    body.progressPercent !== undefined
    && body.progressPercent !== null
    && progressPercent === null
  ) {
    return null;
  }
  if (
    body.stageProgressPercent !== undefined
    && body.stageProgressPercent !== null
    && stageProgressPercent === null
  ) {
    return null;
  }
  const completedItems = readNonNegativeInt(body.completedItems);
  const totalItems = readNonNegativeInt(body.totalItems);
  const currentItem = readSafeString(body.currentItem, 320);
  const speed = readSafeString(body.speed, 80);
  const eta = readSafeString(body.eta, 80);
  const lastEvent = readSafeString(body.lastEvent, 500);
  const updatedAt = readIsoDate(body.updatedAt);

  if (
    !projectId
    || !status
    || !stage
    || completedItems === null
    || totalItems === null
    || currentItem === null
    || speed === null
    || eta === null
    || lastEvent === null
    || !updatedAt
    || (totalItems > 0 && completedItems > totalItems)
  ) {
    return null;
  }

  return {
    projectId,
    status,
    stage,
    progressPercent,
    stageProgressPercent,
    completedItems,
    totalItems,
    currentItem,
    speed,
    eta,
    lastEvent,
    updatedAt,
  };
}

export async function readMissionControlStatusBody(request: Request): Promise<unknown | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MISSION_CONTROL_MAX_BODY_BYTES) {
    return null;
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MISSION_CONTROL_MAX_BODY_BYTES || !raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
