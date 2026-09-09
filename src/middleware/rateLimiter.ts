import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  statusCode?: number;
}) {
  const store = new Map<string, RateLimitRecord>();

  // Cleanup expired entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (record.resetTime <= now) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // In test environment, do not enforce rate limits to allow fast test execution
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `${ip}`;
    const now = Date.now();

    const record = store.get(key);

    if (!record || record.resetTime <= now) {
      store.set(key, {
        count: 1,
        resetTime: now + options.windowMs,
      });
      res.setHeader('X-RateLimit-Limit', options.max);
      res.setHeader('X-RateLimit-Remaining', options.max - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + options.windowMs) / 1000));
      next();
      return;
    }

    record.count++;
    const remaining = Math.max(0, options.max - record.count);
    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > options.max) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      res.status(options.statusCode || 429).json({
        error: 'TOO_MANY_REQUESTS',
        message: options.message || `Rate limit exceeded. Please retry after ${retryAfterSec} seconds.`,
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    next();
  };
}

// 1. Strict Limiter for Auth Routes (10 requests per 15 minutes per IP)
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many authentication attempts from this IP. Please try again in 15 minutes.',
});

// 2. Generation Limiter (20 generations per hour per IP)
export const kitGenerationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Kit generation rate limit reached (30 kits/hour). Please wait before generating more.',
});

// 3. General API Limiter (120 requests per minute)
export const generalApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many API requests. Please slow down.',
});
