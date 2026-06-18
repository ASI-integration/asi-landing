'use client';

import { useState } from 'react';

import { TgIcon } from '@/components/TgIcon';
import type { GuestTestFlowState } from '@/lib/crm/guest-test-flow';
import type { SetupNextStepCta, SetupNextStepModel } from '@/lib/property-setup/setup-next-step';

type GuestTestLaunchResponse = {
  ok?: boolean;
  error?: string;
  mode?: 'dispatched' | 'deep_link';
  deepLink?: string;
  guestTestCommand?: string;
  telegramBotUrl?: string;
  guestTestFlow?: GuestTestFlowState;
};

type GuestTestLaunchCtaProps = {
  propertyId: string;
  nextStep: SetupNextStepModel;
  cta: SetupNextStepCta;
  onGuestTestFlowChange?: (flow: GuestTestFlowState) => void;
  onLaunchMessage?: (message: string | null) => void;
  onLaunchError?: (message: string | null) => void;
  variant?: 'primary' | 'secondary';
  className?: string;
};

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60';

export function GuestTestLaunchFallback({
  guestTestCommand,
  prominent = false,
}: {
  guestTestCommand: string;
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(guestTestCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (prominent) {
    return (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-950">Отправьте боту команду:</p>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-4 py-3 text-left font-mono text-base font-semibold text-slate-900 hover:bg-amber-100/60"
        >
          {guestTestCommand}
        </button>
        <p className="mt-2 text-xs text-amber-900">{copied ? 'Команда скопирована.' : 'Нажмите, чтобы скопировать.'}</p>
      </div>
    );
  }

  return (
    <p className="mt-3 text-xs text-emerald-800">
      Запасной вариант:{' '}
      <code className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-950">{guestTestCommand}</code>
    </p>
  );
}

export function GuestTestLaunchCta({
  propertyId,
  nextStep,
  cta,
  onGuestTestFlowChange,
  onLaunchMessage,
  onLaunchError,
  variant = 'primary',
  className,
}: GuestTestLaunchCtaProps) {
  const [launching, setLaunching] = useState(false);
  const [showProminentFallback, setShowProminentFallback] = useState(false);

  async function handleLaunch() {
    setLaunching(true);
    onLaunchError?.(null);
    onLaunchMessage?.(null);
    setShowProminentFallback(false);

    try {
      const res = await fetch(`/api/ops/properties/${propertyId}/guest-test/launch`, {
        method: 'POST',
      });
      const json = (await res.json()) as GuestTestLaunchResponse;

      if (!res.ok || !json.ok) {
        onLaunchError?.('Не удалось запустить тест гостя. Попробуйте ещё раз.');
        if (nextStep.guestTestCommand) {
          setShowProminentFallback(true);
        }
        return;
      }

      if (json.guestTestFlow) {
        onGuestTestFlowChange?.(json.guestTestFlow);
      }

      if (json.mode === 'dispatched') {
        onLaunchMessage?.('Тест гостя запущен. Откройте Telegram и задайте вопрос по объекту.');
        if (json.telegramBotUrl) {
          window.open(json.telegramBotUrl, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      const deepLink = json.deepLink;
      if (deepLink) {
        const opened = window.open(deepLink, '_blank', 'noopener,noreferrer');
        if (!opened) {
          setShowProminentFallback(true);
        }
      } else if (nextStep.guestTestCommand) {
        setShowProminentFallback(true);
      }
    } catch {
      onLaunchError?.('Ошибка сети при запуске теста. Попробуйте ещё раз.');
      if (nextStep.guestTestCommand) {
        setShowProminentFallback(true);
      }
    } finally {
      setLaunching(false);
    }
  }

  if (cta.kind === 'setup_step') {
    return null;
  }

  if (cta.kind === 'external') {
    return (
      <a
        href={cta.href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={className ?? (variant === 'primary' ? primaryBtn : secondaryBtn)}
      >
        <TgIcon className="h-5 w-5 shrink-0" />
        {cta.label}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleLaunch()}
        disabled={launching}
        className={className ?? (variant === 'primary' ? primaryBtn : secondaryBtn)}
      >
        <TgIcon className="h-5 w-5 shrink-0" />
        {launching ? 'Запуск…' : cta.label}
      </button>
      {showProminentFallback && nextStep.guestTestCommand ? (
        <GuestTestLaunchFallback guestTestCommand={nextStep.guestTestCommand} prominent />
      ) : null}
    </>
  );
}
