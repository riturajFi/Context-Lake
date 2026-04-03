import { Kafka, type Admin, type Consumer, logLevel } from 'kafkajs';
import { validateEventEnvelope } from '@context-lake/shared-events';
import { createLogger } from '@context-lake/shared-logging';

import { ProjectionMetrics } from './metrics.js';
import { ProjectionApplier } from './projections.js';
import type { ProjectionConsumerRuntime } from './types.js';

export interface KafkaProjectionConsumerOptions {
  brokers: string[];
  groupId: string;
  clientId: string;
  topics: string[];
  fromBeginning: boolean;
  consumerName: string;
  logger: ReturnType<typeof createLogger>;
  metrics: ProjectionMetrics;
  applier: ProjectionApplier;
}

export class KafkaProjectionConsumer implements ProjectionConsumerRuntime {
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly admin: Admin;

  constructor(private readonly options: KafkaProjectionConsumerOptions) {
    this.kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.brokers,
      logLevel: logLevel.NOTHING,
    });
    this.consumer = this.kafka.consumer({ groupId: options.groupId });
    this.admin = this.kafka.admin();
  }

  async start() {
    await this.admin.connect();
    await this.consumer.connect();

    for (const topic of this.options.topics) {
      await this.consumer.subscribe({ topic, fromBeginning: this.options.fromBeginning });
    }

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        await this.handleMessage({
          topic,
          partition,
          offset: message.offset,
          value: message.value?.toString() ?? '{}',
        });
        await this.refreshLag(topic);
      },
    });
  }

  async stop() {
    await this.consumer.disconnect();
    await this.admin.disconnect();
  }

  async handleMessage(message: {
    topic: string;
    partition: number;
    offset: string;
    value: string;
  }) {
    const start = Date.now();

    try {
      const parsed = JSON.parse(message.value) as Record<string, unknown>;
      const event = validateEventEnvelope(parsed);
      const result = await this.options.applier.apply({
        consumerName: this.options.consumerName,
        topic: message.topic,
        partition: message.partition,
        offset: message.offset,
        event,
      });

      this.options.metrics.setProjectionUpdateLatencyMs(Date.now() - start);
      this.options.logger.info(
        {
          topic: message.topic,
          partition: message.partition,
          offset: message.offset,
          event_id: event.event_id,
          event_type: event.event_type,
          applied: result.applied,
          reason: result.applied ? undefined : result.reason,
        },
        'projection event processed',
      );
    } catch (error) {
      this.options.metrics.incrementFailedProjectionCount();
      const failureReason = error instanceof Error ? error.message : 'unknown projection error';
      let parsed: Record<string, unknown> = {};

      try {
        parsed = JSON.parse(message.value) as Record<string, unknown>;
      } catch {}

      await this.options.applier.deadLetter({
        consumerName: this.options.consumerName,
        topic: message.topic,
        partition: message.partition,
        offset: message.offset,
        payload: parsed,
        failureReason,
        event: parsed,
      });

      this.options.logger.error(
        {
          topic: message.topic,
          partition: message.partition,
          offset: message.offset,
          error,
        },
        'projection event failed and was dead-lettered',
      );
    }
  }

  private async refreshLag(topic: string) {
    const latestOffsets = await this.admin.fetchTopicOffsets(topic);
    const lag = latestOffsets.reduce((sum, latest) => sum + Number(latest.offset), 0);

    this.options.metrics.setConsumerLag(lag);
  }
}
