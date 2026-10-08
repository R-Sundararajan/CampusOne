import { config as loadEnv } from 'dotenv';
loadEnv({ path: ['.env', '../.env'], quiet: true });
import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith('postgresql://').or(z.string().startsWith('postgres://')),
  JWT_SECRET: z.string().min(32),
});

export type Config = {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  appOrigin: string;
  databaseUrl: string;
  jwtSecret: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Include field names only: Zod diagnostics can contain secret values.
    throw new Error(`Invalid environment: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  }
  const value = result.data;
  const origin = new URL(value.APP_ORIGIN);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.APP_ORIGIN) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path or trailing slash');
  }
  if (value.JWT_SECRET.startsWith('replace-') || value.JWT_SECRET.includes('example')) {
    throw new Error('Replace the placeholder JWT_SECRET with a random secret');
  }
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw new Error('Production APP_ORIGIN must use HTTPS outside local Docker');
  }
  return {
    nodeEnv: value.NODE_ENV, port: value.PORT, appOrigin: value.APP_ORIGIN,
    databaseUrl: value.DATABASE_URL, jwtSecret: value.JWT_SECRET,
  };
}
