import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/interview_prep',
  jwtSecret: process.env.JWT_SECRET || 'fallback_jwt_secret_trao_assessment_2026',
  
  // LLM Provider configuration
  llmProvider: (process.env.LLM_PROVIDER || 'mock') as 'gemini' | 'groq' | 'openai' | 'mock',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  groqApiKey: process.env.GROQ_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  
  // Rate limits & timeouts
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '15', 10),
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '45000', 10),
  crawlerTimeoutMs: parseInt(process.env.CRAWLER_TIMEOUT_MS || '8000', 10),
  maxPageSizeBytes: 2 * 1024 * 1024, // 2MB
  maxCrawlPages: 5,
};
