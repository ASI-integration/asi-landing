/**
 * SP-04/SP-07 — sanitized result fields for Pilot Console.
 * Never returns raw Bridge envelopes, secrets, provider metadata, or logs.
 */
import type { RuntimeBridgeSafeResult } from '@/lib/asi-runtime/bridge-types';
import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import { isExactGitSha } from '@/lib/development/baseline-sha';
import { safeAllowlistedPullRequestUrl } from '@/lib/development/pr-url';
import type { PilotConsoleStatus } from './status';

const SUMMARY_MAX = 500;
const BLOCKER_MAX = 240;
const MAX_CHANGED_FILES = 40;
const MAX_BLOCKERS = 20;

export type PilotSafeResultView = {
  outcome: 'succeeded' | 'failed' | null;
  summary: string | null;
  changedFiles: string[];
  pullRequestUrl: string | null;
  commitSha: string | null;
  blockers: string[];
};

function sanitizeText(value: string, max: number): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (containsForbiddenStringContent(trimmed)) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function isSafeChangedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized || normalized.length > 260) return false;
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  if (containsForbiddenStringContent(normalized)) return false;
  // Prefer green pilot scope; still allow other relative repo paths without secrets.
  return true;
}

/**
 * Build a pilot-safe result payload from a Bridge safe result (or null).
 */
export function buildPilotSafeResultView(input: {
  consoleStatus: PilotConsoleStatus;
  bridgeResult: RuntimeBridgeSafeResult | null | undefined;
}): PilotSafeResultView {
  const { consoleStatus, bridgeResult } = input;

  if (!bridgeResult || (consoleStatus !== 'succeeded' && consoleStatus !== 'failed')) {
    return {
      outcome: null,
      summary: null,
      changedFiles: [],
      pullRequestUrl: null,
      commitSha: null,
      blockers: [],
    };
  }

  const outcome = consoleStatus === 'succeeded' ? 'succeeded' : 'failed';
  const summary = sanitizeText(String(bridgeResult.summary ?? ''), SUMMARY_MAX);

  const changedFiles = (bridgeResult.changedFiles ?? [])
    .filter((path): path is string => typeof path === 'string')
    .map((path) => path.replace(/\\/g, '/').trim())
    .filter(isSafeChangedPath)
    .slice(0, MAX_CHANGED_FILES);

  let pullRequestUrl: string | null = null;
  let commitSha: string | null = null;
  for (const artifact of bridgeResult.artifacts ?? []) {
    if (artifact.type === 'pull_request' && !pullRequestUrl) {
      pullRequestUrl = safeAllowlistedPullRequestUrl(artifact.value);
    }
    if (artifact.type === 'commit' && !commitSha) {
      const sha = String(artifact.value ?? '').trim().toLowerCase();
      if (isExactGitSha(sha)) commitSha = sha;
    }
  }

  const blockers = (bridgeResult.blockers ?? [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => sanitizeText(item, BLOCKER_MAX))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_BLOCKERS);

  return {
    outcome,
    summary,
    changedFiles,
    pullRequestUrl,
    commitSha,
    blockers,
  };
}
