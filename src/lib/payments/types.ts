export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export interface PaymentMetadata {
  reservationId?: string;
  propertyId?: string;
  serviceType?: string;
  guestId?: string;
  chatId?: number;
}

export interface PaymentRequest {
  id: string; // Internal UUID
  provider: 'stripe' | 'yookassa';
  providerTransactionId: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  metadata: PaymentMetadata;
  createdAt: Date;
  updatedAt: Date;
  checkoutUrl: string | null;
}

export interface PaymentProvider {
  /**
   * Generates a checkout session URL and returns the provider's transaction ID.
   */
  createPaymentLink(request: Omit<PaymentRequest, 'id' | 'provider' | 'providerTransactionId' | 'status' | 'createdAt' | 'updatedAt' | 'checkoutUrl'>): Promise<{ checkoutUrl: string; transactionId: string }>;

  /**
   * Verifies the cryptographic signature of the webhook event.
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;

  /**
   * Parses the webhook payload and returns the relevant transaction status updates.
   */
  parseWebhookEvent(payload: string | Buffer, signature: string): Promise<{ transactionId: string; status: PaymentStatus; rawEvent: any }>;
}
