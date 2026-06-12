'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OpsProperty, PropertyMedia } from '@/lib/ops-foundation/types';
import {
  SETUP_CHANNEL_CATALOG,
  SETUP_CHANNEL_STATUS_LABELS,
  createEmptySetupData,
  isSetupAddressComplete,
  isSetupBasicComplete,
  isSetupChannelsSelected,
  isSetupCheckInComplete,
  isSetupDescriptionComplete,
  isSetupPricingComplete,
  isSetupRulesComplete,
  isSetupUnitsComplete,
  isSetupWifiComplete,
  normalizeSetupData,
  type PropertySetupChannelStatus,
  type PropertySetupData,
  type PropertySetupUnit,
} from '@/lib/property-setup/setup-data';

const inputCls = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';
const textareaCls = `${inputCls} min-h-[88px]`;
const primaryBtn = 'inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50';
const ghostBtn = 'inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

type FlatSection = 'basic' | 'address' | 'description' | 'rules' | 'checkInOut' | 'wifi' | 'pricing';

const SECTION_NAV: Array<{ anchor: string; label: string }> = [
  { anchor: 'basic', label: 'Основная информация' },
  { anchor: 'address', label: 'Адрес' },
  { anchor: 'units', label: 'Категории/юниты' },
  { anchor: 'photos', label: 'Фото' },
  { anchor: 'description', label: 'Описание' },
  { anchor: 'rules', label: 'Правила' },
  { anchor: 'checkin', label: 'Заезд/выезд' },
  { anchor: 'wifi', label: 'Wi-Fi/инструкции' },
  { anchor: 'pricing', label: 'Цены' },
  { anchor: 'channels', label: 'Каналы' },
  { anchor: 'readiness', label: 'Готовность' },
];

function Section({
  id,
  step,
  title,
  subtitle,
  children,
}: {
  id: string;
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {step}
          </span>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        </div>
        {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

function emptyUnit(): PropertySetupUnit {
  return { name: '', count: '', capacity: '', bedType: '', amenities: '' };
}

const channelStatusTone: Record<PropertySetupChannelStatus, string> = {
  not_connected: 'bg-slate-100 text-slate-600 border-slate-200',
  needs_credentials: 'bg-amber-50 text-amber-800 border-amber-200',
  preparing: 'bg-sky-50 text-sky-800 border-sky-200',
  shadow: 'bg-violet-50 text-violet-800 border-violet-200',
};

export function PropertySetupClient({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<OpsProperty | null>(null);
  const [data, setData] = useState<PropertySetupData>(createEmptySetupData());
  const [media, setMedia] = useState<PropertyMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [extrasWarning, setExtrasWarning] = useState(false);

  const [photoUrl, setPhotoUrl] = useState('');
  const [photoTitle, setPhotoTitle] = useState('');
  const [addingPhoto, setAddingPhoto] = useState(false);

  const loadMedia = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/properties/${propertyId}/media`);
      const json = (await res.json()) as { ok?: boolean; media?: PropertyMedia[] };
      if (res.ok && json.ok) setMedia(json.media ?? []);
    } catch {
      // фото не критичны для загрузки страницы
    }
  }, [propertyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/properties/${propertyId}/setup`);
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        property?: OpsProperty;
        setup?: unknown;
      };
      if (!res.ok || !json.ok) {
        setError(json.error === 'property_not_found' ? 'Объект не найден.' : 'Не удалось загрузить данные объекта.');
        setLoading(false);
        return;
      }
      setProperty(json.property ?? null);
      setData(normalizeSetupData(json.setup));
      await loadMedia();
    } catch {
      setError('Ошибка сети при загрузке. Обновите страницу.');
    } finally {
      setLoading(false);
    }
  }, [propertyId, loadMedia]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateFlat(section: FlatSection, key: string, value: string) {
    setData((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as unknown as Record<string, string>), [key]: value },
    }));
  }

  function updateUnit(index: number, key: keyof PropertySetupUnit, value: string) {
    setData((prev) => ({
      ...prev,
      units: prev.units.map((unit, i) => (i === index ? { ...unit, [key]: value } : unit)),
    }));
  }

  function addUnit() {
    setData((prev) => ({ ...prev, units: [...prev.units, emptyUnit()] }));
  }

  function removeUnit(index: number) {
    setData((prev) => ({ ...prev, units: prev.units.filter((_, i) => i !== index) }));
  }

  function setChannelStatus(code: string, status: PropertySetupChannelStatus) {
    setData((prev) => ({
      ...prev,
      channels: prev.channels.map((channel) => (channel.code === code ? { ...channel, status } : channel)),
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/ops/properties/${propertyId}/setup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: data }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; extrasPersisted?: boolean };
      if (!res.ok || !json.ok) {
        setError('Не удалось сохранить черновик. Попробуйте ещё раз.');
        return;
      }
      setExtrasWarning(json.extrasPersisted === false);
      setMessage('Черновик сохранён.');
    } catch {
      setError('Ошибка сети при сохранении.');
    } finally {
      setSaving(false);
    }
  }

  async function addPhoto(e: React.FormEvent) {
    e.preventDefault();
    if (!photoUrl.trim()) return;
    setAddingPhoto(true);
    try {
      await fetch(`/api/ops/properties/${propertyId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: photoUrl.trim(), title: photoTitle.trim() || undefined }),
      });
      setPhotoUrl('');
      setPhotoTitle('');
      await loadMedia();
    } finally {
      setAddingPhoto(false);
    }
  }

  async function removePhoto(mediaId: string) {
    await fetch(`/api/ops/properties/${propertyId}/media/${mediaId}`, { method: 'DELETE' });
    await loadMedia();
  }

  async function makeCover(mediaId: string) {
    await Promise.all(
      media.map((item) =>
        fetch(`/api/ops/properties/${propertyId}/media/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isCover: item.id === mediaId }),
        }),
      ),
    );
    await loadMedia();
  }

  const activeMedia = useMemo(() => media.filter((item) => item.status !== 'deleted'), [media]);
  const mediaCount = activeMedia.length;

  const checklist = useMemo(
    () => [
      { label: 'Основная информация заполнена', done: isSetupBasicComplete(data) },
      { label: 'Адрес заполнен', done: isSetupAddressComplete(data) },
      { label: 'Категории/юниты добавлены', done: isSetupUnitsComplete(data) },
      { label: 'Фото добавлены', done: mediaCount > 0 },
      { label: 'Описание заполнено', done: isSetupDescriptionComplete(data) },
      { label: 'Правила заполнены', done: isSetupRulesComplete(data) },
      { label: 'Заезд/выезд заполнены', done: isSetupCheckInComplete(data) },
      { label: 'Wi-Fi/инструкции заполнены', done: isSetupWifiComplete(data) },
      { label: 'Цены заполнены', done: isSetupPricingComplete(data) },
      { label: 'Каналы выбраны', done: isSetupChannelsSelected(data) },
    ],
    [data, mediaCount],
  );
  const completed = checklist.filter((item) => item.done).length;

  if (loading) {
    return <p className="text-sm text-slate-500">Загрузка подготовки объекта…</p>;
  }

  if (error && !property) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-700">{error}</p>
        <Link href="/dashboard/properties" className="text-sm text-slate-600 hover:underline">
          ← К списку объектов
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <div>
        <Link href={`/dashboard/properties/${propertyId}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← К объекту
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Подготовка объекта</h1>
        <p className="mt-1 text-sm text-slate-600">
          {property?.title ?? 'Объект'} — заполните данные один раз. Дальше ASI структурирует их,
          подготовит карточки для каналов и посчитает готовность.
        </p>
        <p className="mt-2 text-sm font-medium text-slate-700">
          Сценарий: заполнить объект → проверить готовность → подключить каналы.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
        {SECTION_NAV.map((item) => (
          <a
            key={item.anchor}
            href={`#${item.anchor}`}
            className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
          >
            {item.label}
          </a>
        ))}
      </nav>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}
      {error && property ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {extrasWarning ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Основные данные сохранены. Расширенные поля (категории, цены, выбор каналов) будут сохраняться
          после применения обновления базы данных.
        </div>
      ) : null}

      {/* 1. Основная информация */}
      <Section id="basic" step={1} title="Основная информация" subtitle="Базовые сведения об объекте.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Название объекта">
            <input
              className={inputCls}
              value={data.basic.title}
              onChange={(e) => updateFlat('basic', 'title', e.target.value)}
              placeholder="Апартаменты на Тверской"
            />
          </Field>
          <Field label="Тип объекта">
            <input
              className={inputCls}
              value={data.basic.propertyType}
              onChange={(e) => updateFlat('basic', 'propertyType', e.target.value)}
              placeholder="Квартира, апартаменты, дом…"
            />
          </Field>
          <Field label="Город">
            <input
              className={inputCls}
              value={data.basic.city}
              onChange={(e) => updateFlat('basic', 'city', e.target.value)}
              placeholder="Москва"
            />
          </Field>
          <Field label="Краткое описание">
            <input
              className={inputCls}
              value={data.basic.shortSummary}
              onChange={(e) => updateFlat('basic', 'shortSummary', e.target.value)}
              placeholder="Уютные апартаменты в центре"
            />
          </Field>
        </div>
      </Section>

      {/* 2. Адрес */}
      <Section id="address" step={2} title="Адрес" subtitle="Адрес нужен для карточек каналов и инструкций гостю.">
        <div className="grid gap-4">
          <Field label="Адрес">
            <input
              className={inputCls}
              value={data.address.line}
              onChange={(e) => updateFlat('address', 'line', e.target.value)}
              placeholder="ул. Тверская, 1, кв. 10"
            />
          </Field>
          <Field label="Район / ориентир">
            <input
              className={inputCls}
              value={data.address.district}
              onChange={(e) => updateFlat('address', 'district', e.target.value)}
              placeholder="Центр, рядом с метро"
            />
          </Field>
          <Field label="Комментарий по входу / доступу">
            <textarea
              className={textareaCls}
              value={data.address.accessNote}
              onChange={(e) => updateFlat('address', 'accessNote', e.target.value)}
              placeholder="Вход со двора, код от подъезда…"
            />
          </Field>
        </div>
      </Section>

      {/* 3. Категории/юниты */}
      <Section
        id="units"
        step={3}
        title="Категории и юниты"
        subtitle="Опишите категории размещения. Если объект один — добавьте один юнит."
      >
        <div className="space-y-4">
          {data.units.length === 0 ? (
            <p className="text-sm text-slate-500">Юниты ещё не добавлены.</p>
          ) : (
            data.units.map((unit, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Название юнита / категории">
                    <input className={inputCls} value={unit.name} onChange={(e) => updateUnit(index, 'name', e.target.value)} />
                  </Field>
                  <Field label="Количество">
                    <input className={inputCls} value={unit.count} onChange={(e) => updateUnit(index, 'count', e.target.value)} placeholder="1" />
                  </Field>
                  <Field label="Вместимость (гостей)">
                    <input className={inputCls} value={unit.capacity} onChange={(e) => updateUnit(index, 'capacity', e.target.value)} placeholder="2" />
                  </Field>
                  <Field label="Тип кроватей">
                    <input className={inputCls} value={unit.bedType} onChange={(e) => updateUnit(index, 'bedType', e.target.value)} placeholder="Двуспальная" />
                  </Field>
                  <Field label="Базовые удобства">
                    <input
                      className={inputCls}
                      value={unit.amenities}
                      onChange={(e) => updateUnit(index, 'amenities', e.target.value)}
                      placeholder="Кондиционер, кухня, стиральная машина"
                    />
                  </Field>
                </div>
                <button type="button" onClick={() => removeUnit(index)} className="mt-3 text-xs font-medium text-red-600 hover:underline">
                  Удалить юнит
                </button>
              </div>
            ))
          )}
          <button type="button" onClick={addUnit} className={ghostBtn}>
            + Добавить юнит
          </button>
        </div>
      </Section>

      {/* 4. Фото */}
      <Section id="photos" step={4} title="Фото" subtitle="Добавьте фото по ссылке. Список ниже — уже добавленные фото.">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Загрузка файлов с устройства будет подключена следующим шагом. Сейчас можно добавить фото по ссылке (URL).
        </div>
        <form onSubmit={addPhoto} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Ссылка на фото (URL)">
            <input className={inputCls} value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Подпись (необязательно)">
            <input className={inputCls} value={photoTitle} onChange={(e) => setPhotoTitle(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <button type="submit" disabled={addingPhoto || !photoUrl.trim()} className={primaryBtn}>
              {addingPhoto ? 'Добавление…' : 'Добавить фото'}
            </button>
          </div>
        </form>
        <div className="mt-5">
          {activeMedia.length === 0 ? (
            <p className="text-sm text-slate-500">Фото пока нет.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {activeMedia.map((item) => (
                <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">{item.title ?? 'Без подписи'}</p>
                    {item.isCover ? (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Главное фото
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 break-all text-xs text-slate-500">{item.url ?? item.storagePath}</p>
                  <div className="mt-2 flex gap-3">
                    {!item.isCover ? (
                      <button type="button" onClick={() => void makeCover(item.id)} className="text-xs font-medium text-slate-700 hover:underline">
                        Сделать главным
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void removePhoto(item.id)} className="text-xs font-medium text-red-600 hover:underline">
                      Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* 5. Описание */}
      <Section id="description" step={5} title="Описание" subtitle="Тексты для гостей и карточек на каналах.">
        <div className="grid gap-4">
          <Field label="Полное описание объекта">
            <textarea className={textareaCls} value={data.description.full} onChange={(e) => updateFlat('description', 'full', e.target.value)} />
          </Field>
          <Field label="Короткое описание для OTA">
            <textarea className={textareaCls} value={data.description.shortForOta} onChange={(e) => updateFlat('description', 'shortForOta', e.target.value)} />
          </Field>
          <Field label="Преимущества">
            <textarea
              className={textareaCls}
              value={data.description.advantages}
              onChange={(e) => updateFlat('description', 'advantages', e.target.value)}
              placeholder="Тихий двор, новый ремонт, рядом метро…"
            />
          </Field>
        </div>
      </Section>

      {/* 6. Правила проживания */}
      <Section id="rules" step={6} title="Правила проживания" subtitle="Заполните, что важно для гостей.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Курение">
            <input className={inputCls} value={data.rules.smoking} onChange={(e) => updateFlat('rules', 'smoking', e.target.value)} placeholder="Запрещено" />
          </Field>
          <Field label="Животные">
            <input className={inputCls} value={data.rules.pets} onChange={(e) => updateFlat('rules', 'pets', e.target.value)} placeholder="По согласованию" />
          </Field>
          <Field label="Вечеринки">
            <input className={inputCls} value={data.rules.parties} onChange={(e) => updateFlat('rules', 'parties', e.target.value)} placeholder="Запрещены" />
          </Field>
          <Field label="Дети">
            <input className={inputCls} value={data.rules.children} onChange={(e) => updateFlat('rules', 'children', e.target.value)} placeholder="Разрешены" />
          </Field>
          <Field label="Депозит">
            <input className={inputCls} value={data.rules.deposit} onChange={(e) => updateFlat('rules', 'deposit', e.target.value)} placeholder="5000 ₽" />
          </Field>
          <Field label="Документы">
            <input className={inputCls} value={data.rules.documents} onChange={(e) => updateFlat('rules', 'documents', e.target.value)} placeholder="Паспорт при заселении" />
          </Field>
          <Field label="Тихие часы">
            <input className={inputCls} value={data.rules.quietHours} onChange={(e) => updateFlat('rules', 'quietHours', e.target.value)} placeholder="с 23:00 до 08:00" />
          </Field>
        </div>
      </Section>

      {/* 7. Заезд/выезд */}
      <Section id="checkin" step={7} title="Заезд и выезд" subtitle="Время и инструкции по заселению и выезду.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Время заезда">
            <input className={inputCls} value={data.checkInOut.checkInTime} onChange={(e) => updateFlat('checkInOut', 'checkInTime', e.target.value)} placeholder="14:00" />
          </Field>
          <Field label="Время выезда">
            <input className={inputCls} value={data.checkInOut.checkOutTime} onChange={(e) => updateFlat('checkInOut', 'checkOutTime', e.target.value)} placeholder="12:00" />
          </Field>
          <Field label="Инструкция заселения">
            <textarea className={textareaCls} value={data.checkInOut.checkInInstructions} onChange={(e) => updateFlat('checkInOut', 'checkInInstructions', e.target.value)} />
          </Field>
          <Field label="Инструкция выезда">
            <textarea className={textareaCls} value={data.checkInOut.checkOutInstructions} onChange={(e) => updateFlat('checkInOut', 'checkOutInstructions', e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* 8. Wi-Fi/инструкции */}
      <Section id="wifi" step={8} title="Wi-Fi и инструкции" subtitle="Доступ к сети и бытовые детали для гостя.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Название Wi-Fi">
            <input className={inputCls} value={data.wifi.wifiName} onChange={(e) => updateFlat('wifi', 'wifiName', e.target.value)} />
          </Field>
          <Field label="Пароль Wi-Fi">
            <input className={inputCls} value={data.wifi.wifiPassword} onChange={(e) => updateFlat('wifi', 'wifiPassword', e.target.value)} />
          </Field>
          <Field label="Как попасть в объект">
            <textarea className={textareaCls} value={data.wifi.entryInstructions} onChange={(e) => updateFlat('wifi', 'entryInstructions', e.target.value)} />
          </Field>
          <Field label="Где ключи / код / домофон">
            <textarea className={textareaCls} value={data.wifi.keysInfo} onChange={(e) => updateFlat('wifi', 'keysInfo', e.target.value)} />
          </Field>
          <Field label="Важные бытовые инструкции">
            <textarea className={`${textareaCls} md:col-span-2`} value={data.wifi.householdInstructions} onChange={(e) => updateFlat('wifi', 'householdInstructions', e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* 9. Цены */}
      <Section id="pricing" step={9} title="Цены и базовый тариф" subtitle="Базовые условия. ASI подготовит тарифы для каналов.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Базовая цена за ночь, ₽">
            <input className={inputCls} value={data.pricing.basePricePerNight} onChange={(e) => updateFlat('pricing', 'basePricePerNight', e.target.value)} placeholder="5000" />
          </Field>
          <Field label="Минимальное количество ночей">
            <input className={inputCls} value={data.pricing.minNights} onChange={(e) => updateFlat('pricing', 'minNights', e.target.value)} placeholder="1" />
          </Field>
          <Field label="Доплата за гостя, ₽ (если есть)">
            <input className={inputCls} value={data.pricing.extraGuestFee} onChange={(e) => updateFlat('pricing', 'extraGuestFee', e.target.value)} />
          </Field>
          <Field label="Уборка, ₽ (если есть)">
            <input className={inputCls} value={data.pricing.cleaningFee} onChange={(e) => updateFlat('pricing', 'cleaningFee', e.target.value)} />
          </Field>
          <Field label="Депозит, ₽ (если есть)">
            <input className={inputCls} value={data.pricing.deposit} onChange={(e) => updateFlat('pricing', 'deposit', e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* 10. Каналы */}
      <Section
        id="channels"
        step={10}
        title="Каналы для подключения"
        subtitle="Подготовительный список. Реальное подключение OTA здесь не включается."
      >
        <ul className="divide-y divide-slate-100">
          {SETUP_CHANNEL_CATALOG.map((channel) => {
            const selection = data.channels.find((item) => item.code === channel.code);
            const status = selection?.status ?? 'not_connected';
            return (
              <li key={channel.code} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-slate-900">{channel.label}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${channelStatusTone[status]}`}>
                    {SETUP_CHANNEL_STATUS_LABELS[status]}
                  </span>
                </div>
                <select
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  value={status}
                  onChange={(e) => setChannelStatus(channel.code, e.target.value as PropertySetupChannelStatus)}
                >
                  {(Object.keys(SETUP_CHANNEL_STATUS_LABELS) as PropertySetupChannelStatus[]).map((value) => (
                    <option key={value} value={value}>
                      {SETUP_CHANNEL_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* 11. Проверка готовности */}
      <Section id="readiness" step={11} title="Проверка готовности" subtitle={`Заполнено ${completed} из ${checklist.length} пунктов.`}>
        <ul className="space-y-2">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {item.done ? '✓' : '—'}
              </span>
              <span className={`text-sm ${item.done ? 'text-slate-900' : 'text-slate-500'}`}>{item.label}</span>
            </li>
          ))}
        </ul>
        {completed < checklist.length ? (
          <p className="mt-4 text-sm text-slate-500">Заполните оставшиеся пункты — это нужно для подготовки карточек каналов.</p>
        ) : (
          <p className="mt-4 text-sm font-medium text-emerald-700">Все пункты заполнены. Объект готов к подключению каналов.</p>
        )}
      </Section>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <p className="text-sm text-slate-500">Готовность: {completed} из {checklist.length}</p>
        <button type="button" onClick={() => void save()} disabled={saving} className={primaryBtn}>
          {saving ? 'Сохранение…' : 'Сохранить черновик'}
        </button>
      </div>
    </div>
  );
}
