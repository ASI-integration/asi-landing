import { PaymentProvider, PaymentRequest, PaymentStatus } from './types';
import {
  isYooKassaEnabled,
  YOOKASSA_PENDING_REVIEW_MESSAGE,
} from './yookassa-env';

export type YooKassaDisabledPayment = {
  provider: 'yookassa';
  status: 'disabled';
  paymentUrl: null;
  transactionId: null;
  message: string;
};

export type YooKassaPaymentStatus = {
  provider: 'yookassa';
  status: 'disabled' | PaymentStatus;
  transactionId: string | null;
  message?: string;
};

export type YooKassaWebhookResult = {
  provider: 'yookassa';
  received: boolean;
  handled: boolean;
  status: 'disabled' | PaymentStatus;
  transactionId: string | null;
  eventId?: string;
  message?: string;
};

type YooKassaPaymentInput = Omit<
  PaymentRequest,
  'provider' | 'providerTransactionId' | 'status' | 'createdAt' | 'updatedAt' | 'paymentUrl'
>;

export interface YooKassaProviderSkeleton {
  createPayment(params: YooKassaPaymentInput): Promise<YooKassaDisabledPayment>;
  getPaymentStatus(transactionId: string): Promise<YooKassaPaymentStatus>;
  handleWebhook(payload: string | Buffer, signature?: string): Promise<YooKassaWebhookResult>;
}

export class YooKassaDisabledError extends Error {
  constructor() {
    super(YOOKASSA_PENDING_REVIEW_MESSAGE);
    this.name = 'YooKassaDisabledError';
  }
}

export class YookassaProvider implements PaymentProvider, YooKassaProviderSkeleton {
  async createPayment(_params: YooKassaPaymentInput): Promise<YooKassaDisabledPayment> {
    return {
      provider: 'yookassa',
      status: 'disabled',
      paymentUrl: null,
      transactionId: null,
      message: YOOKASSA_PENDING_REVIEW_MESSAGE,
    };
  }

  async getPaymentStatus(_transactionId: string): Promise<YooKassaPaymentStatus> {
    return {
      provider: 'yookassa',
      status: 'disabled',
      transactionId: null,
      message: YOOKASSA_PENDING_REVIEW_MESSAGE,
    };
  }

  async handleWebhook(payload: string | Buffer, signature = ''): Promise<YooKassaWebhookResult> {
    if (!isYooKassaEnabled()) {
      return {
        provider: 'yookassa',
        received: true,
        handled: false,
        status: 'disabled',
        transactionId: null,
        message: YOOKASSA_PENDING_REVIEW_MESSAGE,
      };
    }

    const event = await this.parseWebhookEvent(payload, signature);
    return {
      provider: 'yookassa',
      received: true,
      handled: false,
      status: event.status,
      transactionId: event.transactionId,
      eventId: event.eventId,
    };
  }

  async createPaymentLink(params: YooKassaPaymentInput): Promise<{ paymentUrl: string; transactionId: string }> {
    await this.createPayment(params);
    throw new YooKassaDisabledError();
  }

  verifyWebhookSignature(_payload: string | Buffer, _signature: string): boolean {
    // YooKassa uses IP whitelisting rather than HMAC signatures.
    // In production: verify the request originates from YooKassa's IP ranges.
    return true;
  }

  async parseWebhookEvent(
    payload: string | Buffer,
    _signature: string
  ): Promise<{ transactionId: string; status: PaymentStatus; eventId?: string; rawEvent: unknown }> {
    const bodyStr = typeof payload === 'string' ? payload : payload.toString('utf8');
    const event = JSON.parse(bodyStr);

    let status: PaymentStatus = 'pending';
    if (event.event === 'payment.succeeded') {
      status = 'paid';
    } else if (event.event === 'payment.canceled') {
      status = 'cancelled';
    }

    const transactionId: string = event.object.id;
    // YooKassa event objects use the payment ID as their unique identifier
    return { transactionId, status, eventId: transactionId, rawEvent: event };
  }
}
