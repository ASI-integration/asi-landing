import 'server-only';

import type {
  PartnerRecoveryContext,
  PartnerReputationCategory,
  PartnerReputationRisk,
  PartnerReviewResponsePolicy,
  PartnerReviewSentiment,
  PartnerReviewSeverity,
  TrustedPartnerReviewContext,
} from './contract';

export type RecoveryFact = Readonly<{
  category: string;
  outcome: 'satisfied' | 'not_satisfied' | null;
  status: string;
  openedAt: string;
  operationResolvedAt: string | null;
  guestConfirmedAt: string | null;
  resolutionLatencyMs: number | null;
  confirmationLatencyMs: number | null;
  totalRecoveryLatencyMs: number | null;
}>;

export type RecoverySummary = Readonly<{
  context: PartnerRecoveryContext;
  facts: readonly RecoveryFact[];
}>;

export type SensitiveAllegation = 'legal' | 'safety' | 'discrimination' | 'injury' | 'theft' | 'payment_dispute' | 'refund_dispute' | 'personal_data';

export type PartnerReviewAnalysis = Readonly<{
  sentiment: PartnerReviewSentiment;
  severity: PartnerReviewSeverity;
  categories: readonly PartnerReputationCategory[];
  reputationRisk: PartnerReputationRisk;
  recoveryContext: PartnerRecoveryContext;
  recoveryFacts: readonly RecoveryFact[];
  sensitiveAllegations: readonly SensitiveAllegation[];
}>;

export type ResponseRecommendation = Readonly<{
  text: string;
  policy: PartnerReviewResponsePolicy;
  reasonCodes: readonly string[];
}>;

const CATEGORY_PATTERNS: ReadonlyArray<[PartnerReputationCategory, RegExp]> = [
  ['cleanliness', /чист|гряз|уборк|clean|dirty/iu],
  ['heating', /отоплен|батаре|холодн|холодно|heating|radiator|cold/iu],
  ['water', /вод[ауы]|душ|кран|water|shower/iu],
  ['access', /ключ|замок|доступ|подъезд|access|lock|key/iu],
  ['checkin', /заселен|заезд|check[ -]?in/iu],
  ['checkout', /выезд|check[ -]?out/iu],
  ['communication', /связ|ответ|поддержк|communication|reply|support/iu],
  ['noise', /шум|громк|noise|loud/iu],
  ['wifi', /wi[ -]?fi|вайфай|интернет/iu],
  ['parking', /парков|parking/iu],
  ['amenities', /удобств|полотен|бель[её]|amenit/iu],
  ['accuracy', /не соответств|описани|фото|accuracy|description/iu],
  ['value', /дорог|цен[аы]|стоимост|value|price/iu],
  ['payment', /оплат|списал|возврат|деньг|payment|charge|refund/iu],
  ['staff', /персонал|сотрудник|staff/iu],
  ['safety', /безопас|украл|краж|пропал[аио]?\s+(?:вещ|деньг)|травм|угроз|safety|theft|stolen|injur/iu],
  ['maintenance', /слом|не работ|почини|ремонт|проблем|maintenance|broken|fixed|repair/iu],
];

const SENSITIVE_PATTERNS: ReadonlyArray<[SensitiveAllegation, RegExp]> = [
  ['theft', /украл|краж|пропал[аио]?\s+(?:вещ|деньг)|theft|stolen/iu],
  ['injury', /травм|пострадал|injur/iu],
  ['discrimination', /дискриминац|расизм|discriminat|racis/iu],
  ['personal_data', /персональн.{0,12}данн|паспорт.{0,12}(?:утеч|опублик)|personal data|privacy breach/iu],
  ['refund_dispute', /не вернул.{0,12}(?:деньг|возврат)|отказ.{0,12}возврат|refund dispute/iu],
  ['payment_dispute', /незаконн.{0,12}спис|списал.{0,12}без|unauthori[sz]ed charge/iu],
  ['legal', /суд|полици|адвокат|закон|lawsuit|police|lawyer/iu],
  ['safety', /угроз|опасн|безопас|threat|unsafe|danger/iu],
];

const NEGATIVE = /ужас|плохо|гряз|не работ|не решили|холод|слом|пропал|опасн|разочар|terrible|awful|bad|broken|unresolved/iu;
const POSITIVE = /отлич|спасибо|понрав|удобн|чисто|быстро решили|починили|great|excellent|thanks|resolved|fixed/iu;
const RESOLVED_LANGUAGE = /быстро\s+(?:решил|починил)|удалось\s+(?:решить|исправить)|проблем[ау]\s+(?:решил|исправил)|quickly (?:fixed|resolved)/iu;

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }

export function summarizeRecoveryFacts(facts: readonly RecoveryFact[]): RecoverySummary {
  if (facts.length === 0) return { context: 'no_recovery_case', facts: [] };
  if (facts.length > 1) return { context: 'multiple_recovery_cases', facts: facts.slice(0, 5) };
  const fact = facts[0];
  if (fact.status === 'recovered' || fact.status === 'closed' || fact.outcome === 'satisfied') {
    return { context: 'recovered_before_review', facts: [fact] };
  }
  if (fact.status === 'unrecovered' || fact.outcome === 'not_satisfied') {
    return { context: 'unrecovered_before_review', facts: [fact] };
  }
  return { context: 'awaiting_guest_confirmation', facts: [fact] };
}

export function classifyPartnerReview(
  context: TrustedPartnerReviewContext,
  recovery: RecoverySummary,
): PartnerReviewAnalysis {
  const text = `${context.review.title ?? ''} ${context.review.text}`.trim();
  const categories = CATEGORY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  const sensitive = SENSITIVE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  if (categories.length === 0 && context.review.normalizedRating <= 0.6) categories.push('other');
  const hasNegative = NEGATIVE.test(text);
  const hasPositive = POSITIVE.test(text);
  const recoveredLanguage = RESOLVED_LANGUAGE.test(text) && recovery.context === 'recovered_before_review';
  const hasUnrecoveredRecovery = recovery.facts.some(
    (fact) => fact.status === 'unrecovered' || fact.outcome === 'not_satisfied',
  );

  let sentiment: PartnerReviewSentiment;
  if (context.review.normalizedRating <= 0.4) sentiment = 'negative';
  else if (context.review.normalizedRating >= 0.8 && (!hasNegative || hasPositive || recoveredLanguage)) {
    sentiment = hasNegative && !recoveredLanguage ? 'mixed' : 'positive';
  } else if (hasNegative && hasPositive) sentiment = 'mixed';
  else if (hasNegative || context.review.normalizedRating < 0.6) sentiment = 'negative';
  else sentiment = hasPositive ? 'positive' : 'mixed';

  let severity: PartnerReviewSeverity = 'low';
  if (sensitive.length > 0) severity = 'critical';
  else if (context.review.normalizedRating <= 0.2) severity = 'high';
  else if (context.review.normalizedRating <= 0.4) severity = 'high';
  else if (sentiment === 'negative' || recovery.context === 'unrecovered_before_review' || hasUnrecoveredRecovery) severity = 'medium';
  else if (sentiment === 'mixed' && recovery.context !== 'recovered_before_review') severity = 'medium';

  let reputationRisk: PartnerReputationRisk = 'low';
  if (sensitive.length > 0) reputationRisk = 'critical';
  else if (context.review.normalizedRating <= 0.2 || (sentiment === 'negative' && recovery.context === 'unrecovered_before_review')) reputationRisk = 'high';
  else if (context.review.normalizedRating <= 0.4 || sentiment === 'negative' || recovery.context === 'unrecovered_before_review' || hasUnrecoveredRecovery) reputationRisk = 'medium';
  else if (sentiment === 'mixed' && recovery.context !== 'recovered_before_review') reputationRisk = 'medium';

  return Object.freeze({
    sentiment,
    severity,
    categories: unique(categories),
    reputationRisk,
    recoveryContext: recovery.context,
    recoveryFacts: recovery.facts,
    sensitiveAllegations: unique(sensitive),
  });
}

const FORBIDDEN_RESPONSE_PATTERNS = [
  /удалите.{0,24}отзыв/iu,
  /измените.{0,24}(?:отзыв|оценк)/iu,
  /поставьте.{0,12}5\s*(?:зв[её]зд|балл)/iu,
  /в обмен на.{0,24}(?:отзыв|оценк)/iu,
  /если.{0,30}(?:удал|измен).{0,30}(?:возврат|компенсац|скидк)/iu,
  /(?:обещаем|гарантируем).{0,20}(?:возврат|компенсац)/iu,
];

export function responsePassesManipulationGuard(text: string): boolean {
  return FORBIDDEN_RESPONSE_PATTERNS.every((pattern) => !pattern.test(text));
}

export function recommendPartnerReviewResponse(analysis: PartnerReviewAnalysis): ResponseRecommendation {
  let recommendation: ResponseRecommendation;
  if (analysis.sensitiveAllegations.length > 0) {
    recommendation = {
      text: 'Спасибо, что сообщили об этом. Мы внимательно проверяем описанную ситуацию.',
      policy: 'review_required',
      reasonCodes: ['sensitive_allegation', ...analysis.sensitiveAllegations.map((item) => `allegation_${item}`)],
    };
  } else if (analysis.sentiment === 'negative' && analysis.recoveryContext === 'recovered_before_review') {
    recommendation = {
      text: 'Спасибо за обратную связь. Нам жаль, что возникла проблема, и рады, что её удалось решить во время проживания.',
      policy: 'review_required',
      reasonCodes: ['negative_review', 'recovery_confirmed'],
    };
  } else if (analysis.recoveryContext === 'unrecovered_before_review' || analysis.reputationRisk === 'high') {
    recommendation = {
      text: 'Спасибо, что сообщили об этом. Мы разбираем ситуацию и проверяем, что необходимо исправить.',
      policy: 'review_required',
      reasonCodes: ['negative_review', 'recovery_not_confirmed'],
    };
  } else if (analysis.recoveryContext === 'awaiting_guest_confirmation') {
    recommendation = {
      text: 'Спасибо за обратную связь. Нам жаль, что во время проживания возникла проблема. Мы проверяем ситуацию.',
      policy: 'review_required',
      reasonCodes: ['recovery_awaiting_confirmation'],
    };
  } else if (analysis.recoveryContext === 'multiple_recovery_cases') {
    recommendation = {
      text: 'Спасибо за обратную связь. Мы внимательно проверяем все обстоятельства, связанные с проживанием.',
      policy: 'review_required',
      reasonCodes: ['multiple_recovery_cases'],
    };
  } else if (analysis.recoveryContext === 'recovered_before_review') {
    const heating = analysis.categories.includes('heating');
    recommendation = {
      text: heating
        ? 'Спасибо за обратную связь. Нам жаль, что возникла проблема с отоплением, и рады, что её удалось решить во время проживания.'
        : 'Спасибо за обратную связь. Нам жаль, что возникла проблема, и рады, что её удалось решить во время проживания.',
      policy: 'draft_safe',
      reasonCodes: ['recovery_confirmed', heating ? 'heating_issue' : 'resolved_issue'],
    };
  } else if (analysis.sentiment === 'positive') {
    recommendation = {
      text: 'Спасибо за отзыв! Рады, что проживание вам понравилось.',
      policy: 'draft_safe',
      reasonCodes: ['routine_positive_review'],
    };
  } else {
    recommendation = {
      text: 'Спасибо за обратную связь. Мы внимательно относимся к вашим замечаниям и проверяем ситуацию.',
      policy: analysis.sentiment === 'negative' ? 'review_required' : 'draft_safe',
      reasonCodes: [analysis.sentiment === 'negative' ? 'negative_review' : 'mixed_review'],
    };
  }
  if (!responsePassesManipulationGuard(recommendation.text)) {
    return { text: 'Ответ не подготовлен: требуется проверка оператором.', policy: 'blocked', reasonCodes: ['manipulation_guard_blocked'] };
  }
  return Object.freeze(recommendation);
}

export type ReputationAnalyticsReview = Readonly<{
  reviewRef: string;
  normalizedRating: number;
  sentiment: PartnerReviewSentiment;
  recoveryContext: PartnerRecoveryContext;
  categories: readonly PartnerReputationCategory[];
  receivedAt: string;
}>;

export function derivePropertyReputationIntelligence(rows: readonly ReputationAnalyticsReview[], windowDays: 30 | 90) {
  const reviewCount = rows.length;
  const negativeReviewCount = rows.filter((row) => row.sentiment === 'negative').length;
  const categoryCounts = Object.fromEntries(
    [...new Set(rows.flatMap((row) => row.categories))].map((category) => [category, rows.filter((row) => row.categories.includes(category)).length]),
  ) as Partial<Record<PartnerReputationCategory, number>>;
  const topIssueCategories = Object.entries(categoryCounts)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([category, count]) => ({ category: category as PartnerReputationCategory, count: count ?? 0 }));
  const recurringIssues = topIssueCategories.filter(({ count }) => count >= 4);
  return {
    windowDays,
    reviewCount,
    averageNormalizedRating: reviewCount ? Number((rows.reduce((sum, row) => sum + row.normalizedRating, 0) / reviewCount).toFixed(4)) : null,
    negativeReviewCount,
    negativeReviewRate: reviewCount ? Number((negativeReviewCount / reviewCount).toFixed(4)) : null,
    topIssueCategories,
    categoryCounts,
    unresolvedRecoveryLinkedReviewCount: rows.filter((row) => row.recoveryContext === 'unrecovered_before_review').length,
    recoveredReviewCount: rows.filter((row) => row.recoveryContext === 'recovered_before_review').length,
    recurringIssues,
    trendSignal: reviewCount >= 8 ? (negativeReviewCount / reviewCount >= 0.5 ? 'negative_attention' : 'stable') : 'insufficient_sample',
  } as const;
}

function cohort(rows: readonly ReputationAnalyticsReview[], recoveryContext: 'recovered_before_review' | 'unrecovered_before_review') {
  const selected = rows.filter((row) => row.recoveryContext === recoveryContext);
  const negatives = selected.filter((row) => row.sentiment === 'negative').length;
  return {
    sampleSize: selected.length,
    negativeReviewRate: selected.length ? Number((negatives / selected.length).toFixed(4)) : null,
    averageNormalizedRating: selected.length
      ? Number((selected.reduce((sum, row) => sum + row.normalizedRating, 0) / selected.length).toFixed(4))
      : null,
  };
}

export function deriveObservationalRecoveryReviewKpis(rows: readonly ReputationAnalyticsReview[]) {
  return {
    label: 'observational' as const,
    causalityClaimed: false as const,
    recovered: cohort(rows, 'recovered_before_review'),
    unrecovered: cohort(rows, 'unrecovered_before_review'),
  };
}
