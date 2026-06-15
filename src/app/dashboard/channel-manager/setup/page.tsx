'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OpsProperty } from '@/lib/ops-foundation/types';

type PropertiesEnvelope = {
  ok?: boolean;
  properties?: OpsProperty[];
  error?: string;
  detail?: string;
};

function normalizeStep(value: string | null): string {
  return value && /^[a-z0-9_-]+$/i.test(value) ? value : 'channels';
}

export default function ChannelManagerSetupRedirectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNoProperties, setHasNoProperties] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadAndRedirect() {
      setLoading(true);
      setError(null);
      setHasNoProperties(false);

      try {
        const res = await fetch('/api/ops/properties');
        const json = (await res.json()) as PropertiesEnvelope;
        if (!alive) return;

        if (!res.ok || !json.ok) {
          setError(json.detail ?? json.error ?? 'Не удалось загрузить объекты.');
          setLoading(false);
          return;
        }

        const property = json.properties?.[0] ?? null;
        if (!property) {
          setHasNoProperties(true);
          setLoading(false);
          return;
        }

        const params = new URLSearchParams(window.location.search);
        const step = normalizeStep(params.get('step'));
        router.replace(`/dashboard/properties/${property.id}/setup?step=${step}`);
      } catch {
        if (!alive) return;
        setError('Ошибка сети при загрузке объектов.');
        setLoading(false);
      }
    }

    void loadAndRedirect();
    return () => {
      alive = false;
    };
  }, [router]);

  if (loading) {
    return <p className="text-sm text-slate-500">Открываем данные объекта для каналов...</p>;
  }

  if (hasNoProperties) {
    return (
      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-slate-900">Сначала создайте объект</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Чтобы заполнить данные для каналов, нужен хотя бы один объект размещения.
        </p>
        <Link
          href="/dashboard/properties"
          className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Создать объект
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl rounded-xl border border-red-200 bg-red-50 p-6">
      <h1 className="text-xl font-semibold text-red-900">Не удалось открыть мастер объекта</h1>
      <p className="mt-2 text-sm leading-6 text-red-800">{error ?? 'Попробуйте обновить страницу.'}</p>
      <Link href="/dashboard/properties" className="mt-5 inline-flex text-sm font-medium text-red-900 hover:underline">
        Перейти к объектам
      </Link>
    </div>
  );
}
