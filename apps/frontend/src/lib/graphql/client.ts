import axios from 'axios';
type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };
const http = axios.create({
  baseURL:
    process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql',
  timeout: 10000,
});
export async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const { data } = await http.post<GraphQLResponse<T>>('', {
    query,
    variables,
  });
  if (data.errors?.length)
    throw new Error(data.errors.map((error) => error.message).join('; '));
  if (!data.data) throw new Error('The API returned no data.');
  return data.data;
}
