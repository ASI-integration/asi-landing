/**
 * RU demo / free-tier wording only — does not change magnet weights or fetch logic.
 */

import type { LocationAnalysis } from './types';
import {
  buildDemoPublicEvidenceFlags,
  specializedMedicalDemoPublicLineRu,
  strategicHubDemoPublicLineRu,
  type DemoPublicEvidenceFlags,
} from './demo-free-evidence';

export type RuDemoExplanationDiagnostics = {
  bulletsKept: string[];
  bulletsRemovedByEvidenceGate: string[];
  bulletsCollapsedSemanticDup: string[];
};

export type NormalizeRuDemoOptions = {
  max?: number;
  analysis?: LocationAnalysis;
  diagnostics?: RuDemoExplanationDiagnostics;
};

export function sanitizeRuPublicFactor(line: string): string | null {
  const trimmed = (line ?? '').trim();
  if (!trimmed) return null;

  const dropPatterns = [
    /модель\s+ограничила/i,
    /sanity/i,
    /weak[- ]office/i,
    /\bcap\b/i,
    /\braw\b/i,
  ];
  if (dropPatterns.some(rx => rx.test(trimmed))) return null;

  const replacements: Array<[RegExp, string]> = [
    [
      /Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён\.?/u,
      'Рядом есть отдельные деловые точки, но нет крупного якоря спроса уровня БЦ, вокзала или делового кластера.',
    ],
    [
      /Рядом только локальные офисные сигналы[^.]*?деловой профиль не подтверждён\.?/u,
      'Рядом есть отдельные офисы, но крупного якоря спроса (БЦ, вокзал, деловой кластер) поблизости нет.',
    ],
    [
      /Рядом только локальные офисные сигналы[^.]*?устойчивый деловой поток не подтверждается\.?/u,
      'Рядом есть отдельные офисы, но устойчивого делового потока поблизости нет.',
    ],
    [
      /Нет сильных магнитов спроса в радиусе 1 км;\s*оценка ограничена\.?/u,
      'В радиусе 1 км нет крупных якорей спроса (БЦ, вокзала, делового кластера).',
    ],
    [
      /«Сильный» диапазон требует не менее двух независимых магнитов — один сигнал недостаточен\.?/u,
      'Поблизости только один крупный якорь спроса.',
    ],
    [
      /Деловой профиль не подтверждён сильными магнитами \(вторичный кластер\);\s*оценка ограничена для публичного вывода\.?/u,
      'Деловые сигналы есть, но без крупного якоря спроса уровня БЦ или вокзала.',
    ],
    [
      /Есть несколько локальных магнитов спроса \(вторичный кластер\);\s*оценка не должна схлопываться в «почти ноль»\.?/u,
      'Поблизости есть несколько локальных точек спроса.',
    ],
    [/;?\s*оценка ограничена(?:[^.]*)\.?/giu, '.'],
    [/\s*\(вторичный кластер\)/giu, ''],
  ];

  let out = trimmed;
  for (const [rx, repl] of replacements) out = out.replace(rx, repl);
  out = out.replace(/\s+/g, ' ').replace(/\s+\./g, '.').trim();
  return out || null;
}

export function sanitizeRuFactorList(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = sanitizeRuPublicFactor(line);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function semanticBucketRu(line: string): string {
  const l = line.toLowerCase();
  if (/транспортн|метро\b|вокзал|аэропорт|ж\/д|тпу|порт\b/.test(l)) return '__transport__';
  if (/медицин|больниц|клиник|стационар|поликлиник/.test(l)) return '__medical__';
  if (/делов|офис|командиров|кластер делов|бизнес|корпоратив/.test(l)) return '__business__';
  if (/конкурен/.test(l)) return '__competition__';
  if (/промышлен|магистрал|шум|озелен|средова|окружен/.test(l)) return '__environment__';
  return `__other__:${line}`;
}

/** Requires structured magnet evidence (see demo-free-evidence). */
export function gateRuDemoPublicPhrase(line: string, flags: DemoPublicEvidenceFlags): boolean {
  const t = line.trim();

  const vagueTransport =
    /крупн(ый|ая|ое)?\s+транспортн/i.test(t) ||
    /ключевой транспортный якорь/i.test(t) ||
    /транспортная доступность усиливает спрос/i.test(t) ||
    (/есть крупные транспортные узлы/i.test(t) && !/\d/.test(t));

  if (vagueTransport && !flags.transport) return false;

  const vagueMedical =
    /крупная медицина/i.test(t) ||
    (/медицинск(?:ие|ий)|социальн(?:ые|ый)\s+объект/i.test(t) && /зоне доступности/i.test(t));

  if (vagueMedical && !flags.medical) return false;

  const vagueBusiness =
    /рядом деловые объекты/i.test(t) ||
    /деловой поток подтверждён якорями/i.test(t) ||
    (/производственные и деловые объекты/i.test(t) && !/\d/.test(t));

  if (vagueBusiness && !flags.businessCluster) return false;

  if (/сильные сигналы спроса/i.test(t) && !flags.demandStrong) return false;

  return true;
}

/**
 * Removes POI names and jargon where safe.
 * Returns null when the line must be replaced by evidence-backed copy upstream.
 */
export function generalizeRuPublicScoreExplanation(line: string): string | null {
  const trimmed = (line ?? '').trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  if (/крупный транспортный узел в транспортной доступности/i.test(trimmed)) return null;
  if (/крупн(?:ый|ая|ое)\s+транспортно-логистическ/i.test(trimmed)) return null;
  if (/крупная медицина в зоне доступности/i.test(trimmed)) return null;

  if (/ключевой транспортный якорь/i.test(trimmed)) return null;

  if (/деловой поток подтверждён якорями поблизости/i.test(trimmed)) {
    return 'Рядом деловые объекты в зоне доступности.';
  }

  if (/локальные деловые сигналы рядом/i.test(trimmed)) {
    return 'Есть отдельные деловые точки рядом без крупного якоря спроса.';
  }

  const businessFlow =
    /^деловой поток:/i.test(trimmed) ||
    /^стабильный поток командированных/i.test(trimmed) ||
    /^деловой трафик в зоне доступности/i.test(trimmed);

  if (businessFlow) {
    const industrial =
      /завод|фабрик|комбинат|промышленн|предприят|metal|steel|машиностро/i.test(lower);
    if (industrial) return 'Рядом производственные и деловые объекты в зоне доступности.';
    return 'Рядом деловые объекты в зоне доступности.';
  }

  if (/туристический поток:/i.test(trimmed)) {
    const ent =
      /театр|концерт|арена|стадион|цирк|развлеч|nightclub|клуб\b|event|фестивал/i.test(lower);
    if (ent) return 'Есть развлекательные или событийные объекты в зоне доступности.';
    return 'Есть туристические или досуговые объекты в зоне доступности.';
  }

  if (
    /^metro\b/i.test(trimmed) ||
    /^метро\b/i.test(trimmed) ||
    /метро\s+(?:доступно|есть|рядом)/i.test(trimmed)
  ) {
    return trimmed.replace(/^Metro\b/i, 'Метро');
  }

  let out = trimmed.replace(/\s+[—–:]\s*.+?\([^)]*\d[^)]*(?:м|км)[^)]*\)/gu, '');
  out = out.replace(/\s*\([^)]*\d[^)]*(?:м|км)[^)]*\)/gu, '');
  out = out.replace(/\s{2,}/g, ' ').trim();

  if (out.length < 12) return 'В зоне доступности есть сигналы спроса по карте.';
  return out;
}

function resolveNormalizeOpts(options?: number | NormalizeRuDemoOptions): NormalizeRuDemoOptions {
  return typeof options === 'number' ? { max: options } : options ?? {};
}

function prefixEvidenceLines(analysis: LocationAnalysis | undefined): string[] {
  if (!analysis) return [];
  const t = strategicHubDemoPublicLineRu(analysis);
  const m = specializedMedicalDemoPublicLineRu(analysis);
  return [t, m].filter((x): x is string => Boolean(x));
}

/** Deduped list for «Почему такой балл?» (max 5). */
export function normalizeRuDemoExplanationLines(
  lines: readonly string[],
  options?: number | NormalizeRuDemoOptions,
): string[] {
  const opts = resolveNormalizeOpts(options);
  const max = opts.max ?? 5;
  const analysis = opts.analysis;
  const diagnostics = opts.diagnostics;

  if (diagnostics) {
    diagnostics.bulletsKept = [];
    diagnostics.bulletsRemovedByEvidenceGate = [];
    diagnostics.bulletsCollapsedSemanticDup = [];
  }

  const flags = buildDemoPublicEvidenceFlags(analysis);
  const enriched = [...prefixEvidenceLines(analysis), ...lines];

  const bucketSeen = new Set<string>();
  const seenLine = new Set<string>();
  const out: string[] = [];

  for (const raw of enriched) {
    if (out.length >= max) break;

    const cleaned = sanitizeRuPublicFactor(raw);
    if (!cleaned) continue;

    const gen = generalizeRuPublicScoreExplanation(cleaned);
    if (gen == null || !gen.trim()) {
      diagnostics?.bulletsRemovedByEvidenceGate.push(raw);
      continue;
    }

    if (!gateRuDemoPublicPhrase(gen, flags)) {
      diagnostics?.bulletsRemovedByEvidenceGate.push(raw);
      continue;
    }

    const bucket = semanticBucketRu(gen);
    if (/^__(transport|medical|business|competition|environment)__$/.test(bucket)) {
      if (bucketSeen.has(bucket)) {
        diagnostics?.bulletsCollapsedSemanticDup.push(gen);
        continue;
      }
      bucketSeen.add(bucket);
    }

    if (seenLine.has(gen)) continue;
    seenLine.add(gen);
    out.push(gen);
    diagnostics?.bulletsKept.push(gen);
  }

  return out.slice(0, max);
}
