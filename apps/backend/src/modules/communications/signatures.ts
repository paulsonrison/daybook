import { createHmac, timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';

export function verifyWhatsApp(
  secret: string,
  phoneNumberId: string,
  raw: string,
  signature: string,
): boolean {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex')))
    return false;
  try {
    const body = JSON.parse(raw);
    if (
      body.object !== 'whatsapp_business_account' ||
      !Array.isArray(body.entry) ||
      !body.entry.length
    )
      return false;
    return body.entry.every(
      (entry: {
        changes?: { value?: { metadata?: { phone_number_id?: string } } }[];
      }) =>
        Array.isArray(entry.changes) &&
        entry.changes.length > 0 &&
        entry.changes.every(
          (change) => change.value?.metadata?.phone_number_id === phoneNumberId,
        ),
    );
  } catch {
    return false;
  }
}

export interface SmsSignatureConfig {
  accountSid: string;
  messagingServiceSid: string;
  authToken: string;
  sharedKeys?: Record<string, string>;
}
export function verifySms(
  config: SmsSignatureConfig,
  canonicalUrl: string,
  params: Record<string, string | string[]>,
  signature: string,
  settings?: string,
): boolean {
  if (
    params.AccountSid !== config.accountSid ||
    (params.MessagingServiceSid !== undefined &&
      params.MessagingServiceSid !== config.messagingServiceSid)
  )
    return false;
  let secret = config.authToken;
  if (settings) {
    const match =
      /^key=([a-zA-Z0-9_-]+),algorithm=(HMAC_SHA1|HMAC_SHA256)$/.exec(settings);
    if (!match || !Object.hasOwn(config.sharedKeys ?? {}, match[1]))
      return false;
    secret = config.sharedKeys![match[1]];
  }
  if (!secret || !signature) return false;
  try {
    return twilio.validateRequest(
      secret,
      signature,
      canonicalUrl,
      params,
      twilio.getSignatureAlgorithm(settings),
    );
  } catch {
    return false;
  }
}
