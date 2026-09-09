import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { config } from '../config/index.js';

const router = Router();

const DB_STATE_NAMES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function getHealthStatus() {
  const readyState = mongoose.connection.readyState;
  const isDbConnected = readyState === 1;
  const mem = process.memoryUsage();

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: config.nodeEnv,
    version: '1.0.0',
    database: {
      status: DB_STATE_NAMES[readyState] || 'unknown',
      connected: isDbConnected,
      mode: isDbConnected ? 'mongodb-atlas' : 'in-memory-fallback',
      databaseName: mongoose.connection.name || undefined,
    },
    services: {
      llmProvider: config.llmProvider,
      llmModel: config.llmProvider === 'gemini' ? config.geminiModel : config.llmProvider,
      crawler: 'ready',
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      },
    },
  };
}

// GET /health and GET /api/health
router.get('/', (req: Request, res: Response) => {
  const health = getHealthStatus();
  res.status(200).json(health);
});

export default router;
