export type ProviderConfig =
  | {
      channel: 'WHATSAPP';
      phoneNumberId: string;
      apiVersion: string;
      accessToken: string;
    }
  | {
      channel: 'SMS';
      accountSid: string;
      messagingServiceSid: string;
      authToken: string;
    };
export interface PreparedMessage {
  recipient: string;
  body: string;
  callbackUrl?: string;
  template?: {
    name: string;
    language: string;
    parameters: string[];
    qrUrl?: string;
  };
}
export type SubmissionResult =
  | { status: 'ACCEPTED'; messageId: string }
  | {
      status: 'REJECTED';
      retryable: boolean;
      errorCode: string;
      retryAfterSeconds?: number;
    }
  | { status: 'UNKNOWN'; errorCode: string };
type HttpClient = (url: string, init: RequestInit) => Promise<Response>;

async function boundedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 65536) throw new Error('Provider response too large');
      chunks.push(next.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createTransport(http: HttpClient = fetch) {
  return async (
    config: ProviderConfig,
    message: PreparedMessage,
  ): Promise<SubmissionResult> => {
    if (!/^\+[1-9]\d{7,14}$/.test(message.recipient))
      throw new Error('A valid international phone number is required.');
    let url: string;
    let body: string;
    let headers: Record<string, string>;
    if (config.channel === 'WHATSAPP') {
      if (
        !/^\d+$/.test(config.phoneNumberId) ||
        !/^v\d+\.0$/.test(config.apiVersion) ||
        !config.accessToken
      )
        throw new Error('Invalid WhatsApp configuration.');
      const template = message.template;
      if (
        !template ||
        !/^[a-z0-9_]{1,512}$/.test(template.name) ||
        !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language)
      )
        throw new Error('An approved WhatsApp template is required.');
      if (template.qrUrl && new URL(template.qrUrl).protocol !== 'https:')
        throw new Error('A secure QR URL is required.');
      const components: unknown[] = [];
      if (template.qrUrl)
        components.push({
          type: 'header',
          parameters: [{ type: 'image', image: { link: template.qrUrl } }],
        });
      if (template.parameters.length)
        components.push({
          type: 'body',
          parameters: template.parameters.map((text) => ({
            type: 'text',
            text,
          })),
        });
      url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
      headers = {
        authorization: `Bearer ${config.accessToken}`,
        'content-type': 'application/json',
      };
      body = JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.recipient.slice(1),
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          components,
        },
      });
    } else {
      if (
        !/^AC[a-zA-Z0-9]+$/.test(config.accountSid) ||
        !/^MG[a-zA-Z0-9]+$/.test(config.messagingServiceSid) ||
        !config.authToken
      )
        throw new Error('Invalid SMS configuration.');
      if (
        !message.callbackUrl ||
        new URL(message.callbackUrl).protocol !== 'https:'
      )
        throw new Error('A secure callback URL is required.');
      url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
      headers = {
        authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      };
      body = new URLSearchParams({
        To: message.recipient,
        Body: message.body,
        MessagingServiceSid: config.messagingServiceSid,
        StatusCallback: message.callbackUrl,
      }).toString();
    }
    try {
      const response = await http(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const errorCode = `HTTP_${response.status}`;
        if (response.status === 429) {
          const seconds = Number(response.headers.get('retry-after'));
          return {
            status: 'REJECTED',
            retryable: true,
            errorCode,
            retryAfterSeconds:
              Number.isFinite(seconds) && seconds > 0
                ? Math.min(3600, Math.ceil(seconds))
                : 60,
          };
        }
        if ([400, 401, 403, 404, 422].includes(response.status))
          return { status: 'REJECTED', retryable: false, errorCode };
        return { status: 'UNKNOWN', errorCode };
      }
      const value = await boundedJson(response);
      const messages = value.messages;
      const id: unknown =
        config.channel === 'SMS'
          ? value.sid
          : Array.isArray(messages)
            ? messages[0]?.id
            : undefined;
      if (typeof id !== 'string' || !id || id.length > 255)
        return { status: 'UNKNOWN', errorCode: 'MISSING_PROVIDER_ID' };
      return { status: 'ACCEPTED', messageId: id };
    } catch {
      return { status: 'UNKNOWN', errorCode: 'SUBMISSION_UNCERTAIN' };
    }
  };
}
