export type LocationSourceLayer =
  | 'base_geo_layer'
  | 'strategic_transport'
  | 'future_development'
  | 'commercial_premium_later';

export type LocationSourceAccessClass = 'official' | 'commercial' | 'community';
export type LocationSourceAdapterStatus = 'enabled' | 'planned' | 'license_required' | 'disabled';
export type LocationSourceFreshness = 'live_or_cached_daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'unknown';
export type LocationSourceConfidence = 'high' | 'medium' | 'low';

export interface LocationSourceAdapterContract {
  id: string;
  sourceName: string;
  sourceType: LocationSourceLayer;
  accessClass: LocationSourceAccessClass;
  status: LocationSourceAdapterStatus;
  allowedUsage: string;
  updateFrequency: string;
  freshness: LocationSourceFreshness;
  dataCoverage: string;
  confidence: LocationSourceConfidence;
  entityTypesProvided: readonly string[];
  geocodingRequirements: string;
  cachingPolicy: string;
  mapsToCanonicalEntities: true;
  uiMayReadRawSourceData: false;
}

export const SELECTIVE_LOCATION_SOURCE_PARSING_POLICY_RU = [
  'Не парсим всё подряд: источник подключается только если повышает ценность платного отчёта.',
  'В приоритете стабильные официальные или лицензионно безопасные источники.',
  'Каждый адаптер декларирует свежесть, покрытие и confidence.',
  'Каждый адаптер должен быть кэшируемым.',
  'Каждый адаптер мапится в канонические сущности, а не напрямую в UI.',
  'UI читает канонические данные отчёта, а не сырые данные источника.',
  'Yandex и 2GIS допускаются только через официальный API или лицензию; серый scraping запрещён.',
] as const;

export const LOCATION_SOURCE_ADAPTER_REGISTRY = [
  {
    id: 'osm-overpass-base-geo',
    sourceName: 'OSM / Overpass',
    sourceType: 'base_geo_layer',
    accessClass: 'community',
    status: 'enabled',
    allowedUsage: 'Geometry, POI context, transport objects, public map tags under OSM/Overpass usage limits.',
    updateFrequency: 'Community updates continuously; ASI cache refresh policy controls report freshness.',
    freshness: 'live_or_cached_daily',
    dataCoverage: 'Global coverage, uneven completeness by city and object class.',
    confidence: 'medium',
    entityTypesProvided: ['object_geometry', 'poi', 'transport_object', 'background_environment'],
    geocodingRequirements: 'Coordinates required before Overpass collection; do not use as address normalizer.',
    cachingPolicy: 'Cache query result by coordinates, radius/profile, and query version; retain diagnostics internally.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'gar-fias-address-normalization',
    sourceName: 'GAR / FIAS',
    sourceType: 'base_geo_layer',
    accessClass: 'official',
    status: 'planned',
    allowedUsage: 'Address normalization, administrative hierarchy, address identity checks.',
    updateFrequency: 'Official release cadence.',
    freshness: 'monthly',
    dataCoverage: 'Russia address registry coverage.',
    confidence: 'high',
    entityTypesProvided: ['normalized_address', 'admin_hierarchy', 'address_identity'],
    geocodingRequirements: 'Requires address text; may enrich coordinates from licensed/geocoder layer later.',
    cachingPolicy: 'Cache normalized address ids and hierarchy by source version.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'rosstat-emiss-market-context',
    sourceName: 'Rosstat / EMISS',
    sourceType: 'base_geo_layer',
    accessClass: 'official',
    status: 'planned',
    allowedUsage: 'Population, density, economy, demographics, and city-size context for weighting.',
    updateFrequency: 'Official statistical updates.',
    freshness: 'quarterly',
    dataCoverage: 'Russia federal and municipal statistical coverage where published.',
    confidence: 'high',
    entityTypesProvided: ['population', 'density', 'economy', 'demographics', 'city_scale'],
    geocodingRequirements: 'Requires normalized municipality/region identifiers.',
    cachingPolicy: 'Cache by indicator, territory id, and publication period.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'official-civil-aviation-registry',
    sourceName: 'Official civil aviation registry',
    sourceType: 'strategic_transport',
    accessClass: 'official',
    status: 'planned',
    allowedUsage: 'Airport and aerodrome identity, class, public availability, and strategic transport role.',
    updateFrequency: 'Official registry cadence.',
    freshness: 'monthly',
    dataCoverage: 'Civil airports/aerodromes where official public data exists.',
    confidence: 'high',
    entityTypesProvided: ['airport', 'aerodrome', 'business_aviation_terminal', 'dual_use_airport_public_only'],
    geocodingRequirements: 'Registry coordinates preferred; geocode missing locations only with source provenance.',
    cachingPolicy: 'Cache registry snapshot by publication date and adapter version.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'official-sea-river-port-registries',
    sourceName: 'Official sea / river port registries',
    sourceType: 'strategic_transport',
    accessClass: 'official',
    status: 'planned',
    allowedUsage: 'Seaport, river port, cargo terminal, and cruise terminal identity where public registries exist.',
    updateFrequency: 'Official registry cadence.',
    freshness: 'monthly',
    dataCoverage: 'Sea and inland waterway ports where public registries are available.',
    confidence: 'high',
    entityTypesProvided: ['seaport', 'river_port', 'cargo_port', 'cruise_terminal', 'port_industrial_cluster'],
    geocodingRequirements: 'Registry coordinates preferred; otherwise map to OSM geometry with explicit confidence.',
    cachingPolicy: 'Cache registry rows and geometry joins by source publication version.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'osm-transport-geometry',
    sourceName: 'OSM transport objects',
    sourceType: 'strategic_transport',
    accessClass: 'community',
    status: 'enabled',
    allowedUsage: 'Geometry and local coverage for rail, bus, ports, airports, interchanges, and local transport context.',
    updateFrequency: 'Community updates continuously; ASI cache refresh policy controls report freshness.',
    freshness: 'live_or_cached_daily',
    dataCoverage: 'Global but uneven local completeness.',
    confidence: 'medium',
    entityTypesProvided: ['railway_station', 'bus_station', 'transport_interchange', 'port_geometry', 'airport_geometry'],
    geocodingRequirements: 'Coordinates required; use taxonomy/category gates before promotion.',
    cachingPolicy: 'Cache with base Overpass result and diagnostics.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'official-rail-bus-hubs',
    sourceName: 'Official railway / bus hub sources',
    sourceType: 'strategic_transport',
    accessClass: 'official',
    status: 'planned',
    allowedUsage: 'Major railway stations, rail hubs, intercity bus terminals, and timetable-independent hub identity.',
    updateFrequency: 'Official or operator publication cadence.',
    freshness: 'monthly',
    dataCoverage: 'Available public official/operator datasets by region.',
    confidence: 'medium',
    entityTypesProvided: ['railway_hub', 'major_railway_station', 'bus_hub', 'intercity_bus_terminal'],
    geocodingRequirements: 'Match by official id/name and coordinates; unresolved matches stay manual-check only.',
    cachingPolicy: 'Cache by source, region, and publication date.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'eiszhs-domrf-developments',
    sourceName: 'ЕИСЖС / Дом.РФ',
    sourceType: 'future_development',
    accessClass: 'official',
    status: 'planned',
    allowedUsage: 'New residential developments, construction stages, delivery timing, and future competition/supply signals.',
    updateFrequency: 'Official/public portal cadence.',
    freshness: 'weekly',
    dataCoverage: 'Russia new residential development coverage where published.',
    confidence: 'high',
    entityTypesProvided: ['new_residential_development', 'construction_stage', 'delivery_timing', 'future_supply'],
    geocodingRequirements: 'Project geometry/coordinates preferred; address normalization via GAR/FIAS when needed.',
    cachingPolicy: 'Cache project cards by external id, update date, and geometry hash.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'eis-zakupki-development-signals',
    sourceName: 'ЕИС закупки',
    sourceType: 'future_development',
    accessClass: 'official',
    status: 'enabled',
    allowedUsage: 'Roads, schools, medicine, planning, engineering surveys, and early territory-development signals.',
    updateFrequency: 'Public procurement updates as published; adapter cache/probe controls collection.',
    freshness: 'weekly',
    dataCoverage: 'Russia procurement notices; geo precision varies by notice text.',
    confidence: 'medium',
    entityTypesProvided: ['road_project', 'social_infrastructure', 'medical_infrastructure', 'engineering_survey', 'planning_contract', 'territory_development_signal'],
    geocodingRequirements: 'Text-derived geography must declare precision and confidence; no direct UI rendering from raw notices.',
    cachingPolicy: 'Cache normalized notices/signals by notice id, publication date, and classifier version.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'regional-urban-planning-portals',
    sourceName: 'Regional urban-planning portals',
    sourceType: 'future_development',
    accessClass: 'official',
    status: 'planned',
    allowedUsage: 'Master plans, PZZ, planning projects, public hearings, integrated territory development, roads and utilities.',
    updateFrequency: 'Portal-specific cadence.',
    freshness: 'monthly',
    dataCoverage: 'Regional/city-specific coverage; adapter must be whitelisted per portal.',
    confidence: 'medium',
    entityTypesProvided: ['master_plan', 'zoning_rules', 'planning_project', 'public_hearing', 'integrated_development', 'infrastructure_plan'],
    geocodingRequirements: 'Requires portal-specific geometry/address mapping and explicit confidence.',
    cachingPolicy: 'Cache by portal, document id, publication date, and parsed schema version.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
  {
    id: 'yandex-2gis-premium-official-api',
    sourceName: 'Yandex / 2GIS official API or licensed data',
    sourceType: 'commercial_premium_later',
    accessClass: 'commercial',
    status: 'license_required',
    allowedUsage: 'Premium POI, reviews, organization freshness, and richer commercial layer only under official API/licensing. Grey scraping is prohibited.',
    updateFrequency: 'Vendor/API contract cadence.',
    freshness: 'live_or_cached_daily',
    dataCoverage: 'Vendor coverage by license and API terms.',
    confidence: 'high',
    entityTypesProvided: ['premium_poi', 'organization', 'commercial_activity', 'licensed_competitor_context'],
    geocodingRequirements: 'Use vendor geocoding only within license terms and map to canonical entities before report/UI.',
    cachingPolicy: 'Cache only as permitted by license/API terms; keep attribution and expiry metadata.',
    mapsToCanonicalEntities: true,
    uiMayReadRawSourceData: false,
  },
] as const satisfies readonly LocationSourceAdapterContract[];

export function listLocationSourceAdaptersByLayer(layer: LocationSourceLayer): readonly LocationSourceAdapterContract[] {
  return LOCATION_SOURCE_ADAPTER_REGISTRY.filter(source => source.sourceType === layer);
}

export function sourceRegistryHasOnlyCanonicalUiAdapters(): boolean {
  return LOCATION_SOURCE_ADAPTER_REGISTRY.every(source =>
    source.mapsToCanonicalEntities === true && source.uiMayReadRawSourceData === false,
  );
}
