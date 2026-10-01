/** Spatial facts and validation, not a second scoring or property database. */
export type SpatialMode = 'residential' | 'commercial';
export type SpatialPurpose = 'map_preview' | 'site_assessment';
export type SpatialScope =
  | { kind: 'public'; locationId: string }
  | { kind: 'account'; accountId: string; locationId: string };
export type Coordinates = { lat: number; lon: number };
export type SpatialSource = {
  provider: string;
  observedAt: string;
  reference?: string;
  origin: 'external' | 'manual' | 'synthetic';
  delivery: 'live' | 'cached' | 'manual' | 'unavailable';
};
export type SpatialLocation = {
  scope: SpatialScope;
  mode: SpatialMode;
  objectKind: 'property' | 'commercial_location' | 'public_point';
  address: string;
  normalizedAddress?: string;
  city?: string;
  region?: string;
  country?: string;
  district?: string;
  neighborhood?: string;
  coordinates: Coordinates | null;
  /** Canonical geocode/verified manual point, if independently available. */
  addressCoordinates?: Coordinates;
  source: SpatialSource;
};
export type SpatialEntityKind = 'poi' | 'competitor' | 'transit' | 'attraction' | 'demand_anchor';
export type SpatialEntity = {
  id: string;
  kind: SpatialEntityKind;
  category: string;
  name: string;
  coordinates: Coordinates;
  source: SpatialSource;
};
export type SpatialEvidence = {
  scope: SpatialScope;
  mode: SpatialMode;
  center: Coordinates;
  radiusMeters: number;
  status: 'available' | 'partial' | 'unavailable';
  source: SpatialSource;
  /** Survey coverage: an empty successful competitor survey is not provider failure. */
  coverage: SpatialEntityKind[];
  entities: SpatialEntity[];
};
export type SpatialRequest = {
  scope: SpatialScope;
  mode: SpatialMode;
  purpose: SpatialPurpose;
  radiusMeters: number;
};
export type SpatialCheck = { code: string; status: 'pass' | 'blocked' | 'manual'; detail?: string };
export type SpatialValidation = {
  version: 'spatial-validation-v1';
  ok: boolean;
  automated: boolean;
  requiresOperatorReview: boolean;
  scope: SpatialScope;
  mode: SpatialMode;
  purpose: SpatialPurpose;
  radiusMeters: number;
  location: SpatialLocation | null;
  checks: SpatialCheck[];
  evidence: SpatialEvidence[];
  nearby: Array<SpatialEntity & { distanceMeters: number }>;
  counts: Partial<Record<SpatialEntityKind, number>>;
  blockers: string[];
  warnings: string[];
  manualControls: string[];
  provenance: SpatialSource[];
};
