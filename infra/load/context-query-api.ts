import { runLoadTest } from './_shared.js';

const baseUrl = process.env.CONTEXT_QUERY_API_BASE_URL ?? 'http://localhost:3002';
const tenantId = process.env.LOAD_TEST_TENANT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = process.env.LOAD_TEST_TOKEN ?? 'context-lake-local-dev-token';
const customerId = process.env.LOAD_CUSTOMER_ID ?? '11111111-1111-4111-8111-111111111111';

await runLoadTest({
  name: 'context-query-api',
  url: `${baseUrl}/context/customer/${customerId}`,
  headers: {
    authorization: `Bearer ${token}`,
    'x-tenant-id': tenantId,
  },
  totalRequests: Number(process.env.LOAD_TOTAL_REQUESTS ?? 200),
  concurrency: Number(process.env.LOAD_CONCURRENCY ?? 20),
});
