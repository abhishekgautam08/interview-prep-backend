import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MemoryStore } from '../db/models.js';
import { config } from '../config/index.js';
import { AuthRequest } from '../middleware/auth.js';

interface LoginAttemptRecord {
  attempts: number;
  lockUntil?: number;
}

const loginAttempts = new Map<string, LoginAttemptRecord>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function validatePasswordComplexity(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase capital letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number (0-9).' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special symbol (e.g. !@#$%^&*).' };
  }
  return { valid: true };
}

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email, password, and name are required.' });
        return;
      }

      // Enforce Password Security Rules
      const passwordValidation = validatePasswordComplexity(password);
      if (!passwordValidation.valid) {
        res.status(400).json({
          error: 'WEAK_PASSWORD',
          message: passwordValidation.error,
        });
        return;
      }

      const existing = await MemoryStore.findUserByEmail(email);
      if (existing) {
        res.status(409).json({ error: 'EMAIL_EXISTS', message: 'An account with this email already exists.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await MemoryStore.createUser({ email, passwordHash, name });

      const token = jwt.sign({ userId: user.id, email: user.email }, config.jwtSecret, { expiresIn: '7d' });

      res.status(201).json({
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password are required.' });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Check for 15-Minute Account Lockout
      const attemptRecord = loginAttempts.get(normalizedEmail);
      if (attemptRecord && attemptRecord.lockUntil && attemptRecord.lockUntil > Date.now()) {
        const remainingMinutes = Math.ceil((attemptRecord.lockUntil - Date.now()) / (60 * 1000));
        res.status(429).json({
          error: 'ACCOUNT_LOCKED',
          message: `Account temporarily locked due to 5 failed login attempts. Please try again in ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}.`,
          remainingMinutes,
        });
        return;
      }

      const user = await MemoryStore.findUserByEmail(normalizedEmail);
      if (!user) {
        // Increment failed attempt counter to protect against enumeration
        const currentAttempts = (attemptRecord?.attempts || 0) + 1;
        loginAttempts.set(normalizedEmail, { attempts: currentAttempts });
        res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        const currentAttempts = (attemptRecord?.attempts || 0) + 1;

        if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
          loginAttempts.set(normalizedEmail, {
            attempts: currentAttempts,
            lockUntil: Date.now() + LOCK_DURATION_MS,
          });
          res.status(429).json({
            error: 'ACCOUNT_LOCKED',
            message: 'Account locked due to 5 consecutive failed login attempts. Please wait 15 minutes before trying again.',
            remainingMinutes: 15,
          });
          return;
        }

        loginAttempts.set(normalizedEmail, { attempts: currentAttempts });
        const remainingAttempts = MAX_FAILED_ATTEMPTS - currentAttempts;
        res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: `Invalid email or password. ${remainingAttempts} attempt${remainingAttempts > 1 ? 's' : ''} remaining before a 15-minute lockout.`,
          remainingAttempts,
        });
        return;
      }

      // Reset failed attempts on successful login
      loginAttempts.delete(normalizedEmail);

      const userId = user.id || (user as any)._id?.toString();
      const token = jwt.sign({ userId, email: user.email }, config.jwtSecret, { expiresIn: '7d' });

      res.status(200).json({
        user: { id: userId, email: user.email, name: user.name },
        token,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  }

  static async me(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await MemoryStore.findUserById(req.userId!);
      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found.' });
        return;
      }

      const userId = user.id || (user as any)._id?.toString();
      res.status(200).json({
        user: { id: userId, email: user.email, name: user.name },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  }
}
