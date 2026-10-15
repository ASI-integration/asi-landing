import type { LocationAnalysis, MagnetItem, NeighborhoodEnvironmentLayer } from '../../location/types';
import { describe, expect, it } from 'vitest';
import { validateProperty, type SharedProperty, type ScenarioContext } from '../contracts';
import { ledger, npv, conventionalAnnualIrr, type Economics } from '../cashflow';
import { enumerateLayouts, type FloorPlan } from '../layouts';
import { commercialScenarios, residentialScenario, meterCharge, sampledFootfall, type TenantCategory } from '../scenarios';
const envStub: NeighborhoodEnvironmentLayer = {
    environmentalFrictionScore: 20,
    concernLevel: 'low',
    concernLabelEn: 'low',
    concernLabelRu: 'низкий',
    reasonsEn: [],
    reasonsRu: [],
    environmentNarrativeEn: '',
    environmentNarrativeRu: '',
    confidence: 'high',
    breakdown: {
        industrial01: 0.1,
        transitCorridor01: 0.1,
        majorRoads01: 0.1,
        nightlife01: 0,
        aviation01: 0,
        harshUrbanStack01: 0,
    },
};
function magnet(partial: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId'>): MagnetItem {
    const categoryId = partial.categoryId;
    return {
        categoryLabel: partial.categoryLabel ?? categoryId,
        name: partial.name ?? 'Anchor',
        icon: partial.icon ?? '•',
        distance: partial.distance ?? 200,
        lat: partial.lat ?? 55.75,
        lon: partial.lon ?? 37.61,
        weight: partial.weight ?? 5,
        strengthClass: partial.strengthClass ?? 'medium',
        permanenceType: partial.permanenceType ?? 'permanent',
        attractionScore: partial.attractionScore ?? 12,
        scopeLevel: partial.scopeLevel ?? 'local',
        ...partial,
        categoryId,
    };
}
function strongFlowAnalysis(): LocationAnalysis {
    return {
        evergreenIndex: 72,
        scoreBand: 'strong',
        magnets: [magnet({ categoryId: 'shopping_major', name: 'ТЦ' })],
        magnetCountByCategory: {},
        accessibilityStops: [],
        competitors: [],
        gravityExplanation: {
            dominantMagnets: [],
            strongestZoneLabel: '',
            competitorPressureLevel: 'medium',
            demandDistribution: 'concentrated',
            demandType: 'tourism-led',
            clusterDetected: true,
            clusterSize: 4,
            scoreBreakdown: { attraction: 40, competitorPressure: 5, clusterBonus: 8, trafficBoost: 6 },
        },
        demandType: 'tourism-led',
        strongestMagnets: [],
        clusterZones: [],
        splitDemand: false,
        competitorPressure: 5,
        footTraffic: {
            modifierTier: 'strong',
            boostPoints: 8,
            movementDensity: 'high',
            zoneActivity: 'busy',
            flowStability: 'stable',
            flowCharacter: 'destination-led footfall',
            transitVsTarget: { transitShare: 0.2, localActiveShare: 0.25, destinationShare: 0.55 },
            stability01: 0.7,
            concentration01: 0.6,
        },
        audienceAnalysis: {
            primaryAudience: 'TOURIST',
            locationType: 'MIXED',
            audienceFitScore: 70,
            primaryMagnets: [],
            fallbackMode: false,
            audienceSharePct: 60,
            businessClusterDetected: false,
            primaryDriverLabel: '',
            lockedMode: false,
            demandFlowLabel: '',
        },
        neighborhoodEnvironment: envStub,
        heatmapPoints: [],
        conclusion: '',
    };
}
const context: ScenarioContext = { accountId: 'a', propertyId: 'p', revision: 'r1', asOf: '2026-10-15T00:00:00Z' };
function property(): SharedProperty {
    return {
        ...context, canonicalAddress: 'Synthetic property', geographyRevision: 'geo-1', identity: 'resolved',
        evidence: [{ id: 'survey', kind: 'synthetic', locator: 'fixture://survey', observedAt: '2026-10-01', expiresAt: '2026-11-01', rights: 'synthetic', digest: 'a'.repeat(64) }],
        premises: { floorClass: 'street_eligible', firstLine: true, directStreetEntrance: true, signVisibility: 'good', pedestrianFlowBarrierFree: true, accessibleEntranceNoSteps: true, parkingOrTransitProximity: true, streetSide: null, crossingsNearby: true },
        measuredFootfallPerHour: { value: null, reason: 'not measured', evidenceIds: [] }, permittedUses: { value: ['residential', 'retail'], evidenceIds: ['survey'] }, totalPowerKw: { value: 20, evidenceIds: ['survey'] },
    };
}
function economics(overrides: Partial<Economics> = {}): Economics { return { currency: 'RUB', months: 12, capex: 1000, acquisitionCost: 0, monthlyFixedCost: 10, monthlyHeadRent: 20, annualHeadRentEscalation: 0, annualOperatingCostEscalation: 0, variableCostShare: 0, revenueTaxShare: 0, taxBasis: 'explicit_revenue_proxy', annualDiscountRate: 0, depositPaid: 0, depositReceived: 0, depositReturnedMonth: 12, monthlyDebtService: 0, loanProceeds: 0, loanBalanceAtExit: 0, terminalSaleProceeds: 0, terminalSaleCosts: 0, assumptionEvidenceIds: ['survey'], ...overrides }; }
function plan(): FloorPlan {
    return { id: 'plan', revision: 'plan1', propertyId: 'p', evidenceIds: ['survey'], fitoutCostPerAdditionalUnit: 100, monthlyCostPerAdditionalUnit: 5, minUnitArea: 5, maxUnits: 3,
        cells: [
            { id: 'a', x: 0, y: 0, width: 3, depth: 5, common: false, allowedEntrance: true, frontageMetres: 3, windowMetres: 2, water: true, independentExhaust: false },
            { id: 'b', x: 3, y: 0, width: 5, depth: 5, common: false, allowedEntrance: true, frontageMetres: 5, windowMetres: 4, water: null, independentExhaust: null },
            { id: 'c', x: 0, y: 5, width: 3, depth: 2, common: true, allowedEntrance: false, frontageMetres: 0, windowMetres: 0, water: false, independentExhaust: false },
        ], mergeEdges: [['a', 'b']] };
}
function tenant(overrides: Partial<TenantCategory> = {}): TenantCategory { return { id: 'retail', permittedUse: 'retail', minArea: 5, maxArea: 100, minFrontage: 1, minWindows: 0, powerKw: 5, needsWater: false, needsExhaust: false, rentPerM2: 100, vacancyShare: 0, collectionRate: 1, annualRentEscalation: 0, fitoutMonths: 0, maxInstances: 3, estimatedMonthlySales: null, maxRentToSalesShare: null, evidenceIds: ['survey'], ...overrides }; }
const run = (p = property(), pl = plan(), ts = [tenant()], e = economics(), budget = 10000) => commercialScenarios(p, context, e, pl, ts, budget);
describe('shared evidence and scenario boundaries', () => {
    it('rejects cross-account and stale property revision', () => { expect(() => run({ ...property(), accountId: 'other' })).toThrow('scope'); expect(() => run({ ...property(), revision: 'old' })).toThrow('revision'); });
    it('keeps one geography revision across residential and commercial models', () => { const p = property(); const r = residentialScenario(p, context, economics(), { kind: 'long_term_rental', monthlyRent: 100, vacancyShare: .1, annualEscalation: 0, evidenceIds: ['survey'] }); expect(r.geographyRevision).toBe(run(p).geographyRevision); expect(r.economics?.rows[1].grossIncome).toBe(90); expect(r.investmentReady).toBe(false); expect(r.automaticActionAllowed).toBe(false); });
    it('does not promote synthetic proxy to measured traffic', () => { const p = property(); p.measuredFootfallPerHour = { value: 300, evidenceIds: ['survey'] }; expect(() => validateProperty(p, context)).toThrow('Proxy'); });
    it('retains stale source and unresolved building holds', () => { const p = property(); p.identity = 'ambiguous'; p.evidence[0].expiresAt = '2026-10-02'; expect(run(p).holds).toEqual(expect.arrayContaining(['UNRESOLVED_PROPERTY', 'STALE_power', 'STALE_SCENARIO_EVIDENCE'])); });
    it('rejects fabricated provenance and future observations', () => { const p = property(); p.totalPowerKw.evidenceIds = ['missing']; expect(() => run(p)).toThrow('Unbound'); p.totalPowerKw.evidenceIds = ['survey']; p.evidence[0].observedAt = '2027-01-01'; expect(() => run(p)).toThrow('dates'); });
    it('rejects a known incompatible residential use', () => { const p = property(); p.permittedUses = { value: ['retail'], evidenceIds: ['survey'] }; expect(residentialScenario(p, context, economics(), { kind: 'residential_purchase', monthlyRent: 100, vacancyShare: 0, annualEscalation: 0, evidenceIds: ['survey'] }).status).toBe('REJECTED_USE'); });
    it('models seasonal STR explicitly without calling gross income profit', () => { const e = economics({ months: 2, depositReturnedMonth: 2 }); const r = residentialScenario(property(), context, e, { kind: 'short_term_rental', months: [{ availableNights: 30, occupancy: .5, adr: 100 }, { availableNights: 31, occupancy: .2, adr: 80 }], evidenceIds: ['survey'] }); expect(r.economics?.rows.map(x => x.grossIncome)).toEqual([0, 1500, 496]); expect(r.economics?.rows[1].operatingSurplusBeforeTaxAndDebt).toBe(1470); });
    it('retains basement caution without poisoning residential scenarios', () => { const p = property(); p.premises.floorClass = 'below_street'; p.locationAnalysis = strongFlowAnalysis(); expect(run(p).premisesGate?.strongStreetRetailAllowed).toBe(false); expect(run(p).existingFit).not.toBeNull(); expect(run(p).holds).toContain('STREET_RETAIL_PREMISES_NOT_CONFIRMED'); expect(residentialScenario(p, context, economics(), { kind: 'long_term_rental', monthlyRent: 100, vacancyShare: 0, annualEscalation: 0, evidenceIds: ['survey'] }).holds).not.toContain('STREET_RETAIL_PREMISES_NOT_CONFIRMED'); });
});
describe('unequal supplied-plan optimization', () => {
    it('enumerates 15/25 unequal units and whole40 while preserving6 common', () => { const r = run(); expect(r.bestSplit?.units.map(u => u.area)).toEqual([15, 25]); expect(r.bestWhole?.units[0].area).toBe(40); expect(r.commonArea).toBe(6); expect(r.lettableArea).toBe(40); expect(r.bestWhole?.modelledMonthlyGrossRent).toBe(4000); expect(r.bestWhole).not.toHaveProperty('contractedMonthlyGross'); expect(r.bestWhole!.economics.npv - r.bestSplit!.economics.npv).toBe(160); });
    it('supports connected L-shaped union, not equal-area arithmetic', () => { const p = plan(); p.cells[1] = { ...p.cells[1], x: 0, y: 5, width: 5, depth: 3 }; p.cells.pop(); expect(enumerateLayouts(p).layouts.some(l => l.length === 1 && l[0].area === 30)).toBe(true); });
    it('rejects overlap and corner-only merge', () => { const p = plan(); p.cells[1].x = 2; expect(() => enumerateLayouts(p)).toThrow('Overlapping'); p.cells[1].x = 3; p.cells[1].y = 5; expect(() => enumerateLayouts(p)).toThrow('merge'); });
    it('never crosses a structural boundary omitted from merge graph', () => { const p = plan(); p.mergeEdges = []; expect(run(property(), p).bestWhole).toBeNull(); expect(run(property(), p).bestSplit).not.toBeNull(); });
    it('rejects units without a supplied entrance', () => { const p = plan(); p.cells[1].allowedEntrance = false; expect(run(property(), p).bestSplit).toBeNull(); expect(run(property(), p).bestWhole).not.toBeNull(); });
    it('enforces aggregate power rather than independently reusing supply', () => { const p = property(); p.totalPowerKw = { value: 7, evidenceIds: ['survey'] }; expect(run(p).bestSplit).toBeNull(); expect(run(p).bestWhole).not.toBeNull(); });
    it('rejects known absent exhaust but retains explicit unknown condition', () => { const r = run(property(), plan(), [tenant({ needsExhaust: true })]); expect(r.bestSplit).toBeNull(); expect(r.bestWhole?.conditionalReasons).toContain('EXHAUST_UNKNOWN'); });
    it('limits category repetition and rent-to-sales affordability', () => { expect(run(property(), plan(), [tenant({ maxInstances: 1 })]).bestSplit).toBeNull(); expect(run(property(), plan(), [tenant({ estimatedMonthlySales: 100, maxRentToSalesShare: .1 })]).topCandidates).toHaveLength(0); });
    it('marks capped search as incomplete, never globally optimal', () => { const r = run(property(), plan(), [tenant()], economics(), 1); expect(r.search.truncated).toBe(true); expect(r.search.optimality).toBe('BEST_EXPLORED_ONLY'); expect(r.missingCandidateMeaning).toBe('NOT_ESTABLISHED_SEARCH_INCOMPLETE'); });
    it('rejects delimiter-collision IDs and out-of-scope plans', () => { const p = plan(); p.cells[0].id = 'a|b'; expect(() => enumerateLayouts(p)).toThrow(); expect(() => run(property(), { ...plan(), propertyId: 'elsewhere' })).toThrow('mismatch'); });
    it('applies vacancy, collection and fit-out timing', () => { const r = run(property(), plan(), [tenant({ vacancyShare: .2, collectionRate: .5, fitoutMonths: 1 })]); expect(r.bestWhole?.economics.rows[1].grossIncome).toBe(0); expect(r.bestWhole?.economics.rows[2].grossIncome).toBe(1600); });
});
describe('cashflow and course financial regressions', () => {
    it('recalculates C33 changed head rent instead of keeping stale profit', () => { const r = ledger([637100], economics({ months: 1, depositReturnedMonth: 1, capex: 0, monthlyFixedCost: 0, monthlyHeadRent: 205 * 1600 })); expect(r.rows[1].operatingSurplusBeforeTaxAndDebt).toBe(309100); expect(r.rows[1].operatingSurplusBeforeTaxAndDebt).not.toBe(278350); });
    it('does not reduce investment or improve NPV with tenant deposits', () => { const a = ledger(Array(12).fill(100), economics()); const b = ledger(Array(12).fill(100), economics({ depositReceived: 10000 })); expect(b.peakFunding).toBe(a.peakFunding); expect(b.npv).toBe(a.npv); expect(b.rows[0].bankCash).toBe(9000); expect(b.rows[12].refundableDepositCash).toBe(-10000); });
    it('includes own refundable deposit funding and opportunity cost', () => { const r = ledger(Array(12).fill(0), economics({ capex: 0, monthlyFixedCost: 0, monthlyHeadRent: 0, depositPaid: 100, annualDiscountRate: .1 })); expect(r.peakFunding).toBe(100); expect(r.npv).toBe(-9.09); });
    it('discounts annual effective rate and handles conventional IRR', () => { const cash = [-100, ...Array(11).fill(0), 110]; expect(npv(cash, .1)).toBe(0); expect(conventionalAnnualIrr(cash)).toBeCloseTo(.1, 8); expect(conventionalAnnualIrr([-100, 230, -132])).toBeNull(); });
    it('applies annual escalations starting month13, not month12', () => { const r = ledger(Array(13).fill(100), economics({ months: 13, depositReturnedMonth: 13, annualHeadRentEscalation: .1, annualOperatingCostEscalation: .2 })); expect(r.rows[12].headRent).toBe(20); expect(r.rows[13].headRent).toBe(22); expect(r.rows[13].operatingCosts).toBe(12); });
    it('exposes unknown taxes instead of asserting net profitability', () => { const r = run(property(), plan(), [tenant()], economics({ revenueTaxShare: null })); expect(r.holds).toContain('TAX_UNKNOWN'); expect(r.bestWhole?.economics.taxStatus).toBe('UNKNOWN_PRETAX_ONLY'); expect(r.bestWhole?.economics.profitability).toBe('MODELLED_NOT_OBSERVED'); });
    it('accounts for debt and terminal proceeds separately from operating surplus', () => { const r = ledger([100], economics({ months: 1, depositReturnedMonth: 1, loanProceeds: 500, monthlyDebtService: 20, terminalSaleProceeds: 1000, terminalSaleCosts: 50, loanBalanceAtExit: 400 })); expect(r.rows[0].investmentCash).toBe(-500); expect(r.rows[1].operatingSurplusBeforeTaxAndDebt).toBe(70); expect(r.rows[1].unrestrictedCash).toBe(600); });
    it('rejects non-finite values and mismatched horizons', () => { expect(() => ledger([NaN], economics({ months: 1, depositReturnedMonth: 1 }))).toThrow(); expect(() => ledger([100], economics())).toThrow('horizon'); expect(() => run(property(), plan(), [tenant({ rentPerM2: Infinity })])).toThrow(); });
    it('never treats absent meter readings as zero or accepts negative consumption', () => { expect(meterCharge(100, null, 5)).toBeNull(); expect(() => meterCharge(100, 0, 5)).toThrow('Negative'); expect(meterCharge(100, 110, 5)).toBe(50); });
    it('keeps short traffic samples distinct from full-day measurements', () => { const a = sampledFootfall(33, 10), b = sampledFootfall(66, 10); expect((a.extrapolatedHourlyRate + b.extrapolatedHourlyRate) / 2).toBe(297); expect(a.fullDayRate).toBeNull(); expect(a.kind).toBe('sample_extrapolation'); });
    it('keeps course150m² spread separate from profitability after actual costs', () => { const gross = 70 * 2500 + 45 * 2900 + 32 * 3500; expect(gross).toBe(417500); const r = ledger([gross], economics({ months: 1, depositReturnedMonth: 1, monthlyHeadRent: 300000, monthlyFixedCost: 10000, revenueTaxShare: .06 })); expect(r.rows[1].operatingSurplusBeforeTaxAndDebt).toBe(107500); expect(r.rows[1].unrestrictedCash).toBe(82450); });
});
