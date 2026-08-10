// web/src/components/NhostApolloProvider.tsx
'use client';

import React, { useMemo, useRef, useEffect } from 'react';
import { ApolloClient, HttpLink, InMemoryCache, split } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { setContext } from '@apollo/client/link/context';
import { useAccessToken } from '@nhost/nextjs';

export function NhostApolloProvider({ children }: { children: React.ReactNode }) {
  const accessToken = useAccessToken();
  const tokenRef = useRef(accessToken);

  const client = useMemo(() => {
    const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || '';
    const region = process.env.NEXT_PUBLIC_NHOST_REGION || '';
    
    // Fallback URL for local testing or incomplete environment setup
    const httpUri = subdomain && region 
      ? `https://${subdomain}.hasura.${region}.nhost.run/v1/graphql`
      : 'http://localhost:8080/v1/graphql';

    const httpLink = new HttpLink({ uri: httpUri });

    // Inject Auth token into HTTP requests
    const authLink = setContext((_, { headers }) => {
      const token = tokenRef.current;
      return {
        headers: {
          ...headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
    });

    // WebSocket Connection (only runs client-side)
    let link;
    if (typeof window !== 'undefined') {
      const wsUri = subdomain && region
        ? `wss://${subdomain}.hasura.${region}.nhost.run/v1/graphql`
        : 'ws://localhost:8080/v1/graphql';

      const wsLink = new GraphQLWsLink(
        createClient({
          url: wsUri,
          connectionParams: () => {
            const token = tokenRef.current;
            return {
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            };
          },
        })
      );

      // Split link based on operation type (subscription vs other)
      link = split(
        ({ query }) => {
          const definition = getMainDefinition(query);
          return (
            definition.kind === 'OperationDefinition' &&
            definition.operation === 'subscription'
          );
        },
        wsLink,
        authLink.concat(httpLink)
      );
    } else {
      link = authLink.concat(httpLink);
    }

    return new ApolloClient({
      link,
      cache: new InMemoryCache(),
    });
  }, []);

  // Update tokenRef and reset Apollo cache store when accessToken changes (session isolation)
  useEffect(() => {
    tokenRef.current = accessToken;
    client.resetStore().catch(() => {
      client.clearStore().catch(console.error);
    });
  }, [accessToken, client]);

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
export default NhostApolloProvider;
