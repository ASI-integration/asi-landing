-- OPS v1 foundation: объекты, мастер-карточка, медиа, бронирования, задачи, инциденты.
--
-- Scope:
--   - Внутренняя операционная база без OTA/channel-manager интеграций.
--   - Расширяет существующую таблицу properties (multitenant, account_id).
--   - ops_property_tasks — отдельно от automation ops_tasks (stay-flow).
--   - Service-role only через backend API.

-- ─── properties: расширение ─────────────────────────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Расширяем допустимые статусы: paused, archived (inactive остаётся для совместимости)
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE properties
  ADD CONSTRAINT properties_status_check
    CHECK (status IN ('draft', 'active', 'paused', 'archived', 'inactive'));

-- ─── property_master_cards ──────────────────────────────────────────────────
-- Мастер-карточка объекта — единый источник правды (SSOT), без публикации в OTA.

CREATE TABLE IF NOT EXISTS property_master_cards (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id             UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  public_title            TEXT,
  short_description       TEXT,
  full_description        TEXT,
  amenities               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  house_rules             TEXT,
  check_in_instructions   TEXT,
  check_out_instructions  TEXT,
  wifi_name               TEXT,
  wifi_password           TEXT,
  parking_info            TEXT,
  deposit_info            TEXT,
  extra_fees_info         TEXT,
  cancellation_info       TEXT,
  guest_contacts_info     TEXT,
  internal_notes          TEXT,

  content_version         INTEGER     NOT NULL DEFAULT 1,
  -- draft: черновик | ready: готова | needs_review: нужна проверка | published: опубликована (внутренне)
  publication_status      TEXT        NOT NULL DEFAULT 'draft',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT property_master_cards_property_unique UNIQUE (property_id),

  CONSTRAINT property_master_cards_publication_status_check
    CHECK (publication_status IN ('draft', 'ready', 'needs_review', 'published'))
);

CREATE INDEX IF NOT EXISTS idx_property_master_cards_property_id
  ON property_master_cards(property_id);

-- ─── property_media ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS property_media (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  url           TEXT,
  storage_path  TEXT,
  title         TEXT,
  description   TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  is_cover      BOOLEAN     NOT NULL DEFAULT false,
  -- active: видно | hidden: скрыто | deleted: мягкое удаление
  status        TEXT        NOT NULL DEFAULT 'active',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT property_media_status_check
    CHECK (status IN ('active', 'hidden', 'deleted')),

  CONSTRAINT property_media_url_or_path_check
    CHECK (url IS NOT NULL OR storage_path IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_property_media_property_id
  ON property_media(property_id);

CREATE INDEX IF NOT EXISTS idx_property_media_sort_order
  ON property_media(property_id, sort_order);

-- ─── ops_reservations ───────────────────────────────────────────────────────
-- Бронирования v0 — внутренний реестр, не заменяет tg_guest_reservations.

CREATE TABLE IF NOT EXISTS ops_reservations (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id              UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  guest_name               TEXT        NOT NULL,
  guest_phone              TEXT,
  guest_email              TEXT,

  -- direct: прямое | ostrovok/yandex_travel/avito/sutochno/cian: OTA-каналы | other: прочее
  source_channel           TEXT        NOT NULL DEFAULT 'direct',
  external_reservation_id  TEXT,

  check_in_date            DATE        NOT NULL,
  check_out_date           DATE        NOT NULL,

  -- new: новая | confirmed: подтверждена | checked_in: заехал | checked_out: выехал | cancelled | no_show
  status                   TEXT        NOT NULL DEFAULT 'new',
  -- unknown | unpaid | partial | paid | refunded
  payment_status           TEXT        NOT NULL DEFAULT 'unknown',
  -- not_required | pending | received | returned | withheld
  deposit_status           TEXT        NOT NULL DEFAULT 'not_required',

  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ops_reservations_source_channel_check
    CHECK (source_channel IN (
      'direct', 'ostrovok', 'yandex_travel', 'avito', 'sutochno', 'cian', 'other'
    )),

  CONSTRAINT ops_reservations_status_check
    CHECK (status IN ('new', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),

  CONSTRAINT ops_reservations_payment_status_check
    CHECK (payment_status IN ('unknown', 'unpaid', 'partial', 'paid', 'refunded')),

  CONSTRAINT ops_reservations_deposit_status_check
    CHECK (deposit_status IN ('not_required', 'pending', 'received', 'returned', 'withheld')),

  CONSTRAINT ops_reservations_dates_check
    CHECK (check_out_date > check_in_date)
);

CREATE INDEX IF NOT EXISTS idx_ops_reservations_property_id
  ON ops_reservations(property_id);

CREATE INDEX IF NOT EXISTS idx_ops_reservations_check_in
  ON ops_reservations(property_id, check_in_date);

CREATE INDEX IF NOT EXISTS idx_ops_reservations_status
  ON ops_reservations(status);

-- ─── ops_property_tasks ─────────────────────────────────────────────────────
-- Операционные задачи OPS v1 (не путать с automation ops_tasks / stay-flow).

CREATE TABLE IF NOT EXISTS ops_property_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reservation_id   UUID        REFERENCES ops_reservations(id) ON DELETE SET NULL,

  title            TEXT        NOT NULL,
  description      TEXT,

  -- cleaning | check_in | check_out | maintenance | guest_request | payment | documents | lock | internet | other
  category         TEXT        NOT NULL DEFAULT 'other',
  -- low | normal | high | urgent
  priority         TEXT        NOT NULL DEFAULT 'normal',
  -- open | in_progress | blocked | done | cancelled
  status           TEXT        NOT NULL DEFAULT 'open',

  due_at           TIMESTAMPTZ,
  assigned_to      TEXT,

  -- manual | bot | system — источник создания задачи
  source           TEXT        NOT NULL DEFAULT 'manual',
  -- Заготовка для связи с коммуникационным модулем (conversation/event id)
  escalation_source TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ops_property_tasks_category_check
    CHECK (category IN (
      'cleaning', 'check_in', 'check_out', 'maintenance', 'guest_request',
      'payment', 'documents', 'lock', 'internet', 'other'
    )),

  CONSTRAINT ops_property_tasks_priority_check
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  CONSTRAINT ops_property_tasks_status_check
    CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),

  CONSTRAINT ops_property_tasks_source_check
    CHECK (source IN ('manual', 'bot', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_ops_property_tasks_property_id
  ON ops_property_tasks(property_id);

CREATE INDEX IF NOT EXISTS idx_ops_property_tasks_reservation_id
  ON ops_property_tasks(reservation_id);

CREATE INDEX IF NOT EXISTS idx_ops_property_tasks_status
  ON ops_property_tasks(status);

-- ─── ops_incidents ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops_incidents (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id          UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reservation_id       UUID        REFERENCES ops_reservations(id) ON DELETE SET NULL,

  title                TEXT        NOT NULL,
  description          TEXT,

  -- low | medium | high | critical
  severity             TEXT        NOT NULL DEFAULT 'medium',
  -- open | investigating | resolved | closed
  status               TEXT        NOT NULL DEFAULT 'open',

  -- manual | bot | guest | system
  source               TEXT        NOT NULL DEFAULT 'manual',
  escalation_required  BOOLEAN     NOT NULL DEFAULT false,
  -- Заготовка для связи с коммуникационным модулем
  escalation_source    TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ops_incidents_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  CONSTRAINT ops_incidents_status_check
    CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),

  CONSTRAINT ops_incidents_source_check
    CHECK (source IN ('manual', 'bot', 'guest', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_ops_incidents_property_id
  ON ops_incidents(property_id);

CREATE INDEX IF NOT EXISTS idx_ops_incidents_reservation_id
  ON ops_incidents(reservation_id);

CREATE INDEX IF NOT EXISTS idx_ops_incidents_status
  ON ops_incidents(status);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE property_master_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_property_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON property_master_cards;
DROP POLICY IF EXISTS "service_role_full_access" ON property_media;
DROP POLICY IF EXISTS "service_role_full_access" ON ops_reservations;
DROP POLICY IF EXISTS "service_role_full_access" ON ops_property_tasks;
DROP POLICY IF EXISTS "service_role_full_access" ON ops_incidents;

CREATE POLICY "service_role_full_access"
  ON property_master_cards FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON property_media FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON ops_reservations FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON ops_property_tasks FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON ops_incidents FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
