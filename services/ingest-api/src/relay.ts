import type { EventPublisher } from '@context-lake/shared-events';
import { validateEventEnvelope } from '@context-lake/shared-events';
import { createRepositoryContext, withTransaction } from '@context-lake/shared-db';
import type { FastifyBaseLogger } from 'fastify';
import type { IngestionMetrics } from './metrics.js';
import type { Pool } from 'pg';

export interface OutboxRelayOptions {
  pool: Pool;
  publisher: EventPublisher;
  logger: FastifyBaseLogger;
  metrics: IngestionMetrics;
  pollIntervalMs: number;
  batchSize: number;
  maxRetryDelaySeconds: number;
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly options: OutboxRelayOptions) {}

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollIntervalMs);
  }

  async tick() {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const claimed = await withTransaction(this.options.pool, async (tx) => {
        const repositories = createRepositoryContext(tx);
        const pendingCount = await repositories.outbox.countPending();
        this.options.metrics.setOutboxPendingCount(pendingCount);

        return repositories.outbox.claimBatch(this.options.batchSize);
      });

      for (const row of claimed) {
        await this.publishClaimedRow(row.event_id);
      }
    } finally {
      this.running = false;
    }
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    await this.options.publisher.disconnect?.();
  }

  private async publishClaimedRow(eventId: string) {
    const row = await createRepositoryContext(this.options.pool).outbox.findById(eventId);

    if (!row) {
      return;
    }

    try {
      const event = validateEventEnvelope({
        event_id: row.event_id,
        event_type: row.event_name,
        event_version: row.event_version,
        tenant_id: row.tenant_id,
        trace_id: row.trace_id,
        actor_id: row.actor_id ?? undefined,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        occurred_at: normalizeTimestamp(row.occurred_at),
        produced_at: normalizeTimestamp(row.available_at),
        source: 'ingest-api-outbox-relay',
        idempotency_key: row.idempotency_key ?? undefined,
        payload: row.payload,
      });

      await this.options.publisher.publish({
        topic: row.topic,
        key: row.partition_key,
        event,
        headers: {
          trace_id: row.trace_id,
          tenant_id: row.tenant_id,
          event_id: row.event_id,
        },
      });

      await createRepositoryContext(this.options.pool).outbox.markPublished(row.event_id);
      this.options.metrics.incrementPublishSuccess();
      this.options.logger.info(
        {
          event_id: row.event_id,
          topic: row.topic,
          trace_id: row.trace_id,
        },
        'outbox event published',
      );
    } catch (error) {
      const retryDelaySeconds = Math.min(
        Math.max(row.attempt_count, 1) * 5,
        this.options.maxRetryDelaySeconds,
      );
      const reason = error instanceof Error ? error.message : 'unknown publish error';
      const availableAt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();

      await createRepositoryContext(this.options.pool).outbox.markFailed(
        row.event_id,
        reason,
        availableAt,
      );
      this.options.metrics.incrementPublishFailure();
      this.options.logger.error(
        {
          event_id: row.event_id,
          topic: row.topic,
          trace_id: row.trace_id,
          retry_delay_seconds: retryDelaySeconds,
          error,
        },
        'outbox event publish failed',
      );
    }
  }
}

function normalizeTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}
