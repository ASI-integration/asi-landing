'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import { readResponseJson } from '@/lib/safeResponseJson';
import {
  BOOKING_CHANNEL_LABELS_RU,
  BOOKING_CHANNELS,
  BOOKING_STATUS_LABELS_RU,
  BOOKING_STATUSES,
  type BookingChannel,
  type BookingStatus,
  type PilotBooking,
} from '@/lib/bookings/types';

type BookingsResponse = {
  ok: boolean;
  message?: string;
  bookings: PilotBooking[];
  isOpsAdmin?: boolean;
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU');
}

function BookingsPageInner() {
  const [bookings, setBookings] = useState<PilotBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [isOpsAdmin, setIsOpsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [channel, setChannel] = useState<BookingChannel>('manual');
  const [status, setStatus] = useState<BookingStatus>('new');
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/bookings', { credentials: 'include' });
      const payload = await readResponseJson<BookingsResponse>(res, { ok: false, bookings: [] });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить брони.');
        return;
      }
      setBookings(payload.bookings);
      setIsOpsAdmin(Boolean(payload.isOpsAdmin));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isOpsAdmin) return;
    setCreating(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/bookings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          guestName,
          guestContact,
          checkIn,
          checkOut,
          channel,
          status,
          comment,
        }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(res, { ok: false });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось создать бронь.');
        return;
      }
      setMessage('Бронь создана. OPS-задачи обновятся автоматически.');
      setShowForm(false);
      setGuestName('');
      setGuestContact('');
      setCheckIn('');
      setCheckOut('');
      setComment('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Бронирования</h1>
          <p className="mt-2 text-lg text-slate-500 leading-relaxed">
            Ручной ввод брони для пилота. После сохранения создаются OPS-задачи заезда, выезда и уборки.
          </p>
        </div>
        {isOpsAdmin ? (
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {showForm ? 'Скрыть форму' : 'Добавить бронь'}
          </button>
        ) : null}
      </header>

      {message ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      {showForm && isOpsAdmin ? (
        <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Объект (ID)</span>
              <input
                required
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Имя гостя</span>
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Контакт гостя</span>
              <input
                value={guestContact}
                onChange={(e) => setGuestContact(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Канал</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as BookingChannel)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {BOOKING_CHANNELS.map((item) => (
                  <option key={item} value={item}>
                    {BOOKING_CHANNEL_LABELS_RU[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Заезд</span>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Выезд</span>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Статус</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BookingStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {BOOKING_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {BOOKING_STATUS_LABELS_RU[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="font-medium text-slate-700">Комментарий</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {creating ? 'Сохранение…' : 'Сохранить бронь'}
          </button>
        </form>
      ) : null}

      {loading ? (
        <p className="text-slate-500">Загрузка…</p>
      ) : bookings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-5 text-slate-600">
          Пока нет броней. {isOpsAdmin ? 'Добавьте первую бронь вручную.' : ''}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Гость</th>
                <th className="px-4 py-3 font-medium">Объект</th>
                <th className="px-4 py-3 font-medium">Заезд</th>
                <th className="px-4 py-3 font-medium">Выезд</th>
                <th className="px-4 py-3 font-medium">Канал</th>
                <th className="px-4 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{booking.guestName || '—'}</div>
                    <div className="text-slate-500">{booking.guestContact || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{booking.propertyId}</td>
                  <td className="px-4 py-3">{formatDate(booking.checkIn)}</td>
                  <td className="px-4 py-3">{formatDate(booking.checkOut)}</td>
                  <td className="px-4 py-3">{BOOKING_CHANNEL_LABELS_RU[booking.channel]}</td>
                  <td className="px-4 py-3">{BOOKING_STATUS_LABELS_RU[booking.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BookingsPage() {
  return (
    <CrmAccessGuard>
      <BookingsPageInner />
    </CrmAccessGuard>
  );
}
