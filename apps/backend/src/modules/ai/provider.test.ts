import assert from 'node:assert/strict';
import { test } from 'node:test';
const env = { DAYBOOK_AI_ENABLED: 'true', GROQ_API_KEY: 'synthetic-key' };
const message = {
  messages: [
    {
      role: 'user' as const,
      content: 'Return a JSON object for synthetic test data.',
    },
  ],
  json: true,
};
async function feature() {
  const module = await import('./provider.js').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    },
  );
  assert.ok(
    module?.createAiProvider,
    'A bounded hosted AI provider must exist',
  );
  return module;
}
test('AI requires explicit enablement and a valid server secret; missing configuration never calls inference', async () => {
  const { createAiProvider } = await feature();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error('must not call');
  };
  assert.equal(
    (await createAiProvider({}, fetcher).complete(message)).status,
    'NOT_CONFIGURED',
  );
  assert.equal(
    (
      await createAiProvider({ DAYBOOK_AI_ENABLED: 'true' }, fetcher).complete(
        message,
      )
    ).status,
    'NOT_CONFIGURED',
  );
  assert.equal(
    (
      await createAiProvider(
        { ...env, GROQ_API_KEY: 'bad\nsecret' },
        fetcher,
      ).complete(message)
    ).status,
    'CONFIGURATION_ERROR',
  );
  assert.equal(
    (
      await createAiProvider(
        { ...env, DAYBOOK_AI_MODEL: 'unapproved-model' },
        fetcher,
      ).complete(message)
    ).status,
    'CONFIGURATION_ERROR',
  );
  assert.equal(calls, 0);
});
test('provider uses only the official endpoint, bounds output and sends JSON mode without exposing keys', async () => {
  const { createAiProvider } = await feature();
  let request: Record<string, unknown> | undefined;
  const result = await createAiProvider(env, async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    request = JSON.parse(options!.body as string);
    assert.equal(
      new Headers(options?.headers).get('authorization'),
      'Bearer synthetic-key',
    );
    return Response.json({
      choices: [
        { finish_reason: 'stop', message: { content: '{"name":"Original"}' } },
      ],
    });
  }).complete(message);
  assert.equal(result.status, 'READY');
  assert.equal(request?.model, 'qwen/qwen3.8-27b');
  assert.deepEqual(request?.response_format, { type: 'json_object' });
  assert.equal(request?.stream, false);
  assert.ok(!JSON.stringify(result).includes('synthetic-key'));
});
test('quota and service errors are explicit, bounded, sanitized and never retried silently', async () => {
  const { createAiProvider } = await feature();
  let calls = 0;
  const result = await createAiProvider(env, async () => {
    calls++;
    return new Response('synthetic-key private provider detail', {
      status: 429,
      headers: { 'retry-after': '120' },
    });
  }).complete(message);
  assert.deepEqual(result, {
    status: 'QUOTA_EXCEEDED',
    retryAfterSeconds: 120,
  });
  assert.equal(calls, 1);
  const unavailable = await createAiProvider(env, async () => {
    throw new Error('synthetic-key');
  }).complete(message);
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.ok(!JSON.stringify(unavailable).includes('synthetic-key'));
});
test('truncated, malformed and oversized output cannot become a successful extraction', async () => {
  const { createAiProvider } = await feature();
  for (const body of [
    {
      choices: [{ finish_reason: 'length', message: { content: '{"name":' } }],
    },
    { choices: [] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] },
  ]) {
    const result = await createAiProvider(env, async () =>
      Response.json(body),
    ).complete(message);
    assert.equal(result.status, 'INVALID_RESPONSE');
  }
  const large = await createAiProvider(
    env,
    async () => new Response('x'.repeat(524289)),
  ).complete(message);
  assert.equal(large.status, 'INVALID_RESPONSE');
  let calls = 0;
  const input = await createAiProvider(env, async () => {
    calls++;
    throw new Error();
  }).complete({
    messages: [{ role: 'user', content: 'x'.repeat(2097153) }],
    json: true,
  });
  assert.equal(input.status, 'INPUT_TOO_LARGE');
  assert.equal(calls, 0);
});

test('provider output cannot leak the server secret or request an undeclared tool', async () => {
  const { createAiProvider } = await feature();
  const leak = await createAiProvider(env, async () =>
    Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: '{"value":"synthetic-key"}' },
        },
      ],
    }),
  ).complete(message);
  assert.equal(leak.status, 'INVALID_RESPONSE');
  const tools = [
    {
      type: 'function',
      function: {
        name: 'agency_summary',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
  ];
  const hostile = await createAiProvider(env, async () =>
    Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call1',
                type: 'function',
                function: { name: 'delete_ledger', arguments: '{}' },
              },
            ],
          },
        },
      ],
    }),
  ).complete({ messages: message.messages, tools });
  assert.equal(hostile.status, 'INVALID_RESPONSE');
});

test('capacity is bounded across provider instances and released after completion', async () => {
  const { createAiProvider } = await feature();
  const pending: (() => void)[] = [];
  const fetcher: typeof fetch = async () => {
    await new Promise<void>((resolve) => pending.push(resolve));
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    });
  };
  const provider = createAiProvider(env, fetcher),
    first = provider.complete(message),
    second = createAiProvider(env, fetcher).complete(message);
  assert.equal((await provider.complete(message)).status, 'BUSY');
  assert.equal(pending.length, 2);
  pending.forEach((finish) => finish());
  assert.equal((await first).status, 'READY');
  assert.equal((await second).status, 'READY');
  assert.equal(
    (
      await createAiProvider(env, async () =>
        Response.json({
          choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
        }),
      ).complete(message)
    ).status,
    'READY',
  );
});
test('valid declared tool arguments are returned as data, while duplicate tool identities are rejected', async () => {
  const { createAiProvider } = await feature();
  const call = {
    id: 'call_one',
    type: 'function',
    function: { name: 'agency_summary', arguments: '{"month":"2026-01"}' },
  };
  const input = {
    messages: message.messages,
    tools: [
      {
        type: 'function',
        function: { name: 'agency_summary', parameters: { type: 'object' } },
      },
    ],
  };
  const valid = await createAiProvider(env, async () =>
    Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { content: null, tool_calls: [call] },
        },
      ],
    }),
  ).complete(input);
  assert.deepEqual(valid, {
    status: 'READY',
    content: null,
    toolCalls: [
      {
        id: 'call_one',
        name: 'agency_summary',
        arguments: { month: '2026-01' },
      },
    ],
  });
  const repeated = await createAiProvider(env, async () =>
    Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { content: null, tool_calls: [call, call] },
        },
      ],
    }),
  ).complete(input);
  assert.equal(repeated.status, 'INVALID_RESPONSE');
});
