# Pricing Intelligence & Tariff Grid Autopilot v1

Foundation for ASI dynamic pricing recommendations. Not a live PriceLabs replacement.

## Audit: current pricing state (pre-v1)

### Already automatic
| Area | Behavior |
|------|----------|
| Property setup `pricing_status` | `base_price_label` → auto `partial` |
| Setup readiness score | `partial` pricing acceptable (10% weight) |
| Channel calendar import | Per-date `price_amount` upserted to `booking_channel_calendar_snapshots` |
| Import conflict detection | `price_missing` flagged automatically |
| Publication package build | Checks and payload derived from setup on build |

### Semi-automatic
| Area | Behavior |
|------|----------|
| `pricing_status: ready` | Manual operator input only |
| Publication pricing check | Requires `ready` + `base_price_label` (stricter than setup) |
| Channel snapshot pricing | Manual JSON upload → auto persist |

### Manual
| Area | Behavior |
|------|----------|
| Base price label | Operator/owner text label in setup metadata |
| `pricing_status: ready` promotion | Explicit payload |
| Market competitor/supply data | Operator manual snapshot (v1) |
| Audience profile | Infer + operator edit |
| Tariff grid approval | Operator review |
| Auto-apply placeholder | Operator marks pilot-ready (no OTA push) |

### Missing (addressed in v1)
| Gap | v1 solution |
|-----|-------------|
| Nightly tariff model | `booking_tariff_grid_days` |
| Audience-aware weights | `booking_property_audience_profiles` + inference |
| Radius market signals | `booking_pricing_market_signals` (1/3/7/10 km) |
| Transparent recommendations | Rule-based engine + `adjustment_reason` |
| Pricing readiness for publication | `buildPricingSnapshotForPublicationPackage` |

### Blocked
| Area | Status |
|------|--------|
| Live OTA price push | `realOtaPublishingEnabled: false` |
| Real external data providers | Placeholder sources only unless configured |
| PriceLabs-level accuracy | Not claimed |
| Sync imported prices → setup profile | Future work |

## Data model

- `booking_pricing_profiles` — strategy, guardrails, readiness
- `booking_property_audience_profiles` — primary/secondary audience + confidence
- `booking_pricing_market_signals` — radius-based signals by date
- `booking_tariff_grid_days` — day-level recommended/final prices
- `booking_pricing_recommendation_runs` — run history

## Recommendation formula v1 (transparent)

Starting from `base_price`, apply multiplicative factors:

1. **Day-of-week** — weekend +8%, Fri +4%
2. **Seasonality** — summer (Jun–Aug) +12%, winter (Dec–Feb) −5%
3. **Competitor median** — ±15% cap vs base, weighted by confidence
4. **Supply** — low availability ratio → up to +10%
5. **Events** — high impact → up to +20%
6. **Weather** — leisure seaside: rain negative; business: neutral
7. **Lead time** — within 7 days +5%, within 3 days +8%
8. **Audience weights** — per-audience multipliers on event/weather/weekend
9. **Strategy** — occupancy_first (−5%), adr_first (+8%), aggressive_growth (+12%), conservative (−8%)
10. **Guardrails** — clamp to min/max; round to nearest 50 RUB

Every change recorded in `adjustment_reason` array.

## Radius support

Manual snapshots and signals: **1, 3, 7, 10 km** only.

## Publication integration

Publication package consumes:
- `pricing_readiness_score`
- `pricing_summary` (strategy + base/min/max)
- `tariff_grid_snapshot` (next 7 days sample)
- Warnings if pricing incomplete

`ready_for_publication` blocked if pricing profile missing or incomplete.

## Auto-apply

`auto_apply_enabled` is a **placeholder** — marks pilot readiness only. No Channel Manager or OTA price push.

## External APIs

v1 makes **no** paid external API calls. Weather/events/market sources are placeholders.
