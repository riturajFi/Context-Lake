import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const databaseConfigSchema = z.object({
  POSTGRES_URL: z.string().url(),
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

export function loadDatabaseConfig(): DatabaseConfig {
  loadDotenv();
  return databaseConfigSchema.parse(process.env);
}
