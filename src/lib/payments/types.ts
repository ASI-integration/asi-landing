export type PaymentProviderType = 'stripe' | 'yookassa';

export type PaymentStatus =
  | 'pending'
  | 'requires_action'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded';

export interface PaymentRequest {
  id: string;
  provider: PaymentProviderType;
  providerTransactionId: string | null;
  reservationId?: string;
  propertyId?: string;
  listingId?: string;
  guestId?: string;
  /** Telegram chat ID stored as string for flexibility across channels */
  chatId?: string;
  amount: number;
  currency: string;
  description?: string;
  serviceType?: string;
  status: PaymentStatus;
  paymentUrl?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentProvider {
  /**
   * Creates a provider checkout session and returns the payment URL and provider transaction ID.
   * Receives the full internal record (minus provider-assigned fields) so it can embed the
   * internal payment ID in provider metadata for webhook correlation.
   */
  createPaymentLink(
    request: Omit<PaymentRequest, 'provider' | 'providerTransactionId' | 'status' | 'createdAt' | 'updatedAt' | 'paymentUrl'>
  ): Promise<{ paymentUrl: string; transactionId: string }>;

  /** Verifies the cryptographic signature / origin of the webhook request. */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;

  /**
   * Parses the webhook payload.
   * Returns the provider transaction ID, normalized status, an optional provider-level event ID
   * for deduplication, and the raw event for logging.
   */
  parseWebhookEvent(
    payload: string | Buffer,
    signature: string
  ): Promise<{ transactionId: string; status: PaymentStatus; eventId?: string; rawEvent: unknown }>;
}
