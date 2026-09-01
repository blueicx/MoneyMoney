const assert = require('node:assert/strict');
const test = require('node:test');
const { createAccessMiddleware, isLanMode, isLoopbackHost, validateAccessConfiguration } = require('../dist/web/access-control');

test('detects loopback and requires a token for LAN binding', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLanMode('127.0.0.1'), false);
  assert.equal(isLanMode('0.0.0.0'), true);
  assert.deepEqual(validateAccessConfiguration('0.0.0.0', false, ''), ['LAN 访问必须配置 MONEYMONEY_ACCESS_TOKEN']);
  assert.deepEqual(validateAccessConfiguration('127.0.0.1', false, ''), []);
});

test('auth middleware allows health, rejects bad token, and accepts bearer token', () => {
  const middleware = createAccessMiddleware({ enabled: true, token: 'secret-token', maxRequests: 10 });
  const response = () => ({ headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
  const request = path => ({ path, headers: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } });

  const healthRes = response(); let called = false;
  middleware(request('/health'), healthRes, () => { called = true; });
  assert.equal(called, true);

  const denied = response(); middleware(request('/portfolio'), denied, () => {});
  assert.equal(denied.statusCode, 401);
  const allowedReq = request('/portfolio'); allowedReq.headers.authorization = 'Bearer secret-token';
  const allowedRes = response(); called = false;
  middleware(allowedReq, allowedRes, () => { called = true; });
  assert.equal(called, true);
  assert.ok(allowedRes.headers['X-Request-Id']);
});
