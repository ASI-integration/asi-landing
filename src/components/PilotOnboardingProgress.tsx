type ProgressStep = {
  id: string;
  label: string;
  done: boolean;
  current: boolean;
};

type PilotOnboardingProgressProps = {
  progress: {
    steps: ProgressStep[];
  };
};

export function PilotOnboardingProgress({ progress }: PilotOnboardingProgressProps) {
  return (
    <ol className="space-y-2">
      {progress.steps.map((step) => (
        <li
          key={step.id}
          className={`flex items-start gap-3 rounded-md px-2 py-1.5 text-sm ${
            step.current ? 'bg-white/70 font-medium' : ''
          }`}
        >
          <span
            aria-hidden
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
              step.done
                ? 'bg-emerald-600 text-white'
                : step.current
                  ? 'border-2 border-emerald-600 text-emerald-700'
                  : 'border border-slate-300 text-slate-400'
            }`}
          >
            {step.done ? '✓' : '·'}
          </span>
          <span className={step.done ? 'text-emerald-900' : step.current ? 'text-emerald-950' : 'text-slate-600'}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
