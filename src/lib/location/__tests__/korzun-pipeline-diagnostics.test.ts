import { describe, it, expect, vi, afterEach } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import {
  isLocationKorzunDiagnosticsEnabled,
  logKorzunPipelineDiagnostics,
  KORZUN_DIAGNOSTIC_LAT,
  KORZUN_DIAGNOSTIC_LON,
} from '../korzun-pipeline-diagnostics';

const metro: OSMElement = {
  type: 'node',
  id: 1,
  lat: KORZUN_DIAGNOSTIC_LAT + 0.004,
  lon: KORZUN_DIAGNOSTIC_LON + 0.004,
  tags: { name: 'Тестовая', station: 'subway', railway: 'station' },
};

describe('Korzun pipeline diagnostics env gate', () => {
  const prevFlag = process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED;

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED;
    else process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED = prevFlag;
    vi.restoreAllMocks();
  });

  it('isLocationKorzunDiagnosticsEnabled is false by default / unless exactly true', () => {
    delete process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED;
    expect(isLocationKorzunDiagnosticsEnabled()).toBe(false);

    process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED = '';
    expect(isLocationKorzunDiagnosticsEnabled()).toBe(false);

    process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED = 'false';
    expect(isLocationKorzunDiagnosticsEnabled()).toBe(false);

    process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED = '1';
    expect(isLocationKorzunDiagnosticsEnabled()).toBe(false);

    process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED = 'true';
    expect(isLocationKorzunDiagnosticsEnabled()).toBe(true);
  });

  it('logKorzunPipelineDiagnostics does not touch console when disabled', () => {
    delete process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED;
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analysis = buildAnalysis([metro], KORZUN_DIAGNOSTIC_LAT, KORZUN_DIAGNOSTIC_LON);
    logKorzunPipelineDiagnostics({
      lat: KORZUN_DIAGNOSTIC_LAT,
      lon: KORZUN_DIAGNOSTIC_LON,
      elementsCount: 100,
      elements: [metro],
      analysis,
      cached: false,
    });
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logKorzunPipelineDiagnostics logs when LOCATION_KORZUN_DIAGNOSTICS_ENABLED=true', () => {
    process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED = 'true';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analysis = buildAnalysis([metro], KORZUN_DIAGNOSTIC_LAT, KORZUN_DIAGNOSTIC_LON);
    logKorzunPipelineDiagnostics({
      lat: KORZUN_DIAGNOSTIC_LAT,
      lon: KORZUN_DIAGNOSTIC_LON,
      elementsCount: 100,
      elements: [metro],
      analysis,
      cached: false,
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toBe('[korzun-pipeline-diag]');
  });
});
