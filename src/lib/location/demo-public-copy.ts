/**
 * RU demo / free-tier wording only — does not affect scoring or pipeline inputs.
 */

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

/**
 * Demo copy sanitizer — preserves structured evidence (object + distance).
 * Does not collapse named lines into generic «туристический поток» / «крупный узел» phrasing.
 */
export function generalizeRuPublicScoreExplanation(line: string): string {
  const trimmed = (line ?? '').trim();
  if (!trimmed) return trimmed;

  if (/—\s*около\s+\d/.test(trimmed)) {
    return sanitizeRuPublicFactor(trimmed) ?? trimmed;
  }

  const hasDistanceToken = /\d[\d\s,.]*\s*(?:м|км)\b/i.test(trimmed);
  if (hasDistanceToken && trimmed.length >= 24) {
    return sanitizeRuPublicFactor(trimmed) ?? trimmed;
  }

  if (
    /^metro\b/i.test(trimmed) ||
    /^метро\b/i.test(trimmed) ||
    /метро\s+(?:доступно|есть|рядом)/i.test(trimmed)
  ) {
    const cleaned = sanitizeRuPublicFactor(trimmed) ?? trimmed;
    return cleaned.replace(/^Metro\b/i, 'Метро');
  }

  const out = trimmed.replace(/\s{2,}/g, ' ').trim();
  if (out.length < 12) {
    return 'В зоне доступности есть сигналы спроса по карте (общая формулировка, низкая детализация).';
  }
  return sanitizeRuPublicFactor(out) ?? out;
}

/** Deduped list for «Почему такой балл?» (max 5). */
export function normalizeRuDemoExplanationLines(lines: readonly string[], max = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = sanitizeRuPublicFactor(line);
    if (!cleaned) continue;
    const gen = generalizeRuPublicScoreExplanation(cleaned);
    if (!gen || seen.has(gen)) continue;
    seen.add(gen);
    out.push(gen);
    if (out.length >= max) break;
  }
  return out;
}
