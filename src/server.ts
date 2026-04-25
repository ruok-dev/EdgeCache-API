import { createApp } from './app';
import { config } from './config/env';
import { logger } from './infrastructure/logging/logger';
import {
  getRedisClient,
  closeRedisConnection,
} from './infrastructure/redis/connection';
import { RedisCacheRepository } from './infrastructure/cache/RedisCacheRepository';

async function bootstrap(): Promise<void> {
  logger.info({ env: config.NODE_ENV, port: config.PORT }, 'Starting EdgeCache API...');

  let redisRepository: RedisCacheRepository | undefined;

  try {
    const redisClient = await getRedisClient();
    redisRepository = new RedisCacheRepository(redisClient);
    logger.info('Redis connected — using layered cache (L1 + L2)');
  } catch (err) {
    logger.warn(
      { err },
      'Redis unavailable — starting in fallback mode (L1 memory-only)',
    );
  }

  const app = createApp({ redisRepository });

  const server = app.listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        apiVersion: config.API_VERSION,
        baseUrl: `http://localhost:${config.PORT}/api/${config.API_VERSION}`,
      },
      '🚀 EdgeCache API is running',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    server.close(async () => {
      logger.info('HTTP server closed');
      await closeRedisConnection();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
