import { config as loadDotenv } from 'dotenv';
import { Redis } from 'ioredis';
import { Kafka } from 'kafkajs';
import { Client as MinioClient } from 'minio';
import { Client as PgClient } from 'pg';
import { z } from 'zod';

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  SERVICE_NAME: z.string(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  POSTGRES_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  KAFKA_BROKERS: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive(),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
});

export type BaseConfig = z.infer<typeof baseSchema>;

export function loadConfig<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  loadDotenv();

  return baseSchema.extend(schema.shape).parse(process.env);
}

export async function checkPostgres(postgresUrl: string) {
  const client = new PgClient({ connectionString: postgresUrl });
  await client.connect();
  await client.query('select 1');
  await client.end();
}

export async function checkRedis(redisUrl: string) {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await client.connect();
    await client.ping();
  } finally {
    client.disconnect();
  }
}

export async function checkKafka(brokers: string[]) {
  const kafka = new Kafka({
    clientId: 'context-lake-connectivity-check',
    brokers,
  });
  const admin = kafka.admin();

  await admin.connect();
  await admin.listTopics();
  await admin.disconnect();
}

export async function checkMinio(config: {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}) {
  const client = new MinioClient(config);
  await client.listBuckets();
}

export { z };
