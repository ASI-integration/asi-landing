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

/** Removes POI names and jargon from one RU explanation line (demo output). */
export function generalizeRuPublicScoreExplanation(line: string): string {
  const trimmed = (line ?? '').trim();
  if (!trimmed) return trimmed;

  const lower = trimmed.toLowerCase();

  if (/крупный транспортный узел в транспортной доступности/i.test(trimmed)) {
    return 'Есть крупные транспортные узлы в зоне доступности.';
  }
  if (/крупн(?:ый|ая|ое)\s+транспортно-логистическ/i.test(trimmed)) {
    return 'Есть крупные транспортные узлы в зоне доступности.';
  }
  if (/крупная медицина в зоне доступности/i.test(trimmed)) {
    return 'Есть медицинские или социальные объекты в зоне доступности.';
  }

  if (/ключевой транспортный якорь/i.test(trimmed)) {
    return 'Крупный транспортный узел рядом — транспортная доступность усиливает спрос.';
  }

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

  if (out.length < 12) {
    return 'В зоне доступности есть сигналы спроса по карте (общая формулировка, низкая детализация).';
  }
  return out;
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
