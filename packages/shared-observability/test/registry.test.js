import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetricsRegistry } from '../src/index.ts';
test('creates a registry with service default labels', async () => {
    const registry = createMetricsRegistry('ingest-api');
    const metrics = await registry.metrics();
    assert.match(metrics, /service="ingest-api"/);
});
//# sourceMappingURL=registry.test.js.map