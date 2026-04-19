# Residential Control Set — Snapshot Report

**Version:** baseline-v2-pass2-strategy (2026-04-19)  
**Runner:** `scripts/residential-validation-runner.ts`  
**Source:** `scripts/residential-control-set-results.json`  
**Cases:** 28 | **Pass:** 28 | **Fail:** 0

Severity key: **[CRITICAL]** wrong on obvious case • **[MEDIUM]** plausible but suspicious • **[MINOR]** design tension, acceptable

---

## Aggregate Model Output Summary

| Output | Values seen |
|--------|-------------|
| audienceType | premium_comfort: 8 · mixed_use_adjacent: 11 · standard_residential: 9 |
| strategy | hybrid: 10 · selective_premium: 6 · cautious: 5 · short_term: 4 · mid_term: 3 |
| opSuit | semi_auto: 17 · manual: 7 · full_auto: 4 |
| confidence | medium: 10 · high: 11 · low: 7 |

---

## Case-by-Case Snapshot

### R01 — Москва-Сити (strong urban core, business)
**Model output:** audienceType=mixed_use_adjacent · strategy=hybrid · opSuit=semi_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | Plausible: elevated friction + score=82 correctly classify this as mixed-use, not premium |
| hybrid | Plausible: elevated env (roads=0.65) blocks short_term even with demand=85 |
| semi_auto + high confidence | Correct: strong signals, but hybrid strategy disqualifies from full_auto |

**Suspicious:** demand=85, seasonality=68 would normally → short_term in a cleaner env. Moscow City getting hybrid is a known design consequence, not a bug per se, but worth watching when env thresholds are tuned.

**Severity:** minor

---

### R02 — Остоженка / Золотая миля (quiet premium)
**Model output:** audienceType=premium_comfort · strategy=selective_premium_short_term · opSuit=full_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct: all low-friction conditions met |
| selective_premium_short_term | ✓ Correct: premium_comfort + friction<28 + score≥56 + stability≥0.50 |
| full_auto + high confidence | ✓ Correct: 8 magnets, audienceFit=58, stable flow, no competitor excess |

**All outputs plausible and expected.** This is the gold standard quiet premium reference.

**Severity:** pass (no issues)

---

### R03 — Люблино, промышленная зона (industrial harsh + high demand)
**Model output:** audienceType=standard_residential · strategy=cautious_manual_only · opSuit=manual · confidence=low

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct: elevated env blocks premium |
| cautious_manual_only | ✓ Correct: elevated + score=58 < 68 threshold |
| manual | ✓ Correct: follows from cautious |
| confidence=low | ⚠ Design note: cautious cap forces score=2→low even though model is quite certain it's a bad location. Semantic ambiguity: "low confidence" here means "don't operate this" not "data is sparse". |

**Suspicious:** confidence=low for demand=75, magnetCount=6, good signal coverage. An operator might interpret "low confidence" as "we don't have enough data" rather than "this is risky". The model is actually highly confident it's a bad location.

**Severity:** minor (design semantic ambiguity — affects all cautious cases)

---

### R04 — СПб, Невский (tourist historic)
**Model output:** audienceType=mixed_use_adjacent · strategy=short_term · opSuit=semi_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct: score=72 + friction=38 ≥ 26 |
| short_term | ✓ Correct: demand=78 + season=85 + moderate env |
| semi_auto | ✓ Correct: friction=38 is exactly at the full_auto threshold (< 38 needed) — borderline but correct |
| confidence=high | ✓ Correct: 9 magnets, strong scores |

**All outputs plausible.** The friction=38 borderline is worth monitoring — any minor env tuning could flip opSuit to full_auto or back.

**Severity:** pass

---

### R05 — Митино (family-friendly district)
**Model output:** audienceType=premium_comfort · strategy=hybrid · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct: all low-friction conditions met, locationScore=55≥48, stability=0.55≥0.48 |
| hybrid | ✓ Correct: locationScore=55 < 56 (selective threshold) + demand=58>52 → hybrid |
| semi_auto | ✓ Correct |

**Known design tension:** premium_comfort audience classified for a location that gets hybrid (not selective) strategy. The explanation is clear (score barely misses 56), but the UI copy "premium comfort audience + hybrid strategy" may feel inconsistent to operators. A user seeing "premium_comfort" would expect a premium-oriented strategy recommendation.

**Severity:** minor (design tension, acceptable at this score)

---

### R06 — Шоссе Энтузиастов (transport-heavy, noisy)
**Model output:** audienceType=mixed_use_adjacent · strategy=cautious_manual_only · opSuit=manual · confidence=low

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct: score=64 + friction=52 |
| cautious_manual_only | ✓ Correct: elevated + score=64 < 68 |
| manual + confidence=low | Same semantic ambiguity as R03 — model is certain about cautious, but signals it as "low confidence" |

**Suspicious:** roads=0.78 alone (very high road burden) should perhaps produce a specific warning. Currently it only contributes to harshUrbanStack and friction score. No specific flagging of "extreme road corridor".

**Severity:** minor

---

### R07 — Щепкина ул. (medical-adjacent)
**Model output:** audienceType=premium_comfort · strategy=selective_premium_short_term · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct: low env, all thresholds pass |
| selective_premium | ✓ Correct: all selective conditions pass at minimum values |
| semi_auto | ✓ Correct: medium confidence disqualifies from full_auto |
| confidence=medium | Plausible: magnetCount=4 and audienceFit=38 are at lower bound — appropriate to not be high |

**Minor design tension:** selective_premium + medium confidence may be counterintuitive. Operators might expect high confidence for a "premium" recommendation. The model correctly reduces confidence due to sparse magnets, but the combination of the two signals could mislead.

**Severity:** minor

---

### R08 — Люберцы, слабый пригород
**Model output:** audienceType=standard_residential · strategy=mid_term · opSuit=manual · confidence=low

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct: locationScore=28 < 48 |
| mid_term | ✓ Correct: demand<52 |
| manual + confidence=low | ✓ Correct: fallback mode + 2 magnets + confidence penalty |

**All correct. Must-pass validated.**

**Severity:** pass

---

### R09 — Коптево (medium residential)
**Model output:** audienceType=standard_residential · strategy=hybrid · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct: moderate env blocks premium |
| hybrid | ✓ Correct: demand=54>52 |
| semi_auto + medium | ✓ Correct |

**Stable medium profile. No issues.**

**Severity:** pass

---

### R10 — Китай-город (nightlife urban contested)
**Model output:** audienceType=mixed_use_adjacent · strategy=hybrid · opSuit=semi_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct |
| hybrid | ✓ Correct: elevated env blocks short_term |
| semi_auto | ✓ Correct |
| confidence=high | ✓ Correct: strong signals (8 magnets, audienceFit=55≥55, evergreenIndex=70≥65) |

**Positive test: nightlife=0.68 alone does NOT trigger cautious (requires double-burden). Validated.**

**Severity:** pass

---

### R11 — Раменки (premium low-demand)
**Model output:** audienceType=premium_comfort · strategy=selective_premium_short_term · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct |
| selective_premium | ✓ Correct: demand not required for selective — env + score qualify |
| semi_auto | ✓ Correct: confidence=medium |
| confidence=medium | Plausible: magnetCount=4, evergreenIndex=60 < 65 |

**Plausible output. Design question:** is selective_premium appropriate when demand is very low (42)? The strategy says "quality-first guests" but the market may not support even selective pricing. This is a valid concern for next pass.

**Severity:** minor

---

### R12 — Внуково (airport zone)
**Model output:** audienceType=standard_residential · strategy=cautious_manual_only · opSuit=manual · confidence=low

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct |
| cautious_manual_only | ✓ Correct: elevated + score=48 < 68 |
| manual + confidence=low | ✓ Correct: cautious cap |

**Aviation burden (0.88) correctly drives high friction → cautious. Must-pass validated.**

**Severity:** pass

---

### R13 — Боткинская (strong medical cluster, quiet)
**Model output:** audienceType=premium_comfort · strategy=selective_premium_short_term · opSuit=full_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct |
| selective_premium | ✓ Correct |
| full_auto | ✓ Correct: confidence=high + selective + friction=18<38 + comp=low |
| confidence=high | ✓ Correct: 7 magnets, audienceFit=52, evergreenIndex=65≥65 |

**Must-pass validated. This is the reference case for selective+full_auto.**

**Severity:** pass

---

### R14 — Тушино / Сходненская (Soviet block)
**Model output:** audienceType=standard_residential · strategy=hybrid · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct: moderate env |
| hybrid | ✓ Correct: demand=56>52 |
| semi_auto + medium | ✓ Correct |

**Stable standard profile. No issues.**

**Severity:** pass

---

### R15 — СПб, Думская (tourist harsh, nightlife-heavy)
**Model output:** audienceType=mixed_use_adjacent · strategy=hybrid · opSuit=semi_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct |
| hybrid | ✓ Correct: elevated blocks short_term |
| semi_auto + high | ✓ Correct |

**Positive test: nightlife=0.72 + industrial=0.10 → NOT cautious (industrial below 0.50 threshold). Also nightlife=0.72 + majorRoad=0.38 → NOT cautious (road below 0.60 threshold). Validated.**

**Severity:** pass

---

### R16 — Арбат (commercial edge)
**Model output:** audienceType=mixed_use_adjacent · strategy=hybrid · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct: score=62 exactly at threshold + friction=28>26 |
| hybrid | ✓ Correct |
| semi_auto + medium | ✓ Correct |

**Boundary test: score=62 and friction=28 are at exact thresholds for mixed_use_adjacent. Worth monitoring across tuning passes.**

**Severity:** pass

---

### R17 — Преображенская (industrial conversion, high gravity)
**Model output:** audienceType=mixed_use_adjacent · strategy=hybrid · opSuit=semi_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct |
| hybrid | ✓ Correct: elevated env + industrial=0.72 alone doesn't trigger cautious |
| semi_auto | ✓ Correct |
| confidence=high | ⚠ Suspicious: industrial=0.72 + elevated env + harshUrbanStack=0.68, yet confidence=high. Strong signal volume (9 magnets, evergreenIndex=70) overwhelms the environmental concerns in the confidence formula. |

**The confidence score doesn't factor in the industrial burden severity directly — it only counts magnets, audienceFit, evergreen, stability, env confidence level, and demand. A location can have very harsh industrial burden but still get high confidence if the demand signals are strong. This is a valid design tension.**

**Severity:** medium (confidence=high on an industrial-conversion contested zone may mislead operators)

---

### R18 — Хамовники (quiet premium, strong demand)
**Model output:** audienceType=premium_comfort · strategy=selective_premium_short_term · opSuit=full_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct |
| selective_premium | ✓ Correct (takes priority over short_term for premium_comfort) |
| full_auto + high | ✓ Correct: all conditions met at strong levels |

**Must-pass validated. Best-in-class quiet premium output.**

**Design note:** this location (demand=80, season=72) would qualify for short_term in isolation, but premium_comfort audienceType redirects it to selective_premium. This is intentional but worth verifying with real operator feedback — does a quiet high-demand location benefit more from selective targeting or general STR?

**Severity:** pass

---

### R19 — Краснодар удалённый (fallback)
**Model output:** audienceType=standard_residential · strategy=mid_term · opSuit=manual · confidence=low

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct |
| mid_term | ✓ Correct |
| manual + confidence=low | ✓ Correct: fallback + 1 magnet |

**Must-pass validated.**

**Severity:** pass

---

### R20 — Бирюлёво (stability=0.47, cliff edge)
**Model output:** audienceType=standard_residential · strategy=hybrid · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct: stability=0.47 just below 0.48 threshold |
| hybrid | ✓ Correct |
| semi_auto + medium | ✓ Correct |

**This case documents the cliff effect.** A stability change of 0.01 (from 0.47 to 0.48) switches audienceType from standard_residential to premium_comfort, and potentially triggers selective_premium_short_term. This is the most sensitive threshold in the model. Any tuning of stability parameters must be verified against R20 and R26.

**Severity:** minor (by design, but cliff noted)

---

### R21 — Покровка (premium area, weak demand)
**Model output:** audienceType=premium_comfort · strategy=mid_term · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct: env is low, all thresholds pass |
| mid_term | ✓ Correct: locationScore=55 < 56 (selective miss) + demand=42<52 |
| semi_auto | ✓ Correct |

**Known design tension:** premium_comfort audience + mid_term is confusing messaging. An operator reading "premium_comfort (comfort-sensitive guests)" + "mid_term recommended" would likely question the combination. The model is internally consistent, but the copy needs to handle this case explicitly.

**Severity:** minor

---

### R22 — Тверская (dense business cluster)
**Model output:** audienceType=mixed_use_adjacent · strategy=short_term · opSuit=full_auto · confidence=high

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct |
| short_term | ✓ Correct: demand=88>72 + season=75>60 + moderate env (not elevated) |
| full_auto + high confidence | ✓ Correct: all full_auto conditions met |

**Must-pass validated. This is the reference case for short_term + full_auto on a business cluster.**

**Severity:** pass

---

### R23 — Таганская (nightlife + road double burden)
**Model output:** audienceType=mixed_use_adjacent · strategy=cautious_manual_only · opSuit=manual · confidence=low

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct |
| cautious_manual_only | ✓ Correct: nightlife=0.55>0.50 + majorRoad=0.72>0.60 = double burden |
| manual + confidence=low | Same cautious-cap semantic ambiguity as R03, R06 |

**Must-pass validated. Double-burden logic verified.**

**Severity:** pass (with cautious-cap semantic note)

---

### R24 — Щёлковское ш. (good transit, average)
**Model output:** audienceType=standard_residential · strategy=hybrid · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| All outputs | ✓ Plausible, stable standard profile |

**Baseline reference for a plain residential case.**

**Severity:** pass

---

### R25 — Охотный ряд (center crossover) ✓ pass-2
**Model output:** audienceType=mixed_use_adjacent · strategy=short_term · opSuit=semi_auto · confidence=high

**Expected:** strategy=short_term (gates all pass)

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct |
| short_term | ✓ Elevated urban-core path: joint score floor, industrial/nightlife/road guards, transit or contained harsh-urban stack |
| semi_auto | ✓ Friction 40 ≥ full_auto threshold (38); competitor high — appropriate |
| confidence=high | ✓ Strong magnets and fit |

**Note:** `high` concern level still blocks this override; double-burden cautious cases remain unchanged.

---

### R26 — Кунцево (stability=0.50, selective boundary)
**Model output:** audienceType=premium_comfort · strategy=selective_premium_short_term · opSuit=semi_auto · confidence=medium

| What the model produced | Assessment |
|------------------------|------------|
| premium_comfort | ✓ Correct: stability=0.50 ≥ 0.48 (inclusive) |
| selective_premium | ✓ Correct: stability=0.50 ≥ 0.50 (inclusive) |
| semi_auto + medium | ✓ Correct |

**Boundary inclusivity verified. R26 and R20 together document the stability cliff.**

**Severity:** pass

---

### R27 — Адлер / Сочи (resort seasonal) ✓ pass-2
**Model output:** audienceType=standard_residential · strategy=short_term · opSuit=semi_auto · confidence=high

**Expected:** strategy=short_term, opSuit=semi_auto (gates all pass)

| What the model produced | Assessment |
|------------------------|------------|
| standard_residential | ✓ Correct: stability=0.38 < 0.48 threshold |
| short_term | ✓ Low-friction seasonal lift (seasonality ≥ 90, demand 68–71 band) |
| semi_auto | ✓ short_term + stability01 < 0.42 forces semi_auto (volatile resort flow) |
| confidence=high | ✓ Magnets + audience fit support the call |

---

### R28 — Лефортово (industrial conversion, elevated)
**Model output:** audienceType=mixed_use_adjacent · strategy=cautious_manual_only · opSuit=manual · confidence=low

| What the model produced | Assessment |
|------------------------|------------|
| mixed_use_adjacent | ✓ Correct: score=62 + friction=44 |
| cautious_manual_only | ✓ Correct: elevated + score=62 < 68 |
| manual + confidence=low | ✓ Correct: cautious cap |

**Correct output. Industrial conversion with elevated env correctly gets cautious.**

**Severity:** pass

---

## Cross-Archetype Observations

### Archetypes that behave most consistently
1. **Quiet premium (R02, R13, R18):** All three produce the right audienceType + selective_premium + full_auto or semi_auto. The premium_comfort path is reliable.
2. **Weak suburb / fallback (R08, R19):** Both correctly produce mid_term + manual + low confidence. Fallback protection works.
3. **Double-burden cautious (R23):** nightlife + road double-burden correctly triggers cautious. The logic is precise.
4. **Strong business cluster (R22):** short_term + full_auto + high confidence. The best-case STR path is functional.

### Archetypes with recurring issues
1. **Elevated env + high demand:** Blanket short_term block for all elevated locations (R01, R10, R15, R25). Moscow center (R25) is the most egregious — score=88 gets hybrid.
2. **premium_comfort + non-selective strategy:** R05 (premium + hybrid), R21 (premium + mid_term) create audience-strategy mismatch in copy.
3. **Resort / seasonal profile:** R27 shows the model doesn't handle high-seasonality low-stability locations correctly.
4. **Cautious confidence semantics:** All cautious cases (R03, R06, R12, R23, R28) get confidence=low, which conflates "model certainty about risk" with "data sufficiency".

### Threshold sensitivity (cliff effects)
- **stability=0.47 vs 0.48 (R20 vs R26):** audienceType flip
- **locationScore=55 vs 56 (R05):** selective threshold miss
- **friction=38 vs <38 (R04):** full_auto threshold boundary
- **majorRoads=0.60 (R15 vs R23):** road burden threshold for cautious

---

## Issues Ranked by Impact

| Rank | Issue | Affected Cases | Severity |
|------|-------|---------------|----------|
| 1 | Elevated env blanket blocks short_term | R01, R10, R15, R25 | Critical (R25) |
| 2 | Seasonal override missing for resort zones | R27 | Medium |
| 3 | confidence=high on R17 (industrial conversion) | R17 | Medium |
| 4 | premium_comfort + non-selective strategy mismatch in copy | R05, R21 | Minor |
| 5 | cautious_manual_only → confidence=low semantic ambiguity | R03, R06, R12, R23, R28 | Minor |
| 6 | Stability cliff (0.47 vs 0.48) | R20, R26 | Minor (by design) |
| 7 | selective_premium + medium confidence mismatch in copy | R07, R11, R26 | Minor |
