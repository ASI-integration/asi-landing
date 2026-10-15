import { finite } from './contracts';
export interface Economics {
    currency: 'RUB';
    months: number;
    capex: number;
    acquisitionCost: number;
    monthlyFixedCost: number;
    monthlyHeadRent: number;
    annualHeadRentEscalation: number;
    annualOperatingCostEscalation: number;
    variableCostShare: number;
    revenueTaxShare: number | null;
    /** Explicit cash tax proxy, not a tax determination or VAT engine. */
    taxBasis: 'explicit_revenue_proxy';
    annualDiscountRate: number;
    depositPaid: number;
    depositReceived: number;
    depositReturnedMonth: number;
    monthlyDebtService: number;
    loanProceeds: number;
    loanBalanceAtExit: number;
    terminalSaleProceeds: number;
    terminalSaleCosts: number;
    assumptionEvidenceIds: string[];
}
export interface CashflowMonth {
    month: number;
    grossIncome: number;
    operatingCosts: number;
    headRent: number;
    operatingSurplusBeforeTaxAndDebt: number;
    tax: number;
    debtService: number;
    investmentCash: number;
    refundableDepositCash: number;
    unrestrictedCash: number;
    /** Includes deposit cash but must NOT be used as profit or return. */
    bankCash: number;
}
const money = (n: number) => { finite(n, 'calculated cash', -1e12, 1e12); return Math.round(n * 100) / 100 || 0; };
export function validateEconomics(e: Economics): void {
    if (e.currency !== 'RUB' || e.taxBasis !== 'explicit_revenue_proxy')
        throw new Error('Unsupported currency/tax basis');
    finite(e.months, 'months', 1, 120);
    if (!Number.isInteger(e.months))
        throw new Error('Fractional horizon');
    for (const k of ['capex', 'acquisitionCost', 'monthlyFixedCost', 'monthlyHeadRent', 'depositPaid', 'depositReceived', 'monthlyDebtService', 'loanProceeds', 'loanBalanceAtExit', 'terminalSaleProceeds', 'terminalSaleCosts'] as const)
        finite(e[k], k, 0, 1e10);
    for (const k of ['annualHeadRentEscalation', 'annualOperatingCostEscalation', 'variableCostShare'] as const)
        finite(e[k], k, 0, 1);
    if (e.revenueTaxShare !== null)
        finite(e.revenueTaxShare, 'tax share', 0, 1);
    finite(e.annualDiscountRate, 'discount', 0, 1);
    if (!Number.isInteger(e.depositReturnedMonth) || e.depositReturnedMonth < 1 || e.depositReturnedMonth > e.months)
        throw new Error('Deposit release must be inside horizon');
    if (!e.assumptionEvidenceIds.length)
        throw new Error('Economic assumptions require provenance');
}
/** Annual effective discount converted to monthly timing; period zero is undiscounted. */
export function npv(cash: number[], annualRate: number): number {
    finite(annualRate, 'discount', 0, 1);
    return money(cash.reduce((total, value, month) => { finite(value, 'cash', -1e12, 1e12); return total + value / (1 + annualRate) ** (month / 12); }, 0));
}
/** Returns null rather than choosing among roots or accepting non-conventional cash flows. */
export function conventionalAnnualIrr(cash: number[]): number | null {
    if (cash.length < 2 || cash.some(n => !Number.isFinite(n)) || cash[0] >= 0 || cash.slice(1).some(n => n < 0) || !cash.slice(1).some(n => n > 0))
        return null;
    const f = (r: number) => cash.reduce((s, n, i) => s + n / (1 + r) ** i, 0);
    let lo = -0.999, hi = 1;
    if (f(lo) < 0 || f(hi) > 0)
        return null;
    for (let i = 0; i < 160; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0)
            lo = mid;
        else
            hi = mid;
    }
    const annual = (1 + (lo + hi) / 2) ** 12 - 1;
    return Number.isFinite(annual) ? annual : null;
}
export function ledger(income: number[], e: Economics) {
    validateEconomics(e);
    if (income.length !== e.months)
        throw new Error('Income horizon mismatch');
    const rows: CashflowMonth[] = [];
    for (let month = 0; month <= e.months; month++) {
        const year = Math.floor((month - 1) / 12);
        const gross = month ? income[month - 1] : 0;
        finite(gross, 'income', 0, 1e10);
        const operatingCosts = month ? money(e.monthlyFixedCost * (1 + e.annualOperatingCostEscalation) ** year + gross * e.variableCostShare) : 0;
        const headRent = month ? money(e.monthlyHeadRent * (1 + e.annualHeadRentEscalation) ** year) : 0;
        const tax = money(gross * (e.revenueTaxShare ?? 0));
        const debtService = month ? e.monthlyDebtService : 0;
        const investmentCash = month === 0 ? -e.capex - e.acquisitionCost + e.loanProceeds : month === e.months ? e.terminalSaleProceeds - e.terminalSaleCosts - e.loanBalanceAtExit : 0;
        const refundableDepositCash = month === 0 ? e.depositReceived - e.depositPaid : month === e.depositReturnedMonth ? e.depositPaid - e.depositReceived : 0;
        const surplus = money(gross - operatingCosts - headRent);
        const unrestrictedCash = money(surplus - tax - debtService + investmentCash);
        rows.push({ month, grossIncome: money(gross), operatingCosts, headRent, operatingSurplusBeforeTaxAndDebt: surplus, tax, debtService, investmentCash: money(investmentCash), refundableDepositCash: money(refundableDepositCash), unrestrictedCash, bankCash: money(unrestrictedCash + refundableDepositCash) });
    }
    const cash = rows.map(r => money(r.unrestrictedCash + (r.month === 0 ? -e.depositPaid : r.month === e.depositReturnedMonth ? e.depositPaid : 0)));
    let cumulative = 0, peakFunding = 0;
    // Tenant deposits are restricted liabilities, not a reduction of investment at risk.
    for (const r of rows) {
        cumulative += r.unrestrictedCash + (r.month === 0 ? -e.depositPaid : r.month === e.depositReturnedMonth ? e.depositPaid : 0);
        peakFunding = Math.max(peakFunding, -cumulative);
    }
    return { rows, npv: npv(cash, e.annualDiscountRate), annualIrr: conventionalAnnualIrr(cash), peakFunding: money(peakFunding), taxStatus: e.revenueTaxShare === null ? 'UNKNOWN_PRETAX_ONLY' as const : 'EXPLICIT_PROXY_NOT_TAX_ADVICE' as const, profitability: 'MODELLED_NOT_OBSERVED' as const };
}
