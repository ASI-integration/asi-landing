'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import { buildPropertyPassportModel } from '@/lib/channel-manager/property-passport';
import { normalizeSetupData, type PropertySetupData } from '@/lib/property-setup/setup-data';

type PropertiesEnvelope = {
  ok?: boolean;
  properties?: OpsProperty[];
  error?: string;
  detail?: string;
};

type SetupEnvelope = {
  ok?: boolean;
  property?: OpsProperty;
  masterCard?: PropertyMasterCard | null;
  setup?: unknown;
  error?: string;
  detail?: string;
};

type MediaEnvelope = {
  ok?: boolean;
  media?: PropertyMedia[];
  error?: string;
  detail?: string;
};

interface PassportState {
  property: OpsProperty;
  masterCard: PropertyMasterCard | null;
  setup: PropertySetupData;
  media: PropertyMedia[];
}

const statusTone = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  missing: 'border-amber-200 bg-amber-50 text-amber-900',
};

function textLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function InfoBlock({ title, value }: { title: string; value: string }) {
  const lines = textLines(value);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      {lines.length > 1 ? (
        <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-700">{lines[0] ?? value}</p>
      )}
    </div>
  );
}

export function PropertyPassportPreview() {
  const [state, setState] = useState<PassportState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmpty(false);

    try {
      const propertiesRes = await fetch('/api/ops/properties');
      const propertiesJson = (await propertiesRes.json()) as PropertiesEnvelope;
      if (!propertiesRes.ok || !propertiesJson.ok) {
        setError(propertiesJson.detail ?? propertiesJson.error ?? 'Не удалось загрузить объекты.');
        setState(null);
        return;
      }

      const firstProperty = propertiesJson.properties?.[0] ?? null;
      if (!firstProperty) {
        setEmpty(true);
        setState(null);
        return;
      }

      const [setupRes, mediaRes] = await Promise.all([
        fetch(`/api/ops/properties/${firstProperty.id}/setup`),
        fetch(`/api/ops/properties/${firstProperty.id}/media`),
      ]);
      const setupJson = (await setupRes.json()) as SetupEnvelope;
      const mediaJson = (await mediaRes.json()) as MediaEnvelope;

      if (!setupRes.ok || !setupJson.ok) {
        setError(setupJson.detail ?? setupJson.error ?? 'Не удалось загрузить данные объекта.');
        setState(null);
        return;
      }
      if (!mediaRes.ok || !mediaJson.ok) {
        setError(mediaJson.detail ?? mediaJson.error ?? 'Не удалось загрузить фото объекта.');
        setState(null);
        return;
      }

      setState({
        property: setupJson.property ?? firstProperty,
        masterCard: setupJson.masterCard ?? null,
        setup: normalizeSetupData(setupJson.setup),
        media: mediaJson.media ?? [],
      });
    } catch {
      setError('Ошибка сети при загрузке паспорта объекта.');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const passport = useMemo(() => {
    if (!state) return null;
    return buildPropertyPassportModel(state);
  }, [state]);

  if (loading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white px-5 py-5">
        <p className="text-sm text-slate-500">Загружаем паспорт объекта для каналов...</p>
      </section>
    );
  }

  if (empty) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white px-5 py-5">
        <h2 className="text-base font-semibold text-slate-900">Паспорт объекта для каналов</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Сначала создайте объект, затем заполните данные для подготовки карточек каналов.
        </p>
        <Link
          href="/dashboard/properties"
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Перейти к объектам
        </Link>
      </section>
    );
  }

  if (error || !passport) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 px-5 py-5">
        <h2 className="text-base font-semibold text-red-900">Паспорт объекта для каналов</h2>
        <p className="mt-2 text-sm leading-6 text-red-800">{error ?? 'Не удалось собрать предпросмотр объекта.'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100"
        >
          Обновить
        </button>
      </section>
    );
  }

  const coverUrl = passport.coverPhoto?.url ?? null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Паспорт объекта для каналов</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Предпросмотр карточки перед публикацией. Реальные отправки на площадки здесь не выполняются.
            </p>
          </div>
          <span
            className={`w-fit rounded-full border px-3 py-1 text-sm font-medium ${
              passport.isReady ? statusTone.done : statusTone.missing
            }`}
          >
            Готово: {passport.completedCount} из {passport.totalCount}
          </span>
        </div>
      </div>

      <div className="grid gap-6 px-5 py-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl}
                alt={passport.coverPhoto?.title ?? passport.title}
                className="aspect-[16/10] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center px-6 text-center text-sm text-slate-500">
                Главное фото пока не добавлено
              </div>
            )}
          </div>

          {passport.thumbnailPhotos.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {passport.thumbnailPhotos.slice(0, 8).map((photo) => (
                <div key={photo.id} className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  {photo.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo.url}
                      alt={photo.title ?? 'Фото объекта'}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center px-2 text-center text-xs text-slate-400">
                      Нет ссылки
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Остальные фото появятся здесь после загрузки.</p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">{passport.title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">{passport.location}</p>
          </div>

          <div className="grid gap-3">
            <InfoBlock title="Описание" value={passport.description} />
            <InfoBlock title="Правила" value={passport.rules} />
            <InfoBlock title="Заезд и выезд" value={passport.checkInOut} />
            <InfoBlock title="Wi-Fi" value={passport.wifi} />
            <InfoBlock title="Цены" value={passport.pricing} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Выбранные каналы</p>
            {passport.selectedChannels.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {passport.selectedChannels.map((channel) => (
                  <li
                    key={channel.code}
                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800"
                  >
                    {channel.label} · {channel.statusLabel}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">Каналы пока не выбраны.</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Готовность к публикации</h3>
            <p className="mt-1 text-sm text-slate-500">
              Проверьте заполненные пункты и быстро перейдите к тому, чего не хватает.
            </p>
          </div>
          <Link
            href={`/dashboard/properties/${passport.propertyId}/setup?step=readiness`}
            className="inline-flex w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Открыть проверку
          </Link>
        </div>

        <ul className="mt-4 grid gap-3 lg:grid-cols-3">
          {passport.readinessItems.map((item) => (
            <li
              key={item.id}
              className={`rounded-lg border px-4 py-3 ${
                item.done ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-sm font-semibold ${item.done ? 'text-emerald-900' : 'text-amber-950'}`}>
                    {item.label}
                  </p>
                  <p className={`mt-1 text-sm leading-6 ${item.done ? 'text-emerald-800' : 'text-amber-900'}`}>
                    {item.done ? 'Заполнено.' : item.hint}
                  </p>
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    item.done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {item.done ? '✓' : '!'}
                </span>
              </div>
              {!item.done ? (
                <Link
                  href={item.actionHref}
                  className="mt-3 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100"
                >
                  {item.actionLabel}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
