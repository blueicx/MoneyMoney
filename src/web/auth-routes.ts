import crypto from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { config, getLoginSecurityStatus } from '../config';
import { stateStore } from '../storage/sqlite-state';
import {
  GUEST_TOKEN_EXPIRY_MS,
  blacklistToken,
  buildAuthCookie,
  buildClearCookie,
  buildClearCsrfCookie,
  buildCsrfCookie,
  configureTokenRevocationStore,
  createCsrfToken,
  createLoginRateLimiter,
  createLoginToken,
  extractAuthToken,
  isGuestRequestAllowed,
  requireAuth,
  requireCsrf,
  safeEqual,
  verifyLoginToken,
} from './auth';

function audit(action: string, req: Request, detail: string): void {
  stateStore.appendAudit({
    id: `web-auth-${crypto.randomUUID()}`,
    action,
    detail: `${detail}; ip=${String(req.ip || req.socket.remoteAddress || 'unknown')}`,
  });
}

function issueSession(res: Response, req: Request, user: string, role: 'admin' | 'guest', expiryMs: number) {
  const token = createLoginToken(user, role, expiryMs);
  const csrfToken = createCsrfToken();
  res.setHeader('Set-Cookie', [buildAuthCookie(token, req, expiryMs), buildCsrfCookie(csrfToken, req, expiryMs)]);
  return { token, csrfToken };
}

export function registerAuthRoutes(app: Express): void {
  configureTokenRevocationStore({
    revoke: (tokenHash, expiresAt) => stateStore.revokeSession(tokenHash, expiresAt),
    isRevoked: (tokenHash, now) => stateStore.isSessionRevoked(tokenHash, now),
  });
  const loginRateLimiter = createLoginRateLimiter({ windowMs: 60_000, max: 5 });

  app.post('/api/auth/login', loginRateLimiter, (req, res) => {
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    const user = String(username || '').trim();
    const passwordValue = String(password || '');
    if (!user || !passwordValue) return res.status(400).json({ success: false, error: '请输入用户名和密码' });
    if (!config.loginUser || !config.loginPass) {
      audit('login_rejected_unconfigured', req, `user=${user}`);
      return res.status(503).json({ success: false, error: '管理员账号尚未完成安全初始化', code: 'AUTH_NOT_CONFIGURED' });
    }
    if (!safeEqual(user, config.loginUser) || !safeEqual(passwordValue, config.loginPass)) {
      audit('login_failed', req, `user=${user}`);
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }
    const session = issueSession(res, req, user, 'admin', config.loginTokenExpiryMs);
    audit('login_succeeded', req, `user=${user}`);
    return res.json({ success: true, token: session.token, csrfToken: session.csrfToken, user, role: 'admin', expiresInMs: config.loginTokenExpiryMs });
  });

  app.post('/api/auth/guest', loginRateLimiter, (req, res) => {
    const session = issueSession(res, req, 'guest', 'guest', GUEST_TOKEN_EXPIRY_MS);
    audit('guest_session_started', req, 'user=guest');
    res.json({ success: true, token: session.token, csrfToken: session.csrfToken, user: 'guest', role: 'guest', expiresInMs: GUEST_TOKEN_EXPIRY_MS });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = extractAuthToken(req);
    const payload = token ? verifyLoginToken(token) : null;
    if (!payload) return res.status(401).json({ success: false, error: '登录已过期' });
    const remain = payload.exp - Date.now();
    if (payload.role !== 'guest' && remain < 2 * 60 * 60 * 1000) {
      const session = issueSession(res, req, payload.user, payload.role, config.loginTokenExpiryMs);
      blacklistToken(token);
      return res.json({ success: true, user: payload.user, role: payload.role, exp: Date.now() + config.loginTokenExpiryMs, token: session.token, csrfToken: session.csrfToken, renewed: true });
    }
    res.json({ success: true, user: payload.user, role: payload.role, exp: payload.exp });
  });

  app.post('/api/auth/logout', requireCsrf, (req, res) => {
    const token = extractAuthToken(req);
    const payload = token ? verifyLoginToken(token) : null;
    if (token) blacklistToken(token);
    res.setHeader('Set-Cookie', [buildClearCookie(req), buildClearCsrfCookie(req)]);
    audit('logout', req, `user=${payload?.user || 'unknown'}`);
    res.json({ success: true });
  });

  app.get('/api/auth/status', (req, res) => {
    const token = extractAuthToken(req);
    const payload = token ? verifyLoginToken(token) : null;
    let csrfToken: string | null = null;
    if (payload) {
      csrfToken = createCsrfToken();
      res.append('Set-Cookie', buildCsrfCookie(csrfToken, req, Math.max(1, payload.exp - Date.now())));
    }
    const security = getLoginSecurityStatus();
    res.json({ success: true, data: { ...security, configured: !!config.loginUser && !!config.loginPass, loggedIn: !!payload, user: payload?.user || null, role: payload?.role || null, csrfToken, tokenExpiryMs: payload?.role === 'guest' ? GUEST_TOKEN_EXPIRY_MS : config.loginTokenExpiryMs } });
  });
}

export function registerApiAuthProtection(app: Express): void {
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/auth/') || req.path === '/health' || req.path === '/health/live' || req.path === '/health/readiness' || req.path === '/health/version') {
      next();
      return;
    }
    const token = extractAuthToken(req);
    const payload = token ? verifyLoginToken(token) : null;
    if (payload?.role === 'guest' && !isGuestRequestAllowed(req.method, req.path)) {
      res.status(403).json({ success: false, error: '访客模式仅支持只读浏览', code: 'GUEST_READ_ONLY' });
      return;
    }
    requireAuth(req, res, () => requireCsrf(req, res, next));
  });
}
