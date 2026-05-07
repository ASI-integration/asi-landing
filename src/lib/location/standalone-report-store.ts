import { supabase } from '@/lib/supabase';
import type { LocationCommercialReport, LocationStandaloneReport } from './standalone-report';

type PersistedLocationReport = LocationStandaloneReport | LocationCommercialReport;

export type PersistedStandaloneReportEntity = {
  id: string;
  locale: 'ru' | 'en';
  address: string;
  report_version: string;
  report: PersistedLocationReport;
  created_at: string;
};

export async function createStandaloneReport(args: {
  locale: 'ru' | 'en';
  report: PersistedLocationReport;
}): Promise<{ reportId: string }> {
  const { data, error } = await supabase
    .from('location_standalone_reports')
    .insert({
      locale: args.locale,
      address: args.report.address,
      report_version: args.report.version,
      report: args.report as any,
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

