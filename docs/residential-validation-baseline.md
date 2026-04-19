# Residential Validation — Baseline Pass

**Version:** baseline-v3-pass3-confidence-rationale (2026-04-19)  
**Control set:** 28 cases (`docs/residential-control-set-definition.md`)  
**Gate results:** 28/28 pass · 0 known gaps  
**Runner output:** `scripts/residential-control-set-results.json`

**Pass-2 change:** `short_term` no longer uses a blanket `!isElevatedOrHigh` veto. Elevated urban cores can qualify via a guarded composite (demand + centrality + seasonality + audience fit, with industrial/nightlife/road/stack gates). Resort-like cases use a narrow low-friction seasonality lift when demand sits just under the normal STR floor.

**Pass-3 change:** Residential `confidence` uses explicit signal-clarity, burden-stacking, cross-score consistency, and post-calibration caps (`hybrid` + elevated without prime-core exception → at most `medium`; industrial / harsh-stack ceiling). `strategyRationaleRu` is archetype- and strategy-aware and ties to blockers, strengths, and confidence tier.

This document records the state of the residential model as a fixed starting point. Future passes compare against this baseline.

---

## 1. Which Archetypes Already Behave Plausibly

### Strongest (fully verified, no issues)

**Quiet premium → selective_premium → full_auto (R02, R13, R18)**  
The premium_comfort path is well-calibrated. All three cases correctly classify the audience, select selective_premium_short_term, and reach full_auto when confidence is high. The conditions (friction < 28, low nightlife/industrial/roads, stability ≥ 0.50, locationScore ≥ 56) are specific enough to avoid false positives.

**Weak suburb / fallback → mid_term → manual (R08, R19)**  
Fallback protection works correctly. When magnetCount ≤ 2 and isFallbackMode=true, the model reliably produces confidence=low and operationalSuitability=manual. No cases of overconfident output on sparse data were found.

**Double-burden cautious → cautious_manual_only → manual (R23)**  
The nightlife+road double-burden logic (nightlife > 0.50 AND majorRoads > 0.60) correctly triggers cautious_manual_only. R23 is the main validation case: both thresholds hit, strategy is cautious, and the gate passes.

**Dense business cluster → short_term → full_auto (R22)**  
The optimal STR path (short_term + full_auto + high confidence) fires correctly for a moderate-friction business cluster with strong demand. Elevated friction is handled selectively: R22 stays on the classic non-elevated short_term path; R25 uses the elevated urban-core override; fragile elevated cases (R06, R12, R28) stay cautious.

**Single nightlife burden does NOT trigger cautious (R10, R15)**  
A key regression guard: nightlife alone (without industrial or road co-burden) does not produce cautious_manual_only. R10 (nightlife=0.68, no industrial) and R15 (nightlife=0.72, road=0.38<0.60) both correctly stay on the hybrid path.

**Fallback mode blocks premium_comfort (R08, R19)**  
When locationScore < 48 or stability < 0.48, premium_comfort does not fire — even in low-friction environments. Confirmed by R08 (score=28, stable=0.32) and R19 (score=35, stable=0.30).

---

## 2. Closed in baseline-v2 (pass-2 strategy)

| Former issue | Resolution in code |
|--------------|-------------------|
| Blanket `!isElevatedOrHigh` veto on `short_term` | `elevatedUrbanCoreAllowsShortTerm`: **elevated only** (never `high`), joint location+demand floor, industrial/nightlife/road/stack gates, transit-or-contained-stack requirement |
| R27 under-classification | `lowFrictionSeasonalShortTermEligible`: seasonality ≥ 90, demand in **[68, 72)**, friction < 32, non-elevated |
| Resort ops over-automation risk | `computeOperationalSuitability`: `short_term` + **stability01 < 0.42** → **semi_auto** |

## 2b. Closed in baseline-v3 (pass-3 confidence + rationale)

| Former issue | Resolution in code |
|--------------|-------------------|
| R17 overconfident `high` on industrial conversion hybrid | Burden-axis stacking, industrial / harsh-stack ceiling, and hybrid+elevated cap (unless `hybridElevatedPrimeCoreException`) |
| R10 / R15 «фальшивый high» на elevated hybrid | Same hybrid+elevated cap; prime-core exception preserves R01 |
| Generic one-line strategy rationale | `buildStrategyRationaleRu`: audience + scores + optional aggressive-blocker sentence + confidence phrase |

---

## 3. Remaining follow-ups (unchanged from v1 notes)

### Gap A: confidence=low for all cautious_manual_only cases — semantic mismatch

All five cautious cases (R03, R06, R12, R23, R28) produce confidence=low by design (cautious cap). Operators may read this as sparse data rather than deliberate risk certainty.

### Gap B: premium_comfort + non-selective strategy (R05, R21)

Comfort-first audience label with hybrid/mid_term strategy — copy layer should explain the tension.

---

## 4. Historical v1 — “What to Fix in the Next Pass” (archived)

The following was the **pre-pass-2** plan; items 1–2 are implemented as §2 above.

**Target 1: Fix R25 (elevated env + high-score short_term override)** — done with guarded composite instead of a single score threshold.

**Target 2: Fix R27 (seasonal override for short_term)** — done with narrow seasonal lift + stability-based semi_auto.

### Original draft (v1) for Target 1:

Add a high-confidence override to the short_term condition:
```typescript
// Proposed: allow short_term when score is exceptional regardless of friction
const exceptionalSignals = locationScore >= 82 && demandScore > 80 && !isFallbackMode;
if (demandScore > 72 && seasonalityScore > 60 && (!isElevatedOrHigh(level) || exceptionalSignals)) {
  return 'short_term';
}
```
Verify: R25 now passes. R22 unchanged. R01 (score=82, demand=85) — decision: should this also get short_term? Check gate suite. R10 (score=70) — stays hybrid (below 82 threshold). R15 (score=75) — stays hybrid.

**Target 2: Fix R27 (seasonal override for short_term)**

Add a seasonality-based override:
```typescript
// Proposed: resort override when seasonality is extreme
const highSeasonality = seasonalityScore >= 85 && demandScore >= 65;
if ((demandScore > 72 || highSeasonality) && seasonalityScore > 60 && !isElevatedOrHigh(level)) {
  return 'short_term';
}
```
Verify: R27 now passes. R09 (season=50, demand=54) — unchanged. R14 (season=48) — unchanged.

**Target 3: Improve confidence semantics for cautious cases**

Consider a separate confidence path for cautious locations:
```typescript
// Instead of forcing confidence=low, expose why:
// Option A: use 'medium' for cautious when signal strength is high, add explicit warning
// Option B: add a new field 'riskConfidence' distinct from 'dataConfidence'
```
This is a design change that requires discussion. For now, document the semantic mismatch and add copy clarification.

**Target 4: Penalize industrial burden in confidence (R17)** — implemented in pass-3 (industrial ceiling + burden axes + hybrid/elevated cap).

---

## 5. Framework Usability Assessment

**Is this framework usable as a baseline for next passes?** Yes.

- The control set is fixed and representative (28 cases, 12 archetypes)
- The runner is fully repeatable and produces deterministic output (pure function, no live API calls)
- The JSON output is structured for before/after comparison
- The regression gates define clear pass/fail criteria
- The snapshot documents the current state of each case with severity levels

**What this framework enables for pass 2:**
1. Run the runner before changes → save as baseline
2. Make targeted changes to `residential-analysis.ts`
3. Run the runner again → compare
4. Check that no must-pass cases regressed
5. Verify that R25 or R27 moved from fail to pass (if that was the target)
6. Document changes and update snapshot

**What this framework does NOT cover:**
- Live OSM data quality (the runner uses synthetic fixtures; real locations may have different raw data)
- Edge cases not yet in the control set (e.g., mountain resorts, cruise ports, student neighborhoods)
- Long-term stability across model version changes (needs a versioned archive strategy)

**Next step after pass 2 fixes:** expand the control set with 5–10 new cases targeting the fixed archetypes, then re-establish baseline.
