import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { isAppError } from '../../shared/errors/AppError';
import { ApiResponse } from '../../shared/types';
import { generateRequestId } from '../../shared/utils';
import { logger } from '../../infrastructure/logging/logger';

// ─── Request ID + timing ────────────────────────────────────────────────────

export function requestContext(_req: Request, res: Response, next: NextFunction): void {
  const requestId = generateRequestId();
  const startAt = Date.now();

  res.locals['requestId'] = requestId;
  res.locals['startAt'] = startAt;

  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    res.locals['latencyMs'] = Date.now() - startAt;
  });

  next();
}

// ─── Request logger ─────────────────────────────────────────────────────────

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startAt = Date.now();

  res.on('finish', () => {
    const latencyMs = Date.now() - startAt;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]({
      requestId: res.locals['requestId'],
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      latencyMs,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  });

  next();
}

// ─── Global error handler ────────────────────────────────────────────────────

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.locals['requestId'] as string;

  if (err instanceof ZodError) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.flatten(),
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - (res.locals['startAt'] as number ?? Date.now()),
      },
    };
    res.status(400).json(response);
    return;
  }

  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId, url: req.originalUrl }, 'Application error');
    } else {
      logger.warn({ message: err.message, code: err.errorCode, requestId }, 'Client error');
    }

    const response: ApiResponse = {
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        details: (err as { details?: unknown }).details,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - (res.locals['startAt'] as number ?? Date.now()),
      },
    };

    if (err.errorCode === 'RATE_LIMIT_EXCEEDED') {
      const retryAfterMs = (err as unknown as { retryAfterMs: number }).retryAfterMs;
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    }

    res.status(err.statusCode).json(response);
    return;
  }

  logger.error({ err, requestId, url: req.originalUrl }, 'Unhandled error');

  const response: ApiResponse = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
      latencyMs: 0,
    },
  };

  res.status(500).json(response);
}

// ─── 404 handler ────────────────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  const response: ApiResponse = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
    meta: {
      requestId: res.locals['requestId'] as string,
      timestamp: new Date().toISOString(),
      latencyMs: 0,
    },
  };
  res.status(404).json(response);
}
