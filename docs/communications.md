# Documents and messaging configuration

P10 is under implementation. These settings describe the implemented document and transport boundaries; the dispatch screen, dedicated messaging worker and reminder scheduling are not complete yet. Configuration alone does not activate them or prove live delivery.

## Documents

The backend renders immutable financial snapshots with installed Google Chrome through Playwright. Chrome must be available to the backend service account. The renderer uses the shared UI styles and embedded Inter, Noto Sans Malayalam and Noto Sans Devanagari fonts. External network requests and page JavaScript are disabled during rendering. Missing Chrome or a failed generation appears as a document error; it does not produce a placeholder PDF.

Set `PUBLIC_APP_ORIGIN` to the application's origin without a path, credentials or query. Production document links require HTTPS; local development permits HTTP on loopback. Set `DOCUMENT_LINK_SECRET` to a separately generated random value of at least 32 bytes. Keep it in the backend's secret configuration.

Owner downloads require an authenticated agency session. Resident share links grant access to one immutable document and expire after seven days by default; owners may select one to thirty days or revoke a link. Only token hashes are stored. Anyone possessing an active link can read that document, so do not include it in operational logs. Rotating the signing secret prevents reconstructing old links in the owner's view, but already issued links remain valid until expiry or explicit revocation. A PDF's displayed balance and QR amount reflect preparation time; subsequent payments do not rewrite it.

## Agency provider mapping

`DAYBOOK_COMMUNICATIONS_PROVIDERS` is a backend-only JSON object keyed by the exact agency UUID. Secrets are referenced by environment variable name rather than entered into a browser form. Empty configuration reports `NOT_CONFIGURED`; malformed or incomplete entries report `CONFIGURATION_ERROR` without returning their contents. A sender identity cannot be shared between agency mappings.

```json
{
  "00000000-0000-4000-8000-000000000001": {
    "whatsapp": {
      "phoneNumberId": "123456789",
      "apiVersion": "v27.0",
      "accessTokenEnv": "AGENCY_WHATSAPP_ACCESS_TOKEN",
      "appSecretEnv": "AGENCY_META_APP_SECRET",
      "verifyTokenEnv": "AGENCY_META_VERIFY_TOKEN"
    },
    "sms": {
      "accountSid": "AC_REPLACE_WITH_REAL_ACCOUNT",
      "messagingServiceSid": "MG_REPLACE_WITH_REAL_SERVICE",
      "authTokenEnv": "AGENCY_TWILIO_AUTH_TOKEN",
      "sharedKeySecretEnvs": {
        "REPLACE_WITH_SHARED_KEY_ID": "AGENCY_TWILIO_SHARED_KEY_SECRET"
      }
    }
  }
}
```

The IDs above are illustrative placeholders. Use the provider's actual IDs; remove the optional shared-key mapping if unused. Setting values does not establish consent, template approval or successful delivery. The application must verify resident channel consent and the current phone before dispatch. Business-initiated WhatsApp messages use approved templates and their configured language; direct WhatsApp greetings are a separate user action.

The transport sends only to the official Meta Graph and Twilio API endpoints. Provider acceptance means queued by that provider, not delivered. Explicit rejections may be retried within their bounds; timeouts, lost connections and uncertain server responses remain `UNKNOWN` and cannot be blindly resent.

The template builder uses this fixed body-parameter order. Create and obtain provider approval for templates that match it; selecting a name does not approve a template. The configured language must match the resident's message language. An optional QR image header requires an available HTTPS QR image.

| Kind        | Body parameters, in order                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Invoice     | Resident name, agency name, invoice reference, exact outstanding amount, document link, payment link |
| Reminder    | Resident name, agency name, exact outstanding amount, document link, payment link                    |
| Credit hold | Resident name, agency name, exact outstanding amount, document link                                  |

English, Malayalam and Hindi SMS text identifies the agency, shows the amount at preparation, and tells residents that later payments may change it. Template settings are available at `/settings/communications`; prepared invoice batches, documents, links and dispatch history are available at `/communications/documents`. Explicit overdue reminders are available beside resident consent at `/communications`. Native contact controls are also available in resident records, delivery views and collection sheets.

## Dedicated communications worker

The backend provides `npm run communications:worker -w @daybook/backend` for development and `npm run communications:worker:start -w @daybook/backend` after building. These commands run a persistent service and can send configured provider messages; development verification injects synthetic transports instead. Use the restricted database role and the same agency provider/document-link configuration as the backend.

Automatic reminders start disabled. Enabling them opts an agency into current-local-date overdue evaluation. Each cycle evaluates at most 25 residents with a durable cursor, renders at most three queued documents and processes at most five messages. Evaluation catches up to the current date rather than producing one message per missed day. Previous-date unsent reminders become stale before today's evaluation; submitted or uncertain messages retain their recorded outcomes. Frequency and cooldown use recorded acceptance, not preparation time.

Scheduled reminders identify a system actor. Explicit owner reminders and service suspensions identify the authenticated agent. Overdue accounts without invoices receive an immutable account-notice PDF, including the balance, overdue amount, preparation date and verified payment QR. The worker rechecks current consent, phone, locale, source figures, payment identity, document/link state and cooldown before submission. Exhausted PDF generation becomes a visible failed notice, without contacting the provider.

An explicit owner reminder can be prepared while automatic scheduling stays disabled. Missing consent, provider or approved template remains blocked. Service suspension prepares a consented, configured WhatsApp hold notice without claiming delivery; retrying the original suspension request returns the notice's current recorded status. Generated invoice and account-notice PDFs can be downloaded by the owner from dispatch history when ready. Older dispatches, contact attempts and resident messages are available through paged histories.

## Callback boundary

Backend endpoints are `/webhooks/whatsapp/{agencyId}` and `/webhooks/sms/{agencyId}?intent={operationId}`. Frontend forwarding preserves the signature inputs, drops owner credentials and refuses redirects. WhatsApp verification uses the agency's verify token; events require the raw-body app-secret signature and configured phone identity. SMS signatures are verified with the official Twilio helper against the configured HTTPS `PUBLIC_APP_ORIGIN` and full callback path/query, including every submitted form field. Request Host headers do not define this URL. Optional SharedKey signatures select only a configured key ID.

Authenticated events are retained before the send response is associated with its provider ID. Association and event processing use the same agency lock. Replays and out-of-order events cannot downgrade delivered/read status. A WhatsApp timeout without a returned provider ID requires verified reconciliation; an internal operation UUID does not establish provider-side deduplication.

An owner can record an evidenced decision for an uncertain submission. Closing with outcome unknown keeps resend blocked. Verified non-acceptance permits a new explicit preparation, never an automatic retry. Owner-verified acceptance starts the cooldown but does not establish delivery. References remain immutable audit evidence rather than provider IDs. Later authoritative acceptance and signed SMS callbacks take precedence; original request retries return the latest recorded outcome.

Development tests use synthetic recipients, disposable PostgreSQL and local test transports. They do not send customer messages. Live provider and public callback verification remain separate configuration-dependent checks.

References: [Twilio message API](https://www.twilio.com/docs/messaging/api/message-resource), [Twilio webhook security](https://www.twilio.com/docs/usage/security), [official Twilio signature helpers](https://github.com/twilio/twilio-node/blob/main/examples/WebhookSignatureValidation.md), [Meta message API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api).
