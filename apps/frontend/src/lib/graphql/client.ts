import { ASSISTANT_OPERATION } from './assistant-operation';
import axios from 'axios';
type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };
const http = axios.create({
  baseURL: '/api/graphql',
  timeout: 10000,
});
export class UnconfirmedRequestError extends Error {
  readonly code = 'UNCONFIRMED';
  constructor() {
    super(
      'The request could not be confirmed. Check your connection and review your records before trying again.',
    );
  }
}
export function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return send<T>({ query, variables });
}
/** Monthly report generation is explicitly bounded to the PDF renderer's deadline. */
export function reportRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return send<T>({ query, variables }, 35000);
}
export function assistantRequest<T>(input: {
  question: string;
  month?: string;
}): Promise<T> {
  return send<T>(
    {
      query: ASSISTANT_OPERATION,
      operationName: 'DaybookAssistant',
      variables: { input },
    },
    80000,
  );
}
async function send<T>(
  payload: Record<string, unknown>,
  timeout = 10000,
): Promise<T> {
  let data: GraphQLResponse<T>;
  try {
    ({ data } = await http.post<GraphQLResponse<T>>('', payload, { timeout }));
  } catch (error) {
    if (axios.isAxiosError<{ error?: unknown }>(error)) {
      const message = error.response?.data?.error;
      if (
        error.response &&
        error.response.status < 500 &&
        typeof message === 'string'
      )
        throw new Error(message);
      throw new UnconfirmedRequestError();
    }
    throw error;
  }
  if (data.errors?.length)
    throw new Error(data.errors.map((error) => error.message).join('; '));
  if (!data.data) throw new UnconfirmedRequestError();
  return data.data;
}
