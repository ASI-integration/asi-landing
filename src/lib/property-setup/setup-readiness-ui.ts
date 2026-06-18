import type { ObjectGuestReadiness } from './object-guest-readiness';
import {
  resolveSetupNextStep,
  type SetupNextStepCta,
  type SetupNextStepModel,
} from './setup-next-step';

const SETUP_GRID_HIDDEN_STEP_IDS = new Set(['readiness']);

export function filterSetupStepsForGrid<T extends { anchor: string }>(steps: readonly T[]): T[] {
  return steps.filter((step) => !SETUP_GRID_HIDDEN_STEP_IDS.has(step.anchor));
}

export function getSetupFillableStepCount(steps: readonly { anchor: string }[]): number {
  return filterSetupStepsForGrid(steps).length;
}

export function resolveSetupProgressCounts(input: {
  completedFillableSections: number;
  fillableStepCount: number;
}): { completedStepCount: number; totalStepCount: number } {
  return {
    completedStepCount: input.completedFillableSections,
    totalStepCount: input.fillableStepCount,
  };
}

export function formatSetupStepHeader(input: {
  propertyTitle: string | null | undefined;
  activeStepId: string;
  activeStepLabel: string;
  fillableStepIndex: number;
  fillableStepCount: number;
}): string {
  const title = input.propertyTitle?.trim() || 'Объект';
  if (input.activeStepId === 'readiness') {
    return `${title} · ${input.activeStepLabel}`;
  }

  return `${title} · Шаг ${input.fillableStepIndex + 1} из ${input.fillableStepCount}: ${input.activeStepLabel}`;
}

export function isRoutableSetupStepId(stepId: string, allStepIds: readonly string[]): boolean {
  return allStepIds.includes(stepId);
}

export type SetupReadinessPageUi = {
  showTopReadinessBlock: boolean;
  showNextButton: boolean;
  readinessBlockShowPrimaryCta: boolean;
  stickyShowsPrimaryCta: boolean;
  stickyPrimaryCta: SetupNextStepCta | null;
  nextStep: SetupNextStepModel;
  primaryCtaPlacements: Array<'top' | 'section' | 'sticky'>;
};

export function shouldShowTopReadinessBlock(activeStepId: string): boolean {
  return activeStepId !== 'readiness';
}

export function shouldShowSetupNextButton(activeStepId: string): boolean {
  return activeStepId !== 'readiness';
}

export function resolveSetupReadinessPageUi(input: {
  activeStepId: string;
  readiness: ObjectGuestReadiness;
  telegramLinked: boolean;
  guestTestDispatched: boolean;
}): SetupReadinessPageUi {
  const onReadinessStep = input.activeStepId === 'readiness';
  const nextStep = resolveSetupNextStep({
    readiness: input.readiness,
    telegramLinked: input.telegramLinked,
    guestTestDispatched: input.guestTestDispatched,
    onSetupPage: true,
  });

  const showTopReadinessBlock = shouldShowTopReadinessBlock(input.activeStepId);
  const showNextButton = shouldShowSetupNextButton(input.activeStepId);
  const readinessBlockShowPrimaryCta = !onReadinessStep;
  const stickyShowsPrimaryCta = onReadinessStep;

  const primaryCtaPlacements: Array<'top' | 'section' | 'sticky'> = stickyShowsPrimaryCta
    ? ['sticky']
    : showTopReadinessBlock
      ? ['top']
      : [];

  return {
    showTopReadinessBlock,
    showNextButton,
    readinessBlockShowPrimaryCta,
    stickyShowsPrimaryCta,
    stickyPrimaryCta: stickyShowsPrimaryCta ? nextStep.primaryCta : null,
    nextStep,
    primaryCtaPlacements,
  };
}
