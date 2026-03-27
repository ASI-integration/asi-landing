/**
 * Клиентская функция: создаёт платёж и ведёт на страницу оплаты ЮKassa.
 * Вызывать только из клиентских компонентов (после клика).
 */
export async function startYooKassaSubscriptionCheckout(amountCents = 99000): Promise<void> {
  const res = await fetch('/api/payments/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountCents }),
  });
  const data = (await res.json()) as { confirmation_url?: string; error?: string };
  if (!res.ok || !data.confirmation_url) {
    throw new Error(data.error || 'Не удалось создать платёж');
  }
  window.location.href = data.confirmation_url;
}
