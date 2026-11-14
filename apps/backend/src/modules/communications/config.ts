import type { ProviderConfig } from './providers.js';
export type Channel = 'WHATSAPP' | 'SMS';
export type ConfiguredProvider = {
  status: 'CONFIGURED';
  transport: ProviderConfig;
  appSecret?: string;
  verifyToken?: string;
  sharedKeys?: Record<string, string>;
};
export type ProviderSetting =
  ConfiguredProvider | { status: 'NOT_CONFIGURED' | 'CONFIGURATION_ERROR' };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function providerRegistry(env: NodeJS.ProcessEnv = process.env) {
  const entries = new Map<string, ProviderSetting>();
  const identities = new Map<string, string[]>();
  let invalid = false;
  const secret = (ref: unknown) => {
    if (
      typeof ref !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(ref) ||
      !env[ref]?.trim()
    )
      throw new Error('Missing provider secret');
    return env[ref]!;
  };
  try {
    const raw: unknown = JSON.parse(
      env.DAYBOOK_COMMUNICATIONS_PROVIDERS || '{}',
    );
    if (!object(raw)) throw new Error('Invalid registry');
    for (const [agency, value] of Object.entries(raw)) {
      if (!uuid.test(agency) || !object(value))
        throw new Error('Invalid agency mapping');
      for (const channel of ['WHATSAPP', 'SMS'] as const) {
        const key = `${agency}:${channel}`;
        const settings = value[channel === 'SMS' ? 'sms' : 'whatsapp'];
        if (settings === undefined) continue;
        try {
          if (!object(settings)) throw new Error('Invalid provider');
          let configured: ConfiguredProvider;
          let identity: string;
          if (channel === 'WHATSAPP') {
            const { phoneNumberId, apiVersion } = settings;
            if (
              typeof phoneNumberId !== 'string' ||
              !/^\d{1,30}$/.test(phoneNumberId) ||
              typeof apiVersion !== 'string' ||
              !/^v\d{1,3}\.0$/.test(apiVersion)
            )
              throw new Error('Invalid WhatsApp identity');
            configured = {
              status: 'CONFIGURED',
              transport: {
                channel,
                phoneNumberId,
                apiVersion,
                accessToken: secret(settings.accessTokenEnv),
              },
              appSecret: secret(settings.appSecretEnv),
              verifyToken: secret(settings.verifyTokenEnv),
            };
            identity = `WHATSAPP:${phoneNumberId}`;
          } else {
            const { accountSid, messagingServiceSid } = settings;
            if (
              typeof accountSid !== 'string' ||
              !/^AC[a-zA-Z0-9]{1,64}$/.test(accountSid) ||
              typeof messagingServiceSid !== 'string' ||
              !/^MG[a-zA-Z0-9]{1,64}$/.test(messagingServiceSid)
            )
              throw new Error('Invalid SMS identity');
            const sharedKeys: Record<string, string> = Object.create(null);
            if (settings.sharedKeySecretEnvs !== undefined) {
              if (!object(settings.sharedKeySecretEnvs))
                throw new Error('Invalid shared keys');
              for (const [id, ref] of Object.entries(
                settings.sharedKeySecretEnvs,
              )) {
                if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
                  throw new Error('Invalid shared key');
                sharedKeys[id] = secret(ref);
              }
            }
            configured = {
              status: 'CONFIGURED',
              transport: {
                channel,
                accountSid,
                messagingServiceSid,
                authToken: secret(settings.authTokenEnv),
              },
              sharedKeys,
            };
            identity = `SMS:${accountSid}:${messagingServiceSid}`;
          }
          entries.set(key, configured);
          identities.set(identity, [...(identities.get(identity) ?? []), key]);
        } catch {
          entries.set(key, { status: 'CONFIGURATION_ERROR' });
        }
      }
    }
    for (const keys of identities.values()) {
      if (keys.length > 1)
        for (const key of keys)
          entries.set(key, { status: 'CONFIGURATION_ERROR' });
    }
  } catch {
    invalid = true;
  }
  return {
    get(agencyId: string, channel: Channel): ProviderSetting {
      return invalid
        ? { status: 'CONFIGURATION_ERROR' }
        : (entries.get(`${agencyId}:${channel}`) ?? {
            status: 'NOT_CONFIGURED',
          });
    },
  };
}
export type ProviderRegistry = ReturnType<typeof providerRegistry>;
