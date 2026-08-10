// web/src/lib/nhost.ts

import { NhostClient } from '@nhost/nextjs';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || '';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || '';

export const nhost = new NhostClient({
  subdomain: subdomain || 'local',
  region: region || '',
});
