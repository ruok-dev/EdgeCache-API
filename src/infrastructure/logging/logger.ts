import pino, { Logger } from 'pino';
import { config } from '../../config/env';

function buildLogger(): Logger {
  const base: pino.LoggerOptions = {
    level: config.LOG_LEVEL,
    base: {
      pid: process.pid,
      service: 'edgecache-api',
      env: config.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  };

  if (config.LOG_FORMAT === 'pretty') {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
    });
  }

  return pino(base);
}

export const logger = buildLogger();

export function createChildLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}
