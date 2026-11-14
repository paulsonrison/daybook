import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

test('official transports distinguish acceptance, rejection and uncertain submission without retries', async () => {
  const path = './providers.js';
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(module?.createTransport, 'Official message transport must exist');
  const requests: { url: string; init: RequestInit }[] = [];
  let response = new Response(
    JSON.stringify({ messages: [{ id: 'wamid.synthetic' }] }),
    { status: 200 },
  );
  const transport = module.createTransport(
    async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return response;
    },
  );
  const config = {
    channel: 'WHATSAPP',
    phoneNumberId: '123456789',
    apiVersion: 'v27.0',
    accessToken: 'synthetic-secret',
  };
  const message = {
    recipient: '+919876543210',
    body: 'നമസ്കാരം',
    template: {
      name: 'invoice_notice',
      language: 'ml',
      parameters: ['₹100.00'],
    },
  };
  assert.deepEqual(await transport(config, message), {
    status: 'ACCEPTED',
    messageId: 'wamid.synthetic',
  });
  assert.equal(
    requests[0].url,
    'https://graph.facebook.com/v27.0/123456789/messages',
  );
  const payload = JSON.parse(requests[0].init.body as string);
  assert.equal(payload.template.components[0].parameters[0].text, '₹100.00');
  assert.equal(payload.to, '919876543210');
  assert.equal(requests[0].init.redirect, 'error');
  response = new Response('{}', {
    status: 429,
    headers: { 'retry-after': '15' },
  });
  assert.deepEqual(await transport(config, message), {
    status: 'REJECTED',
    retryable: true,
    errorCode: 'HTTP_429',
    retryAfterSeconds: 15,
  });
  response = new Response('{}', { status: 401 });
  assert.deepEqual(await transport(config, message), {
    status: 'REJECTED',
    retryable: false,
    errorCode: 'HTTP_401',
  });
  response = new Response('{}', { status: 503 });
  assert.deepEqual(await transport(config, message), {
    status: 'UNKNOWN',
    errorCode: 'HTTP_503',
  });
  response = new Response('{}', { status: 200 });
  assert.deepEqual(await transport(config, message), {
    status: 'UNKNOWN',
    errorCode: 'MISSING_PROVIDER_ID',
  });
  assert.equal(requests.length, 5);
  await assert.rejects(
    () => transport(config, { ...message, recipient: '98765' }),
    /international/,
  );
  assert.equal(requests.length, 5);
});

test('a lost HTTP response remains uncertain and cannot trigger a hidden retry', async () => {
  const path = './providers.js';
  const { createTransport } = await import(path);
  let calls = 0;
  const server = createServer((request) => {
    calls++;
    request.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const transport = createTransport((_url: string, init: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}`, init),
    );
    const result = await transport(
      {
        channel: 'SMS',
        accountSid: 'AC123',
        messagingServiceSid: 'MG123',
        authToken: 'synthetic',
      },
      {
        recipient: '+919876543210',
        body: 'Hello',
        callbackUrl: 'https://daybook.example/callback',
      },
    );
    assert.deepEqual(result, {
      status: 'UNKNOWN',
      errorCode: 'SUBMISSION_UNCERTAIN',
    });
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('SMS submits native text and canonical callback URL to the official account endpoint', async () => {
  const path = './providers.js';
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(module?.createTransport, 'Official message transport must exist');
  let calls = 0;
  const transport = module.createTransport(
    async (url: string, init: RequestInit) => {
      calls++;
      assert.equal(
        url,
        'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
      );
      const body = new URLSearchParams(init.body as string);
      assert.equal(body.get('Body'), 'नमस्ते ₹100.00');
      assert.equal(
        body.get('StatusCallback'),
        'https://daybook.example/webhooks/sms/agency?intent=123',
      );
      assert.equal(body.get('MessagingServiceSid'), 'MG123');
      return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 });
    },
  );
  assert.deepEqual(
    await transport(
      {
        channel: 'SMS',
        accountSid: 'AC123',
        messagingServiceSid: 'MG123',
        authToken: 'synthetic',
      },
      {
        recipient: '+919876543210',
        body: 'नमस्ते ₹100.00',
        callbackUrl: 'https://daybook.example/webhooks/sms/agency?intent=123',
      },
    ),
    { status: 'ACCEPTED', messageId: 'SM123' },
  );
  assert.equal(calls, 1);
});
