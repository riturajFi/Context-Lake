import { performance } from 'node:perf_hooks';

export interface LoadTestOptions {
  name: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  totalRequests: number;
  concurrency: number;
  buildRequest?: (sequence: number) => {
    headers?: Record<string, string>;
    body?: string;
  };
}

export async function runLoadTest(options: LoadTestOptions) {
  const durations: number[] = [];
  let errors = 0;
  let completed = 0;
  const startedAt = performance.now();

  async function worker() {
    while (completed < options.totalRequests) {
      const current = completed;
      completed += 1;

      if (current >= options.totalRequests) {
        return;
      }

      const requestStartedAt = performance.now();
      const dynamicRequest = options.buildRequest?.(current);

      try {
        const response = await fetch(options.url, {
          method: options.method ?? 'GET',
          headers: {
            ...options.headers,
            ...dynamicRequest?.headers,
          },
          body: dynamicRequest?.body ?? options.body,
        });

        if (!response.ok) {
          errors += 1;
        }
      } catch {
        errors += 1;
      } finally {
        durations.push(performance.now() - requestStartedAt);
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));

  durations.sort((left, right) => left - right);
  const totalDurationMs = performance.now() - startedAt;
  const throughput = Number(((options.totalRequests / totalDurationMs) * 1000).toFixed(2));
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const errorRate = Number(((errors / options.totalRequests) * 100).toFixed(2));

  console.log(JSON.stringify({
    test: options.name,
    total_requests: options.totalRequests,
    concurrency: options.concurrency,
    throughput_rps: throughput,
    p50_ms: p50,
    p95_ms: p95,
    error_rate_percent: errorRate,
  }, null, 2));
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.floor(values.length * ratio));
  return Number(values[index].toFixed(2));
}
