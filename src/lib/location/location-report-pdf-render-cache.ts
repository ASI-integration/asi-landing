import type { PersistedStandaloneReportEntity } from './standalone-report-store';

const PDF_RENDER_ENTITY_CACHE = new Map<string, PersistedStandaloneReportEntity>();

export function primeLocationReportPdfRenderEntity(entity: PersistedStandaloneReportEntity): void {
  PDF_RENDER_ENTITY_CACHE.set(entity.id, entity);
}

export function takeLocationReportPdfRenderEntity(reportId: string): PersistedStandaloneReportEntity | null {
  const entity = PDF_RENDER_ENTITY_CACHE.get(reportId) ?? null;
  if (entity) {
    PDF_RENDER_ENTITY_CACHE.delete(reportId);
  }
  return entity;
}

export function clearLocationReportPdfRenderEntity(reportId: string): void {
  PDF_RENDER_ENTITY_CACHE.delete(reportId);
}
