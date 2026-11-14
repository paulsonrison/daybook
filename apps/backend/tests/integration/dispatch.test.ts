import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { providerRegistry } from '../../src/modules/communications/config.js';
import { withTenant } from '../../src/db/tenant.js';
import { testApi } from './support.js';
process.env.DOCUMENT_LINK_SECRET =
  'synthetic-dispatch-document-secret-01234567890123456789';
process.env.PUBLIC_APP_ORIGIN = 'https://dispatch.example.test';
test('invoice batches preserve per-recipient blockers, original IDs and tenant scope without storing bearer URLs', async () => {
  let providers = providerRegistry({});
  const api = testApi({
    get: (agency, channel) => providers.get(agency, channel),
  });
  try {
    const cookie = await api.agency();
    async function run(query: string, variables: Record<string, unknown> = {}) {
      const result = await api.query(cookie, query, variables);
      assert.ok(!result.errors, JSON.stringify(result));
      return result.data;
    }
    const me = (await run('{me{agencyId}}')).me;
    providers = providerRegistry({
      SMS: 'synthetic-sms',
      DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify({
        [me.agencyId]: {
          sms: {
            accountSid: 'AC123',
            messagingServiceSid: 'MG123',
            authTokenEnv: 'SMS',
          },
        },
      }),
    });
    const route = await api.route(cookie);
    const today = (await run('{deliveryMetrics{today}}')).deliveryMetrics.today;
    await run(
      'mutation{saveBillingPolicy(input:{noTaxConfirmed:true}){version} saveCollectionSettings(input:{upiId:"dispatch@upi",payeeName:"Domain Tests",confirmOwnership:true}){version}}',
    );
    const items: {
      invoiceId: string;
      version: number;
      documentId: string;
      linkId: string;
    }[] = [];
    const residents: string[] = [];
    for (let index = 0; index < 2; index++) {
      const resident = (
        await run(
          'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
          {
            input: {
              requestId: randomUUID(),
              name: `Dispatch Resident ${index}`,
              address: '1 Lotus Lane',
              phone: `987654321${index}`,
              sector: 'Lotus Lane',
              routeId: route.id,
              dropOrder: index + 1,
            },
          },
        )
      ).saveResident;
      residents.push(resident.id);
      const bill = {
        residentId: resident.id,
        periodMode: 'CUSTOM',
        periods: [{ from: today, to: today }],
        adjustments: [
          {
            id: randomUUID(),
            kind: 'SURCHARGE',
            amount: '7.25',
            reason: 'Dispatch test charge',
          },
        ],
      };
      const preview = (
        await run(
          'query($input:BillInput!){previewBill(input:$input){fingerprint}}',
          { input: bill },
        )
      ).previewBill;
      const invoice = (
        await run(
          'mutation($input:InvoiceInput!){generateInvoice(input:$input){id version}}',
          {
            input: {
              ...bill,
              requestId: randomUUID(),
              previewFingerprint: preview.fingerprint,
              acknowledgeUnmarkedDays: true,
            },
          },
        )
      ).generateInvoice;
      const document = (
        await run(
          'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id}}',
          {
            input: {
              requestId: randomUUID(),
              kind: 'INVOICE',
              sourceId: invoice.id,
              locale: 'en',
            },
          },
        )
      ).prepareDocument;
      const generated = (
        await run(
          'mutation($input:GenerateDocumentInput!){generateDocument(input:$input){status}}',
          { input: { requestId: randomUUID(), documentId: document.id } },
        )
      ).generateDocument;
      assert.equal(generated.status, 'READY');
      const link = (
        await run(
          'mutation($input:DocumentLinkInput!){createDocumentLink(input:$input){id}}',
          { input: { requestId: randomUUID(), documentId: document.id } },
        )
      ).createDocumentLink;
      items.push({
        invoiceId: invoice.id,
        version: invoice.version,
        documentId: document.id,
        linkId: link.id,
      });
    }
    await run(
      'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: residents[0],
          version: 0,
          locale: 'en',
          whatsapp: false,
          sms: true,
          confirmedConsent: true,
          evidence: 'Explicit synthetic SMS consent',
        },
      },
    );
    const input = { requestId: randomUUID(), channel: 'SMS', items };
    const query =
      'mutation($input:InvoiceMessageBatchInput!){queueInvoiceMessages(input:$input){id residentId invoiceId status reason attempts}}';
    const first = (await run(query, { input })).queueInvoiceMessages;
    assert.deepEqual(
      first.map((item: { status: string }) => item.status),
      ['PENDING', 'NO_CONSENT'],
    );
    const statusQuery =
      'query($ids:[ID!]!){messageDispatchStatuses(ids:$ids){id status}}';
    const known = await run(statusQuery, {
      ids: first.map((row: { id: string }) => row.id),
    });
    assert.deepEqual(
      known.messageDispatchStatuses.map(
        (row: { status: string }) => row.status,
      ),
      ['PENDING', 'NO_CONSENT'],
    );
    const hidden = await api.query(await api.agency(), statusQuery, {
      ids: [first[0].id],
    });
    assert.ok(hidden.errors);
    assert.deepEqual((await run(query, { input })).queueInvoiceMessages, first);
    const duplicate = (
      await run(query, { input: { ...input, requestId: randomUUID() } })
    ).queueInvoiceMessages;
    assert.equal(duplicate[0].status, 'UNRESOLVED');
    const wrongTenant = await api.query(await api.agency(), query, {
      input: { ...input, requestId: randomUUID() },
    });
    assert.ok(wrongTenant.errors);
    const payload = await withTenant(
      api.pool,
      me.agencyId,
      async (c) =>
        (
          await c.query(
            'SELECT payload FROM daybook.notification_intents WHERE id=$1',
            [first[0].id],
          )
        ).rows[0].payload,
    );
    assert.ok(!JSON.stringify(payload).includes('/documents/public/'));
    assert.equal(payload.amount, '7.25');
    await run(
      'mutation($input:PaymentInput!){recordPayment(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: residents[0],
          purpose: 'ACCOUNT',
          method: 'CASH',
          amount: '1.00',
          date: today,
          confirmReceived: true,
          confirmationNote: 'Synthetic partial payment after PDF preparation',
        },
      },
    );
    const stale = (
      await run(query, { input: { ...input, requestId: randomUUID() } })
    ).queueInvoiceMessages;
    assert.equal(stale[0].status, 'STALE');
    const path = '../../src/modules/communications/worker.js';
    const worker = await import(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    });
    assert.ok(
      worker?.processNextMessage,
      'The outbox worker must revalidate before external submission',
    );
    let submissions = 0;
    const submit = async (
      config: { channel: string },
      message: { body: string; callbackUrl: string },
    ) => {
      submissions++;
      assert.equal(config.channel, 'SMS');
      assert.ok(message.body.includes('₹6.25'));
      assert.ok(
        message.body.includes(
          'https://dispatch.example.test/documents/public/',
        ),
      );
      assert.ok(
        message.callbackUrl.startsWith(
          `https://dispatch.example.test/webhooks/sms/${me.agencyId}?intent=`,
        ),
      );
      return { status: 'ACCEPTED', messageId: 'SM-dispatch-accepted' };
    };
    const registry = {
      get: (agency: string, channel: 'SMS' | 'WHATSAPP') =>
        providers.get(agency, channel),
    };
    assert.equal(
      (await worker.processNextMessage(api.pool, me.agencyId, registry, submit))
        .status,
      'STALE',
    );
    assert.equal(submissions, 0);
    const freshDocument = (
      await run(
        'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            kind: 'INVOICE',
            sourceId: items[0].invoiceId,
            locale: 'en',
          },
        },
      )
    ).prepareDocument;
    await run(
      'mutation($input:GenerateDocumentInput!){generateDocument(input:$input){status}}',
      { input: { requestId: randomUUID(), documentId: freshDocument.id } },
    );
    const freshLink = (
      await run(
        'mutation($input:DocumentLinkInput!){createDocumentLink(input:$input){id}}',
        { input: { requestId: randomUUID(), documentId: freshDocument.id } },
      )
    ).createDocumentLink;
    const freshInput = {
      requestId: randomUUID(),
      channel: 'SMS',
      items: [
        { ...items[0], documentId: freshDocument.id, linkId: freshLink.id },
      ],
    };
    const queued = (await run(query, { input: freshInput }))
      .queueInvoiceMessages;
    assert.equal(queued[0].status, 'PENDING');
    await run(
      'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: residents[0],
          version: 1,
          locale: 'en',
          whatsapp: false,
          sms: false,
          confirmedConsent: false,
          evidence: 'Synthetic opt-out before submission',
        },
      },
    );
    assert.equal(
      await worker.processNextMessage(api.pool, me.agencyId, registry, submit),
      null,
    );
    const cancelled = await run(
      'query($ids:[ID!]!){messageDispatchStatuses(ids:$ids){status reason}}',
      { ids: [queued[0].id] },
    );
    assert.equal(cancelled.messageDispatchStatuses[0].status, 'CANCELLED');
    assert.equal(
      cancelled.messageDispatchStatuses[0].reason,
      'CHANNEL_CONSENT_WITHDRAWN',
    );
    assert.equal(submissions, 0);
    await run(
      'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: residents[0],
          version: 2,
          locale: 'en',
          whatsapp: false,
          sms: true,
          confirmedConsent: true,
          evidence: 'New explicit synthetic SMS permission',
        },
      },
    );
    const sendInput = { ...freshInput, requestId: randomUUID() };
    const ready = (await run(query, { input: sendInput })).queueInvoiceMessages;
    assert.equal(ready[0].status, 'PENDING');
    assert.equal(
      (await worker.processNextMessage(api.pool, me.agencyId, registry, submit))
        .status,
      'ACCEPTED',
    );
    assert.equal(submissions, 1);
    assert.equal(
      await worker.processNextMessage(api.pool, me.agencyId, registry, submit),
      null,
    );
    assert.equal(submissions, 1);
    const acceptedAt = await withTenant(
      api.pool,
      me.agencyId,
      async (c) =>
        (
          await c.query(
            'SELECT accepted_at IS NOT NULL AS recorded FROM daybook.notification_intents WHERE id=$1',
            [ready[0].id],
          )
        ).rows[0].recorded,
    );
    assert.equal(acceptedAt, true);
    assert.equal(
      (await run(query, { input: { ...sendInput, requestId: randomUUID() } }))
        .queueInvoiceMessages[0].status,
      'COOLDOWN',
    );
    assert.ok(
      worker.runCommunicationsCycle,
      'The dedicated cycle must drain document preparation independently of delivery jobs',
    );
    const backgroundDocument = (
      await run(
        'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            kind: 'INVOICE',
            sourceId: items[0].invoiceId,
            locale: 'en',
          },
        },
      )
    ).prepareDocument;
    const cycle = await worker.runCommunicationsCycle(
      api.pool,
      me.agencyId,
      registry,
      submit,
    );
    assert.deepEqual(cycle.messages, []);
    assert.equal(
      (
        await run('query($id:ID!){document(id:$id){status}}', {
          id: backgroundDocument.id,
        })
      ).document.status,
      'READY',
    );
    assert.equal(submissions, 1);
  } finally {
    await api.pool.end();
  }
});
