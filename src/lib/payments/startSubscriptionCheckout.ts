import { YOOKASSA_PENDING_REVIEW_MESSAGE } from './yookassa-env';

/**
 * Клиентская заготовка под будущий checkout ЮKassa.
 * Сейчас платежи намеренно отключены до финальной проверки отчёта.
 */
export async function startYooKassaSubscriptionCheckout(amountCents = 99000): Promise<void> {
  void amountCents;
  throw new Error(YOOKASSA_PENDING_REVIEW_MESSAGE);
}
