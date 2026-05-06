export const LOCATION_REPORT_OBJECT_TYPES = [
  'apartment',
  'apart_hotel',
  'house',
  'commercial_space',
  'land_other',
] as const;

export const LOCATION_REPORT_OBJECT_STATUSES = [
  'owned',
  'considering_purchase',
  'considering_rent_sublease',
  'checking_address',
] as const;

export const LOCATION_REPORT_INTENDED_STRATEGIES = [
  'short_term',
  'mid_term',
  'long_term',
  'hybrid',
  'commercial_use',
  'unknown',
] as const;

export const LOCATION_REPORT_RENOVATION_LEVELS = [
  'none',
  'standard',
  'good',
  'designer',
] as const;

export const LOCATION_REPORT_PARKING_VALUES = ['yes', 'no', 'unknown'] as const;

export const LOCATION_REPORT_MODULES = [
  'income_range',
  'strategy_comparison',
  'competitors',
  'district_risks',
  'target_audience',
  'transport_magnets',
  'object_improvements',
  'packaging_recommendations',
  'decision',
  'manual_check_questions',
] as const;

export type LocationReportObjectType = typeof LOCATION_REPORT_OBJECT_TYPES[number];
export type LocationReportObjectStatus = typeof LOCATION_REPORT_OBJECT_STATUSES[number];
export type LocationReportIntendedStrategy = typeof LOCATION_REPORT_INTENDED_STRATEGIES[number];
export type LocationReportRenovationLevel = typeof LOCATION_REPORT_RENOVATION_LEVELS[number];
export type LocationReportParking = typeof LOCATION_REPORT_PARKING_VALUES[number];
export type LocationReportModule = typeof LOCATION_REPORT_MODULES[number];

export type LocationReportObjectParams = {
  rooms?: number | null;
  area_m2?: number | null;
  renovation_level?: LocationReportRenovationLevel | null;
  floor?: number | null;
  building_year?: number | null;
  building_type?: string | null;
  parking?: LocationReportParking;
  purchase_price_rub?: number | null;
  monthly_rent_rub?: number | null;
};

export type LocationReportIntake = {
  object_type: LocationReportObjectType;
  object_status: LocationReportObjectStatus;
  intended_strategy: LocationReportIntendedStrategy;
  object_params: LocationReportObjectParams;
  requested_modules: LocationReportModule[];
  income_accuracy_acknowledged: true;
};

export const LOCATION_REPORT_INCOME_DISCLAIMER_RU =
  'Базовая оценка строится по локации, магнитам, конкуренции и доступным сигналам. Точная доходность зависит от объекта: ремонта, площади, дома, фото, отзывов, сезона и цены. Поэтому в полном отчёте мы показываем вилку и уровень уверенности, а не гарантированную сумму.';

const objectTypeSet = new Set<string>(LOCATION_REPORT_OBJECT_TYPES);
const objectStatusSet = new Set<string>(LOCATION_REPORT_OBJECT_STATUSES);
const intendedStrategySet = new Set<string>(LOCATION_REPORT_INTENDED_STRATEGIES);
const renovationLevelSet = new Set<string>(LOCATION_REPORT_RENOVATION_LEVELS);
const parkingSet = new Set<string>(LOCATION_REPORT_PARKING_VALUES);
const moduleSet = new Set<string>(LOCATION_REPORT_MODULES);

function optionalNumber(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function optionalString(value: unknown, max = 80): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) return null;
  return trimmed;
}

export function validateLocationReportIntake(value: unknown): {
  ok: true;
  intake: LocationReportIntake;
} | {
  ok: false;
  error: string;
} {
  if (!value || typeof value !== 'object') return { ok: false, error: 'report_intake_required' };
  const input = value as Record<string, unknown>;

  const objectType = input.object_type;
  if (typeof objectType !== 'string' || !objectTypeSet.has(objectType)) {
    return { ok: false, error: 'invalid_object_type' };
  }

  const objectStatus = input.object_status;
  if (typeof objectStatus !== 'string' || !objectStatusSet.has(objectStatus)) {
    return { ok: false, error: 'invalid_object_status' };
  }

  const intendedStrategy = input.intended_strategy;
  if (typeof intendedStrategy !== 'string' || !intendedStrategySet.has(intendedStrategy)) {
    return { ok: false, error: 'invalid_intended_strategy' };
  }

  if (input.income_accuracy_acknowledged !== true) {
    return { ok: false, error: 'income_accuracy_ack_required' };
  }

  const requestedModulesRaw = Array.isArray(input.requested_modules)
    ? input.requested_modules
    : [];
  const requestedModules = Array.from(new Set(
    requestedModulesRaw.filter((m): m is LocationReportModule =>
      typeof m === 'string' && moduleSet.has(m),
    ),
  ));
  if (requestedModules.length === 0) return { ok: false, error: 'requested_modules_required' };

  const paramsRaw =
    input.object_params && typeof input.object_params === 'object'
      ? input.object_params as Record<string, unknown>
      : {};
  const rooms = optionalNumber(paramsRaw.rooms, 0, 30);
  const area = optionalNumber(paramsRaw.area_m2, 1, 5000);
  const floor = optionalNumber(paramsRaw.floor, -5, 200);
  const buildingYear = optionalNumber(paramsRaw.building_year, 1700, 2100);
  const purchasePrice = optionalNumber(paramsRaw.purchase_price_rub, 0, 10_000_000_000);
  const monthlyRent = optionalNumber(paramsRaw.monthly_rent_rub, 0, 100_000_000);
  const buildingType = optionalString(paramsRaw.building_type);
  if (
    rooms === null ||
    area === null ||
    floor === null ||
    buildingYear === null ||
    purchasePrice === null ||
    monthlyRent === null ||
    buildingType === null
  ) return { ok: false, error: 'invalid_object_params' };

  const renovation = paramsRaw.renovation_level;
  const parking = paramsRaw.parking;
  if (renovation !== undefined && renovation !== null && renovation !== '' && (typeof renovation !== 'string' || !renovationLevelSet.has(renovation))) {
    return { ok: false, error: 'invalid_renovation_level' };
  }
  if (parking !== undefined && parking !== null && parking !== '' && (typeof parking !== 'string' || !parkingSet.has(parking))) {
    return { ok: false, error: 'invalid_parking' };
  }

  return {
    ok: true,
    intake: {
      object_type: objectType as LocationReportObjectType,
      object_status: objectStatus as LocationReportObjectStatus,
      intended_strategy: intendedStrategy as LocationReportIntendedStrategy,
      object_params: {
        ...(rooms !== undefined ? { rooms } : {}),
        ...(area !== undefined ? { area_m2: area } : {}),
        ...(renovation ? { renovation_level: renovation as LocationReportRenovationLevel } : {}),
        ...(floor !== undefined ? { floor } : {}),
        ...(buildingYear !== undefined ? { building_year: buildingYear } : {}),
        ...(buildingType !== undefined ? { building_type: buildingType } : {}),
        ...(parking ? { parking: parking as LocationReportParking } : { parking: 'unknown' }),
        ...(purchasePrice !== undefined ? { purchase_price_rub: purchasePrice } : {}),
        ...(monthlyRent !== undefined ? { monthly_rent_rub: monthlyRent } : {}),
      },
      requested_modules: requestedModules,
      income_accuracy_acknowledged: true,
    },
  };
}

export function hasObjectParamsForIncome(intake?: LocationReportIntake | null): boolean {
  const params = intake?.object_params;
  if (!params) return false;
  return Boolean(
    params.area_m2 ||
    params.rooms ||
    params.renovation_level ||
    params.purchase_price_rub ||
    params.monthly_rent_rub,
  );
}

export function reportModuleSelected(
  intake: LocationReportIntake | null | undefined,
  module: LocationReportModule,
): boolean {
  return !intake || intake.requested_modules.includes(module);
}
