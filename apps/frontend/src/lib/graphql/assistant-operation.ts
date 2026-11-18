export const ASSISTANT_OPERATION =
  'mutation DaybookAssistant($input:AssistantInput!){askAssistant(input:$input){status answer facts asOf}}';
/** An arbitrary operation name must not extend a financial mutation's deadline. */
export function upstreamTimeout(
  path: string,
  body: string | undefined,
  method = 'POST',
) {
  if (path === '/operations/backups' && method === 'GET' && !body) return 50000;
  if (path !== '/graphql' || !body) return 10000;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'operationName' in parsed &&
      'query' in parsed &&
      parsed.operationName === 'DaybookAssistant' &&
      parsed.query === ASSISTANT_OPERATION
    )
      return 75000;
  } catch {}
  return 10000;
}
