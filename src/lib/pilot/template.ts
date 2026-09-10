/**
 * SP-02 — Pilot task template + green policy guard.
 * Client may only supply title/goal/idempotencyKey. Server owns the Bridge envelope.
 */

import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import {
  RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS,
  RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS,
  RUNTIME_BRIDGE_MAX_INSTRUCTIONS,
} from '@/lib/asi-runtime/bridge-schema';
import type { RuntimeBridgeTaskRequest } from '@/lib/asi-runtime/bridge-types';
import { PilotAccessError } from './errors';
import { PILOT_PROVENANCE_MARKER } from './provenance';

export const PILOT_GOAL_MAX_CHARS = 2_000;
export const PILOT_TITLE_MAX_CHARS = 200;
export const PILOT_TEMPLATE_ID = 'strigunov_pilot_green_v1' as const;

/** Fixed repository for Strigunov pilot (matches Bridge schema allowlist). */
export const PILOT_FIXED_REPOSITORY = 'ASI-integration/asi-landing' as const;

export const PILOT_FIXED_REPOSITORY_ID = 'asi-landing' as const;

/** Privileged / envelope fields the external pilot client must not set. */
export const PILOT_FORBIDDEN_CLIENT_FIELDS = Object.freeze([
  'baselineSha',
  'baseline_sha',
  'repository',
  'repositoryId',
  'repository_id',
  'repositoryPath',
  'repository_path',
  'provider',
  'providers',
  'merge',
  'deploy',
  'release',
  'instructions',
  'acceptanceCriteria',
  'safetyConstraints',
  'inScope',
  'outOfScope',
  'redActions',
  'conversationId',
  'chatgptTaskId',
  'clientId',
  'engineMode',
  'policy',
  'timeoutSeconds',
  'networkMode',
  'codexMode',
] as const);

const RED_OBJECTIVE_PATTERN =
  /\b(merge|deploy|release|production|prod\b|staging\b|migration|migrations|secret|secrets|supabase|dns\b|payment|payments|rollback|sudo|shell\b|privileged|owner[- ]?console|ASI_REAL_GH|force[- ]?push)\b/i;

export const PILOT_SAFETY_CONSTRAINTS = Object.freeze([
  'Не выполнять merge, deploy, release и не менять production data, migrations, secrets, environment variables, DNS, payments или repository settings.',
  'Не выбирать провайдеров, shell-команды, пути репозитория или policy overrides — они задаются только серверным шаблоном пилота.',
  'Работать только в изолированном checkout; изменять только файлы под docs/pilot/ (proof/markdown в согласованном scope).',
  'Не обходить readiness/auth/policy gates и не использовать owner-only Runtime функции.',
  `Шаблон: ${PILOT_TEMPLATE_ID}. ${PILOT_PROVENANCE_MARKER}.`,
] as const);

export type PilotGreenTemplatePackage = {
  templateId: typeof PILOT_TEMPLATE_ID;
  title: string;
  objective: string;
  instructions: string[];
  acceptanceCriteria: string[];
  safetyConstraints: string[];
  repository: typeof PILOT_FIXED_REPOSITORY;
};

function text(value: unknown, max: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && value === value.trim()
    && !containsForbiddenStringContent(value);
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  const candidate = value.slice(0, max - 1);
  const boundary = candidate.lastIndexOf(' ');
  const prefix = boundary >= Math.floor(max * 0.6) ? candidate.slice(0, boundary) : candidate;
  return `${prefix.trimEnd()}…`;
}

function promptInstructionLines(prompt: string): string[] {
  const lines: string[] = [];
  let remaining = prompt.replace(/\s+/g, ' ').trim();
  while (remaining.length > RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS) {
    let boundary = remaining.lastIndexOf(' ', RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS);
    if (boundary < Math.floor(RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS * 0.6)) {
      boundary = RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS;
    }
    lines.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) lines.push(remaining);
  return lines.length ? lines : [prompt];
}

function assertInstructionBudget(lines: string[]): void {
  if (lines.length > RUNTIME_BRIDGE_MAX_INSTRUCTIONS) {
    throw new PilotAccessError('invalid_goal', 400, 'Слишком длинная формулировка задачи.');
  }
  let total = 0;
  for (const line of lines) {
    total += line.length;
    if (total > RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS) {
      throw new PilotAccessError('invalid_goal', 400, 'Слишком длинная формулировка задачи.');
    }
  }
}

/**
 * Reject privileged client fields. Unknown extra keys beyond allowlist are also rejected
 * so pilots cannot smuggle envelope overrides.
 */
export function assertNoPrivilegedPilotFields(body: Record<string, unknown>): void {
  const allowed = new Set(['goal', 'title', 'idempotencyKey', 'objective', 'description']);
  for (const key of Object.keys(body)) {
    if (PILOT_FORBIDDEN_CLIENT_FIELDS.includes(key as (typeof PILOT_FORBIDDEN_CLIENT_FIELDS)[number])) {
      throw new PilotAccessError(
        'privileged_field_forbidden',
        400,
        'Поле задаётся только сервером и не принимается от клиента.',
      );
    }
    if (!allowed.has(key)) {
      throw new PilotAccessError(
        'unknown_field_forbidden',
        400,
        'Неизвестное поле запроса пилота.',
      );
    }
  }
}

export function assertPilotGoalIsGreen(goal: string): void {
  if (RED_OBJECTIVE_PATTERN.test(goal)) {
    throw new PilotAccessError(
      'red_objective_rejected',
      400,
      'Задача отклонена: для пилота запрещены merge/deploy/production и другие привилегированные действия.',
    );
  }
}

/**
 * Build the server-owned green Bridge task package from pilot NL input.
 */
export function buildPilotGreenTemplate(input: {
  goal: unknown;
  title?: unknown;
  /** Aliases accepted then normalized — still green-path only. */
  objective?: unknown;
  description?: unknown;
}): PilotGreenTemplatePackage {
  const rawGoal = input.goal ?? input.objective ?? input.description;
  if (!text(rawGoal, PILOT_GOAL_MAX_CHARS)) {
    throw new PilotAccessError(
      'invalid_goal',
      400,
      'Опишите задачу пилота (до 2000 символов).',
    );
  }

  const goal = rawGoal.trim();
  assertPilotGoalIsGreen(goal);

  let title: string | null = null;
  if (input.title !== undefined && input.title !== null && String(input.title).trim()) {
    if (!text(input.title, PILOT_TITLE_MAX_CHARS)) {
      throw new PilotAccessError('invalid_title', 400, 'Проверьте заголовок задачи.');
    }
    title = input.title.trim();
    assertPilotGoalIsGreen(title);
  }

  const compact = goal.replace(/\s+/g, ' ');
  const resolvedTitle = title ?? truncateText(compact, PILOT_TITLE_MAX_CHARS);
  const objective = truncateText(
    `Пилот ASI (${PILOT_TEMPLATE_ID}): выполнить безопасный green-path запрос. ${compact}`,
    4000,
  );

  const scopeLines = [
    'Использовать только серверный шаблон пилота; не расширять scope.',
    'Изменять только файлы под docs/pilot/.',
    'Не выполнять merge, deploy, release, production или секреты.',
    ...promptInstructionLines(goal),
  ];
  assertInstructionBudget(scopeLines);

  return {
    templateId: PILOT_TEMPLATE_ID,
    title: resolvedTitle,
    objective,
    instructions: scopeLines,
    acceptanceCriteria: [
      `Запрос пилота выполнен в рамках green template: ${truncateText(compact, 900)}`,
      'Изменения ограничены docs/pilot/.',
      'Merge/deploy/production действия не выполнялись.',
    ],
    safetyConstraints: [...PILOT_SAFETY_CONSTRAINTS],
    repository: PILOT_FIXED_REPOSITORY,
  };
}

export function toBridgeTaskRequest(
  taskPackage: PilotGreenTemplatePackage,
  baselineSha: string,
): RuntimeBridgeTaskRequest {
  return {
    title: taskPackage.title,
    objective: taskPackage.objective,
    instructions: taskPackage.instructions,
    acceptanceCriteria: taskPackage.acceptanceCriteria,
    safetyConstraints: taskPackage.safetyConstraints,
    repository: taskPackage.repository,
    baselineSha,
  };
}
