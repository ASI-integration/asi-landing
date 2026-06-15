'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OpsProperty, PropertyMedia } from '@/lib/ops-foundation/types';

type PropertiesEnvelope = {
  ok?: boolean;
  properties?: OpsProperty[];
};

export function ChannelManagerObjectDataLink() {
  const [href, setHref] = useState('/dashboard/properties');
  const [property, setProperty] = useState<OpsProperty | null>(null);
  const [cover, setCover] = useState<PropertyMedia | null>(null);
  const [label, setLabel] = useState('Перейти к объектам');

  useEffect(() => {
    let alive = true;

    async function loadProperties() {
      try {
        const res = await fetch('/api/ops/properties');
        const json = (await res.json()) as PropertiesEnvelope;
        const selectedProperty = json.ok ? json.properties?.[0] : null;
        const propertyId = selectedProperty?.id ?? null;
        if (!alive || !propertyId) return;

        setProperty(selectedProperty ?? null);
        setHref(`/dashboard/properties/${propertyId}/setup?step=channels`);
        const mediaRes = await fetch(`/api/ops/properties/${propertyId}/media`);
        const mediaJson = (await mediaRes.json()) as { ok?: boolean; media?: PropertyMedia[] };
        if (!alive || !mediaRes.ok || !mediaJson.ok) return;
        const activeMedia = (mediaJson.media ?? []).filter((item) => item.status !== 'deleted');
        setCover(activeMedia.find((item) => item.isCover) ?? activeMedia[0] ?? null);
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
    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {cover?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.url}
            alt={cover.title ?? property?.title ?? 'Фото объекта'}
            className="h-20 w-28 shrink-0 rounded-md border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
            Фото
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{property?.title ?? 'Объект'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {cover ? 'Главное фото готово для карточки объекта.' : 'Добавьте фото в мастере объекта.'}
          </p>
        </div>
      </div>
      <Link
        href={href}
        className="inline-flex shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        {label}
      </Link>
    </div>
  );
}
