// web/src/components/ClientProviders.tsx
'use client';

import React from 'react';
import { NhostProvider } from '@nhost/nextjs';
import { nhost } from '@/lib/nhost';
import { NhostApolloProvider } from './NhostApolloProvider';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <NhostProvider nhost={nhost}>
      <NhostApolloProvider>
        {children}
      </NhostApolloProvider>
    </NhostProvider>
  );
}
export default ClientProviders;
