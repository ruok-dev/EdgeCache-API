import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_VERSION: z.string().default('v1'),

  CACHE_DEFAULT_TTL: z.coerce.number().int().positive().default(300),
  CACHE_MAX_MEMORY_ENTRIES: z.coerce.number().int().positive().default(10000),
  CACHE_MAX_MEMORY_MB: z.coerce.number().int().positive().default(512),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_KEY_PREFIX: z.string().default('edgecache:'),
  REDIS_MAX_RETRIES: z.coerce.number().int().positive().default(3),
  REDIS_RETRY_DELAY_MS: z.coerce.number().int().positive().default(1000),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  LOG_INCLUDE_TRACE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  UPSTREAM_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((v) => v.split(',').filter(Boolean)),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  UPSTREAM_MAX_REDIRECTS: z.coerce.number().int().min(0).default(5),

  API_SECRET: z.string().min(32, 'API_SECRET must be at least 32 characters'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('*')
    .transform((v) => v.split(',').filter(Boolean)),

  METRICS_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  METRICS_ENDPOINT: z.string().default('/metrics'),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    console.error('❌ Invalid environment configuration:');
    console.error(JSON.stringify(formatted, null, 2));
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
