export type ReportSignalLayer = 'fast' | 'full' | 'deep';
export type ReportSignalResultStatus = 'success' | 'skipped' | 'failed';

export type ReportSignal = {
  id: string;
  label?: string;
  value?: unknown;
  source?: string;
  confidence?: 'low' | 'medium' | 'high';
  meta?: Record<string, unknown>;
};

export type ReportSignalCollectRequest = {
  requestId: string;
  stage: 'preliminary' | 'final';
};

export type ReportSignalResult = {
  status: ReportSignalResultStatus;
  signals: ReportSignal[];
  warnings: string[];
  source_meta: Record<string, unknown>;
};

export type ReportSignalAdapter = {
  id: string;
  label: string;
  layer: ReportSignalLayer;
  enabled: boolean;
  collect(request: ReportSignalCollectRequest): Promise<ReportSignalResult>;
};

export type ReportSignalAdapterRegistry = readonly ReportSignalAdapter[];

export type ReportSignalAdapterSummary = {
  id: string;
  label: string;
  layer: ReportSignalLayer;
  status: ReportSignalResultStatus;
  signals: ReportSignal[];
  signal_count: number;
  warning_count: number;
  warnings: string[];
  source_meta: Record<string, unknown>;
};

export type ReportSignalCollectionSummary = {
  requested_layers: ReportSignalLayer[];
  adapters: ReportSignalAdapterSummary[];
};

function placeholderAdapter(args: {
  id: string;
  label: string;
  layer: ReportSignalLayer;
  enabled: boolean;
}): ReportSignalAdapter {
  return {
    ...args,
    async collect(request) {
      return {
        status: 'success',
        signals: [],
        warnings: [],
        source_meta: {
          adapter_id: args.id,
          layer: args.layer,
          placeholder: true,
          request_id: request.requestId,
          stage: request.stage,
        },
      };
    },
  };
}

export const REPORT_SIGNAL_ADAPTER_REGISTRY = [
  placeholderAdapter({
    id: 'base_location',
    label: 'Base location',
    layer: 'fast',
    enabled: true,
  }),
  placeholderAdapter({
    id: 'prime_magnets',
    label: 'Prime magnets',
    layer: 'fast',
    enabled: true,
  }),
  placeholderAdapter({
    id: 'transport',
    label: 'Transport',
    layer: 'fast',
    enabled: true,
  }),
  placeholderAdapter({
    id: 'competitors',
    label: 'Competitors',
    layer: 'full',
    enabled: false,
  }),
  placeholderAdapter({
    id: 'commercial_potential',
    label: 'Commercial potential',
    layer: 'full',
    enabled: false,
  }),
  placeholderAdapter({
    id: 'urban_development',
    label: 'Urban development',
    layer: 'full',
    enabled: false,
  }),
  placeholderAdapter({
    id: 'procurement_signals',
    label: 'Procurement signals',
    layer: 'deep',
    enabled: false,
  }),
  placeholderAdapter({
    id: 'h3_foot_traffic',
    label: 'H3 foot traffic',
    layer: 'deep',
    enabled: false,
  }),
] as const satisfies ReportSignalAdapterRegistry;

export function getEnabledReportSignalAdaptersByLayer(
  layer: ReportSignalLayer,
  registry: ReportSignalAdapterRegistry = REPORT_SIGNAL_ADAPTER_REGISTRY,
): ReportSignalAdapter[] {
  return registry.filter(adapter => adapter.enabled && adapter.layer === layer);
}

export function getEnabledReportSignalAdaptersForLayers(
  layers: readonly ReportSignalLayer[],
  registry: ReportSignalAdapterRegistry = REPORT_SIGNAL_ADAPTER_REGISTRY,
): ReportSignalAdapter[] {
  const layerSet = new Set(layers);
  return registry.filter(adapter => adapter.enabled && layerSet.has(adapter.layer));
}

function summarizeAdapterResult(
  adapter: ReportSignalAdapter,
  result: ReportSignalResult,
): ReportSignalAdapterSummary {
  return {
    id: adapter.id,
    label: adapter.label,
    layer: adapter.layer,
    status: result.status,
    signals: result.signals,
    signal_count: result.signals.length,
    warning_count: result.warnings.length,
    warnings: result.warnings,
    source_meta: result.source_meta,
  };
}

export async function collectReportSignalsForLayers(args: {
  request: ReportSignalCollectRequest;
  layers: readonly ReportSignalLayer[];
  registry?: ReportSignalAdapterRegistry;
}): Promise<ReportSignalCollectionSummary> {
  const adapters = getEnabledReportSignalAdaptersForLayers(args.layers, args.registry);
  const summaries: ReportSignalAdapterSummary[] = [];

  for (const adapter of adapters) {
    try {
      const result = await adapter.collect(args.request);
      summaries.push(summarizeAdapterResult(adapter, result));
    } catch (err) {
      summaries.push({
        id: adapter.id,
        label: adapter.label,
        layer: adapter.layer,
        status: 'failed',
        signals: [],
        signal_count: 0,
        warning_count: 1,
        warnings: [err instanceof Error ? err.message : String(err)],
        source_meta: {},
      });
    }
  }

  return {
    requested_layers: [...args.layers],
    adapters: summaries,
  };
}
