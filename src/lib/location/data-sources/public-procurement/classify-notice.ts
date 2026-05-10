import type { ConfidenceLevel } from '../../report-contract';
import type {
  UrbanDevelopmentLifecycleStage,
  UrbanDevelopmentSignalStatus,
  UrbanDevelopmentSignalType,
} from '../urban-development';
import {
  PUBLIC_PROCUREMENT_PROCEDURE_LIFECYCLE_RULES,
  PUBLIC_PROCUREMENT_URBAN_KEYWORD_RULES,
  type PublicProcurementUrbanKeywordRule,
} from './urban-signals-dictionary';

export interface PublicProcurementNoticeInput {
  readonly id: string;
  readonly title: string;
  readonly customer?: string;
  readonly regionHint?: string;
  readonly subjectDetail?: string;
  readonly procedureStage?: string;
  readonly publishedAt?: string;
  readonly url?: string;
}

export interface ClassifiedPublicProcurementUrbanSignal {
  readonly signalType: UrbanDevelopmentSignalType;
  readonly lifecycleStage: UrbanDevelopmentLifecycleStage;
  readonly status: UrbanDevelopmentSignalStatus;
  readonly confidence: ConfidenceLevel;
  readonly thematicMatched: boolean;
}

function normalizeBlob(parts: readonly (string | undefined)[]): string {
  return parts
    .filter((x): x is string => Boolean(x?.trim()))
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function pickKeywordRule(blob: string): PublicProcurementUrbanKeywordRule | undefined {
  let best: PublicProcurementUrbanKeywordRule | undefined;
  for (const rule of PUBLIC_PROCUREMENT_URBAN_KEYWORD_RULES) {
    if (!rule.needles.some(n => blob.includes(n))) continue;
    if (!best || rule.priority > best.priority) best = rule;
  }
  return best;
}

function lifecycleFromProcedure(procedureText: string | undefined): UrbanDevelopmentLifecycleStage | undefined {
  if (!procedureText?.trim()) return undefined;
  const p = procedureText.toLowerCase();
  for (const rule of PUBLIC_PROCUREMENT_PROCEDURE_LIFECYCLE_RULES) {
    if (rule.needles.some(n => p.includes(n))) return rule.lifecycleStage;
  }
  return undefined;
}

function mergeLifecycle(
  keywordRule: PublicProcurementUrbanKeywordRule | undefined,
  procedureStage: string | undefined,
): UrbanDevelopmentLifecycleStage {
  const fromProcedure = lifecycleFromProcedure(procedureStage);
  if (fromProcedure === 'construction_preparation') return fromProcedure;
  if (fromProcedure === 'design') return 'design';
  if (fromProcedure === 'procurement') return 'procurement';
  if (keywordRule?.lifecycleStage) return keywordRule.lifecycleStage;
  return 'procurement';
}

function statusFromLifecycle(stage: UrbanDevelopmentLifecycleStage): UrbanDevelopmentSignalStatus {
  switch (stage) {
    case 'planning':
      return 'planned';
    case 'design':
      return 'in_design';
    case 'procurement':
      return 'procurement';
    case 'construction_preparation':
      return 'planned';
  }
}

function confidenceFromMatch(args: {
  thematicMatched: boolean;
  signalType: UrbanDevelopmentSignalType;
  hasUrl: boolean;
}): ConfidenceLevel {
  if (!args.thematicMatched || args.signalType === 'government_procurement') return 'low';
  if (args.hasUrl) return 'high';
  return 'medium';
}

export function classifyPublicProcurementNotice(notice: PublicProcurementNoticeInput): ClassifiedPublicProcurementUrbanSignal {
  const blob = normalizeBlob([notice.title, notice.subjectDetail, notice.customer]);
  const keywordRule = pickKeywordRule(blob);

  const thematicMatched = Boolean(keywordRule);
  const signalType: UrbanDevelopmentSignalType = keywordRule?.signalType ?? 'government_procurement';
  const lifecycleStage = mergeLifecycle(keywordRule, notice.procedureStage);
  const status = statusFromLifecycle(lifecycleStage);
  const confidence = confidenceFromMatch({
    thematicMatched,
    signalType,
    hasUrl: Boolean(notice.url?.trim()),
  });

  return { signalType, lifecycleStage, status, confidence, thematicMatched };
}
