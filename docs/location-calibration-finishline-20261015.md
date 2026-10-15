# Location calibration evidence and acceptance — 2026-10-15

Baseline: PR #456, c3cb5d42c910b99eb563e3b37fafeb927d82e256. This change does not modify any historical calibration/golden expectation, numeric threshold, distance decay, weight or strong-verdict requirement.

## Confirmed fixes

The presentation path previously defaulted a single verified business/transit/university anchor to residential audience. Audience type and demand strength are separate: one positive anchor can describe business or mixed demand with the existing fit threshold, while the two-anchor strong-score gate remains. Low-fit, weak-office and mixed industrial context safeguards remain. Cyrillic museum token boundaries now work; qualified museums still require the existing independent tourist cluster, and generic/local museums still fail earlier taxonomy gates.

Focused reproduction initially had four failures out of eight tests. After the fix all eight pass. Historical calibration improves from 32/56 to 44/56 locally. Twelve failures remain deliberately visible, not excluded or re-baselined. Final exact-SHA CI evidence is recorded in the external sprint report.

## Why the remaining fixtures cannot honestly certify geographic acceptance

The 50 named-address scenarios inject headline scores, distances and audience classifications. Magnet coordinates are 0,0 and the scoring trace origin defaults to Saint Petersburg, including Moscow, coastal and Siberian cases. Thus this is presentation-policy calibration, not live geocoding, walking-route, provider-coverage, seasonal occupancy or market-profit calibration.

Remaining failures:

| Cases | Root cause and required evidence |
|---|---|
| Sochi Kurortny50; Nizhny Novgorod Bolshaya Pokrovskaya | Generic theatre has no confirmed city-scale identity. |
| Anapa Pionersky20; Zelenogradsk Kurortny1; Svetlogorsk Lenina8; Gelendzhik waterfront1 | Generic beach/waterfront lacks durable regional resort classification and season evidence; hotel is not a prime substitute. |
| Sheregesh Gagarina12; Esto-Sadok Estonskaya37 | Generic ski-resort name does not prove scale, actual distance or year-round demand. |
| Palace Square2 | Generic museum is filtered; metro alone correctly caps80, conflicting with expected85–100. |
| Samara Leningradskaya25 | Generic museum plus generic shopping centre both lack scale evidence. |
| Moscow Bolshaya Pirogovskaya2 | Generic clinic is local/weak; metro supports mixed, not proven business/medical demand. |
| Explicit tourist88 regression | Generic museum + generic shopping centre cannot justify two prime anchors. |

An official Hermitage source confirms the main museum complex at Palace Square2 (https://www.hermitagemuseum.org/explore/complexes/1, inspected2026-10-15). That validates an address identity, not this fixture's260m distance, two independent qualifying anchors, residential subject suitability, or score range. No place name was swapped merely to force PASS. The ski information portal https://sheregesh.su/news/sezon-2025-2026 describes seasonal lift operations; it is not primary geographic/financial evidence for Gagarina12 and is not used to set weights.

Representative scope already represented by unchanged suites: metropolitan cores, residential neighborhoods, suburban/low-density areas, coastal resorts, ski resorts, smaller cities. Passing synthetic cases do not constitute real-world verification of these markets. Full acceptance requires an approved versioned provider export with object IDs, timestamps, WGS84 subject/anchor coordinates, source tags, route/access barriers, and independent expected outcomes. No such export exists in the supplied fixtures.

## Evergreen, seasonality, suitability and profitability audit

`calcEvergreenIndex` sums category/permanence/distance attractions, subtracts competitor pressure, adds cluster/accessibility and inferred pedestrian-flow signals, then compresses scores above80. It is a bounded structural demand proxy, not an empirical forecast. `location-score.ts` derives seasonality_score from footTraffic.stability01; it has no month-specific occupancy/price history. Resort fame or a permanent physical building does not prove stable annual demand.

The street-retail suitability module separately requires floor/frontage/entrance evidence and gates unknown/below-street premises. Residential and purchase scenarios must not inherit retail suitability from area flow alone. These safeguards remain in regression coverage.

`estimated_monthly_income` uses score-derived RUB price proxies, modeled occupancy and30days. It is gross modeled revenue, not profit: acquisition/rent cost, financing, taxes, fees, vacancy distribution, utilities, maintenance and operational labor are absent. Do not present these outputs as real profitability, valuation or underwriting evidence. This audit changes no commercial promises or numeric model without market evidence.

## Historical access reconciliation

PR456 prevents new caller-controlled included-tier grants but does not retroactively revoke stored entitlements. `planHistoricalAccessReview` is an OFFLINE helper for an explicitly authorized, independently reviewed export. It examines supplied request/report/snapshot links, tier, unlock status and authorization-evidence digest. It outputs hashed grant IDs, reason codes and an evidence-bound manifest hash; it has no database/network writes and grants no authority. Missing evidence means owner review, not fraud or automatic revocation.

Coverage limitation: subject identity, expiration, public capability URLs and all live database records remain outside this helper. NO_FINDING_IN_SUPPLIED_EVIDENCE is neither authorization nor an automatic KEEP decision. Production reconciliation requires approved export, recipient/expiry review, trusted payment/manual grant provenance, and separately approved exact mutation manifest. No export, payment data or production grant was accessed during this sprint.
