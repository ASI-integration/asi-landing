-- Server-owned bridge from legacy Telegram communication property ids to the
-- canonical tenant/property model. This migration intentionally creates no
-- bindings: legacy rows fail closed until an operator backfills an exact map.

CREATE TABLE public.legacy_tg_property_bindings (
  legacy_property_id TEXT PRIMARY KEY
    REFERENCES public.tg_property_knowledge(property_id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  canonical_property_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT legacy_tg_property_bindings_property_id_check
    CHECK (char_length(btrim(legacy_property_id)) BETWEEN 1 AND 200),
  CONSTRAINT legacy_tg_property_bindings_account_property_fk
    FOREIGN KEY (account_id, canonical_property_id)
    REFERENCES public.properties(account_id, id) ON DELETE CASCADE
);

CREATE INDEX legacy_tg_property_bindings_account_property_idx
  ON public.legacy_tg_property_bindings(account_id, canonical_property_id);

ALTER TABLE public.legacy_tg_property_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_tg_property_bindings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.legacy_tg_property_bindings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.legacy_tg_property_bindings TO service_role;

COMMENT ON TABLE public.legacy_tg_property_bindings IS
  'Service-role-only mapping from legacy tg property ids to canonical tenant-owned properties.';
