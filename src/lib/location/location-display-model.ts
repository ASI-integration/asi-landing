import type { LocationAnalysis, TargetAudience } from './types';
import {
  applyResidentialDemoSanity,
  type ResidentialDemoAudience,
  type ResidentialDemoSanity,
  type ResidentialDemoVerdictTone,
} from './residential-demo-sanity';

export type LocationDisplayAudience =
  | ResidentialDemoAudience
  | 'COMMERCIAL';

export interface LocationSafeDriver {
  labelRu: string;
  kind: 'positive' | 'limiting' | 'context';
}

export interface LocationDisplayModel {
  rawScore: number;
  displayScore: number;
  displayAudience: LocationDisplayAudience;
  audienceLabelRu: string;
  verdictLabelRu: string;
  verdictTone: ResidentialDemoVerdictTone;
  capReasons: string[];
  safeDrivers: LocationSafeDriver[];
  reportNarrative: string;
  residentialSanityApplied: boolean;
  demoSanity?: ResidentialDemoSanity;
}

export interface BuildLocationDisplayModelOptions {
  locale?: 'ru' | 'en';
  mode?: 'residential' | 'commercial';
}

function audienceLabelRu(audience: LocationDisplayAudience): string {
  switch (audience) {
    case 'BUSINESS':
      return 'Деловой';
    case 'TOURIST':
      return 'Туристический';
    case 'MIXED':
      return 'Смешанная';
    case 'COMMERCIAL':
      return 'Коммерческая';
    case 'RESIDENTIAL':
    default:
      return 'Жилая';
  }
}

function displayAudienceFromRaw(primary?: TargetAudience): LocationDisplayAudience {
  if (primary === 'BUSINESS') return 'BUSINESS';
  if (primary === 'TOURIST') return 'TOURIST';
  return 'RESIDENTIAL';
}

function verdictFromScore(
  displayScore: number,
  displayAudience: LocationDisplayAudience,
): { label: string; tone: ResidentialDemoVerdictTone } {
  if (displayScore >= 80) {
    if (displayAudience === 'BUSINESS') {
      return { label: 'Сильная локация для командированных', tone: 'strong' };
    }
    if (displayAudience === 'TOURIST') {
      return { label: 'Сильная туристическая локация', tone: 'strong' };
    }
    if (displayAudience === 'COMMERCIAL') {
      return { label: 'Сильная коммерческая локация', tone: 'strong' };
    }
    return { label: 'Сильная локация для посуточной аренды', tone: 'strong' };
  }

  if (displayScore >= 60) {
    return { label: 'Хорошая локация', tone: 'medium' };
  }

  if (displayScore >= 45) {
    return { label: 'Спокойная жилая зона, спрос требует проверки', tone: 'weak' };
  }

  return { label: 'Слабый спрос — нужен точечный сценарий', tone: 'weak' };
}

function publicCapReason(line: string): string {
  return line
    .replace(
      /Рядом промышленные объекты, но деловых магнитов нет — оценка ограничена для жилого сценария\.?/u,
      'Рядом есть промышленные объекты, но нет крупного делового якоря для устойчивого потока командированных.',
    )
    .replace(
      /Деловой профиль не подтверждён сильными магнитами \(вторичный кластер\);\s*оценка ограничена для публичного вывода\.?/u,
      'Деловые сигналы есть, но без крупного якоря спроса уровня БЦ или вокзала.',
    )
    .replace(
      /Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён\.?/u,
      'Рядом есть отдельные деловые точки, но нет крупного якоря спроса уровня БЦ, вокзала или делового кластера.',
    )
    .replace(
      /Рядом только локальные офисные сигналы[^.]*?деловой профиль не подтверждён\.?/u,
      'Рядом есть отдельные офисы, но крупного якоря спроса поблизости нет.',
    )
    .replace(
      /Нет сильных магнитов спроса в радиусе 1 км;\s*оценка ограничена\.?/u,
      'В радиусе 1 км нет крупных якорей спроса.',
    )
    .replace(
      /«Сильный» диапазон требует не менее двух независимых магнитов — один сигнал недостаточен\.?/u,
      'Поблизости только один крупный якорь спроса.',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function unsafeResidentialDriver(line: string, displayAudience: LocationDisplayAudience): boolean {
  const normalized = line.toLowerCase();
  if (displayAudience !== 'BUSINESS') {
    if (/командирован|деловой\s+поток|корпоратив|business/i.test(line)) return true;
  }
  return /завод|фабрик|производств|промзон|industrial|factory/i.test(normalized);
}

function makeSafeDrivers(args: {
  analysis: LocationAnalysis;
  displayAudience: LocationDisplayAudience;
  capReasons: string[];
  residentialSanityApplied: boolean;
}): LocationSafeDriver[] {
  const out: LocationSafeDriver[] = [];
  const seen = new Set<string>();

  const push = (labelRu: string, kind: LocationSafeDriver['kind']) => {
    const label = labelRu.replace(/\s+/g, ' ').trim();
    if (!label || seen.has(label)) return;
    seen.add(label);
    out.push({ labelRu: label, kind });
  };

  for (const reason of args.capReasons) {
    push(publicCapReason(reason), 'limiting');
  }

  const positives = args.analysis.locationScore?.top_positive_factors ?? [];
  for (const factor of positives) {
    if (out.length >= 4) break;
    if (
      args.residentialSanityApplied &&
      unsafeResidentialDriver(factor, args.displayAudience)
    ) continue;
    push(factor, 'positive');
  }

  if (out.length === 0) {
    const env = args.analysis.neighborhoodEnvironment;
    if (env?.environmentNarrativeRu) push(env.environmentNarrativeRu, 'context');
  }

  return out.slice(0, 4);
}

function buildReportNarrative(args: {
  displayScore: number;
  verdictLabelRu: string;
  displayAudience: LocationDisplayAudience;
  safeDrivers: LocationSafeDriver[];
  capReasons: string[];
}): string {
  const driver = args.safeDrivers[0]?.labelRu;
  if (args.capReasons.length > 0 && driver) {
    return `${args.verdictLabelRu}: ${driver}`;
  }
  if (driver) {
    return `${args.verdictLabelRu}: ${driver}`;
  }
  return `${args.verdictLabelRu}: публичная оценка ${Math.round(args.displayScore)}/100, профиль спроса — ${audienceLabelRu(args.displayAudience).toLowerCase()}.`;
}

export function buildLocationDisplayModel(
  analysis: LocationAnalysis,
  options: BuildLocationDisplayModelOptions = {},
): LocationDisplayModel {
  const locale = options.locale ?? 'ru';
  const mode = options.mode ?? 'residential';
  const rawScore = analysis.evergreenIndex;
  const isRuResidential = locale === 'ru' && mode === 'residential';
  const demoSanity = isRuResidential ? applyResidentialDemoSanity(analysis) : undefined;

  const displayScore = demoSanity?.displayScore ?? rawScore;
  const displayAudience =
    mode === 'commercial'
      ? 'COMMERCIAL'
      : demoSanity?.displayAudience ?? displayAudienceFromRaw(analysis.audienceAnalysis?.primaryAudience);
  const verdict =
    demoSanity
      ? { label: demoSanity.verdictLabelRu, tone: demoSanity.verdictTone }
      : verdictFromScore(displayScore, displayAudience);
  const capReasons = demoSanity?.capReasonsRu ?? [];
  const residentialSanityApplied = Boolean(demoSanity?.capApplied);
  const safeDrivers = makeSafeDrivers({
    analysis,
    displayAudience,
    capReasons,
    residentialSanityApplied: Boolean(demoSanity),
  });

  return {
    rawScore,
    displayScore,
    displayAudience,
    audienceLabelRu: demoSanity?.audienceLabelRu ?? audienceLabelRu(displayAudience),
    verdictLabelRu: verdict.label,
    verdictTone: verdict.tone,
    capReasons,
    safeDrivers,
    reportNarrative: buildReportNarrative({
      displayScore,
      verdictLabelRu: verdict.label,
      displayAudience,
      safeDrivers,
      capReasons,
    }),
    residentialSanityApplied,
    ...(demoSanity ? { demoSanity } : {}),
  };
}
