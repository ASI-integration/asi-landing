'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OpsProperty } from '@/lib/ops-foundation/types';

type PropertiesEnvelope = {
  ok?: boolean;
  properties?: OpsProperty[];
};

export function ChannelManagerObjectDataLink() {
  const [href, setHref] = useState('/dashboard/properties');
  const [label, setLabel] = useState('Перейти к объектам');

  useEffect(() => {
    let alive = true;

    async function loadProperties() {
      try {
        const res = await fetch('/api/ops/properties');
        const json = (await res.json()) as PropertiesEnvelope;
        const propertyId = json.ok ? json.properties?.[0]?.id : null;
        if (!alive || !propertyId) return;

        setHref(`/dashboard/properties/${propertyId}/setup?step=channels`);
        setLabel('Открыть данные объекта для каналов');
      } catch {
        // Ссылка остаётся на списке объектов, это безопасный запасной путь.
      }
    }

    void loadProperties();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Link
      href={href}
      className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
    >
      {label}
    </Link>
  );
}
