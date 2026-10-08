'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import {
  formatReservationStatusLabelRu,
  reservationEmptyMessages,
  type ReservationView,
} from '@/lib/reservations/views';

type Row = { id: string; asi_reference: string; property_id: string; unit_id: string | null; source_type: string; check_in_at: string; check_out_at: string; guest_name: string; normalized_status: string };
const tabs: Array<[ReservationView, string]> = [['upcoming', 'Предстоящие'], ['active', 'Сейчас проживают'], ['inquiries', 'Запросы и удержания'], ['conflicts', 'Конфликты'], ['cancelled', 'Отменённые'], ['all', 'Все']];

function Workspace() {
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<ReservationView>('upcoming');
  const [showForm, setShowForm] = useState<'reservation' | 'block' | null>(null);
  const [message, setMessage] = useState('');
  const [unassignedLegacyCount, setUnassignedLegacyCount] = useState(0);
  const [form, setForm] = useState({ propertyId: '', unitId: '', checkIn: '', checkOut: '', guestName: '', guestPhone: '', guestEmail: '', guestCount: '1', confirmationMode: 'inquiry' });

  const load = useCallback(async () => {
    const response = await fetch(`/api/dashboard/reservations?view=${view}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) return setMessage(body.message ?? 'Не удалось загрузить брони.');
    setRows(body.reservations ?? []);
    setUnassignedLegacyCount(body.unassignedLegacyCount ?? 0);
  }, [view]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    const response = await fetch('/api/dashboard/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, guestCount: Number(form.guestCount), sourceType: 'manual', idempotencyKey: crypto.randomUUID() }) });
    const body = await response.json();
    if (!response.ok) return setMessage(body.reservation?.conflicts?.length ? 'Эти даты заняты. Откройте список конфликтов и выберите другие даты.' : body.message ?? 'Не удалось сохранить бронь.');
    setMessage(form.confirmationMode === 'inquiry' ? 'Запрос сохранён. Даты пока не заняты.' : 'Бронь сохранена в едином календаре.');
    setShowForm(null);
    await load();
  }

  return <div className="max-w-7xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">Единый календарь броней</h1><p className="mt-1 text-slate-600">Все источники используют одну бронь и один календарь доступности.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setShowForm('reservation')} className="rounded-lg bg-slate-900 px-4 py-2 text-white">+ Добавить прямую бронь</button><button onClick={() => setShowForm('block')} className="rounded-lg border px-4 py-2">+ Закрыть даты</button><a href="/dashboard/onboarding" className="rounded-lg border px-4 py-2">Импортировать существующие брони</a><a href="/dashboard/booking-ops" className="rounded-lg border px-4 py-2">Подробная работа с бронью</a></div></header>
    <div className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <button key={key} onClick={() => setView(key)} aria-pressed={view === key} className={`rounded-full px-3 py-2 text-sm ${view === key ? 'bg-emerald-700 text-white' : 'border bg-white'}`}>{label}</button>)}</div>
    {showForm === 'reservation' ? <form onSubmit={submit} className="grid gap-3 rounded-xl border bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
      {([['propertyId', 'Объект', 'text'], ['unitId', 'Помещение', 'text'], ['checkIn', 'Заезд', 'date'], ['checkOut', 'Выезд', 'date'], ['guestName', 'Имя гостя', 'text'], ['guestPhone', 'Телефон', 'text'], ['guestEmail', 'Эл. почта', 'email'], ['guestCount', 'Количество гостей', 'number']] as const).map(([key, label, type]) => <label key={key} className="text-sm">{label}<input required={['propertyId', 'checkIn', 'checkOut', 'guestName', 'guestCount'].includes(key)} type={type} className="mt-1 w-full rounded border p-2" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })}/></label>)}
      <label className="text-sm">Режим<select className="mt-1 w-full rounded border p-2" value={form.confirmationMode} onChange={(event) => setForm({ ...form, confirmationMode: event.target.value })}><option value="inquiry">Запрос — даты не закрываются</option><option value="temporary_hold">Временно удержать даты</option><option value="confirmed">Подтверждено</option></select></label>
      <div className="flex items-end gap-2"><button className="rounded bg-emerald-700 px-4 py-2 text-white">Сохранить</button><button type="button" onClick={() => setShowForm(null)} className="rounded border px-4 py-2">Отмена</button></div>
    </form> : null}
    {showForm === 'block' ? <BlockForm onDone={async () => { setShowForm(null); await load(); }} onMessage={setMessage} /> : null}
    {unassignedLegacyCount > 0 ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Есть неназначенные старые брони. Запустите безопасное назначение аккаунту.</p> : null}
    {message ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">{message}</p> : null}
    <div className="overflow-x-auto rounded-xl border bg-white">{rows.length === 0 ? <p className="p-8 text-center text-slate-600">{reservationEmptyMessages[view]}</p> : <table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Номер', 'Гость', 'Объект', 'Даты', 'Источник', 'Статус'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-3 font-semibold">{row.asi_reference}</td><td className="p-3">{row.guest_name}</td><td className="p-3">{row.property_id}{row.unit_id ? ` / ${row.unit_id}` : ''}</td><td className="p-3">{new Date(row.check_in_at).toLocaleDateString('ru-RU')} — {new Date(row.check_out_at).toLocaleDateString('ru-RU')}</td><td className="p-3">{row.source_type}</td><td className="p-3">{formatReservationStatusLabelRu(row.normalized_status)}</td></tr>)}</tbody></table>}</div>
  </div>;
}

function BlockForm({ onDone, onMessage }: { onDone: () => void; onMessage: (message: string) => void }) {
  const [form, setForm] = useState({ propertyId: '', unitId: '', checkIn: '', checkOut: '', type: 'owner', note: '' });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/dashboard/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, action: 'block' }) });
    const body = await response.json();
    if (!response.ok) return onMessage(body.message ?? 'Не удалось закрыть даты.');
    onMessage(form.type === 'maintenance' ? 'Даты закрыты для ремонта.' : 'Даты закрыты для владельца.');
    onDone();
  }
  return <form onSubmit={submit} className="grid gap-3 rounded-xl border bg-white p-5 sm:grid-cols-2">{([['propertyId', 'Объект', 'text'], ['unitId', 'Помещение', 'text'], ['checkIn', 'С', 'date'], ['checkOut', 'До', 'date'], ['note', 'Заметка', 'text']] as const).map(([key, label, type]) => <label key={key}>{label}<input required={key !== 'unitId' && key !== 'note'} type={type} className="mt-1 w-full rounded border p-2" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })}/></label>)}<label>Причина<select className="mt-1 w-full rounded border p-2" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="owner">Проживание владельца</option><option value="maintenance">Ремонт</option></select></label><button className="rounded bg-slate-900 px-4 py-2 text-white">Закрыть даты</button></form>;
}

export default function Page() { return <CrmAccessGuard><Workspace /></CrmAccessGuard>; }
