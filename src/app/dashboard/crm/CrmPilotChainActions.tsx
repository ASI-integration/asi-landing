'use client';

import Link from 'next/link';
import type { CrmContact } from '@/lib/crm/types';
import { resolvePilotChainNextActions } from '@/lib/pilot-chain/next-actions';

type Props = {
  contact: CrmContact;
};

export function CrmPilotChainActions({ contact }: Props) {
  const actions = resolvePilotChainNextActions(contact);

  if (actions.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Следующий шаг пилота</div>
      <ul className="mt-2 space-y-1.5">
        {actions.map((action) => (
          <li key={action.key} className="flex flex-wrap items-center gap-2">
            {action.done ? (
              <span className="text-emerald-700">✓ {action.labelRu}</span>
            ) : action.href ? (
              <Link href={action.href} className="font-semibold text-blue-700 hover:text-blue-900">
                {action.labelRu}
              </Link>
            ) : (
              <span className="text-slate-700">{action.labelRu}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
