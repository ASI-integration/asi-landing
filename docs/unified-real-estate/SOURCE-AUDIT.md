# Course source audit and adoption decisions

Review date2026-10-15. User-provided archive SHA256 `cbc550bb2fd6ca8d12fe5cc1de39871b06c89954fd44c98247c92215b77361ca`. Private source files are not included in this PR. Source IDs C00–C62 map to ZIP entry order and individual digests in the private inventory. External videos/linked spreadsheets not contained in the archive were not silently treated as read.

Coverage:58 PDFs/580 pages, including one byte-identical15-page duplicate C55=C52;565 unique PDF pages inspected with full extracted text and page contact sheets, with selected financial tables enlarged. Five legacy DOC files opened read-only with macros/external links disabled:21 Word-computed pages and19 tables. Page count depends on Word pagination. No claim that contact-sheet inspection authenticates signatures, cadastral documents or tiny embedded screenshots. Sensitive16-page financial subset was inspected privately; temporary rendered images and DOC text with example personal data were removed after anonymized notes. The original archive remains unchanged.

| Coverage group | Files/pages | Review artifact in private evidence bundle |
| --- | --- | --- |
| Core course C06–C38, excluding sensitive samples |27PDF/143pages | independent-course-C06-C38.json/.md |
| Later modules C39–C62 excluding root subset |18PDF/349pages,334unique | course-later-review.json/.md; C55 duplicate verified by hash |
| Geometry/location/comparables core C46,C47,C49,C50,C53,C58 |6PDF/72pages | root-course-review.json/.md |
| Financial samples C04,C07,C11,C12,C16,C19,C21 |7PDF/16pages | sensitive-course-review.json/.md |
| Safety DOC C00,C01,C02,C03,C05 |5DOC/21computedpages | root-course-review.json/.md; doc-read.json |

## What is reusable

Course material supports a useful requirements taxonomy: compare whole and subdivided leases, preserve frontage, plan unequal units around entrances/columns/wet cores, distinguish utility metering and common-area allocation, screen tenant requirements, calculate fit-out cost and cash timing, document handover condition and lease obligations. These become inspectable inputs and scenario tests, not hard-coded market truth or current legal advice.

C50pp8–14 and C53p4 explicitly support unequal subdivision and circulation costs. C58pp4–13 shows irregular drawings, windows, walls and scale-sensitive layout work. C46pp1–12 and C47pp1–7 motivate comparable-property normalization but do not supply verified current lease transactions. C49pp4–9 provides a sample-counting procedure whose sampling limitations must remain visible. C33's two alternative plans illustrate why all financial outputs must recalculate when assumptions change.

## Financial and technical reconciliation

| Source/page | Independently checked observation | Product decision |
| --- | --- | --- |
| C49p5 |33×6=198 and66×6=396; average297. Printed intermediate200+300 conflicts with illustrated600 sum; rounded200+400 yields300 | Keep observed counts/sample duration; extrapolation is not all-day measured footfall |
| C49pp6–9 |10m observation zone, opposite-side exclusions,0.5 corner factor, household-unit vs-person counting | Store station geometry/direction/denominator; factors are course heuristics, not observed people/hour |
| C50p3 |200×1500=300000;50×3000=150000;10×5000=50000 | Examples show size/rent tradeoff, not universal rent schedule |
| C50p8 |103m²=3common+15+25+60 | Preserve common space and unequal areas |
| C53p4 |150=70+45+32+3common; gross417500, head rent300000, spread117500,28.14%gross | Spread excludes capex/opex/tax/vacancy; not net yield |
| C33p3 model1 |205m²=196rentable+9common;637100−358750=278350,43.69%gross | Recompute from inputs, keep common area non-rentable |
| C33p3 model2 |205=195rentable+10common;547500−358750=188750,34.47%gross | Compare both with identical financial basis |
| C33p5 |Head rent changes to1600×205=328000 but old profit retained. Correct spreads309100 and219500 | Proven stale-formula defect in source; deterministic regression prevents carrying cached profit |
| C33p5 |268people/h checked against≥300 criterion | Checklist contradiction; source does not establish threshold or passing observation |
| C23p1 |Missing February readings encoded as0 yield negative consumption; January allocation residual0.14 | Unknown is not zero; reconciliation residual needs explicit policy |
| C19p1 |Header/table periods disagree;1563.20×9.29=14522.128 vsdisplay14910.16;8.615×27.60=237.774 vsdisplay407.38 | Printed values not reproducible from visible inputs; original formula unknown, do not invent correction |
| C11pp1–10 |Upstream water totals1130.66 vsowner invoice1130.61 |0.05 unresolved reconciliation difference, preserve source discrepancy |
| C04/C21; C12/C16 |Invoice/act pairs repeat29165.31 and18289.20 respectively | Same obligation must not become duplicate expense/income |
| C40p17 |7.42×1.2=8.904; rounded8.90×1173.7=10445.93 vsunrounded10450.6248 | Explicit tariff/VAT rounding sequence; historical example not current tax rule |
| C52p13 |300000×120=36m;450000×120=54m;18m difference | Assumed capitalization uplift, not realized exit gain |
| C52p14 |36m acquisition,11m equity+25m debt;18−6.25−0.75−1.65=9.35m;9.35/11=85% | Financing/tax/exit assumptions unverified; not guaranteed return |
| C52p6 |100–150k monthly versus2.5–5m capital spans24–72% annual simple gross pairings |≥60% annual marketing claim not generally implied |
| C54/C56/C60 |Tenant refundable deposits reduce purported net investment towardzero | Deposit liabilities cannot manufacture ROI or eliminate required equity reserve |
| C58p10 |4.30×4.30=18.49m² | Pixels imply metres only with verified scale; drawings are not survey evidence |
| C50p7 |Window≥50% comparison mixes potentially different dimensional quantities | Keep frontage length, glazing area and floor area separately typed |
| C50pp9–14 |Width/depth and1.5/2.5m corridor heuristics | Not encoded as legal or evacuation approval |
| C53pp8,12 |150W/m² example=15kW/100m²; independent ventilation discussed | Capacity/ventilation require actual technical documentation and use-specific verification |
| C61pp18,29 |Diagram80m² no-window/backyard description conflicts with frontage narrative | Retain contradiction; no favorable attribute inferred |

Other reviewed finance and operational examples are retained in the per-module private reviews with page references. Images of plans and tables explain methodology; they are not independent proof of measured area, current rent, sales or engineering compliance.

## Historical safety and law

DOC C00 has a2022 instruction date and2021 example rows; C01 is a2017 alarm-log example; C02 contains14 tables covering fire systems/equipment and historic frequencies; C03 is a7-page industrial briefing template with dated emergency guidance; C05 is a2022 commissioning sample with inconsistent participant roles. None is evidence that an actual property is commissioned, compliant or maintained. Do not deploy old templates as current safety instructions.

Limited official-source spot verification accessed2026-10-15:
- FNS publication dated2025-12-30, https://www.nalog.gov.ru/rn77/news/activities_fts/16594137/ states2026 changes including20m RUB prior-year USN VAT threshold and general22/10/0 or special5/7 rates. Page itself carries an archival warning. This establishes that historical course VAT assumptions cannot be universal defaults; it is not a complete current taxpayer-specific opinion.
- MChS regional official notice https://23.mchs.gov.ru/deyatelnost/press-centr/anonsy/5478761 states a new training order effective2025-09-01. Historical training templates require current specialist review; this sprint does not determine all applicable fire standards.
- Current evacuation-width/application rules and property-specific legal suitability were not established. Remain UNKNOWN; no unsupported statutory constants introduced.

## Excluded advice and evidence hierarchy

Do not automate sham competing offers, mislabel sublease as direct lease, manipulate listing area, impersonate buyers/tenants, conceal defects or rely on enforcement delay to avoid approvals. C30pp3–4 non-ceiling-partition approval shortcuts and C62p33/C56 misleading marketing examples are not product features. Crossed-out negative examples are interpreted as such, not endorsements.

Priority: authenticated property-specific legal/technical evidence and measured current observations; then dated verifiable market comparables; then explicit owner declarations; then calibrated models; then labeled course heuristics. Synthetic fixtures demonstrate arithmetic only. A course anecdote cannot establish pedestrian traffic, tenant commitment, legal eligibility or profit. Source omissions and contradictory figures remain visible acceptance blockers.
