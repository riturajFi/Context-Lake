import { runLoadTest } from './_shared.js';

const baseUrl = process.env.INGEST_API_BASE_URL ?? 'http://localhost:3001';
const tenantId = process.env.LOAD_TEST_TENANT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = process.env.LOAD_TEST_TOKEN ?? 'context-lake-local-dev-token';

await runLoadTest({
  name: 'ingest-api',
  url: `${baseUrl}/ingest/customer`,
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-tenant-id': tenantId,
  },
  buildRequest(sequence) {
    const suffix = `${Date.now()}-${sequence}`;

    return {
      headers: {
        'idempotency-key': `load-${suffix}`,
      },
      body: JSON.stringify({
        external_ref: `load-${suffix}`,
        email: `load-${sequence}@example.com`,
        full_name: `Load Test User ${sequence}`,
        status: 'active',
        metadata: {
          source: 'load-test',
        },
      }),
    };
  },
  totalRequests: Number(process.env.LOAD_TOTAL_REQUESTS ?? 100),
  concurrency: Number(process.env.LOAD_CONCURRENCY ?? 10),
});
