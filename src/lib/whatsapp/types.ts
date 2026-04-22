export type WhatsAppWebhook = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: 'whatsapp';
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<WhatsAppInboundMessage>;
        statuses?: Array<any>;
      };
    }>;
  }>;
};

export type WhatsAppInboundMessage = {
  from?: string; // wa_id
  id?: string; // provider message id
  timestamp?: string;
  type?: 'text' | 'audio' | 'voice' | string;
  text?: { body?: string };
  audio?: {
    id?: string; // media id
    mime_type?: string;
    sha256?: string;
    voice?: boolean;
  };
};

export type WhatsAppAudioMessage = {
  waId: string;
  messageId: string;
  mediaId: string;
  mimeType?: string;
  timestamp?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  profileName?: string;
  rawMessage: WhatsAppInboundMessage;
  rawWebhook: WhatsAppWebhook;
};

export type WhatsAppMediaMeta = {
  id: string;
  url: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
};

export type WhatsAppSttResult = {
  transcript: string;
  confidence?: number;
  language?: string;
};

