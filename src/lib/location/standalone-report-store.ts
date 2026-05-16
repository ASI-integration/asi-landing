import { supabase } from '@/lib/supabase';
import type { LocationStandaloneReport, PersistableLocationReport } from './standalone-report';

export type PersistedStandaloneReportEntity = {
  id: string;
  locale: 'ru' | 'en';
  address: string;
  report_version: string;
  report: PersistableLocationReport;
  created_at: string;
};

export async function createStandaloneReport(args: {
  locale: 'ru' | 'en';
  report: PersistableLocationReport;
}): Promise<{ reportId: string }> {
  const reportId = crypto.randomUUID();
  const report = prepareReportForPersistence(args.report, reportId);

  const { data, error } = await supabase
    .from('location_standalone_reports')
    .insert({
      id: reportId,
      locale: args.locale,
      address: report.address,
      report_version: report.version,
      report: report as any,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message || 'failed_to_create_report');
  }

  return { reportId: data.id as string };
}

function prepareReportForPersistence(
  input: PersistableLocationReport,
  reportId: string,
): PersistableLocationReport {
  const common = {
    reportId,
    status: (input as any).status ?? 'ready',
    pdfStatus: (input as any).pdfStatus ?? 'ready',
    pdfUrl: (input as any).pdfUrl ?? `/api/location-report/${encodeURIComponent(reportId)}/pdf`,
  };

  if (input.version === 'v1' && input.reportMode === 'free') {
    const freeInput: LocationStandaloneReport = { ...(input as LocationStandaloneReport) };
    delete (freeInput as any).unifiedReport;
    delete (freeInput as any).paidSections;
    delete (freeInput as any).strReport;
    const sections = freeInput.sections
      .filter(section => section.id === 'summary' || section.id === 'next_step')
      .map(section => {
        if (section.id !== 'summary') return section;
        return {
          ...section,
          income_rub_month: null,
          recommended_strategy: null,
        };
      });

    return {
      ...freeInput,
      ...common,
      reportMode: 'free',
      sections,
    } as LocationStandaloneReport;
  }

  return {
    ...(input as any),
    ...common,
  } as PersistableLocationReport;
}

export async function getStandaloneReportById(reportId: string): Promise<PersistedStandaloneReportEntity | null> {
  const { data, error } = await supabase
    .from('location_standalone_reports')
    .select('id, locale, address, report_version, report, created_at')
    .eq('id', reportId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return data as any;
}

