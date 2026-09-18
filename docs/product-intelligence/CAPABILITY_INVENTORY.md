# ASI Capability Inventory (v1)

Canonical, evidence-based inventory of every identifiable ASI capability, for the RU market. This is grounding material for `asi-website-editor` (see `AGENTS.md` → Project Skills) and for anyone deciding what the public site may claim. It is not itself public copy and is not a roadmap commitment.

## Method and status model

Every capability gets exactly one status, based only on explicit repository evidence (code, tests, migrations) — never on doc language, a directory's existence, or a plausible-sounding name:

- **LIVE_PROVEN** — real integration, exercised against real infrastructure/users, with evidence of routine (not one-off) operation.
- **BUILT_NEEDS_ACCEPTANCE** — real, non-trivial logic exists and is unit-tested, but the strongest evidence available is a mocked dependency (mocked Supabase, mocked LLM, mocked provider), not a live system or real user traffic.
- **PILOT** — real integration against a live external system exists and has been exercised outside a mock, but only at small/manual/test scale (a designated test chat, a manually-dispatched workflow), not yet at routine guest/production scale.
- **PLANNED** — a data model, UI, or provider-metadata registry exists, but the actual integration/adapter is explicitly absent or marked as a placeholder in the code itself.
- **IDEA_ONLY** — no repository implementation found; at most discussed as a hypothesis or roadmap idea (including ideas raised for the first time in this inventory).
- **UNKNOWN** — insufficient evidence either way after a real search.

A recurring, load-bearing pattern found across the codebase: the code itself uses `_placeholder` suffixes and explicit `honest_label`/`honest_notice` strings (e.g. `autoApplyIsPlaceholder: true`, `'Рекомендации ценообразования — не live-цены в OTA.'`) to mark what is *not* real. Where the code says "placeholder," this inventory treats the capability as **not** live, regardless of how much surrounding scaffolding or tests exist. Conversely, most files named `*acceptance*.test.ts` run against a hand-built in-memory Supabase mock — "acceptance" in this repo usually means "the internal contract behaves correctly under test," not "proven against production." Only files suffixed `.pg.integration.test.ts`, a handful of manually-dispatched `*-live-acceptance*` scripts/workflows, and the Playwright specs under `tests/` touch anything genuinely live.

## Summary by status

| Status | Count | Capabilities |
|---|---|---|
| LIVE_PROVEN | 0 | — |
| PILOT | 1 | Telegram guest messaging (send) |
| BUILT_NEEDS_ACCEPTANCE | 13 | Booking-ops lifecycle & tasks; Turnover/cleaning/linen/inspection coordination; Legal/deposit/МВД readiness gating; Email guest messaging; Guest identity & repeat-guest memory; LLM reply guardrails/escalation; Owner/lead CRM & pilot rollout; Manual-import channel/booking reconciliation engine; Pricing recommendation engine; Location scoring & report — residential; Location scoring & report — commercial/retail; Owner/operator dashboard UI; Object/pilot readiness gating |
| PLANNED | 4 | Live OTA/channel-manager sync (named platforms); ASI's own recurring subscription billing loop; Cross-module `PlatformDecision` orchestration; International (non-RU) Stripe billing lifecycle |
| IDEA_ONLY | 4 | WhatsApp outbound guest messaging; Smart access / lock control; OTA payout & commission reconciliation; Guest-facing booking payment/deposit processing |
| UNKNOWN | 0 | — |

**23 capabilities inventoried.** None are LIVE_PROVEN by this inventory's evidence bar — the strongest current evidence is PILOT (Telegram send) and a large BUILT_NEEDS_ACCEPTANCE core. Note the WhatsApp-outbound entry is now also market-moot: Russia blocked WhatsApp nationwide on 2026-02-12 (see `POSITIONING_MAP.md`), independent of ASI's own implementation status.

---

## 1. Booking-ops lifecycle & task engine

- **Pain addressed:** operators lose track of where each booking stands (legal readiness, cleaning, guest questions, checkout, deposit return) once portfolios grow past a handful of units.
- **What ASI actually does:** a real state machine (`BOOKING_LIFECYCLE_STATUSES`/`BOOKING_LIFECYCLE_GATE_KEYS`) computes SLA items with severity escalation (info→warning→urgent→critical) based on time-to-checkin, runs an event-sourced automation loop with idempotent event de-duplication, and drives a worker task board (cleaner/linen/consumables/inspector roles).
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/booking-ops/lifecycle.ts`, `lifecycle-orchestrator.ts`, `lifecycle-autopilot.ts`, `automation-engine.ts`, `tasks.ts`.
- **Tests/acceptance evidence:** `booking-ops-e2e-acceptance.test.ts`, `golden-path-acceptance.test.ts` (21-step synthetic run, asserts `realMessagesSent: 0` and refuses false PASS on injected failure) — both against a hand-built in-memory Supabase mock, not a real database.
- **Current public-claim ceiling:** may say ASI tracks a booking's lifecycle internally and gates actions on readiness. Must not say this is proven at production scale — no live-traffic evidence exists.
- **What must happen before a stronger claim is allowed:** a `.pg.integration.test.ts` (or equivalent) against real Postgres, or a documented run against real bookings, with a written result.
- **Related/dependencies:** turnover/cleaning (#2), legal/deposit gating (#3), guest messaging (#4/#5).
- **Caveat:** at least four parallel "ops" task/board generations coexist (`src/lib/ops/`, `ops-v1/`, `ops-v17/`, `ops-board/`, `ops-pilot/`, plus `booking-ops/tasks.ts`) with no file declaring one canonical/deprecated. A claim of "one canonical reservation lifecycle" is true at the domain-model level only.

## 2. Turnover / cleaning / linen / inspection coordination

- **Pain addressed:** coordinating cleaner, linen, supplies and inspection between checkout and next check-in is manual and error-prone as unit count grows.
- **What ASI actually does:** a real status chain (`checkout_confirmed → cleaning_needed → … → unit_ready_for_next_guest`, plus linen/laundry/supplies tracks) with transition validation (e.g. `cleaning_executor_required`) and computed physical-readiness blockers that gate release of check-in instructions. On checkout it automatically finds the next eligible booking and links a cleaning task, or creates a fallback task if none exists.
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/booking-ops/turnover.ts`, `physical-readiness-execution.ts` (521 lines), `turnover-cleaning-activation.ts`; migrations `20260629000001_booking_ops_turnover_v1.sql`, `20260702200000_booking_physical_readiness_execution_pack_v1.sql`.
- **Tests/acceptance evidence:** `turnover.test.ts`, `turnover-cleaning-activation.test.ts`, `physical-readiness-execution.test.ts`, `physical-readiness-closure.test.ts` — passing, substantive assertions, all against mocked Supabase.
- **Current public-claim ceiling:** may say ASI tracks cleaning/linen/inspection status and gates check-in readiness on it. Must not say cleaners are automatically dispatched or notified — coordination with the human cleaner is an explicit **manual draft only** (`"Отправка выполняется только вручную после проверки оператором"`), and there is no cleaner marketplace, roster, or photo-proof upload pipeline.
- **What must happen before a stronger claim is allowed:** an actual outbound dispatch channel to cleaners (not just a draft), and evidence it ran on a real booking.
- **Related/dependencies:** booking-ops lifecycle (#1); this is one instance of the broader gating pattern also seen in #3.

## 3. Legal / deposit / МВД readiness gating

- **Pain addressed:** guest-registration (МВД), deposit collection and contract signature are legally required or commercially expected, easy to skip under time pressure, and check-in instructions should not leak before they're satisfied.
- **What ASI actually does:** a real status machine for documents/contract/deposit/MVD gates release of check-in instructions until an operator has attested each step. The naming convention is itself the evidence of honesty: every status implying a real integration is suffixed `_placeholder` (`paid_provider_placeholder`, `submitted_provider_placeholder`); every status actually settable today is suffixed `_manual` (operator self-attestation). Passport/document storage is deliberately never persisted (`storage_ref: null`, masked references only).
- **Status:** BUILT_NEEDS_ACCEPTANCE for the workflow/gating layer; **IDEA_ONLY** for any real МВД e-filing, real deposit payment capture, or document OCR/verification — none exist.
- **Repository evidence:** `src/lib/booking-ops/guest-legal-deposit-mvd-execution.ts` (612 lines); migrations `20260702180000_guest_legal_deposit_mvd_execution_pack_v1.sql`, `20260629235959_booking_legal_payment_autopilot_v1.sql`.
- **Tests/acceptance evidence:** `guest-legal-deposit-mvd-execution.test.ts` (15 cases) explicitly asserts drafts do **not** count as done (`'contract draft does not count as signed'`, `'MVD draft does not count as submitted'`) and that a reason is required before any waiver DB write.
- **Current public-claim ceiling:** may say ASI tracks legal/deposit/МВД readiness as an operator checklist that gates check-in information release. Must not say ASI files migration registrations with МВД, collects deposits, or verifies documents — none of that exists in code.
- **What must happen before a stronger claim is allowed:** a real МВД e-filing client (e.g. against ЕПГУ), a real payment-capture integration for deposits, and tests proving both, before removing the "manual/placeholder" ceiling.
- **Related/dependencies:** booking-ops lifecycle (#1); payments (#17/#20).

## 4. Guest messaging — Telegram (send)

- **Pain addressed:** answering repetitive guest questions (check-in time, Wi-Fi, parking) around the clock without staffing a 24/7 chat desk.
- **What ASI actually does:** a real HTTP integration to the Telegram Bot API (with timeout/abort handling and per-call token read, deliberately not cached, to avoid stale tokens on serverless), invoked from the communication orchestrator for guest replies.
- **Status:** PILOT — the strongest live-integration evidence in the repository, but not yet LIVE_PROVEN.
- **Repository evidence:** `src/lib/telegram.ts`; send call sites in `src/lib/communication/orchestrator.ts`, `communication-autopilot-v1-orchestrator.ts`.
- **Tests/acceptance evidence:** real, manually-dispatched evidence beyond mocks: `.github/workflows/telegram-guest-concierge-smoke.yml` (explicitly titled "not quality gate," SSHes to a VPS, uses a dedicated test bot/chat), plus standalone scripts `scripts/telegram-live-acceptance.mjs`, `telegram-autopilot-live-acceptance.mjs`, `telegram-identity-live-acceptance.mjs` (`npm run test:telegram:live` family) — real HTTP calls to Telegram, but against a designated test chat, manually run, not CI-gated, and with no evidence of routine guest-scale traffic.
- **Current public-claim ceiling:** may say ASI can send guest replies via Telegram and this has been exercised against the real Telegram API. Must not say this is proven at scale across a real guest population — only test-chat-scale evidence exists.
- **What must happen before a stronger claim is allowed:** a documented run (or CI gate) against real guest traffic on at least one live pilot object, with a written before/after result.
- **Related/dependencies:** guest identity/memory (#5), LLM guardrails (#6).

## 5. Guest messaging — Email

- **Pain addressed:** same as #4, for hosts/guests who use email.
- **What ASI actually does:** a real SMTP-based send adapter, but **draft-only by default** — `isEmailDraftOnly()` returns `true` unless explicitly overridden, and dedicated regression tests exist specifically to prevent that default from silently flipping.
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/communication/channels/email.ts`, `email-outbound-safe-mode.ts`.
- **Tests/acceptance evidence:** tests named `email-draft-only-regression.test.ts` / draft-only production-regression suite — confirm the safety default, not real delivery.
- **Current public-claim ceiling:** may say ASI can draft email replies for operator review. Must not say ASI sends email to guests automatically today.
- **What must happen before a stronger claim is allowed:** evidence of `EMAIL_AUTO_SEND` enabled in a real deployment with delivered messages.
- **Related/dependencies:** #4, #6.

## 6. Guest messaging — WhatsApp (outbound)

- **Pain addressed:** same as #4, for guests who use WhatsApp.
- **What ASI actually does:** nothing outbound. Grep across the repository finds only *inbound* WhatsApp voice-note handling (webhook parsing, transcription) — no outbound send adapter of any kind exists.
- **Status:** IDEA_ONLY (no outbound implementation).
- **Repository evidence:** absence confirmed by targeted search of `src/lib/whatsapp/` and `src/lib/communication/channels/`.
- **Tests/acceptance evidence:** none (nothing to test).
- **Current public-claim ceiling:** must not claim WhatsApp as a guest-messaging channel at all.
- **Market note (independent of ASI's build status):** Russia blocked WhatsApp nationwide on 2026-02-12 (Roskomnadzor DNS-level block, confirmed by multiple international outlets). This makes the capability moot for the RU market regardless of implementation — any future messaging investment should target Telegram and MAX, not WhatsApp.
- **Related/dependencies:** #7 (inbound WhatsApp voice, a separate, real capability).

## 7. Guest messaging — WhatsApp (inbound voice transcription)

- **Pain addressed:** guests sending voice notes instead of text.
- **What ASI actually does:** real inbound webhook parsing and speech-to-text transcription of WhatsApp voice notes.
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/whatsapp/webhook.ts`, `media.ts`, `stt.ts`; test `src/lib/whatsapp/__tests__/voice-pipeline.test.ts`.
- **Tests/acceptance evidence:** unit-level only.
- **Current public-claim ceiling:** may say ASI can transcribe inbound voice notes; must not imply a full WhatsApp conversation loop (see #6's market note — this channel is now moot in Russia regardless).
- **What must happen before a stronger claim is allowed:** N/A given the market-level WhatsApp block; superseded by MAX/Telegram voice handling if built.
- **Related/dependencies:** #6.

## 8. Guest identity & repeat-guest memory

- **Pain addressed:** recognizing a returning guest and gating sensitive disclosures (e.g. door codes) on actual identity confidence, not just "a message arrived."
- **What ASI actually does:** a real, DB-backed identity-resolution algorithm cross-checking phone number + booking ID across `tg_guest_identities`/`tg_guest_profiles`/`tg_guest_reservations`, returning a confidence-scored status (`unknown/unverified/partially_verified/verified`, 0–0.95) with an explicit repeat-stay counter (`stays_count`), and a security gate (`canRevealTelegramAccessDetails()`) requiring `verified` + confidence ≥ 0.85 before revealing access details.
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/communication/telegram-guest-memory.ts`, `telegram-session-memory.ts`; migrations `20260528000001_telegram_guest_memory_foundation.sql`, `20260531000001_telegram_booking_object_memory_v1.sql`.
- **Tests/acceptance evidence:** `telegram-guest-memory-foundation.test.ts`, `telegram-guest-memory-migration.test.ts` — hand-built in-memory fake DB, meaningful branch coverage, no `.pg.integration.test.ts` found specifically for these tables.
- **Current public-claim ceiling:** may say ASI recognizes returning guests with a confidence-graded identity check before disclosing sensitive information. Must not call this a full guest CRM (see #9) or claim it is validated against real production traffic.
- **What must happen before a stronger claim is allowed:** a Postgres integration test for these specific tables, or a documented live result.
- **Related/dependencies:** #4, #9 (explicitly separate systems — do not conflate).

## 9. LLM reply guardrails & escalation routing

- **Pain addressed:** an automated reply must never make an unsupported claim and must hand off anything requiring judgment.
- **What ASI actually does:** routing/guardrail logic (`decideCommunicationAutopilotResponseWithLlmRouter`) tested against a 100-phrase acceptance matrix, asserting no forbidden claims appear and correct escalation on "needs_operator" cases.
- **Status:** BUILT_NEEDS_ACCEPTANCE — for the guardrail/routing layer specifically. The underlying language model itself is never invoked in these tests (fully mocked/scripted LLM response).
- **Repository evidence:** `src/lib/communication/__tests__/comm-agent-acceptance-100.test.ts`, `comm-v1-automated-acceptance.test.ts`.
- **Tests/acceptance evidence:** as above — proves guardrail correctness against a scripted model, not real model behavior at guest scale.
- **Current public-claim ceiling:** may say ASI's reply logic is tested against a forbidden-claim/escalation matrix. Must not claim the real language model has been proven safe at scale — that evidence does not exist in this repository.
- **What must happen before a stronger claim is allowed:** the same acceptance matrix run against the real model provider in a real (or shadow) deployment, with logged pass/fail.
- **Related/dependencies:** #4, #8.

## 10. Owner/lead CRM & pilot rollout

- **Pain addressed:** managing ASI's own pipeline of prospective/pilot property owners (not guests).
- **What ASI actually does:** a real operator-facing lead pipeline (`new_lead → contact → instruction_sent → … → pilot`) with queue/archive/audit events, and a pilot-capacity gate (`PILOT_ACTIVE_LIMIT`, default 4, env-overridable) that blocks a 5th active pilot unless one is explicitly replaced.
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/crm/types.ts`, `repository.ts`, `queue.ts`, `pilot-rollout.ts`, `activity-feed.ts`, `booking-signals.ts`.
- **Tests/acceptance evidence:** `queue.test.ts`, `pilot-rollout.test.ts`, `operator-inbox.test.ts`, `booking-signals.test.ts`, `activity-feed.test.ts` — real transition-logic tests.
- **Current public-claim ceiling:** internal-facing only; this capability should not appear in public copy as a customer-facing feature at all — it is ASI's own sales/rollout tooling.
- **What must happen before a stronger claim is allowed:** N/A — not a customer-facing claim.
- **Related/dependencies:** #13 (onboarding/readiness).
- **Important correction for any existing doc:** `src/lib/crm/` is **not** a guest CRM. It has zero repeat-guest/preference/guest-history tracking — that lives entirely in #8, a separate, narrower module. Any document describing "CRM" as tracking guest history is factually wrong about which module does what.

## 11. Channel manager / OTA sync (named platforms)

- **Pain addressed:** keeping inventory/rates/availability in sync across OTAs without manual re-entry.
- **What ASI actually does:** a static provider-metadata registry (Bnovo, RealtyCalendar, TravelLine, Контур.Отель, Shelter; separately Суточно/Yandex.Travel/Ozon Travel/Avito/Cian/101Hotels/Otello) where **every single entry** is marked `planned`, `on_request`, `partner_access_required`, or `unknown` — several with explicit code comments stating no confirmed public API exists. The only entry marked `available` is `manual_import`.
- **Status:** PLANNED (bordering IDEA_ONLY for the named adapters specifically).
- **Repository evidence:** `src/lib/channel-manager/registry.ts`, `src/lib/channel-connections/providers.ts`, `src/lib/distribution/domain.ts` (pure types, zero implementation), migration `20260421000001_distribution_runtime_phase1.sql` (schema-only, header comment explicitly disclaims "smart OTA optimization or profitability logic").
- **Tests/acceptance evidence:** none for real OTA connectivity — none exists to test.
- **Current public-claim ceiling:** must not claim live sync with any named OTA (Avito, Booking.com, Airbnb, Суточно.ру, Яндекс Путешествия, etc.). May describe channel connection as a roadmap direction.
- **What must happen before a stronger claim is allowed:** a real, tested API/webhook integration with at least one named platform.
- **Related/dependencies:** #12 (the manual-import engine underneath, which is real).

## 12. Manual-import channel/booking reconciliation engine

- **Pain addressed:** given the above, operators still need a safe way to reconcile manually-entered/CSV-imported booking data without corrupting real records.
- **What ASI actually does:** a genuinely sophisticated, self-described "provider-independent read-only sync contract" that processes manually-imported snapshots with idempotent setup, fail-closed behavior on any unmarked/foreign data (never adopts or cascades over real customer rows), and a recovery/cleanup path whose cascade manifest is cross-checked against the actual SQL migration's `ON DELETE CASCADE` definitions.
- **Status:** BUILT_NEEDS_ACCEPTANCE, with one component **verified against real Postgres** (rare in this codebase): the recovery-cleanup RPC is tested in `channel-manager-live-core-recovery.pg.integration.test.ts` against a real (disposable) Postgres instance, including a mid-transaction failure/rollback proof — but that same test file self-gates and reports `runtimeVerified: false` if no disposable Postgres URL is configured for the run.
- **Repository evidence:** `src/lib/booking-ops/channel-manager-live-core.ts` (3,078 lines; explicit header: "No real provider APIs, polling, webhooks, or outbound OTA writes").
- **Tests/acceptance evidence:** `channel-manager-live-core-acceptance.test.ts` (mocked), `channel-manager-live-core-recovery.pg.integration.test.ts` (real Postgres, self-gating), `channel-manager-live-incremental-sync.pg.integration.test.ts`, `channel-manager-reconciliation.pg.integration.test.ts`.
- **Current public-claim ceiling:** may say ASI can safely import and reconcile manually-entered booking data without risking real records. Must not call this "channel manager sync" in a way that implies OTA connectivity (that's #11).
- **What must happen before a stronger claim is allowed:** nothing further needed for the manual-import claim itself; connecting it to a real OTA is #11's job.
- **Related/dependencies:** #1, #11.

## 13. Pricing recommendation engine

- **Pain addressed:** manual/heuristic pricing leaves money on the table or under/overprices relative to demand, season, and competition.
- **What ASI actually does:** a real multi-factor pricing calculation (day-of-week, seasonality, lead-time, competitor median, supply/availability, event pressure, weather, strategy multiplier) producing a clamped, rounded recommendation and a 180-day tariff grid, with an auditable recommendation-run record. Genuinely (if simply) informed by location/audience signals via `getAudiencePricingWeights()`.
- **Status:** BUILT_NEEDS_ACCEPTANCE — for the recommendation engine. **Not** connected to any live OTA price push.
- **Repository evidence:** `src/lib/booking-ops/pricing-intelligence-autopilot.ts` (1,026 lines); migration `20260701180000_pricing_intelligence_tariff_grid_v1.sql`.
- **Tests/acceptance evidence:** `pricing-intelligence-autopilot.test.ts` — passing.
- **Explicit self-disclosed limits:** `autoApplyIsPlaceholder: true` is a literal type-level constant on every pricing profile; the code's own honest-label strings state "Рекомендации ценообразования — не live-цены в OTA" and "Пилотное авто-применение — не live-пуш цен в OTA." Weather/events/market signal sources are themselves named `*_provider_placeholder`; only manual and channel-import signal ingestion is real.
- **Current public-claim ceiling:** may say ASI computes pricing recommendations from multiple signals including a location/audience weighting. Must not say prices are automatically pushed to any OTA, or that weather/event/market data feeds are live — the code itself says they are placeholders.
- **What must happen before a stronger claim is allowed:** a real market-data/weather/events provider connection, and (separately) a real OTA price-push integration, before removing the "recommendation only" ceiling. Internal docs (`docs/platform-90-percent-roadmap.md`) independently rate this area's honest ceiling at ~30–45% without an external market-data provider.
- **Related/dependencies:** #14, #15 (location signals feed pricing).

## 14. Location scoring & report — residential

- **Pain addressed:** deciding whether an address/location is viable for short-term rental before committing to it.
- **What ASI actually does:** the deepest-tested module in the repository. A canonical `LocationDecision`/`LocationPublicSummary` contract with self-enforcing architectural guards — a static-source-inspecting test literally reads `.tsx` source at test time to assert the public UI never imports scoring internals directly and never invents signals outside the kernel's output. Golden-fixture regression tests exist against known addresses. At least one real external data feed is wired: a SOAP client against the Russian public-procurement register (EIS), with its own live-probe test.
- **Status:** BUILT_NEEDS_ACCEPTANCE, trending toward PILOT for the scoring core specifically — this is the strongest-evidenced module in the codebase after Telegram send, though its proof is against fixtures/golden data, not production traffic.
- **Repository evidence:** `src/lib/location/location-decision-contract.ts`, `location-public-summary.ts`, `data-sources/public-procurement/eis-official-client.ts`; `docs/location/`, `docs/location-validation/`.
- **Tests/acceptance evidence:** `location-decision-anti-bypass.test.ts` (source-inspecting), `location-scoring-golden-fixtures.test.ts`, `golden-addresses.test.ts`, `public-procurement-live-probe.test.ts`.
- **Current public-claim ceiling:** may say ASI provides an open-map-based location analysis with explicit data-completeness limits, per `docs/commercial-product-positioning-v1.md`'s mandated public framing ("We don't promise exact human counts. We give you a defensible spatial picture..."). Must not claim guaranteed revenue or footfall counts.
- **What must happen before a stronger claim is allowed:** documented production-traffic evidence (not just fixture correctness) for a stronger "proven" claim.
- **Related/dependencies:** #13, #15.

## 15. Location scoring & report — commercial/retail

- **Pain addressed:** siting decisions for commercial/retail-adjacent short-term-rental positioning.
- **What ASI actually does:** the same architectural contract as #14, but explicitly rated lower internally: `docs/platform-90-percent-roadmap.md`/`readiness-summary.md` put the honest ceiling at 55–70%, calling the lack of real footfall/pedestrian-graph data "the main bottleneck." `docs/commercial-product-positioning-v1.md` mandates an explicit anti-positioning section (not a "magic number," not door-counting, not a lease-negotiation replacement) and a "Trust & limitations" split between what the model is confident about (transit hubs, obvious tourist destinations) and what it is intentionally conservative about (real footfall at the door, OSM completeness).
- **Status:** BUILT_NEEDS_ACCEPTANCE, with an internally-documented, lower ceiling than #14.
- **Repository evidence:** same location module; `docs/commercial-product-positioning-v1.md`; `docs/platform-90-percent-readiness-summary.md`.
- **Tests/acceptance evidence:** shared with #14 where the code paths overlap.
- **Current public-claim ceiling:** must use the exact honesty framing already mandated in `docs/commercial-product-positioning-v1.md` — "V1, OSM-only, proxy flow," never "almost perfect" or a percentage readiness claim.
- **What must happen before a stronger claim is allowed:** a real footfall/pedestrian-graph data provider connection.
- **Related/dependencies:** #14.

## 16. Owner/operator dashboard UI

- **Pain addressed:** an owner/operator needs one place to see reservations, ops status, pricing, and channel-connection state.
- **What ASI actually does:** a real, extensive dashboard (20+ sections: booking-ops, bookings, channel-connections, communication, crm, onboarding, operations, pricing, properties, reports, reservations) backed by 18 real API route groups, several with their own route tests. `src/app/dashboard/booking-ops/page.tsx` alone is 5,109 lines.
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/app/dashboard/**`, `src/app/api/dashboard/**`.
- **Tests/acceptance evidence:** per-route API tests exist (e.g. `booking-ops/__tests__/route.test.ts`); Playwright configs exist at repo root (`playwright.config.ts`, `playwright.dashboard.config.ts`) suggesting e2e coverage is at least set up, though not confirmed exhaustively in this pass.
- **Current public-claim ceiling:** may say ASI provides an operator dashboard covering these areas. Must not claim full end-to-end browser-acceptance proof without checking the Playwright suite results directly.
- **What must happen before a stronger claim is allowed:** a documented Playwright/e2e run against the dashboard.
- **Related/dependencies:** all capabilities that expose data through it.

## 17. Object / pilot readiness gating (onboarding)

- **Pain addressed:** starting the 14-day pilot clock before an object is actually ready invalidates the pilot; operators need a real go/no-go gate.
- **What ASI actually does:** a concrete, field-level readiness engine (`REQUIRED_FIELDS`: address, object_type, checkin/checkout time, channels, rules, wifi, photos) with a real switch-statement evaluator per check, and a notable strictness nuance: some checks are relaxed outside `NODE_ENV=production` — i.e. the gate is deliberately stricter in production than in dev/test. A pilot-chain orchestrator connects CRM lead → property object → (metadata-only) channel-manager step → ops task.
- **Status:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/object-readiness/engine.ts`, `src/lib/pilot-readiness/engine.ts`, `src/lib/pilot-chain/orchestrator.ts`; migration `20260623000001_pilot_readiness_v1.sql`.
- **Tests/acceptance evidence:** `pilot-chain/__tests__/pilot-chain.test.ts` and related — mocked CRM/Supabase.
- **Current public-claim ceiling:** matches the public site's existing framing exactly ("14 дней пилота отсчитываются только после полной готовности") — this claim is well-supported by real code, not just marketing language. Must not claim the channel-manager leg of the chain performs a live OTA connection (it's metadata-only, per #11).
- **What must happen before a stronger claim is allowed:** N/A — this is one of the better-supported existing public claims.
- **Related/dependencies:** #1, #11.

## 18. ASI's own recurring subscription billing (1000₽/object/month)

- **Pain addressed:** collecting ASI's own continuation fee after a successful pilot.
- **What ASI actually does:** a real YooKassa provider class (`createPayment`, `getPaymentStatus`, `handleWebhook`) wired to real credential env vars, with the exact pricing constant used on the public site (`COMMUNICATION_PILOT_PRICE_RUB = 1000`). However, `isYooKassaEnabled()` is env-gated off by default, `createPayment()` unconditionally returns `status: 'disabled'`, and its currently-wired call site (`simulate-payment` route) is tied to the **location-report** product's payment step, not a recurring communication-pilot subscription loop.
- **Status:** PLANNED for the specific "recurring 1000₽/property/month subscription charge" claim (pricing constant and provider exist; no recurring-billing loop against it was found). BUILT_NEEDS_ACCEPTANCE for the underlying YooKassa provider/webhook code itself.
- **Repository evidence:** `src/lib/payments/yookassa.ts`, `yookassa-env.ts`, `handle-yookassa-webhook.ts`; test `create-payment-disabled.test.ts` (its name states the current state).
- **Tests/acceptance evidence:** as above.
- **Current public-claim ceiling:** the public site may state the 1000₽/property/month continuation price as a commercial term (it is a real, correct constant), but must not imply automated recurring billing is live — per `RU_PUBLIC_SITE_CONTRACT.pricing.noAutomaticPaidTransition`, this is already correctly framed as manual/decision-gated, which matches the code.
- **What must happen before a stronger claim is allowed:** an enabled, tested recurring billing loop.
- **Related/dependencies:** #3 (deposit payment is a separate, still-more-placeholder concern), #20.

## 19. International (non-RU) Stripe billing lifecycle

- **Pain addressed:** N/A for the RU market — this is a different product line ("Guest Autopilot," international/EN positioning).
- **What ASI actually does:** a real state machine (signup → card_verified → integration_in_progress → … → paid_active) with tests, but explicitly gated off (`isInternationalBillingEnabled()` defaults false) pending "an approved merchant/legal entity, finalized pricing, and production Stripe config."
- **Status:** BUILT_NEEDS_ACCEPTANCE (as a state machine); not applicable to RU-market claims.
- **Repository evidence:** `src/lib/billing/account-lifecycle.ts`, `lifecycle.ts`, `stripe-client.ts`.
- **Tests/acceptance evidence:** unit-level state-machine tests.
- **Current public-claim ceiling:** must not appear on RU public pages at all — different product, different market, off by default.
- **Related/dependencies:** none for RU.
- **Positioning flag:** this product line is one of at least three distinct brand narratives found across `src/app/page.tsx` (EN "ASI Intelligence"/"ASI Micro Hotels"), `src/app/ru/**` (RU guest-communication pilot), and a `/rental-autopilot` cross-link labeled "Rental Autopilot" — see `POSITIONING_MAP.md` for the brand-fragmentation risk this creates.

## 20. Smart access / lock control

- **Pain addressed:** self-check-in without a human handing over keys; RU-market research (see `POSITIONING_MAP.md`) shows this is the single largest per-unit software cost line item RU operators pay today (350–1,500 ₽/lock/month via RU middleware).
- **What ASI actually does:** nothing. An exhaustive case-insensitive search across `src/` and `docs/` for lock/access-code/door-code/vendor-name terms returned zero matches, except a communication-safety regex that exists purely to *block* sending a message that looks like it contains a door code until legal readiness is confirmed (a guardrail, not a feature).
- **Status:** IDEA_ONLY — introduced here as a market-informed opportunity, not as an existing or even previously-discussed capability in this repository.
- **Repository evidence:** absence confirmed by search; the only tangential hit is the guardrail regex in `guest-legal-deposit-mvd-execution.ts`.
- **Tests/acceptance evidence:** none.
- **Current public-claim ceiling:** must not appear on the public site in any form.
- **What must happen before a stronger claim is allowed:** an actual integration (RU market realistically means TTLock/Tuya via a middleware layer, per `POSITIONING_MAP.md`), tested, before any public mention.
- **Related/dependencies:** #2 (turnover — check-in/checkout timing would gate lock codes), #3 (legal readiness already gates check-in instruction release, which is the natural attachment point).

## 21. OTA payout & commission reconciliation

- **Pain addressed:** reconciling gross booking amount vs. net OTA payout vs. commission vs. taxable base across 4–6 platforms with different commission models and payout cadences (confirmed as a real RU tax/accounting burden — see `POSITIONING_MAP.md`).
- **What ASI actually does:** nothing. `src/lib/distribution/domain.ts` defines types (`ChannelReservation.total_amount`) but no reconciliation logic reads or writes them; no code matches OTA payouts against bookings.
- **Status:** IDEA_ONLY.
- **Repository evidence:** absence confirmed; schema-only types in `src/lib/distribution/domain.ts`.
- **Tests/acceptance evidence:** none.
- **Current public-claim ceiling:** must not appear on the public site.
- **Market note:** RU market research independently identifies this as the **highest-conviction gap** in the entire RU competitive landscape — no RU vendor surveyed (RealtyCalendar, Bnovo, TravelLine, Контур.Отель) appears to own multi-OTA payout reconciliation either. This is a genuine opportunity, not a caught-up-to-competitors feature.
- **What must happen before a stronger claim is allowed:** a real reconciliation engine, tested against at least one real OTA's payout/commission data, before any public claim.
- **Related/dependencies:** #11, #18.

## 22. Guest-facing booking payment / deposit processing

- **Pain addressed:** collecting a security deposit or booking payment from the guest directly (distinct from #18, which is ASI's own fee to the operator).
- **What ASI actually does:** nothing beyond the manual-attestation placeholder covered in #3 (`paid_manual`, no real charge).
- **Status:** IDEA_ONLY.
- **Repository evidence:** covered in #3; no separate guest-payment gateway code found.
- **Tests/acceptance evidence:** none beyond #3's draft-tracking tests.
- **Current public-claim ceiling:** must not appear on the public site as a "deposit collection" or "guest payment" feature.
- **Related/dependencies:** #3, #18.

## 23. Cross-module `PlatformDecision` orchestration

- **Pain addressed:** the strategic aspiration behind "not another point tool" — a single decision layer spanning location, pricing, communication, and ops, escalating humans only for exceptions.
- **What ASI actually does:** this is explicitly a **target**, not a shipped system. `docs/platform-90-percent-roadmap.md`/`readiness-summary.md` rate cross-module orchestration at 45–60% achievable, gated on a `PlatformDecision` schema (module, confidence, limitations[], actions[]) and a conflict-priority policy ("safety > payment > location upsell") that do not yet exist. What *does* exist today are narrow, real, code-level links between specific pairs of modules: physical-readiness gates check-in-instruction release (#2↔#3), legal-readiness gates check-in-instruction release (#3), and location/audience signals weight pricing factors (#13↔#14). These are genuine cross-module connections, just narrower and more specific than a unified orchestration layer.
- **Status:** PLANNED for the unified system; the narrow pairwise links above are individually BUILT_NEEDS_ACCEPTANCE (already counted under their own capabilities).
- **Repository evidence:** `docs/platform-90-percent-roadmap.md`, `docs/platform-90-percent-readiness-summary.md`, `docs/blueprints/ASI-OPS-CONTOUR-BLUEPRINT.md` (explicit "Next Implementation Targets" list: operator review workflow, OTA/direct dispute routing, sensor ingestion, delegation UI, incident persistence, dashboard visualization — all marked not yet built).
- **Tests/acceptance evidence:** none for the unified system (it doesn't exist yet); the pairwise links are tested as part of their own capabilities.
- **Current public-claim ceiling:** may describe *specific, real* cross-module gates (e.g. "check-in instructions are held until legal and physical readiness are both confirmed") as a proof point that ASI connects operational steps, without claiming a general, all-domain "one system" exists yet. See `CLAIMS_REGISTER.md` for exact allowed/prohibited wording.
- **What must happen before a stronger claim is allowed:** the `PlatformDecision` schema and priority policy would need to actually ship and be tested across at least two more module pairs.
- **Related/dependencies:** effectively all of the above.
