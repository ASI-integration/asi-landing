# Residential Regression Gates

**Version:** baseline-v2-pass2-strategy (2026-04-19)  
**Applies to:** `buildResidentialAnalysis` in `src/lib/location/residential-analysis.ts`  
**Runner:** `npx tsx scripts/residential-validation-runner.ts`

---

## 1. What Counts as a Regression

A **regression** is any change to the model that causes a previously-passing case in the control set to fail its gate criteria — specifically one or more of:

- `audienceType` mapped incorrectly (wrong bucket for the archetype)
- `strategy` mapped incorrectly (wrong tier for the archetype)
- `operationalSuitability` mapped incorrectly (e.g., manual → semi_auto on a known-risky location)
- `confidence` mapped incorrectly (e.g., high → medium on a must-pass case)

A regression is **confirmed** when a case that previously passed now fails, AND the failure is not covered by a stated known gap or a deliberate design change documented in the same PR.

---

## 2. What Counts as Acceptable Change

An acceptable change is one that:

1. **Fixes a documented gap** (e.g. former R25/R27) without breaking previously-passing cases
2. **Improves a must-pass case** (e.g., R02, R08, R13, R18, R22 all continue to pass)
3. **Moves an ambiguity case** in a defensible direction with a written rationale
4. **Adjusts a threshold** where the control set snapshot documents that the old value was a cliff-effect artifact (stability=0.47/0.48, friction=38 boundary)
5. **Reduces pass count by 0** — all changes must be pass-neutral or pass-positive

---

## 3. What Counts as Improvement

An improvement is one that:

1. **Keeps R25 (Moscow center crossover) on short_term** when elevated env is offset by demand/centrality (resolved pass-2)
2. **Keeps R27 (resort seasonal) on short_term** via controlled seasonality lift (resolved pass-2)
3. **Reduces cliff severity at stability thresholds** without breaking R02, R07, R13, R18, R26
4. **Addresses premium_comfort + non-selective mismatch** (R05, R21) without regressing R11 or R07
5. **Maintains or improves pass count** from the current baseline of **28/28**

---

## 4. Critical Errors (Immediate Blockers)

Any model change that produces the following is a **critical regression** and must be reverted before merge:

### 4.1 Wrong strategy on obvious cases

| Case | Must produce | Never produce |
|------|-------------|---------------|
| R02 (Остоженка, quiet premium) | selective_premium_short_term | hybrid, mid_term, cautious |
| R08 (Люберцы weak suburb) | mid_term | short_term, selective_premium |
| R13 (Боткинская cluster) | selective_premium_short_term | hybrid, mid_term, cautious |
| R18 (Хамовники strong premium) | selective_premium_short_term | hybrid, mid_term, cautious |
| R22 (Тверская dense business) | short_term | cautious, mid_term |
| R23 (Таганская double burden) | cautious_manual_only | short_term, selective_premium, hybrid |

### 4.2 False premium_comfort on a known-noisy case

Premium_comfort must NEVER fire when `concernLevel` is elevated or high. Specifically:

- R03, R06, R10, R12, R15, R23, R25, R28 must NEVER produce `audienceType=premium_comfort`

### 4.3 Wrong operationalSuitability on weak/risky cases

| Case | Must produce | Never produce |
|------|-------------|---------------|
| R08 (Люберцы weak suburb, confidence=low) | manual | full_auto, semi_auto |
| R19 (Краснодар fallback) | manual | full_auto, semi_auto |
| R03 (industrial harsh) | manual | full_auto, semi_auto |
| R12 (airport zone) | manual | full_auto, semi_auto |
| R23 (double burden) | manual | full_auto, semi_auto |

### 4.4 Overconfident output on weak/proxy cases

`confidence=high` must NEVER fire when:

- `isFallbackMode=true` (R08, R19 must stay ≤ medium)
- `magnetCount ≤ 2` (R08, R19 must stay ≤ low)
- `strategy=cautious_manual_only` (all cautious cases must stay at low)

### 4.5 Tourist-heavy + weak-for-living cases getting premium

R04 (Невский), R15 (Думская) — `audienceType` must remain `mixed_use_adjacent`, never `premium_comfort`. If env tuning changes friction scores and these drop below 26 while staying elevated, the audienceType gate will catch it.

### 4.6 Noisy harsh urban getting over-optimistic strategy

| Case | Strategy upper bound |
|------|---------------------|
| R03 (industrial harsh) | max = cautious_manual_only |
| R06 (transport heavy) | max = cautious_manual_only |
| R12 (airport zone) | max = cautious_manual_only |
| R23 (nightlife+road) | max = cautious_manual_only |
| R28 (industrial mixed) | max = cautious_manual_only |

---

## 5. Must-Pass Cases (Zero Ambiguity)

These 6 cases must always pass all 4 gates. Any failure here is a critical blocker:

| Case | Archetype | Full expected output |
|------|-----------|---------------------|
| **R02** | Quiet premium | premium_comfort · selective_premium · full_auto · high |
| **R08** | Weak suburb | standard_residential · mid_term · manual · low |
| **R13** | Medical cluster quiet | premium_comfort · selective_premium · full_auto · high |
| **R18** | Strong quiet premium | premium_comfort · selective_premium · full_auto · high |
| **R22** | Dense business cluster | mixed_use_adjacent · short_term · full_auto · high |
| **R23** | Double burden cautious | mixed_use_adjacent · cautious · manual · low |

---

## 6. Ambiguity-Allowed Cases

These cases have multiple defensible outputs. Gate failures here are **non-blocking** but must be documented with rationale:

| Case | Allowed ambiguity |
|------|------------------|
| R04 | opSuit: semi_auto or full_auto (friction=38 is exactly at boundary) |
| R05 | strategy: hybrid or selective_premium (score=55 is borderline — acceptable either way if rationale given) |
| R07 | confidence: medium or high (sparse magnets vs quiet env — either defensible) |
| R11 | confidence: medium or high (weak magnets vs good env signals) |
| R15 | strategy: hybrid (nightlife-led elevated — must not drift to short_term) |
| R21 | strategy: mid_term or hybrid (demand=42 is below hybrid threshold=52, so mid_term is correct by design) |

---

## 7. Former Known Gaps (resolved pass-2)

| Case | Issue (baseline-v1) | Resolution |
|------|---------------------|------------|
| R25 | `!isElevatedOrHigh` blanket blocked short_term | Selective **elevated-only** urban-core STR path with demand/centrality/industrial/nightlife/road guards |
| R27 | Demand floor 72 ignored seasonality 92 | **Low-friction seasonal lift** band (demand 68–71, seasonality ≥ 90) + **stability < 0.42 → semi_auto** for short_term ops |

---

## 8. Gate Evaluation Protocol

Run after EVERY change to `residential-analysis.ts`:

```bash
npx tsx scripts/residential-validation-runner.ts
```

**Pass criteria:**
- `passCount === 28` (full control set)
- `unexpectedFailIds` is empty (no intentional failing cases)
- All 6 must-pass cases show `allPass: true` in JSON output
- No critical errors from Section 4

**Improvement criteria (for a successful tuning pass):**
- `passCount` remains 28 and must-pass cases still pass
- `unexpectedFailIds` is empty

**Compare two passes:**
```bash
# Save current baseline
cp scripts/residential-control-set-results.json scripts/residential-control-set-results-baseline.json

# After changes, run and compare
npx tsx scripts/residential-validation-runner.ts
node -e "
  const a = require('./scripts/residential-control-set-results-baseline.json');
  const b = require('./scripts/residential-control-set-results.json');
  b.results.forEach((r, i) => {
    const prev = a.results[i];
    const diffs = [];
    if (r.output.residentialAudienceType !== prev.output.residentialAudienceType)
      diffs.push('audience: ' + prev.output.residentialAudienceType + ' -> ' + r.output.residentialAudienceType);
    if (r.output.residentialStrategy !== prev.output.residentialStrategy)
      diffs.push('strategy: ' + prev.output.residentialStrategy + ' -> ' + r.output.residentialStrategy);
    if (r.output.operationalSuitability !== prev.output.operationalSuitability)
      diffs.push('opSuit: ' + prev.output.operationalSuitability + ' -> ' + r.output.operationalSuitability);
    if (r.output.confidence !== prev.output.confidence)
      diffs.push('conf: ' + prev.output.confidence + ' -> ' + r.output.confidence);
    if (diffs.length > 0)
      console.log(r.id + ' (' + r.archetype + '):', diffs.join(', '));
  });
"
```

---

## 9. Change Classification Matrix

| Change to residential-analysis.ts | Expected effect | Gate behavior |
|-----------------------------------|----------------|---------------|
| Raise short_term demand threshold (e.g., >72 → >75) | R04, R22 may lose short_term | BLOCKER if R22 fails |
| Lower short_term demand threshold (e.g., >72 → >68) | R27 may gain short_term | IMPROVEMENT if R27 fixed |
| Add `locationScore ≥ N` override for short_term on elevated env | R25 may gain short_term | IMPROVEMENT if R25 fixed |
| Raise selective locationScore threshold (e.g., ≥56 → ≥60) | R07, R11 may lose selective | Non-blocking if ambiguity-allowed |
| Lower selective locationScore threshold (e.g., ≥56 → ≥52) | R05, R20 may gain selective | Flag: verify R20 expected standard |
| Change stability threshold for premium_comfort (0.48 → X) | R20/R26 cliff position shifts | Check both cases |
| Change cautious elevated threshold (score < 68 → score < N) | R06, R28 may change strategy | BLOCKER if R23 loses cautious |
| Change friction threshold for full_auto (< 38 → < N) | R04, R13, R22 opSuit may change | BLOCKER if R02/R13/R18 lose full_auto |
| Add seasonality override for short_term | R27 may gain short_term | IMPROVEMENT target |
| Change confidence score formula | Multiple cases affected | Run full gate suite |
