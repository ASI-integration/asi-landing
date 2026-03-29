import { NextRequest, NextResponse } from 'next/server';
import { runAllIncidentScenarios } from '@/lib/ops/incident-test-harness';

const VALID_GUEST_TIERS    = ['strict', 'trusted', 'privileged'] as const;
const VALID_COST_TIERS     = ['micro', 'minor', 'major'] as const;
const VALID_EVIDENCE_CONF  = ['low', 'medium', 'high'] as const;

type GuestTier   = typeof VALID_GUEST_TIERS[number];
type CostTier    = typeof VALID_COST_TIERS[number];
type EvidenceConf = typeof VALID_EVIDENCE_CONF[number];

function parseGuestTier(v: string | null): GuestTier {
  return VALID_GUEST_TIERS.includes(v as GuestTier) ? (v as GuestTier) : 'trusted';
}
function parseCostTier(v: string | null): CostTier {
  return VALID_COST_TIERS.includes(v as CostTier) ? (v as CostTier) : 'minor';
}
function parseEvidenceConf(v: string | null): EvidenceConf {
  return VALID_EVIDENCE_CONF.includes(v as EvidenceConf) ? (v as EvidenceConf) : 'medium';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const overrides = {
    guestTier:          parseGuestTier(searchParams.get('guestTier')),
    costTier:           parseCostTier(searchParams.get('costTier')),
    evidenceConfidence: parseEvidenceConf(searchParams.get('evidenceConfidence')),
  };

  try {
    const scenarios = runAllIncidentScenarios(overrides);
    return NextResponse.json({ ok: true, scenarios });
  } catch {
    return NextResponse.json({ ok: false, error: 'ops_demo_failed' }, { status: 500 });
  }
}
