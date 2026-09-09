import { describe, it, expect } from 'vitest';
import { getHealthStatus } from '../src/routes/healthRoutes.js';
import { config } from '../src/config/index.js';

describe('Health Check API (/health & /api/health)', () => {
  it('returns valid health payload with required fields', () => {
    const health = getHealthStatus();

    expect(health.status).toBe('ok');
    expect(typeof health.timestamp).toBe('string');
    expect(typeof health.uptimeSeconds).toBe('number');
    expect(health.environment).toBe(config.nodeEnv);
    expect(health.version).toBe('1.0.0');

    // Database structure
    expect(health.database).toHaveProperty('status');
    expect(health.database).toHaveProperty('connected');
    expect(health.database).toHaveProperty('mode');

    // Services structure
    expect(health.services.llmProvider).toBe(config.llmProvider);
    expect(health.services.crawler).toBe('ready');

    // System metrics
    expect(typeof health.system.nodeVersion).toBe('string');
    expect(typeof health.system.platform).toBe('string');
    expect(typeof health.system.memory.heapUsedMB).toBe('number');
    expect(typeof health.system.memory.heapTotalMB).toBe('number');
    expect(typeof health.system.memory.rssMB).toBe('number');
  });
});
