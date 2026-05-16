import { supabase } from '@/lib/supabase';
import type { PersistableLocationReport } from './standalone-report';

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
  const report = {
    ...(args.report as any),
    reportId,
    status: (args.report as any).status ?? 'ready',
    pdfStatus: (args.report as any).pdfStatus ?? 'ready',
    pdfUrl: (args.report as any).pdfUrl ?? `/api/location-report/${encodeURIComponent(reportId)}/pdf`,
  } as PersistableLocationReport;

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

