import { finite } from './contracts';
/** Metric, axis-aligned atomic spaces. Their union may be L-shaped and unequal.
 * These are supplied plans, not automatically extracted CAD or engineering approval. */
export interface SpaceCell {
    id: string;
    x: number;
    y: number;
    width: number;
    depth: number;
    common: boolean;
    allowedEntrance: boolean;
    frontageMetres: number;
    windowMetres: number;
    water: boolean | null;
    independentExhaust: boolean | null;
}
export interface FloorPlan {
    id: string;
    revision: string;
    propertyId: string;
    evidenceIds: string[];
    cells: SpaceCell[];
    /** Edges explicitly allow combining adjacent cells; omitted edges preserve structural separation. */
    mergeEdges: [
        string,
        string
    ][];
    fitoutCostPerAdditionalUnit: number;
    monthlyCostPerAdditionalUnit: number;
    minUnitArea: number;
    maxUnits: number;
}
export interface UnitCandidate {
    cellIds: string[];
    area: number;
    frontageMetres: number;
    windowMetres: number;
    water: boolean | null;
    independentExhaust: boolean | null;
}
const area = (c: SpaceCell) => c.width * c.depth;
function touches(a: SpaceCell, b: SpaceCell): boolean {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    return (Math.abs(overlapX) < 1e-8 && overlapY > 1e-8) || (Math.abs(overlapY) < 1e-8 && overlapX > 1e-8);
}
export function enumerateLayouts(plan: FloorPlan) {
    if (!plan.id || !plan.revision || !plan.propertyId || !plan.evidenceIds.length)
        throw new Error('Unbound floor plan');
    if (!plan.cells.length || plan.cells.length > 10)
        throw new Error('Plan cell limit');
    const cells = plan.cells.filter(c => !c.common).slice().sort((a, b) => a.id.localeCompare(b.id));
    if (!cells.length || cells.length > 8)
        throw new Error('Search supports 1–8 lettable cells');
    finite(plan.minUnitArea, 'minimum area', 0.01, 1e6);
    finite(plan.fitoutCostPerAdditionalUnit, 'partition capex', 0, 1e9);
    finite(plan.monthlyCostPerAdditionalUnit, 'per-unit operating cost', 0, 1e8);
    if (!Number.isInteger(plan.maxUnits) || plan.maxUnits < 1 || plan.maxUnits > 8)
        throw new Error('Invalid max units');
    const ids = new Map<string, SpaceCell>();
    for (const c of plan.cells) {
        if (!/^[A-Za-z0-9_-]+$/.test(c.id) || ids.has(c.id))
            throw new Error('Duplicate space ID');
        ids.set(c.id, c);
        finite(c.x, 'x', -1e4, 1e4);
        finite(c.y, 'y', -1e4, 1e4);
        finite(c.width, 'width', 0.01, 1000);
        finite(c.depth, 'depth', 0.01, 1000);
        finite(c.frontageMetres, 'frontage', 0, 2 * (c.width + c.depth));
        finite(c.windowMetres, 'windows', 0, c.frontageMetres);
        if (typeof c.common !== 'boolean' || typeof c.allowedEntrance !== 'boolean' || ![true, false, null].includes(c.water) || ![true, false, null].includes(c.independentExhaust))
            throw new Error('Invalid space attributes');
    }
    for (let i = 0; i < plan.cells.length; i++)
        for (let j = i + 1; j < plan.cells.length; j++) {
            const a = plan.cells[i], b = plan.cells[j];
            if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-8 && Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > 1e-8)
                throw new Error('Overlapping cells');
        }
    const edges = new Set<string>();
    for (const [a, b] of plan.mergeEdges) {
        const x = ids.get(a), y = ids.get(b);
        if (!x || !y || a === b || x.common || y.common || !touches(x, y))
            throw new Error('Invalid merge edge');
        edges.add([a, b].sort().join('|'));
    }
    function connected(group: SpaceCell[]) {
        const visited = new Set([group[0].id]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const c of group)
                if (!visited.has(c.id) && group.some(p => visited.has(p.id) && edges.has([p.id, c.id].sort().join('|')))) {
                    visited.add(c.id);
                    changed = true;
                }
        }
        return visited.size === group.length;
    }
    const layouts: UnitCandidate[][] = [];
    let partitionsConsidered = 0;
    const groups: SpaceCell[][] = [];
    function visit(index: number) {
        if (index === cells.length) {
            partitionsConsidered++;
            if (groups.some(g => !connected(g) || !g.some(c => c.allowedEntrance) || g.reduce((s, c) => s + area(c), 0) < plan.minUnitArea))
                return;
            const capability = (g: SpaceCell[], key: 'water' | 'independentExhaust') => g.some(c => c[key] === true) ? true : g.some(c => c[key] === null) ? null : false;
            layouts.push(groups.map(g => ({ cellIds: g.map(c => c.id), area: g.reduce((s, c) => s + area(c), 0), frontageMetres: g.reduce((s, c) => s + c.frontageMetres, 0), windowMetres: g.reduce((s, c) => s + c.windowMetres, 0), water: capability(g, 'water'), independentExhaust: capability(g, 'independentExhaust') })));
            return;
        }
        for (const g of groups) {
            g.push(cells[index]);
            visit(index + 1);
            g.pop();
        }
        if (groups.length < plan.maxUnits) {
            groups.push([cells[index]]);
            visit(index + 1);
            groups.pop();
        }
    }
    visit(0);
    return { layouts, partitionsConsidered, lettableArea: cells.reduce((s, c) => s + area(c), 0), commonArea: plan.cells.filter(c => c.common).reduce((s, c) => s + area(c), 0), geometryScope: 'SUPPLIED_RECTANGULAR_CELLS_ONLY' as const, engineeringApproval: false as const };
}
