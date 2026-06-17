'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { readStoredPilotContactId } from '@/lib/crm/pilot-onboarding';
import { propertyStatusLabels } from '@/lib/ops-foundation/labels';
import type { OpsProperty, PropertyStatus } from '@/lib/ops-foundation/types';

const statusTone: Record<PropertyStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-amber-100 text-amber-800',
  archived: 'bg-gray-100 text-gray-600',
  inactive: 'bg-gray-100 text-gray-600',
};

export default function PropertiesPage() {
  const router = useRouter();
  const [crmContactId, setCrmContactId] = useState<string | null>(null);
  const [properties, setProperties] = useState<OpsProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ops/properties');
      const json = (await res.json()) as { ok?: boolean; properties?: OpsProperty[]; error?: string; detail?: string };
      if (!res.ok || !json.ok) {
        setError(json.detail ?? json.error ?? 'Не удалось загрузить объекты');
        setProperties([]);
        return;
      }
      setProperties(json.properties ?? []);
    } catch {
      setError('Ошибка сети при загрузке объектов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('crmContactId')?.trim();
    if (fromUrl) {
      setCrmContactId(fromUrl);
      return;
    }
    setCrmContactId(readStoredPilotContactId());
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/ops/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          city: city.trim() || undefined,
          address: address.trim() || undefined,
          crmContactId: crmContactId ?? undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; property?: OpsProperty; error?: string; detail?: string };
      if (!res.ok || !json.ok) {
        setError(json.detail ?? json.error ?? 'Не удалось создать объект');
        return;
      }
      setTitle('');
      setCity('');
      setAddress('');
      if (json.property?.id) {
        router.push(`/dashboard/properties/${json.property.id}/setup`);
        return;
      }
      await load();
    } catch {
      setError('Ошибка сети при создании объекта');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Объекты</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Единый реестр объектов размещения. Мастер-карточка, бронирования, задачи и инциденты — в карточке объекта.
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Новый объект</h2>
        <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Название *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Апартаменты на Тверской"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Город</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Москва"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Адрес</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="ул. Тверская, 1"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {creating ? 'Создание…' : 'Создать объект'}
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Список объектов</h2>
        </div>
        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-500">Загрузка…</p>
        ) : properties.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-500">Объектов пока нет. Создайте первый объект выше.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {properties.map((property) => (
              <li key={property.id}>
                <Link
                  href={`/dashboard/properties/${property.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-slate-900">{property.title}</p>
                    <p className="text-sm text-slate-500">
                      {[property.city, property.address].filter(Boolean).join(' · ') || 'Адрес не указан'}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[property.status]}`}>
                    {propertyStatusLabels[property.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
