export const RUNTIME_SNAPSHOT_MAX_BODY_BYTES = 16_384;

export const RUNTIME_SNAPSHOT_SUPPORTED_PAYLOAD_VERSION = 1;

const ALLOWED_KEYS = new Set([
  'taskId',
  'taskTitle',
  'status',
  'currentStage',
  'completedSteps',
  'totalSteps',
  'progressPercent',
  'provider',
  'attemptNumber',
  'commitSha',
  'pullRequestUrl',
  'verificationStatus',
  'lastEvent',
  'startedAt',
  'payloadVersion',
]);

const STRING_LIMITS: Record<string, number> = {
  taskId: 200,
  taskTitle: 500,
  status: 100,
  currentStage: 200,
  provider: 100,
  commitSha: 64,
  pullRequestUrl: 2000,
  verificationStatus: 100,
  lastEvent: 500,
};

const FORBIDDEN_STRING_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
  /\bsk-[A-Za-z0-9]{8,}\b/i,
  /\bASI_[A-Z0-9_]+=/i,
  /\bprocess\.env\b/i,
  /(?:^|[\s"'`])(?:[A-Z][A-Z0-9_]{2,})=(?:[^\s"'`]{8,})/,
  /(?:^|[\s"'])[A-Za-z]:\\[^\s"']+/,
  /(?:^|[\s"'])\/(?:Users|home|var|tmp|etc)\/[^\s"']+/,
  /\b(?:stdout|stderr)\s*[:=]/i,
];

export type RuntimeSnapshotIngestPayload = {
  taskId: string;
  taskTitle: string;
  status: string;
  currentStage: string;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  provider: string;
  attemptNumber: number;
  commitSha: string | null;
  pullRequestUrl: string | null;
  verificationStatus: string;
  lastEvent: string;
  startedAt: string;
  payloadVersion: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  if (containsForbiddenStringContent(trimmed)) return null;
  return trimmed;
}

function readOptionalTrimmedString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  return readTrimmedString(value, maxLength);
}

function readNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function readOptionalNonNegativeInt(value: unknown, defaultValue: number): number | null {
  if (value === null || value === undefined) return defaultValue;
  return readNonNegativeInt(value);
}

function readOptionalProgressPercent(value: unknown, defaultValue: number): number | null {
  if (value === null || value === undefined) return defaultValue;
  return readProgressPercent(value);
}

function readOptionalTrimmedStringOrDefault(
  value: unknown,
  maxLength: number,
  defaultValue: string,
): string | null {
  if (value === null || value === undefined) return defaultValue;
  return readTrimmedString(value, maxLength);
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null;
  return value;
}

function readProgressPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) return null;
  return value;
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function readHttpUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > STRING_LIMITS.pullRequestUrl) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function containsForbiddenStringContent(value: string): boolean {
  return FORBIDDEN_STRING_PATTERNS.some((pattern) => pattern.test(value));
}

export function parseRuntimeSnapshotIngestPayload(body: unknown): RuntimeSnapshotIngestPayload | null {
  if (!isPlainObject(body)) return null;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return null;
    const value = body[key];
    if (value !== null && typeof value === 'object') return null;
  }

  const taskId = readTrimmedString(body.taskId, STRING_LIMITS.taskId);
  const taskTitle = readTrimmedString(body.taskTitle, STRING_LIMITS.taskTitle);
  const status = readTrimmedString(body.status, STRING_LIMITS.status);
  const startedAt = readIsoDate(body.startedAt);
  const completedSteps = readOptionalNonNegativeInt(body.completedSteps, 0);
  const totalSteps = readOptionalNonNegativeInt(body.totalSteps, 0);
  const progressPercent = readOptionalProgressPercent(body.progressPercent, 0);
  const attemptNumber = readPositiveInt(body.attemptNumber);
  const payloadVersion = typeof body.payloadVersion === 'number' && Number.isInteger(body.payloadVersion)
    ? body.payloadVersion
    : null;

  if (
    !taskId
    || !taskTitle
    || !status
    || !startedAt
    || completedSteps === null
    || totalSteps === null
    || progressPercent === null
    || attemptNumber === null
    || payloadVersion !== RUNTIME_SNAPSHOT_SUPPORTED_PAYLOAD_VERSION
  ) {
    return null;
  }

  const currentStage = readOptionalTrimmedStringOrDefault(
    body.currentStage,
    STRING_LIMITS.currentStage,
    '',
  );
  const provider = readOptionalTrimmedStringOrDefault(
    body.provider,
    STRING_LIMITS.provider,
    '',
  );
  const verificationStatus = readOptionalTrimmedStringOrDefault(
    body.verificationStatus,
    STRING_LIMITS.verificationStatus,
    'unknown',
  );
  const lastEvent = readOptionalTrimmedStringOrDefault(
    body.lastEvent,
    STRING_LIMITS.lastEvent,
    '',
  );

  if (
    currentStage === null
    || provider === null
    || verificationStatus === null
    || lastEvent === null
  ) {
    return null;
  }

  let commitSha: string | null;
  if (body.commitSha === undefined || body.commitSha === null) {
    commitSha = null;
  } else {
    const parsedCommitSha = readOptionalTrimmedString(body.commitSha, STRING_LIMITS.commitSha);
    if (parsedCommitSha === undefined) return null;
    commitSha = parsedCommitSha;
  }

  let pullRequestUrl: string | null;
  if (body.pullRequestUrl === undefined || body.pullRequestUrl === null) {
    pullRequestUrl = null;
  } else {
    const parsedPullRequestUrl = readHttpUrl(body.pullRequestUrl);
    if (parsedPullRequestUrl === undefined) return null;
    pullRequestUrl = parsedPullRequestUrl;
  }

  return {
    taskId,
    taskTitle,
    status,
    currentStage,
    completedSteps,
    totalSteps,
    progressPercent,
    provider,
    attemptNumber,
    commitSha,
    pullRequestUrl,
    verificationStatus,
    lastEvent,
    startedAt,
    payloadVersion,
  };
}

export async function readRuntimeSnapshotIngestBody(request: Request): Promise<unknown | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > RUNTIME_SNAPSHOT_MAX_BODY_BYTES) {
    return null;
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > RUNTIME_SNAPSHOT_MAX_BODY_BYTES) {
    return null;
  }
  if (!raw.trim()) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
