import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication token required to access this resource.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { userId?: string; email?: string };
    if (!payload || !payload.userId) {
      res.status(401).json({
        error: 'INVALID_SESSION',
        message: 'Invalid session token. Please log in again to refresh your session.',
      });
      return;
    }
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({
        error: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please log in again.',
      });
      return;
    }
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid session authentication token.',
    });
  }
}
