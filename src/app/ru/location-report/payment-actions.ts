export type LocationReportPaymentAction =
  | { kind: 'yookassa'; label: string; url: string }
  | { kind: 'manual_contact'; label: string; url: string }
  | { kind: 'none' };

export function getLocationReportPaymentAction(status: {
  access_status?: string;
  payment_provider?: 'manual' | 'yookassa';
  payment_url?: string | null;
} | null | undefined): LocationReportPaymentAction {
  if (status?.access_status !== 'pending_payment') return { kind: 'none' };
  if (status.payment_provider === 'yookassa' && status.payment_url) {
    return {
      kind: 'yookassa',
      label: 'Оплатить картой / СБП',
      url: status.payment_url,
    };
  }
  return {
    kind: 'manual_contact',
    label: 'Связаться для оплаты',
    url: 'mailto:info@asi-global.ru?subject=Полный%20отчёт%20по%20локации',
  };
}
