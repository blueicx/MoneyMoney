import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface AccessControlOptions {
  enabled: boolean;
  token: string;
  windowMs?: number;
  maxRequests?: number;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = String(host || '').trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1' || normalized === '[::1]';
}

export function isLanMode(host: string, explicit = false): boolean { return explicit || !isLoopbackHost(host); }

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractToken(req: Request): string {
  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  if (typeof req.query?.access_token === 'string') return req.query.access_token.trim();
  return String(req.headers['x-moneymoney-access-token'] || '').trim();
}

export function createAccessMiddleware(options: AccessControlOptions) {
  const counts = new Map<string, { startedAt: number; count: number }>();
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 120;
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
    res.setHeader('X-Request-Id', requestId);
    if (!options.enabled) return next();
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const current = counts.get(ip);
    const now = Date.now();
    if (!current || now - current.startedAt >= windowMs) counts.set(ip, { startedAt: now, count: 1 });
    else {
      current.count += 1;
      if (current.count > maxRequests) {
        res.setHeader('Retry-After', Math.ceil((windowMs - (now - current.startedAt)) / 1000));
        return res.status(429).json({ success: false, error: '请求过于频繁', requestId });
      }
    }
    if (req.path === '/health' || req.path === '/health/live') return next();
    const token = extractToken(req);
    if (!options.token || !safeEqual(token, options.token)) return res.status(401).json({ success: false, error: '需要有效的访问令牌', requestId });
    next();
  };
}

export function validateAccessConfiguration(host: string, explicitLanMode: boolean, token: string): string[] {
  if (!isLanMode(host, explicitLanMode)) return [];
  return token.trim() ? [] : ['LAN 访问必须配置 MONEYMONEY_ACCESS_TOKEN'];
}
