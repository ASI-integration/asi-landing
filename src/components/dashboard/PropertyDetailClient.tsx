'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  masterCardPublicationStatusLabels,
  opsIncidentSeverityLabels,
  opsIncidentStatusLabels,
  opsPropertyTaskCategoryLabels,
  opsPropertyTaskPriorityLabels,
  opsPropertyTaskStatusLabels,
  propertyStatusLabels,
  reservationSourceChannelLabels,
  reservationStatusLabels,
} from '@/lib/ops-foundation/labels';
import type {
  MasterCardPublicationStatus,
  OpsIncident,
  OpsProperty,
  OpsPropertyTask,
  OpsReservation,
  PropertyMasterCard,
  PropertyMedia,
  PropertyStatus,
  ReservationSourceChannel,
} from '@/lib/ops-foundation/types';

type TabId = 'main' | 'master-card' | 'media' | 'reservations' | 'tasks' | 'incidents';

const tabs: { id: TabId; label: string }[] = [
  { id: 'main', label: 'Основное' },
  { id: 'master-card', label: 'Мастер-карточка' },
  { id: 'media', label: 'Фото' },
  { id: 'reservations', label: 'Бронирования' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'incidents', label: 'Инциденты' },
];

const inputCls = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
const textareaCls = `${inputCls} min-h-[88px]`;
const btnCls = 'inline-flex items-center px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  const res = await fetch(url, init);
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    return { ok: false, error: String(json.detail ?? json.error ?? 'request_failed') };
  }
  return { ok: true, data: json as T };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function MainTab({
  property,
  onSaved,
}: {
  property: OpsProperty;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(property.title);
  const [address, setAddress] = useState(property.address ?? '');
  const [city, setCity] = useState(property.city ?? '');
  const [timezone, setTimezone] = useState(property.timezone ?? '');
  const [status, setStatus] = useState<PropertyStatus>(property.status);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setTitle(property.title);
    setAddress(property.address ?? '');
    setCity(property.city ?? '');
    setTimezone(property.timezone ?? '');
    setStatus(property.status);
  }, [property]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await fetchJson(`/api/ops/properties/${property.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, address, city, timezone, status }),
    });
    setSaving(false);
    setMessage(result.ok ? 'Сохранено' : result.error ?? 'Ошибка');
    if (result.ok) onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-xl">
      <Field label="Название">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
      </Field>
      <Field label="Адрес">
        <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Город">
        <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Часовой пояс">
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls} placeholder="Europe/Moscow" />
      </Field>
      <Field label="Статус">
        <select value={status} onChange={(e) => setStatus(e.target.value as PropertyStatus)} className={inputCls}>
          {Object.entries(propertyStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <button type="submit" disabled={saving} className={btnCls}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </form>
  );
}

function MasterCardTab({ propertyId }: { propertyId: string }) {
  const [card, setCard] = useState<PropertyMasterCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    publicTitle: '',
    shortDescription: '',
    fullDescription: '',
    amenities: '',
    houseRules: '',
    checkInInstructions: '',
    checkOutInstructions: '',
    wifiName: '',
    wifiPassword: '',
    parkingInfo: '',
    depositInfo: '',
    extraFeesInfo: '',
    cancellationInfo: '',
    guestContactsInfo: '',
    internalNotes: '',
    publicationStatus: 'draft' as MasterCardPublicationStatus,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchJson<{ masterCard: PropertyMasterCard }>(`/api/ops/properties/${propertyId}/master-card`);
    if (result.ok && result.data?.masterCard) {
      const mc = result.data.masterCard;
      setCard(mc);
      setForm({
        publicTitle: mc.publicTitle ?? '',
        shortDescription: mc.shortDescription ?? '',
        fullDescription: mc.fullDescription ?? '',
        amenities: mc.amenities.join(', '),
        houseRules: mc.houseRules ?? '',
        checkInInstructions: mc.checkInInstructions ?? '',
        checkOutInstructions: mc.checkOutInstructions ?? '',
        wifiName: mc.wifiName ?? '',
        wifiPassword: mc.wifiPassword ?? '',
        parkingInfo: mc.parkingInfo ?? '',
        depositInfo: mc.depositInfo ?? '',
        extraFeesInfo: mc.extraFeesInfo ?? '',
        cancellationInfo: mc.cancellationInfo ?? '',
        guestContactsInfo: mc.guestContactsInfo ?? '',
        internalNotes: mc.internalNotes ?? '',
        publicationStatus: mc.publicationStatus,
      });
    }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await fetchJson(`/api/ops/properties/${propertyId}/master-card`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        amenities: form.amenities.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    });
    setSaving(false);
    setMessage(result.ok ? 'Мастер-карточка сохранена' : result.error ?? 'Ошибка');
    if (result.ok) void load();
  }

  if (loading) return <p className="text-sm text-slate-500">Загрузка…</p>;

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-sm text-slate-500">
        Единый источник правды по объекту. Данные пока не публикуются в OTA.
        {card ? ` Версия контента: ${card.contentVersion}.` : null}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Публичное название">
          <input value={form.publicTitle} onChange={(e) => setForm((f) => ({ ...f, publicTitle: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Статус публикации">
          <select
            value={form.publicationStatus}
            onChange={(e) => setForm((f) => ({ ...f, publicationStatus: e.target.value as MasterCardPublicationStatus }))}
            className={inputCls}
          >
            {Object.entries(masterCardPublicationStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Краткое описание">
          <textarea value={form.shortDescription} onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Полное описание">
          <textarea value={form.fullDescription} onChange={(e) => setForm((f) => ({ ...f, fullDescription: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Удобства (через запятую)">
          <input value={form.amenities} onChange={(e) => setForm((f) => ({ ...f, amenities: e.target.value }))} className={inputCls} placeholder="Wi-Fi, кондиционер, парковка" />
        </Field>
        <Field label="Правила дома">
          <textarea value={form.houseRules} onChange={(e) => setForm((f) => ({ ...f, houseRules: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Инструкция по заезду">
          <textarea value={form.checkInInstructions} onChange={(e) => setForm((f) => ({ ...f, checkInInstructions: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Инструкция по выезду">
          <textarea value={form.checkOutInstructions} onChange={(e) => setForm((f) => ({ ...f, checkOutInstructions: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Wi-Fi (имя)">
          <input value={form.wifiName} onChange={(e) => setForm((f) => ({ ...f, wifiName: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Wi-Fi (пароль)">
          <input value={form.wifiPassword} onChange={(e) => setForm((f) => ({ ...f, wifiPassword: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Парковка">
          <textarea value={form.parkingInfo} onChange={(e) => setForm((f) => ({ ...f, parkingInfo: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Депозит">
          <textarea value={form.depositInfo} onChange={(e) => setForm((f) => ({ ...f, depositInfo: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Доп. сборы">
          <textarea value={form.extraFeesInfo} onChange={(e) => setForm((f) => ({ ...f, extraFeesInfo: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Отмена">
          <textarea value={form.cancellationInfo} onChange={(e) => setForm((f) => ({ ...f, cancellationInfo: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Контакты для гостя">
          <textarea value={form.guestContactsInfo} onChange={(e) => setForm((f) => ({ ...f, guestContactsInfo: e.target.value }))} className={textareaCls} />
        </Field>
        <Field label="Внутренние заметки">
          <textarea value={form.internalNotes} onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))} className={textareaCls} />
        </Field>
      </div>
      <button type="submit" disabled={saving} className={btnCls}>{saving ? 'Сохранение…' : 'Сохранить мастер-карточку'}</button>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </form>
  );
}

function MediaTab({ propertyId }: { propertyId: string }) {
  const [media, setMedia] = useState<PropertyMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchJson<{ media: PropertyMedia[] }>(`/api/ops/properties/${propertyId}/media`);
    if (result.ok) setMedia(result.data?.media ?? []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    await fetchJson(`/api/ops/properties/${propertyId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }),
    });
    setUrl('');
    setTitle('');
    setAdding(false);
    void load();
  }

  async function remove(mediaId: string) {
    await fetch(`/api/ops/properties/${propertyId}/media/${mediaId}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 max-w-2xl">
        <Field label="URL фото *">
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} placeholder="https://..." required />
        </Field>
        <Field label="Подпись">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </Field>
        <div className="sm:col-span-2">
          <button type="submit" disabled={adding} className={btnCls}>{adding ? 'Добавление…' : 'Добавить фото'}</button>
        </div>
      </form>
      {loading ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : media.length === 0 ? (
        <p className="text-sm text-slate-500">Фото пока нет.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {media.map((item) => (
            <li key={item.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium text-slate-900">{item.title ?? 'Без подписи'}</p>
              <p className="mt-1 text-xs text-slate-500 break-all">{item.url ?? item.storagePath}</p>
              <button type="button" onClick={() => void remove(item.id)} className="mt-2 text-xs text-red-600 hover:underline">
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReservationsTab({ propertyId }: { propertyId: string }) {
  const [items, setItems] = useState<OpsReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [guestName, setGuestName] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [sourceChannel, setSourceChannel] = useState<ReservationSourceChannel>('direct');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchJson<{ reservations: OpsReservation[] }>(`/api/ops/reservations?propertyId=${propertyId}`);
    if (result.ok) setItems(result.data?.reservations ?? []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim() || !checkInDate || !checkOutDate) return;
    setAdding(true);
    await fetchJson('/api/ops/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId, guestName, checkInDate, checkOutDate, sourceChannel }),
    });
    setGuestName('');
    setCheckInDate('');
    setCheckOutDate('');
    setAdding(false);
    void load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 max-w-2xl">
        <Field label="Имя гостя *">
          <input value={guestName} onChange={(e) => setGuestName(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Канал">
          <select value={sourceChannel} onChange={(e) => setSourceChannel(e.target.value as ReservationSourceChannel)} className={inputCls}>
            {Object.entries(reservationSourceChannelLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Заезд *">
          <input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Выезд *">
          <input type="date" value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} className={inputCls} required />
        </Field>
        <div className="sm:col-span-2">
          <button type="submit" disabled={adding} className={btnCls}>{adding ? 'Создание…' : 'Создать бронирование'}</button>
        </div>
      </form>
      {loading ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">Бронирований пока нет.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className="font-medium text-slate-900">{item.guestName}</p>
              <p className="text-sm text-slate-500">
                {item.checkInDate} → {item.checkOutDate} · {reservationSourceChannelLabels[item.sourceChannel]} · {reservationStatusLabels[item.status]}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TasksTab({ propertyId }: { propertyId: string }) {
  const [items, setItems] = useState<OpsPropertyTask[]>([]);
  const [reservations, setReservations] = useState<OpsReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [reservationId, setReservationId] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [tasksRes, resRes] = await Promise.all([
      fetchJson<{ tasks: OpsPropertyTask[] }>(`/api/ops/tasks?propertyId=${propertyId}`),
      fetchJson<{ reservations: OpsReservation[] }>(`/api/ops/reservations?propertyId=${propertyId}`),
    ]);
    if (tasksRes.ok) setItems(tasksRes.data?.tasks ?? []);
    if (resRes.ok) setReservations(resRes.data?.reservations ?? []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    await fetchJson('/api/ops/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        title,
        reservationId: reservationId || undefined,
        category: 'other',
        source: 'manual',
      }),
    });
    setTitle('');
    setReservationId('');
    setAdding(false);
    void load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 max-w-2xl">
        <Field label="Заголовок *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Бронирование (опционально)">
          <select value={reservationId} onChange={(e) => setReservationId(e.target.value)} className={inputCls}>
            <option value="">Без привязки</option>
            {reservations.map((r) => (
              <option key={r.id} value={r.id}>{r.guestName} ({r.checkInDate})</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <button type="submit" disabled={adding} className={btnCls}>{adding ? 'Создание…' : 'Создать задачу'}</button>
        </div>
      </form>
      {loading ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">Задач пока нет.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className="font-medium text-slate-900">{item.title}</p>
              <p className="text-sm text-slate-500">
                {opsPropertyTaskCategoryLabels[item.category]} · {opsPropertyTaskPriorityLabels[item.priority]} · {opsPropertyTaskStatusLabels[item.status]}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IncidentsTab({ propertyId }: { propertyId: string }) {
  const [items, setItems] = useState<OpsIncident[]>([]);
  const [reservations, setReservations] = useState<OpsReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reservationId, setReservationId] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [incRes, resRes] = await Promise.all([
      fetchJson<{ incidents: OpsIncident[] }>(`/api/ops/incidents?propertyId=${propertyId}`),
      fetchJson<{ reservations: OpsReservation[] }>(`/api/ops/reservations?propertyId=${propertyId}`),
    ]);
    if (incRes.ok) setItems(incRes.data?.incidents ?? []);
    if (resRes.ok) setReservations(resRes.data?.reservations ?? []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    await fetchJson('/api/ops/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        title,
        description: description || undefined,
        reservationId: reservationId || undefined,
        source: 'manual',
      }),
    });
    setTitle('');
    setDescription('');
    setReservationId('');
    setAdding(false);
    void load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 max-w-2xl">
        <Field label="Заголовок *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Бронирование (опционально)">
          <select value={reservationId} onChange={(e) => setReservationId(e.target.value)} className={inputCls}>
            <option value="">Без привязки</option>
            {reservations.map((r) => (
              <option key={r.id} value={r.id}>{r.guestName} ({r.checkInDate})</option>
            ))}
          </select>
        </Field>
        <Field label="Описание">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${textareaCls} sm:col-span-2`} />
        </Field>
        <div className="sm:col-span-2">
          <button type="submit" disabled={adding} className={btnCls}>{adding ? 'Создание…' : 'Создать инцидент'}</button>
        </div>
      </form>
      {loading ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">Инцидентов пока нет.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className="font-medium text-slate-900">{item.title}</p>
              <p className="text-sm text-slate-500">
                {opsIncidentSeverityLabels[item.severity]} · {opsIncidentStatusLabels[item.status]}
                {item.escalationRequired ? ' · Требуется эскалация' : ''}
              </p>
              {item.description ? <p className="mt-1 text-sm text-slate-600">{item.description}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PropertyDetailClient({ propertyId }: { propertyId: string }) {
  const [tab, setTab] = useState<TabId>('main');
  const [property, setProperty] = useState<OpsProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProperty = useCallback(async () => {
    setLoading(true);
    const result = await fetchJson<{ property: OpsProperty }>(`/api/ops/properties/${propertyId}`);
    if (result.ok && result.data?.property) {
      setProperty(result.data.property);
      setError(null);
    } else {
      setProperty(null);
      setError(result.error ?? 'Объект не найден');
    }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void loadProperty();
  }, [loadProperty]);

  if (loading) return <p className="text-sm text-slate-500">Загрузка объекта…</p>;
  if (!property) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-700">{error ?? 'Объект не найден'}</p>
        <Link href="/dashboard/properties" className="text-sm text-slate-600 hover:underline">← К списку объектов</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/dashboard/properties" className="text-sm text-slate-500 hover:text-slate-700">← Объекты</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{property.title}</h1>
          <p className="text-sm text-slate-500">{propertyStatusLabels[property.status]}</p>
        </div>
        <Link
          href={`/dashboard/properties/${property.id}/setup`}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Данные объекта для каналов
        </Link>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === item.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section className="bg-white rounded-xl border border-slate-200 p-6">
        {tab === 'main' ? <MainTab property={property} onSaved={loadProperty} /> : null}
        {tab === 'master-card' ? <MasterCardTab propertyId={property.id} /> : null}
        {tab === 'media' ? <MediaTab propertyId={property.id} /> : null}
        {tab === 'reservations' ? <ReservationsTab propertyId={property.id} /> : null}
        {tab === 'tasks' ? <TasksTab propertyId={property.id} /> : null}
        {tab === 'incidents' ? <IncidentsTab propertyId={property.id} /> : null}
      </section>
    </div>
  );
}
