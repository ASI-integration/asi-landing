-- ── Location analysis persistent cache ───────────────────────────────────────
-- Replaces the in-memory Map in src/lib/location/cache.ts.
-- Run once in Supabase SQL editor or via supabase db push.

CREATE TABLE IF NOT EXISTS location_analysis_cache (
  -- Primary key: rounded coordinates "lat4,lon4" (≈11 m precision)
  coord_key       TEXT PRIMARY KEY,

  -- Resolved coordinates (stored separately for geocode lookups)
  lat             DOUBLE PRECISION NOT NULL,
  lon             DOUBLE PRECISION NOT NULL,

  -- Optional: normalized address string for address-based lookup
  address_key     TEXT,

  -- Full analysis payload from the gravity engine
  analysis        JSONB NOT NULL,

  -- Provider metadata
  elements_count  INTEGER NOT NULL DEFAULT 0,
  source          TEXT    NOT NULL DEFAULT 'osm-overpass',

  -- Freshness tracking
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast address lookup (sparse — not all rows have an address)
CREATE INDEX IF NOT EXISTS idx_loc_cache_address_key
  ON location_analysis_cache (address_key)
  WHERE address_key IS NOT NULL;

-- Stale-entry cleanup: rows older than 24 h are no longer served
CREATE INDEX IF NOT EXISTS idx_loc_cache_updated_at
  ON location_analysis_cache (updated_at);
