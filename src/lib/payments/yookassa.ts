import { PaymentProvider, PaymentRequest, PaymentStatus } from './types';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  buildYooKassaReceiptDraft,
  getYooKassaConfig,
  getYooKassaReturnUrl,
  isYooKassaEnabled,
  YOOKASSA_PENDING_REVIEW_MESSAGE,
} from './yookassa-env';
import { getYooKassaHttp } from './yookassa-http';

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
  amountValue?: string;
  currency?: string;
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
  createPayment(params: YooKassaPaymentInput): Promise<YooKassaDisabledPayment | {
    provider: 'yookassa';
    status: 'pending';
    paymentUrl: string;
    transactionId: string;
  }>;
  getPayment(transactionId: string): Promise<YooKassaPaymentStatus>;
  getPaymentStatus(transactionId: string): Promise<YooKassaPaymentStatus>;
  handleWebhook(payload: string | Buffer, signature?: string): Promise<YooKassaWebhookResult>;
}

export class YooKassaDisabledError extends Error {
  constructor() {
    super(YOOKASSA_PENDING_REVIEW_MESSAGE);
    this.name = 'YooKassaDisabledError';
  }
}

function mapStatus(status: string): PaymentStatus {
  if (status === 'succeeded') return 'paid';
  if (status === 'canceled') return 'cancelled';
  return 'pending';
}

export class YookassaProvider implements PaymentProvider, YooKassaProviderSkeleton {
  async createPayment(params: YooKassaPaymentInput) {
    if (!isYooKassaEnabled()) {
      return {
        provider: 'yookassa' as const,
        status: 'disabled' as const,
        paymentUrl: null,
        transactionId: null,
        message: YOOKASSA_PENDING_REVIEW_MESSAGE,
      };
    }

    const created = await this.createPaymentLink(params);
    return {
      provider: 'yookassa' as const,
      status: 'pending' as const,
      paymentUrl: created.paymentUrl,
      transactionId: created.transactionId,
    };
  }

  async getPayment(transactionId: string): Promise<YooKassaPaymentStatus> {
    return this.getPaymentStatus(transactionId);
  }

  async getPaymentStatus(transactionId: string): Promise<YooKassaPaymentStatus> {
    const config = getYooKassaConfig();
    if (!config) {
      return {
        provider: 'yookassa',
        status: 'disabled',
        transactionId: null,
        message: YOOKASSA_PENDING_REVIEW_MESSAGE,
      };
    }

    const http = getYooKassaHttp();
    const response = await http({
      method: 'GET',
      path: `/payments/${encodeURIComponent(transactionId)}`,
      shopId: config.shopId,
      secretKey: config.secretKey,
    });
    if (!response.ok || !response.json || typeof response.json !== 'object') {
      throw new Error(`YooKassa getPayment failed (${response.status})`);
    }
    const body = response.json as {
      id?: string;
      status?: string;
      amount?: { value?: string; currency?: string };
    };
    return {
      provider: 'yookassa',
      status: mapStatus(body.status ?? 'pending'),
      transactionId: body.id ?? transactionId,
      amountValue: body.amount?.value,
      currency: body.amount?.currency,
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

  async createPaymentLink(
    params: YooKassaPaymentInput,
  ): Promise<{ paymentUrl: string; transactionId: string }> {
    const config = getYooKassaConfig();
    if (!config) {
      throw new YooKassaDisabledError();
    }

    const amountValue = (params.amount / 100).toFixed(2);
    const receipt = buildYooKassaReceiptDraft({
      description: params.description || COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
      amountValue,
      currency: params.currency,
    });

    const body: Record<string, unknown> = {
      amount: {
        value: amountValue,
        currency: params.currency,
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: getYooKassaReturnUrl(params.id),
      },
      description: params.description || COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
      metadata: {
        payment_id: params.id,
        service_type: params.serviceType ?? 'communication_pilot_object_month',
        ...(params.ownerId ? { owner_id: params.ownerId } : {}),
        ...(params.reservationId ? { request_id: params.reservationId } : {}),
        ...(params.metadata ?? {}),
      },
    };
    if (receipt) {
      body.receipt = receipt;
    }

    const http = getYooKassaHttp();
    const response = await http({
      method: 'POST',
      path: '/payments',
      shopId: config.shopId,
      secretKey: config.secretKey,
      idempotenceKey: params.idempotencyKey ?? params.id,
      body,
    });

    if (!response.ok || !response.json || typeof response.json !== 'object') {
      throw new Error(`YooKassa payment creation failed (${response.status})`);
    }

    const payment = response.json as {
      id?: string;
      confirmation?: { confirmation_url?: string };
    };
    const paymentUrl = payment.confirmation?.confirmation_url;
    if (!payment.id || !paymentUrl) {
      throw new Error('YooKassa payment response is incomplete');
    }

    return { paymentUrl, transactionId: payment.id };
  }

  verifyWebhookSignature(_payload: string | Buffer, _signature: string): boolean {
    // YooKassa does not provide an HMAC signature for this webhook contract.
    // Authoritative verification is GET /payments/{id} after notification.
    return false;
  }

  async parseWebhookEvent(
    payload: string | Buffer,
    _signature: string,
  ): Promise<{ transactionId: string; status: PaymentStatus; eventId?: string; rawEvent: unknown }> {
    const bodyStr = typeof payload === 'string' ? payload : payload.toString('utf8');
    const event = JSON.parse(bodyStr) as {
      event?: string;
      object?: { id?: string; status?: string };
    };

    if (!event?.object?.id || !event.event) {
      throw new Error('Malformed YooKassa webhook payload');
    }

    let status: PaymentStatus = 'pending';
    if (event.event === 'payment.succeeded') status = 'paid';
    else if (event.event === 'payment.canceled') status = 'cancelled';
    else if (event.event === 'payment.waiting_for_capture') status = 'requires_action';

    return {
      transactionId: event.object.id,
      status,
      eventId: `${event.event}:${event.object.id}:${event.object.status ?? 'na'}`,
      rawEvent: event,
    };
  }
}
