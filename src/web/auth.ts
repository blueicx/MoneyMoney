import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';

function b64urlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(input: string): Buffer {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = input.length % 4;
  if (pad) input += '='.repeat(4 - pad);
  return Buffer.from(input, 'base64');
}


const tokenBlacklist = new Map();
export function blacklistToken(token: string): void {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return;
    const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8')) as any;
    const exp = (payload as any).exp || (Date.now() + 12*60*60*1000);
    tokenBlacklist.set(token, exp);
  } catch { tokenBlacklist.set(token, Date.now()+12*60*60*1000); }
  const now = Date.now(); for (const [k,exp] of tokenBlacklist) if (now>exp) tokenBlacklist.delete(k);
}
export function isTokenBlacklisted(token: string): boolean {
  const exp = tokenBlacklist.get(token);
  if (!exp) return false;
  if (Date.now()>exp){ tokenBlacklist.delete(token); return false; }
  return true;
}
export interface AuthPayload { user: string; exp: number; iat: number; }

export function createLoginToken(username: string): string {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Date.now();
  const payloadObj: AuthPayload = { user: username, iat: now, exp: now + config.loginTokenExpiryMs };
  const payload = b64urlEncode(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(header + '.' + payload).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return header + '.' + payload + '.' + sig;
}

export function verifyLoginToken(token: string): AuthPayload | null {
  try {
    if (!token) return null;
    if (isTokenBlacklisted(token)) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = crypto.createHmac('sha256', config.jwtSecret).update(header + '.' + payload).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const obj = JSON.parse(b64urlDecode(payload).toString('utf8')) as AuthPayload;
    if (Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}

export function extractAuthToken(req: Request): string {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)mm_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1].trim());
  if (typeof (req.query as any)?.token === 'string') return String((req.query as any).token).trim();
  return String((req.headers['x-moneymoney-token'] as string) || '').trim();
}

export function isSecureRequest(req: any): boolean { const proto = String((req.headers['x-forwarded-proto'] as string) || '').toLowerCase(); if (proto==='https') return true; return (req as any).secure || req.protocol === 'https'; }
export function buildAuthCookie(token: string, req: any): string { const secure = isSecureRequest(req) ? '; Secure' : ''; return 'mm_token='+encodeURIComponent(token)+'; Path=/; HttpOnly; SameSite=Lax'+secure+'; Max-Age='+Math.ceil(config.loginTokenExpiryMs/1000); }
export function buildClearCookie(req: any): string { const secure = isSecureRequest(req) ? '; Secure' : ''; return 'mm_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'+secure; }
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // allow auth endpoints without token
  if (req.path.startsWith('/auth/')) { next(); return; }
  const token = extractAuthToken(req);
  if (!token) { res.status(401).json({ success: false, error: '未登录', code: 'UNAUTHORIZED' }); return; }
  if (isTokenBlacklisted(token)) { res.status(401).json({ success: false, error: "登录已过期", code: "TOKEN_EXPIRED" }); return; }
  const payload = verifyLoginToken(token);
  if (!payload) { res.status(401).json({ success: false, error: '登录已过期', code: 'TOKEN_EXPIRED' }); return; }
  (req as any).user = payload;
  next();
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
export function createLoginRateLimiter(options?: { windowMs?: number; max?: number }) {
  const windowMs = options?.windowMs ?? 60_000;
  const max = options?.max ?? 5;
  const store = new Map<string, { count: number; start: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = String((req as any).ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    const rec = store.get(ip);
    if (!rec || now - rec.start >= windowMs) {
      store.set(ip, { count: 1, start: now });
      return next();
    }
    rec.count += 1;
    if (rec.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - rec.start)) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ success: false, error: '尝试过于频繁，请稍后再试', code: 'RATE_LIMITED', retryAfter });
    }
    next();
  };
}