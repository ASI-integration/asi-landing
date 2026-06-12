-- Property setup profiles: owner-facing draft подготовки объекта.
--
-- Scope:
--   - Хранит черновик подготовки объекта (owner-facing), который НЕ помещается
--     в properties / property_master_cards: тип объекта, категории/юниты,
--     время заезда/выезда, структурированные правила, базовые цены,
--     выбор каналов для подключения и дополнительные инструкции.
--   - Один профиль на объект (UNIQUE property_id), данные в JSONB.
--   - Без OTA/active mode: список каналов — только подготовительный.
--   - Service-role only через backend API (account-scoped через properties.account_id).

CREATE TABLE IF NOT EXISTS property_setup_profiles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Полный owner-facing черновик подготовки объекта.
  data         JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT property_setup_profiles_property_unique UNIQUE (property_id)
);

CREATE INDEX IF NOT EXISTS idx_property_setup_profiles_property_id
  ON property_setup_profiles(property_id);

ALTER TABLE property_setup_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON property_setup_profiles;

CREATE POLICY "service_role_full_access"
  ON property_setup_profiles FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
