-- Soft-archive CRM contacts from the operator queue without deleting data.

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS crm_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_queue_active
  ON public.crm_contacts (updated_at DESC)
  WHERE crm_archived = false;
