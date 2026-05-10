import type { PublicProcurementNoticeInput } from './classify-notice';

export interface PublicProcurementFixtureFile {
  readonly notices: PublicProcurementNoticeInput[];
}

export function parsePublicProcurementFixtureFile(raw: unknown): PublicProcurementFixtureFile {
  if (!raw || typeof raw !== 'object') throw new Error('Public procurement fixture: expected object root.');
  const obj = raw as Record<string, unknown>;
  const noticesRaw = obj.notices;
  if (!Array.isArray(noticesRaw)) throw new Error('Public procurement fixture: missing notices array.');

  const notices: PublicProcurementNoticeInput[] = noticesRaw.map((row, i) => {
    if (!row || typeof row !== 'object') throw new Error(`Public procurement fixture: notice ${i} is not an object.`);
    const n = row as Record<string, unknown>;
    const id = n.id;
    const title = n.title;
    if (typeof id !== 'string' || !id.trim()) throw new Error(`Public procurement fixture: notice ${i} needs string id.`);
    if (typeof title !== 'string' || !title.trim()) throw new Error(`Public procurement fixture: notice ${i} needs string title.`);

    const optString = (k: string): string | undefined => {
      const v = n[k];
      if (v === undefined || v === null) return undefined;
      if (typeof v !== 'string') throw new Error(`Public procurement fixture: notice ${i} field ${k} must be string.`);
      const t = v.trim();
      return t || undefined;
    };

    return {
      id: id.trim(),
      title: title.trim(),
      customer: optString('customer'),
      regionHint: optString('regionHint'),
      subjectDetail: optString('subjectDetail'),
      procedureStage: optString('procedureStage'),
      publishedAt: optString('publishedAt'),
      url: optString('url'),
    };
  });

  return { notices };
}
