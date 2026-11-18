const SYSTEM = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'TEMP',
  'TMP',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];
export function systemEnvironment(env) {
  return Object.fromEntries(
    SYSTEM.filter((k) => env[k]).map((k) => [k, env[k]]),
  );
}
/** The HTTP process must never inherit the operator's environment. */
export function backendEnvironment(env, { databaseUrl, origin, port }) {
  const allowed = [
    'DAYBOOK_AI_ENABLED',
    'DAYBOOK_AI_MODEL',
    'GROQ_API_KEY',
    'DAYBOOK_SCHEDULER_SECRET',
    'DAYBOOK_COMMUNICATIONS_PROVIDERS',
    'DOCUMENT_LINK_SECRET',
    'PDF_BROWSER_PATH',
    'PDF_BROWSER_CHANNEL',
  ];
  // Provider secrets use their own namespace; registry references cannot select owner secrets.
  allowed.push(
    ...Object.keys(env).filter(
      (k) =>
        /^DAYBOOK_PROVIDER_[A-Z0-9_]+$/.test(k) ||
        /^AGENCY_(WHATSAPP_ACCESS_TOKEN|META_APP_SECRET|META_VERIFY_TOKEN|TWILIO_AUTH_TOKEN)$/.test(
          k,
        ),
    ),
  );
  return {
    ...systemEnvironment(env),
    ...Object.fromEntries(
      allowed.filter((k) => env[k]).map((k) => [k, env[k]]),
    ),
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    PORT: port,
    HOST: '127.0.0.1',
    FRONTEND_ORIGIN: origin,
    PUBLIC_APP_ORIGIN: origin,
  };
}
export function backupEnvironment(env, { scheduleDatabaseUrl } = {}) {
  return {
    ...systemEnvironment(env),
    ...Object.fromEntries(
      Object.entries(env).filter(([k]) =>
        /^DAYBOOK_BACKUP_[A-Z0-9_]+$/.test(k),
      ),
    ),
    ...(scheduleDatabaseUrl
      ? { DAYBOOK_SCHEDULE_DATABASE_URL: scheduleDatabaseUrl }
      : {}),
    NODE_ENV: 'production',
  };
}
