import Redis from 'ioredis';
import { config } from '../../config/env';
import { logger } from '../logging/logger';

let redisClient: Redis | null = null;

export function createRedisClient(): Redis {
  const client = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
    db: config.REDIS_DB,
    keyPrefix: config.REDIS_KEY_PREFIX,
    maxRetriesPerRequest: config.REDIS_MAX_RETRIES,
    connectTimeout: config.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: config.REDIS_COMMAND_TIMEOUT_MS,
    retryStrategy(times) {
      if (times > config.REDIS_MAX_RETRIES) {
        logger.error({ attempts: times }, 'Redis max retries reached, giving up');
        return null;
      }
      const delay = Math.min(config.REDIS_RETRY_DELAY_MS * 2 ** times, 30000);
      logger.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting...');
      return delay;
    },
    lazyConnect: true,
    enableReadyCheck: true,
  });

  client.on('connect', () => logger.info('Redis connection established'));
  client.on('ready', () => logger.info('Redis ready'));
  client.on('error', (err) => logger.error({ err }, 'Redis error'));
  client.on('close', () => logger.warn('Redis connection closed'));
  client.on('reconnecting', () => logger.info('Redis reconnecting'));
  client.on('end', () => logger.warn('Redis connection ended'));

  return client;
}

export async function getRedisClient(): Promise<Redis> {
  if (!redisClient) {
    redisClient = createRedisClient();
    await redisClient.connect();
  }
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

export function isRedisConnected(): boolean {
  return redisClient?.status === 'ready';
}
