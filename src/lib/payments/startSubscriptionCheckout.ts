import { COMMUNICATION_PILOT_PRICE_KOPEKS, YOOKASSA_PENDING_REVIEW_MESSAGE } from './yookassa-env';

/**
 * Клиентская заготовка под checkout YooKassa для пилота коммуникационного модуля.
 * Если платежи отключены, пользователь видит понятный текст по текущей услуге.
 */
export async function startYooKassaSubscriptionCheckout(amountCents = COMMUNICATION_PILOT_PRICE_KOPEKS): Promise<void> {
  void amountCents;
  throw new Error(YOOKASSA_PENDING_REVIEW_MESSAGE);
}
