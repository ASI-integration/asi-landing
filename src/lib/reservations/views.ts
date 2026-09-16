import type { ReservationStatus } from './types';

export type ReservationView = 'upcoming' | 'active' | 'inquiries' | 'conflicts' | 'cancelled' | 'all';

export type ReservationViewRow = {
  id: string;
  account_id?: string | null;
  normalized_status: string;
  check_in_at: string;
  check_out_at: string;
};

export function belongsToReservationAccount(row: { account_id?: string | null }, accountId: string): boolean {
  return typeof row.account_id === 'string' && row.account_id === accountId;
}

export const reservationEmptyMessages: Record<ReservationView, string> = {
  upcoming: 'Нет предстоящих броней',
  active: 'Сейчас никто не проживает',
  inquiries: 'Нет запросов или удержаний',
  conflicts: 'Нет нерешённых конфликтов',
  cancelled: 'Нет отменённых броней',
  all: 'Броней пока нет',
};

/** Owner Console labels for existing reservation lifecycle statuses. Display-only. */
export const RESERVATION_STATUS_LABELS_RU: Record<ReservationStatus, string> = {
  inquiry: 'Запрос',
  temporary_hold: 'Временное удержание',
  confirmed: 'Подтверждено',
  checked_in: 'Гость заехал',
  checked_out: 'Гость выехал',
  cancelled: 'Отменено',
};

export function formatReservationStatusLabelRu(status: string | null | undefined): string {
  const raw = String(status ?? '').trim();
  if (!raw) return '—';
  return RESERVATION_STATUS_LABELS_RU[raw as ReservationStatus] ?? raw;
}

export function isReservationVisibleInView(input: {
  row: ReservationViewRow;
  view: ReservationView;
  now: Date;
  activeHoldIds: Set<string>;
  conflictReservationIds: Set<string>;
}): boolean {
  const { row, view, now, activeHoldIds, conflictReservationIds } = input;
  if (view === 'all') return true;
  if (view === 'cancelled') return row.normalized_status === 'cancelled';
  if (view === 'conflicts') return conflictReservationIds.has(row.id);
  if (view === 'inquiries') return row.normalized_status === 'inquiry' || (row.normalized_status === 'temporary_hold' && activeHoldIds.has(row.id));
  if (view === 'active') {
    if (row.normalized_status === 'checked_in') return true;
    return row.normalized_status === 'confirmed' && new Date(row.check_in_at) <= now && new Date(row.check_out_at) > now;
  }
  if (row.normalized_status === 'cancelled' || row.normalized_status === 'inquiry') return false;
  if (row.normalized_status === 'temporary_hold' && !activeHoldIds.has(row.id)) return false;
  return new Date(row.check_out_at) > now;
}
