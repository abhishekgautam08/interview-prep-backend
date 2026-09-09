import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { connectDB } from './db/connection.js';
import authRoutes from './routes/authRoutes.js';
import kitRoutes from './routes/kitRoutes.js';
import practiceRoutes from './routes/practiceRoutes.js';

const app = express();

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Middleware
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

// General Rate Limiter for all API routes
import { generalApiLimiter, authRateLimiter } from './middleware/rateLimiter.js';
app.use('/api', generalApiLimiter);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/kits', kitRoutes);
app.use('/api/kits', practiceRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[ServerError]', err);
  res.status(err.status || 500).json({
    error: err.name || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected internal error occurred.',
  });
});

export async function startServer() {
  await connectDB();
  return app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`🚀 Interview Prep Kit Backend running on port ${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   LLM Provider: ${config.llmProvider}`);
    console.log(`   CORS Origin: ${config.corsOrigin}`);
    console.log(`====================================================`);
  });
}

// If run directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
