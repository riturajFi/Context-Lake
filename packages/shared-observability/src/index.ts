import { SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
} from 'prom-client';

import type { ServiceName } from '@context-lake/shared-types';

export {
  Counter,
  Gauge,
  Histogram,
  Registry,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
};

export interface TelemetryOptions {
  serviceName: ServiceName;
  endpoint?: string;
}

export async function initializeOpenTelemetry(options: TelemetryOptions) {
  if (!options.endpoint) {
    return null;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
    }),
    traceExporter: new OTLPTraceExporter({
      url: options.endpoint,
    }),
  });

  await sdk.start();
  return sdk;
}

export async function shutdownOpenTelemetry(sdk: NodeSDK | null) {
  if (!sdk) {
    return;
  }

  await sdk.shutdown();
}

export async function withActiveSpan<T>(
  tracerName: string,
  spanName: string,
  attributes: Record<string, string | number | boolean | undefined>,
  callback: () => Promise<T>,
) {
  const tracer = trace.getTracer(tracerName);

  return tracer.startActiveSpan(
    spanName,
    {
      attributes: Object.fromEntries(
        Object.entries(attributes).filter(
          (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
        ),
      ),
    },
    async (span) => {
      try {
        const result = await callback();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error('unknown error'));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'unknown error',
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function createMetricsRegistry(serviceName: ServiceName) {
  const registry = new Registry();
  registry.setDefaultLabels({
    service: serviceName,
  });
  collectDefaultMetrics({
    register: registry,
    prefix: 'context_lake_',
  });
  return registry;
}

export async function getPrometheusMetrics(registry: Registry) {
  return registry.metrics();
}
