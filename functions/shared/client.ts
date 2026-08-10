// functions/shared/client.ts

export async function queryHasura(
  query: string,
  variables: any = {},
  headers: Record<string, string> = {}
) {
  const graphqlUrl = process.env.NHOST_GRAPHQL_URL || `${process.env.NHOST_BACKEND_URL}/v1/graphql`;
  const adminSecret = process.env.NHOST_ADMIN_SECRET;

  if (!graphqlUrl) {
    throw new Error('NHOST_GRAPHQL_URL or NHOST_BACKEND_URL is not configured.');
  }

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (adminSecret && !reqHeaders['x-hasura-admin-secret'] && !reqHeaders['Authorization']) {
    reqHeaders['x-hasura-admin-secret'] = adminSecret;
  }

  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json()) as any;
  if (body.errors) {
    console.error('Hasura query error:', JSON.stringify(body.errors, null, 2));
    throw new Error(body.errors[0].message || 'GraphQL Query Error');
  }

  return body.data;
}

export async function queryHasuraAsUser(
  userId: string,
  query: string,
  variables: any = {}
) {
  return queryHasura(query, variables, {
    'x-hasura-role': 'user',
    'x-hasura-user-id': userId,
  });
}
