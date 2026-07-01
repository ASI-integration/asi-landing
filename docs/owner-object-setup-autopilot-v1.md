# Owner/Object Setup Autopilot v1 — Audit & Implementation

## Goal

Automate owner onboarding and object data collection: track readiness, queue safe owner communication intents, and prepare objects for Channel Manager handoff — without real OTA API push or unsafe auto-send.

## Current state audit

### `/dashboard/leads` (CRM)

| Component | Classification |
|-----------|----------------|
| `CrmPageClient.tsx` | **Semi-automatic** — manual status dropdowns, pilot chain actions |
| Pilot rollout normalization | **Automatic** |
| Telegram onboarding note block | **Semi-automatic** — parsed from CRM note |
| `CrmPilotChainActions` | **Semi-automatic** — operator-triggered next steps |
| Owner setup panel (v1) | **Automatic** status + operator actions |

### `/dashboard/property-knowledge`

| Component | Classification |
|-----------|----------------|
| Manual form save | **Manual** |
| Text intake parse/preview | **Semi-automatic** — operator approves fields |
| Sensitive fields (Wi‑Fi password, intercom) | **Manual** confirm replace |
| Object setup readiness panel (v1) | **Automatic** list from setup profiles |

### Property / object models

| System | Classification |
|--------|----------------|
| `tg_property_knowledge` / pilot readiness | **Automatic** percent, **manual** gaps |
| Object Readiness Engine (Telegram wizard) | **Automatic** scoring, **manual** operator escalation |
| `booking_property_setup_profiles` (v1) | **Automatic** tracking + validation |

### Channel readiness

| Step | Classification |
|------|----------------|
| `/dashboard/channel-connections` flow | **Manual** UI |
| Access verification | **Manual** |
| OTA publication | **Blocked** — no live API (next task) |

### Photo / info / rules / check-in / Wi‑Fi / pricing / channels

| Field area | Before v1 | After v1 |
|------------|-----------|----------|
| Title, city, type, capacity | Telegram wizard / CRM note | **Tracked** in property setup profile |
| Check-in/out times | Wizard / prepare page | **Tracked** + missing field detection |
| Rules | Wizard multi-select | **Tracked** (`rules_status`) |
| Photos | Upload or `later` intent | **Tracked** (`photos_status` + assets) |
| Pricing | Manual note only | **Tracked** (`pricing_status`, label only) |
| Wi‑Fi | Wizard / property knowledge | **Status only** — no raw password storage |
| Channel manager access | Manual CRM stages | **Tracked** (`channel_access_status`, safe ref) |

### Lead onboarding statuses

Legacy CRM setup stages (`instruction_sent` → `ready_for_test`) remain **manual** in dropdown. v1 adds parallel machine-readable statuses in `booking_owner_setup_profiles`.

### Owner communication

| Path | Classification |
|------|----------------|
| Telegram owner wizard | **Automatic** prompts |
| Booking Ops guest orchestrator | N/A for owners |
| `booking_owner_setup_communication_intents` (v1) | **Automatic** draft intents via auto-send policy |

### Pilot wording (Bragin / Strigunov)

- `bragin_group` CRM source → `pilot_group: bragin`
- Note contains «Стригунов» / `community_member` → `pilot_group: strigunov`
- Early-access form labels preserved in metadata `pilot_wording`

## v1 additions

### Tables

- `booking_owner_setup_profiles`
- `booking_property_setup_profiles`
- `booking_property_assets`
- `booking_owner_setup_communication_intents`

Migration: `20260701160000_owner_object_setup_autopilot_v1.sql`

### Service

`src/lib/booking-ops/owner-object-setup-autopilot.ts`

### APIs

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/dashboard/leads/[leadId]/owner-setup/initialize` | Ops admin | Create owner setup from lead |
| `GET /api/dashboard/leads/[leadId]/owner-setup` | CRM operator | Status + blockers |
| `POST /api/dashboard/property-setup/action` | Ops admin | Setup actions |
| `GET /api/dashboard/property-setup/status` | CRM operator | Property readiness |
| `GET /api/dashboard/property-setup/list` | CRM operator | List profiles |
| `POST /api/owner-setup/submit` | Public token + rate limit | Owner self-serve data |

### UI

- `CrmOwnerSetupPanel` on `/dashboard/leads`
- `ObjectSetupReadinessPanel` on `/dashboard/property-knowledge` and `/dashboard/booking-ops`

### Channel Manager handoff statuses (metadata)

- `ready_for_channel_preparation`
- `manual_channel_publication_pending`
- `channel_access_received`
- `object_data_ready`
- `publication_blocked`

Feeds **Channel Manager Access & Import v1** (next task).

## Classification summary

| Area | Before v1 | After v1 |
|------|-----------|----------|
| Lead → owner setup profile | **Missing** | **Automatic** initialize |
| Object data tracking | CRM note / wizard only | **Automatic** profiles + scores |
| Missing fields visibility | Partial | **Explicit** safe labels |
| Owner comm drafts | Manual / Telegram only | **Automatic** queued intents |
| Actual message send | Opt-in scope | **Unchanged** — drafts only |
| Self-serve owner form | **Missing** | **Added** token submit API |
| Real OTA / CM API push | **Blocked** | **Still blocked** |

## Security

- No raw passwords, door codes, or CM credentials in DB/API/UI
- Channel access stored as status + optional `channel_access_ref` (safe label)
- Public submit rejects credential-shaped fields
- Communication intents evaluated through `communication-auto-send-policy`
- Global auto-send remains OFF

## Still manual

- Operator sends queued communication drafts
- Channel manager connection UI and verification
- OTA publication
- Property knowledge sensitive field replacement
- Telegram wizard for owners not using public link
- Pricing finalization in external CM
