/** Physical release acceptance is an ordered prefix, never a sum of CI/PR statuses. */
export type PhysicalStage = { id: string; status: string; proofCount: number };

/** Verified stage IDs must come from separately authenticated, run-bound host evidence. */
export function physicallyAccepted(stage: PhysicalStage, independentlyVerifiedStages: readonly string[]): boolean {
  return stage.status === 'ACCEPTED'
    && Number.isSafeInteger(stage.proofCount)
    && stage.proofCount > 0
    && independentlyVerifiedStages.includes(stage.id);
}

export function acceptedPrefix(stages: readonly PhysicalStage[], independentlyVerifiedStages: readonly string[]): number {
  let n = 0;
  for (const stage of stages) {
    if (!physicallyAccepted(stage, independentlyVerifiedStages)) break;
    n++;
  }
  return n;
}
