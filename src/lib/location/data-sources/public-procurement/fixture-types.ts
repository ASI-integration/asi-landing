import type { PublicProcurementNoticeInput } from './classify-notice';

export interface PublicProcurementFixtureFile {
  readonly notices: PublicProcurementNoticeInput[];
}

/** One fixture row: validated fields plus isolated raw JSON object for audit pipelines. */
export interface PublicProcurementFixtureParsedNotice {
  readonly validated: PublicProcurementNoticeInput;
  readonly rawPayload: unknown;
}

export interface PublicProcurementFixtureParseResult {
  readonly notices: readonly PublicProcurementFixtureParsedNotice[];
}

function optString(n: Record<string, unknown>, i: number, k: string): string | undefined {
  const v = n[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`Public procurement fixture: notice ${i} field ${k} must be string.`);
  const t = v.trim();
  return t || undefined;
}

export function parsePublicProcurementNoticeRecord(row: unknown, index: number): PublicProcurementFixtureParsedNotice {
  if (!row || typeof row !== 'object') throw new Error(`Public procurement fixture: notice ${index} is not an object.`);
  const n = row as Record<string, unknown>;
  const id = n.id;
  const title = n.title;
  if (typeof id !== 'string' || !id.trim()) throw new Error(`Public procurement fixture: notice ${index} needs string id.`);
  if (typeof title !== 'string' || !title.trim()) throw new Error(`Public procurement fixture: notice ${index} needs string title.`);

  const validated: PublicProcurementNoticeInput = {
    id: id.trim(),
    title: title.trim(),
    customer: optString(n, index, 'customer'),
    regionHint: optString(n, index, 'regionHint'),
    subjectDetail: optString(n, index, 'subjectDetail'),
    procedureStage: optString(n, index, 'procedureStage'),
    publishedAt: optString(n, index, 'publishedAt'),
    updatedAt: optString(n, index, 'updatedAt'),
    url: optString(n, index, 'url'),
  };

  return {
    validated,
    rawPayload: n,
  };
}

export function parsePublicProcurementFixtureWithAudit(raw: unknown): PublicProcurementFixtureParseResult {
  if (!raw || typeof raw !== 'object') throw new Error('Public procurement fixture: expected object root.');
  const obj = raw as Record<string, unknown>;
  const noticesRaw = obj.notices;
  if (!Array.isArray(noticesRaw)) throw new Error('Public procurement fixture: missing notices array.');

  const notices = noticesRaw.map((row, i) => parsePublicProcurementNoticeRecord(row, i));

  return { notices };
}

export function parsePublicProcurementFixtureFile(raw: unknown): PublicProcurementFixtureFile {
  const full = parsePublicProcurementFixtureWithAudit(raw);
  return { notices: full.notices.map(n => n.validated) };
}
