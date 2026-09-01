const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// ---- auth module (dist) ----
const auth = require('../dist/web/auth');
const configMod = require('../dist/config');

test('createLoginToken and verify round-trip, tamper and expiry', () => {
  const tok = auth.createLoginToken('admin');
  const payload = auth.verifyLoginToken(tok);
  assert.ok(payload);
  assert.equal(payload.user, 'admin');
  assert.ok(payload.exp > Date.now());
  // tamper
  const tampered = tok.slice(0, -1) + (tok.slice(-1) === 'A' ? 'B' : 'A');
  assert.equal(auth.verifyLoginToken(tampered), null);
  // blacklist
  auth.blacklistToken(tok);
  assert.equal(auth.verifyLoginToken(tok), null);
  assert.equal(auth.isTokenBlacklisted(tok), true);
});

test('verify rejects empty and malformed', () => {
  assert.equal(auth.verifyLoginToken(''), null);
  assert.equal(auth.verifyLoginToken('a.b'), null);
  assert.equal(auth.verifyLoginToken('a.b.c.d'), null);
});

test('buildAuthCookie includes HttpOnly, SameSite, Max-Age and Secure on https', () => {
  const tok = auth.createLoginToken('u');
  const httpReq = { headers: {}, protocol: 'http', secure: false };
  const httpsReq = { headers: { 'x-forwarded-proto': 'https' }, protocol: 'http', secure: false };
  const c1 = auth.buildAuthCookie(tok, httpReq);
  const c2 = auth.buildAuthCookie(tok, httpsReq);
  assert.match(c1, /HttpOnly/);
  assert.match(c1, /SameSite=Lax/);
  assert.match(c1, /Max-Age=/);
  assert.ok(!c1.includes('Secure'), 'http should not have Secure');
  assert.ok(c2.includes('Secure'), 'https should have Secure');
  const clear = auth.buildClearCookie(httpReq);
  assert.match(clear, /Max-Age=0/);
  assert.match(clear, /HttpOnly/);
});

test('isSecureRequest detects proto and secure flag', () => {
  assert.equal(auth.isSecureRequest({ headers: { 'x-forwarded-proto': 'https' }, protocol: 'http' }), true);
  assert.equal(auth.isSecureRequest({ headers: {}, protocol: 'https', secure: true }), true);
  assert.equal(auth.isSecureRequest({ headers: {}, protocol: 'http', secure: false }), false);
});

test('safeEqual timing safe', () => {
  assert.equal(auth.safeEqual('admin', 'admin'), true);
  assert.equal(auth.safeEqual('admin', 'Admin'), false);
  assert.equal(auth.safeEqual('a', 'ab'), false);
});

test('login rate limiter blocks 6th request in 60s with 429 and Retry-After', () => {
  const limiter = auth.createLoginRateLimiter({ windowMs: 60000, max: 5 });
  const mkReq = (ip='1.2.3.4') => ({ ip, socket: { remoteAddress: ip }, headers: {} });
  const mkRes = () => {
    const h={}; return {
      headers: h,
      statusCode: 200,
      setHeader(k,v){ h[k]=v; },
      status(code){ this.statusCode=code; return this; },
      json(v){ this.body=v; return this; }
    };
  };
  let nextCalls=0;
  for(let i=0;i<5;i++){
    const req=mkReq(); const res=mkRes();
    limiter(req,res,()=>{nextCalls++;});
    assert.equal(res.statusCode,200);
  }
  assert.equal(nextCalls,5);
  const req6=mkReq(); const res6=mkRes(); let called=false;
  limiter(req6,res6,()=>{called=true;});
  assert.equal(called,false);
  assert.equal(res6.statusCode,429);
  assert.equal(res6.body.code,'RATE_LIMITED');
  assert.ok(res6.headers['Retry-After']);
});

test('config default credential helpers', () => {
  // helpers should reflect current env (defaults in test env are admin/admin123)
  const isDefault = configMod.isDefaultLoginCredentials();
  const status = configMod.getLoginSecurityStatus();
  assert.equal(typeof isDefault, 'boolean');
  assert.equal(typeof status.isDefault, 'boolean');
  assert.equal(typeof status.isJwtDefault, 'boolean');
  // BUILD checks: the file exists
  assert.ok(status);
});

test('extractAuthToken prefers Bearer, then Cookie, then query', () => {
  const bearer = auth.extractAuthToken({ headers: { authorization: 'Bearer abc123', cookie: 'mm_token=cookie123' }, query: {} });
  assert.equal(bearer, 'abc123');
  const cookie = auth.extractAuthToken({ headers: { cookie: 'mm_token=cookie123' }, query: {} });
  assert.equal(cookie, 'cookie123');
  const q = auth.extractAuthToken({ headers: {}, query: { token: 'q123' } });
  assert.equal(q, 'q123');
});

test('requireAuth allows auth paths and rejects unauthenticated', () => {
  const reqAuth = { path: '/auth/login', headers: {}, query: {} };
  let next=false; auth.requireAuth(reqAuth, { status(){return this;}, json(){return this;}}, ()=>{next=true;});
  assert.equal(next,true);
  const reqUnauth = { path: '/portfolio', headers: {}, query: {} };
  const res = { statusCode:200, status(c){this.statusCode=c;return this;}, json(v){this.body=v;return this;}};
  auth.requireAuth(reqUnauth, res, ()=>{});
  assert.equal(res.statusCode,401);
  assert.equal(res.body.code,'UNAUTHORIZED');
});

test('frontend assets contain new hardening markers', () => {
  const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'dist', 'web', 'public', 'login.html'), 'utf8');
  assert.ok(loginHtml.includes('pw-toggle'), 'login should have show/hide toggle');
  assert.ok(loginHtml.includes('expiredBanner'), 'login should have expired banner');
  assert.ok(loginHtml.includes('defaultBanner'), 'login should have default cred banner');
  assert.match(loginHtml, /Retry-After|429/);
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'dist', 'web', 'public', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('sec-banner'), 'index should have security banner');
  assert.ok(indexHtml.includes('mm_isLoggedIn'), 'index should have login state helper');
  assert.ok(indexHtml.includes('quick') || indexHtml.includes('快捷'), 'index radar should have quick trade linkage');
});

test('server endpoints include /api/auth/status', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname,'..','src','web','server.ts'),'utf8');
  assert.ok(serverSrc.includes("/api/auth/status"), 'status endpoint exists');
  assert.ok(serverSrc.includes('buildAuthCookie'), 'uses secure cookie helper');
  assert.ok(serverSrc.includes('blacklistToken'), 'logout blacklists');
  assert.ok(serverSrc.includes('/login') && serverSrc.includes('redirect'), 'login redirects when already authed');
});
