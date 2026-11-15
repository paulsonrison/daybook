export const AI_MODEL = 'qwen/qwen3.8-27b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const RESPONSE_LIMIT = 524288;
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | null
    | readonly (
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      )[];
  tool_call_id?: string;
  tool_calls?: readonly unknown[];
}
export interface AiInput {
  messages: readonly AiMessage[];
  json?: boolean;
  tools?: readonly Record<string, unknown>[];
}
export type AiResult =
  | {
      status: 'READY';
      content: string | null;
      toolCalls: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }[];
    }
  | { status: 'QUOTA_EXCEEDED'; retryAfterSeconds: number | null }
  | {
      status:
        | 'NOT_CONFIGURED'
        | 'CONFIGURATION_ERROR'
        | 'INPUT_TOO_LARGE'
        | 'UNAVAILABLE'
        | 'INVALID_RESPONSE'
        | 'BUSY';
    };
export type AiProvider = { complete(input: AiInput): Promise<AiResult> };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
let active = 0;
async function boundedBody(response: Response) {
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)
  ) {
    await response.body?.cancel();
    throw new Error('response bound');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('missing response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > RESPONSE_LIMIT) throw new Error('response bound');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
/** Fixed host, opt-in secret, finite capacity, no paid fallback and no automatic retry. */
export function createAiProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): AiProvider {
  const enabled = env.DAYBOOK_AI_ENABLED,
    key = env.GROQ_API_KEY;
  const configuration =
    enabled === undefined || enabled === 'false'
      ? 'NOT_CONFIGURED'
      : enabled !== 'true'
        ? 'CONFIGURATION_ERROR'
        : !key
          ? 'NOT_CONFIGURED'
          : !/^[\x21-\x7e]{1,512}$/.test(key) ||
              (env.DAYBOOK_AI_MODEL !== undefined &&
                env.DAYBOOK_AI_MODEL !== AI_MODEL)
            ? 'CONFIGURATION_ERROR'
            : null;
  return {
    async complete(input) {
      if (configuration) return { status: configuration };
      const body = JSON.stringify({
        model: AI_MODEL,
        messages: input.messages,
        stream: false,
        max_completion_tokens: 4096,
        ...(input.json ? { response_format: { type: 'json_object' } } : {}),
        ...(input.tools?.length
          ? { tools: input.tools, tool_choice: 'auto' }
          : {}),
      });
      if (Buffer.byteLength(body, 'utf8') > 2097152)
        return { status: 'INPUT_TOO_LARGE' };
      if (active >= 2) return { status: 'BUSY' };
      active++;
      try {
        let response: Response;
        try {
          response = await fetcher(ENDPOINT, {
            method: 'POST',
            redirect: 'error',
            headers: {
              authorization: `Bearer ${key}`,
              'content-type': 'application/json',
            },
            body,
            signal: AbortSignal.timeout(20000),
          });
        } catch {
          return { status: 'UNAVAILABLE' };
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 429) {
            const header = response.headers.get('retry-after');
            return {
              status: 'QUOTA_EXCEEDED',
              retryAfterSeconds:
                header && /^\d{1,6}$/.test(header)
                  ? Math.min(86400, Number(header))
                  : null,
            };
          }
          return {
            status:
              response.status === 401 || response.status === 403
                ? 'CONFIGURATION_ERROR'
                : 'UNAVAILABLE',
          };
        }
        let data: unknown;
        try {
          data = await boundedBody(response);
        } catch {
          return { status: 'INVALID_RESPONSE' };
        }
        if (JSON.stringify(data).includes(key!))
          return { status: 'INVALID_RESPONSE' };
        if (
          !object(data) ||
          !Array.isArray(data.choices) ||
          data.choices.length !== 1
        )
          return { status: 'INVALID_RESPONSE' };
        const choice = data.choices[0];
        if (
          !object(choice) ||
          !['stop', 'tool_calls'].includes(choice.finish_reason as string) ||
          !object(choice.message)
        )
          return { status: 'INVALID_RESPONSE' };
        const message = choice.message,
          content = message.content;
        if (
          content !== null &&
          content !== undefined &&
          typeof content !== 'string'
        )
          return { status: 'INVALID_RESPONSE' };
        const raw = message.tool_calls ?? [];
        if (
          !Array.isArray(raw) ||
          raw.length > 5 ||
          (raw.length && (!input.tools?.length || input.json))
        )
          return { status: 'INVALID_RESPONSE' };
        const toolCalls: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }[] = [];
        for (const call of raw) {
          if (
            !object(call) ||
            call.type !== 'function' ||
            typeof call.id !== 'string' ||
            !call.id ||
            call.id.length > 128 ||
            !object(call.function) ||
            typeof call.function.name !== 'string' ||
            !/^[a-z][a-z0-9_]{0,63}$/.test(call.function.name) ||
            typeof call.function.arguments !== 'string'
          )
            return { status: 'INVALID_RESPONSE' };
          const name = call.function.name;
          if (
            !input.tools?.some(
              (tool) => object(tool.function) && tool.function.name === name,
            ) ||
            toolCalls.some((previous) => previous.id === call.id)
          )
            return { status: 'INVALID_RESPONSE' };
          let args: unknown;
          try {
            args = JSON.parse(call.function.arguments);
          } catch {
            return { status: 'INVALID_RESPONSE' };
          }
          if (!object(args)) return { status: 'INVALID_RESPONSE' };
          toolCalls.push({
            id: call.id,
            name: call.function.name,
            arguments: args,
          });
        }
        if (
          !toolCalls.length &&
          (typeof content !== 'string' || !content.trim())
        )
          return { status: 'INVALID_RESPONSE' };
        if (input.json) {
          try {
            if (!object(JSON.parse(content as string)))
              return { status: 'INVALID_RESPONSE' };
          } catch {
            return { status: 'INVALID_RESPONSE' };
          }
        }
        return {
          status: 'READY',
          content: typeof content === 'string' ? content : null,
          toolCalls,
        };
      } finally {
        active--;
      }
    },
  };
}
