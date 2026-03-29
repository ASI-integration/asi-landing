# ASI OPS Contour Blueprint

## Purpose

This document defines the canonical architecture for the ASI OPS contour.
It covers incident intake, unit state derivation, check-in readiness, the decision
engine, communication posture, financial recommendation, and delegation boundaries.

It is the authoritative reference for how OPS decisions are structured, what
data flows through the system, and where the boundaries of automated autonomy lie.

---

## Core Principles

**Incident detection is immutable.**
Once an incident is recorded, its existence cannot be erased by configuration, guest
tier, or tolerance settings. Modifiers affect how the system reacts — not whether
the incident occurred.

**Unit state is system-derived, not owner-defined.**
Operational state (`ready`, `dirty`, `maintenance`, `blocked`) flows from actual
incident and turnover outcomes. Owners influence thresholds and reaction posture,
not the underlying state machine.

**Owners configure reaction, not reality.**
Tolerance score, delegation level, and brand profile affect communication and autonomy
decisions. They do not alter safety rules or incident facts.

**Silent by default.**
The system does not communicate with guests, owners, or OTAs unless a rule explicitly
triggers a communication mode. Most micro incidents produce no outbound signal.

**No automatic charging.**
Financial recommendations (`recommendedPayer`) are advisory only. No charge is
initiated by the decision engine. All financial action requires explicit downstream
operator review.

**Safe operational autonomy, cautious conflict autonomy.**
The system may act autonomously on operational decisions (block check-in, trigger
turnover) but escalates to humans whenever financial liability, guest disputes, or
low-confidence safety concerns arise.

---

## Current Domain Model

### IncidentRecord
The canonical normalized incident. Created from a source report (cleaner, sensor,
guest message, etc.). Fields: `incidentId`, `propertyId`, `reservationRef`, `source`,
`type`, `severity`, `evidenceStatus`, `contactStrategy`, `otaCaseRequired`,
`directGuestSensitive`, `createdAt`.

Incident types: `damage`, `excessive_mess`, `party_suspected`, `smoking_suspected`,
`noise_violation`, `unauthorized_access`.

### CleanerIssueReportInput
The intake form submitted by a cleaner. Maps directly to an `IncidentRecord` via
`mapCleanerIssueToIncident`. Evidence presence (photos/videos) determines
`evidenceStatus`.

### PropertyCapabilities
Hardware/sensor capabilities of a unit: smart lock, noise sensor, smoke sensor, door
sensor, branding kit level. Informs which incident sources are available.

### PropertyBrandProfile
Brand/standardization profile: tier, safety kit installed, evidence protocol enabled,
lock and WiFi standardization. Informs operator autonomy and guest-facing decisions.

### Decision Engine Concepts

| Concept | Values | Role |
|---|---|---|
| `EvidenceConfidence` | `low` / `medium` / `high` | Caller-supplied; reflects photo, video, sensor certainty |
| `CostTier` | `micro` / `minor` / `major` | Caller-supplied; financial magnitude of the incident |
| `GuestTier` | `strict` / `trusted` / `privileged` | Caller-supplied; guest relationship / track record |
| `DelegationLevel` | `soft` / `medium` / `hard` | Operator's autonomy grant to the system |
| `CommunicationMode` | `silent` / `soft` / `warning` / `escalation` | Output posture toward guests/owners/OTAs |
| `RecommendedPayer` | `guest` / `owner` / `insurance` / `operator` / `none` | Advisory financial responsibility |

---

## Flow

```
CleanerIssueReportInput
  → processCleanerIssueReport()
      → IncidentRecord
      → UnitStateIncidentPatch
  → applyIncidentPatchToUnitState()
      → updated UnitState
  → evaluateCheckinReadinessAfterCleanerIncident()
      → canProceed
  → evaluateOpsDecision()
      → OpsDecisionResult
            { blockCheckin, recommendedPayer, communicationMode, escalateToHuman, reasons }
  → CleanerIncidentServiceResult
        { incident, unitStatePatch, nextUnitState, canProceed, decision }
```

Each step is a pure function. No step writes to a database or triggers I/O.

---

## Decision Model

### Safety Block Rules (Hard — Not Overridable)
- `damage` + `severity === 'high'` → always block check-in
- `unauthorized_access` → always block check-in
- Tolerance score and guest tier have no effect on hard safety blocks

### Soft Block Rules (Tolerance-Modifiable)
- `costTier === 'major'` → block
- `damage` + `severity === 'medium'` → block
- `smoking_suspected` + `evidenceConfidence === 'high'` → block
- `excessive_mess` / `party_suspected` → block unless `toleranceScore > 70`
- `noise_violation` + `evidenceConfidence === 'low'` → do not block
- `costTier === 'micro'` → do not block

### Evidence Confidence
Supplied by the caller based on available artifacts (photos, video, sensor logs).
Low confidence may still permit operational blocking but always triggers human
escalation when a block is issued. High confidence unlocks stricter financial
attribution.

### Cost Tiers
- **micro**: Trivial damage; owner absorbs; no communication; no escalation (unless delegation is soft)
- **minor**: Moderate; first-time → owner absorb; repeated with evidence → possible guest liability
- **major**: Significant; high confidence → guest; lower confidence → insurance; always escalates

### Guest Tier Effect
Trusted and privileged guests receive softer communication modes when policy permits.
Guest tier never overrides safety blocking or major-cost escalation.

### Tolerance Score
A reaction modifier in the range 0–100. Interpreted as:
- `0–30`: strict — tightest block and communication thresholds
- `31–70`: balanced
- `71–100`: relaxed — softens non-safety blocks and communication mode

Tolerance score does not modify the incident record, safety rules, or financial logic.

### Delegation Level
Controls how much autonomous action the system takes without human review:
- `soft`: escalates to human for any non-micro incident
- `medium`: escalates only when financial or low-confidence conditions are met
- `hard`: widest autonomy; escalates only for safety-critical or escalation-mode scenarios

---

## Communication Policy

| Mode | When Used |
|---|---|
| `silent` | Micro incidents; first-time trusted/privileged guests in non-strict tolerance bands |
| `soft` | First-time minor incidents; trusted guests in balanced/strict contexts |
| `warning` | Repeated minor incidents |
| `escalation` | Major incidents; OTA cases with `otaCaseRequired`; any scenario requiring human review |

**Log ≠ communicate.** An incident being recorded in the system does not imply any
outbound message is sent. Communication mode is a separate output field and defaults
to silent.

---

## Financial Recommendation Policy

| Scenario | Recommended Payer |
|---|---|
| `costTier === 'micro'` | `owner` (always) |
| `costTier === 'minor'`, first incident | `owner` (absorb) |
| `costTier === 'minor'`, repeated + evidence `medium`/`high` | `guest` |
| `costTier === 'major'`, `evidenceConfidence === 'high'` | `guest` |
| `costTier === 'major'`, lower confidence | `insurance` |

All outputs are recommendations. No charge is initiated by the decision engine.
Downstream operator review is required before any financial action.

---

## Current Code Locations

| File | Role |
|---|---|
| `src/lib/ops/types.ts` | Domain types: `IncidentRecord`, `CleanerIssueReportInput`, `PropertyCapabilities`, `PropertyBrandProfile` |
| `src/lib/ops/mappers.ts` | Pure mappers: cleaner report → incident → unit state patch → readiness |
| `src/lib/ops/incident-service.ts` | Service composer: orchestrates mappers + decision engine, returns full result |
| `src/lib/ops/decision-engine.ts` | Decision engine: `shouldBlockCheckin`, `recommendPayer`, `chooseCommunicationMode`, `shouldEscalateToHuman`, `evaluateOpsDecision` |
| `src/lib/ops/incident-test-harness.ts` | Local harness: scenario runners + `runAllIncidentScenarios` for comparison |
| `src/lib/ops/stay-flow-runner.ts` | Stay lifecycle runner: check-in readiness gating, turnover, auto-advance |

---

## Next Implementation Targets

- **Operator review workflow** — surface escalated decisions to a human-in-the-loop queue
- **OTA/direct dispute routing** — route `escalation`-mode decisions to the appropriate channel based on booking source
- **Sensor ingestion** — normalize noise/smoke/door sensor events into `IncidentRecord` via dedicated mappers
- **Owner onboarding / delegation UI** — allow owners to set tolerance score, delegation level, and brand profile
- **Persistence layer for incidents** — write `IncidentRecord` and `OpsDecisionResult` to a durable store post-decision
- **Dashboard visualization** — surface incident history, decision outcomes, and payer recommendations per property
