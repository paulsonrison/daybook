# Hosted Daybook assistant and document intake status

The selected platform is Render for the application and GroqCloud for hosted Qwen3.8-27B inference. No model weights or GPU are required on the user's computer or the Render application. The model card is https://huggingface.co/Qwen/Qwen3.8-27B; the hosted API identifier is `qwen/qwen3.8-27b`.

## Configure the implemented assistant

Configure `DAYBOOK_AI_ENABLED=true`, `DAYBOOK_AI_MODEL=qwen/qwen3.8-27b` and a secret `GROQ_API_KEY` in the backend's environment, then restart that backend. On Render use the service Environment settings; do not commit the key, put it in a `NEXT_PUBLIC_` variable, or send it in a browser request. Keep the enabled flag false until the operator accepts the provider's data handling and usage conditions. No key is needed for synthetic automated tests.

Open `/assistant` while signed in. Select a reporting month or leave it blank for the current agency month. The assistant can request one restricted agency-summary tool. The server chooses the agency from the authenticated session and obtains financial/delivery/supply aggregates through the existing tenant-scoped analytics. It cannot post payments, edit records, execute SQL or select another tenant. Exact verified figures and their dates are shown separately from generated explanation. These figures are the financial authority, not model arithmetic.

Missing configuration, invalid responses, capacity pressure, quota errors and refusals are visible; the question remains available for correction/retry. There is no automatic paid-provider fallback or automatic retry. The fixed assistant operation has a 75-second proxy deadline and an 80-second client deadline; normal operations retain 10 seconds. Provider requests have a 20-second deadline, at most three rounds and two concurrent calls per backend process.

Groq's free-plan limits and available models depend on the account and may change. This implementation does not create an account, purchase credits, enable billing or promise unlimited inference. Confirm current limits at https://console.groq.com/docs/rate-limits and vision/model support at https://console.groq.com/docs/vision. Live model quality, multilingual safety and actual provider credentials have not been verified by the synthetic tests.

## Intake work still in progress

Native CSV decoding is implemented as a backend primitive: UTF-8, 1 MiB, at most 2,000 data rows, 30 columns and 32 KiB per record. It preserves strings, leading zeros, exact decimals and decoded-table cell evidence, and never evaluates formula-like text.

A bounded Office ZIP reader now checks archive structure, paths, CRC, actual expanded size and forged size metadata: at most 10 MiB compressed input, 8 MiB expanded data and 512 entries. It never extracts to disk or fetches external resources. This helper alone does not provide XLSX/DOCX field extraction.

PDF, scanned PDF/image and Office decoding, authenticated upload jobs, draft persistence, source-linked field review/confirmation and the final Render Blueprint remain unfinished. No upload-to-autofill feature is claimed ready. Financial document posting will continue through the existing validated domain workflows and explicit user confirmation.

## Deployment and quality gates

No cloud resources have been provisioned. A Render free service is a preview environment with ephemeral files; its free PostgreSQL offering is not a durable production database. Persist future upload/job state in tenant-protected durable storage, not the service filesystem. Production deployment and any paid resources need separate authorization.

Before enabling real documents, assess representative English, Malayalam and Hindi samples, including blurred scans, ambiguous dates, tables, duplicate accounts and large amounts. Include cross-tenant and prompt-injection cases. Do not infer calibrated confidence or field accuracy from a general model benchmark, a passing stub response or valid JSON. Simple output filters do not guarantee universally safe generated language.
