'use client';

/**
 * Minimal, read-only rendering of the Guest Autopilot account lifecycle.
 * Reuses the existing dashboard's plain Tailwind card style — no new design
 * system, no new visual language.
 */

type LifecycleStatus =
  | 'signup'
  | 'card_verified'
  | 'integration_in_progress'
  | 'integration_ready'
  | 'trial_active'
  | 'paid_active';

const STEPS: { status: LifecycleStatus; label: string }[] = [
  { status: 'signup', label: 'Account created' },
  { status: 'card_verified', label: 'Card secured' },
  { status: 'integration_in_progress', label: 'Connecting systems' },
  { status: 'integration_ready', label: 'Connected' },
  { status: 'trial_active', label: '14-day free live run' },
  { status: 'paid_active', label: 'Paid operation' },
];

const ORDER: LifecycleStatus[] = STEPS.map((s) => s.status);

export function LifecycleProgress({
  status,
  trialEndsAt,
}: {
  status: LifecycleStatus | null | undefined;
  trialEndsAt?: string | null;
}) {
  const currentIndex = status ? ORDER.indexOf(status) : -1;

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 max-w-md">
      <p className="text-sm font-semibold text-slate-900">Account setup</p>
      <ul className="mt-4 space-y-2">
        {STEPS.map((step, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={step.status} className="flex items-center gap-2 text-sm">
              <span
                className={
                  done
                    ? 'text-emerald-600'
                    : active
                      ? 'text-slate-900 font-semibold'
                      : 'text-slate-400'
                }
              >
                {done ? '✓' : active ? '→' : '·'}
              </span>
              <span className={active ? 'text-slate-900 font-semibold' : done ? 'text-slate-600' : 'text-slate-400'}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>
      {status === 'trial_active' && trialEndsAt ? (
        <p className="mt-4 text-xs text-slate-500">
          Free trial ends {new Date(trialEndsAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}.
        </p>
      ) : null}
      {!status || status === 'signup' ? (
        <p className="mt-4 text-xs text-slate-500">
          Nothing is charged today. Attaching a card only saves it securely for later — setup and
          integration time is free, and the 14-day trial starts only once your integration is
          connected and verified.
        </p>
      ) : null}
    </div>
  );
}
