const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node/register/transpile-only');

function load() {
  const modulePath = path.join(__dirname, '../src/features/ai-comparison-default-pools.ts');
  assert.ok(fs.existsSync(modulePath), '默认对照池解析器必须存在并能在创建前验证来源');
  return require(modulePath);
}
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function contractName(asset, expiresAt, strike, type) {
  const date = new Date(expiresAt);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()];
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${asset}-${day}${month}${year}-${strike}-${type}`;
}

function optionSnapshot(asset, now, fetchedAt = now) {
  const expiryMs = now + 21 * DAY;
  const spot = asset === 'BTC' ? 100_000 : 4_000;
  const strike = spot;
  const rows = ['C', 'P'].map(type => ({
    instrumentName: contractName(asset, expiryMs, strike, type),
    strike,
    optionType: type === 'C' ? 'call' : 'put',
    bidPrice: 2,
    askPrice: 2.04,
    spreadPct: 2,
    volume: 12,
    openInterest: 100,
    quoteQuality: { status: 'quoted', label: '双边报价可见', referenceAsk: 2.04, referenceBid: 2 },
  }));
  rows.push({ ...rows[0], instrumentName: contractName(asset, now + 2 * DAY, strike, 'C'), quoteQuality: { status: 'quoted' } });
  rows.push({ ...rows[0], instrumentName: contractName(asset, expiryMs, strike + spot / 10, 'C'), spreadPct: 35, quoteQuality: { status: 'wide-spread' } });
  return {
    source: 'Deribit Public API', market: 'crypto', asset,
    fetchedAt: new Date(fetchedAt).toISOString(), spot,
    expiries: [{ expiryMs, daysToExpiry: 21, rows }],
  };
}

function verifiedQuote(name, now, expiresAt) {
  return {
    market: 'options', dataStatus: 'live', fetchedAt: new Date(now - 2_000).toISOString(),
    bestBid: 200, bestAsk: 204,
    optionContract: {
      instrumentId: `option:deribit:${name}`, sourceInstrumentName: name,
      venue: 'deribit', verified: true, currency: 'USD', multiplier: 1,
      expiresAt: new Date(expiresAt).toISOString(),
    },
  };
}

test('default crypto pool is fixed to verified Binance spot identities and never imports a watchlist', async () => {
  const { resolveDefaultComparisonPool } = load();
  const pool = await resolveDefaultComparisonPool('crypto', { now: Date.UTC(2026, 9, 11) });
  assert.equal(pool.status, 'ready');
  assert.deepEqual(pool.instruments, [
    { venue: 'Binance', symbolOrMarketId: 'BTCUSDT', title: 'BTC/USDT 现货' },
    { venue: 'Binance', symbolOrMarketId: 'ETHUSDT', title: 'ETH/USDT 现货' },
  ]);
  assert.equal(pool.sourceWatchlistId, 'defaults:crypto:v1');
  assert.match(pool.reason, /每轮.*盘口/);
});

test('default options pool only freezes fresh Deribit contracts with liquid two-sided chain rows and verified execution quotes', async () => {
  const { resolveDefaultComparisonPool } = load();
  const now = Date.UTC(2026, 9, 11, 12);
  const calls = [];
  const snapshots = {
    BTC: optionSnapshot('BTC', now),
    ETH: optionSnapshot('ETH', now),
  };
  const pool = await resolveDefaultComparisonPool('options', {
    now,
    getOptionsSnapshot: async asset => snapshots[asset],
    verifyOptionQuote: async name => {
      calls.push(name);
      const identity = name.split('-');
      const day = Number(identity[1].slice(0, 2));
      const month = MONTHS.indexOf(identity[1].slice(2, 5));
      const year = 2000 + Number(identity[1].slice(5, 7));
      const expiryMs = Date.UTC(year, month, day, 8);
      return verifiedQuote(name, now, expiryMs);
    },
  });
  assert.equal(pool.status, 'ready');
  assert.equal(pool.instruments.length, 4);
  assert.ok(pool.instruments.every(row => row.venue === 'Options'));
  assert.deepEqual(pool.instruments.map(row => row.symbolOrMarketId.split('-')[0]).sort(), ['BTC', 'BTC', 'ETH', 'ETH']);
  assert.equal(calls.length, 4);
  assert.ok(pool.evidence.every(row => row.source === 'Deribit Public API' && row.status === 'live'));
});

test('stale snapshots and failed contract verification are excluded instead of becoming default option positions', async () => {
  const { resolveDefaultComparisonPool } = load();
  const now = Date.UTC(2026, 9, 11, 12);
  const snapshots = { BTC: optionSnapshot('BTC', now, now - 180_000), ETH: optionSnapshot('ETH', now) };
  const pool = await resolveDefaultComparisonPool('options', {
    now,
    getOptionsSnapshot: async asset => snapshots[asset],
    verifyOptionQuote: async name => {
      if (name.startsWith('ETH-')) throw new Error('盘口缺少完整合约深度');
      return verifiedQuote(name, now, now + 21 * DAY);
    },
  });
  assert.equal(pool.status, 'unavailable');
  assert.deepEqual(pool.instruments, []);
  assert.match(pool.excluded.join(' '), /过期|完整合约深度/);
});

test('prediction and stock default pools fail closed; they cannot overwrite the existing stock watchlist pool or invent settlement rules', async () => {
  const { resolveDefaultComparisonPool } = load();
  let sourceCalls = 0;
  const dependencies = {
    getOptionsSnapshot: async () => { sourceCalls++; throw new Error('must not be called'); },
    verifyOptionQuote: async () => { sourceCalls++; throw new Error('must not be called'); },
  };
  const prediction = await resolveDefaultComparisonPool('prediction', dependencies);
  const stocks = await resolveDefaultComparisonPool('stocks', dependencies);
  assert.equal(prediction.status, 'unsupported');
  assert.equal(stocks.status, 'unsupported');
  assert.deepEqual(prediction.instruments, []);
  assert.deepEqual(stocks.instruments, []);
  assert.match(prediction.reason, /结算规则/);
  assert.match(stocks.reason, /现有股票组/);
  assert.equal(sourceCalls, 0);
});

test('default pool creation is a separate admin-only endpoint that refuses existing groups and cannot activate or replace them', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  const start = server.indexOf("app.post('/api/ai-runners/comparisons/automatic/defaults'");
  const end = server.indexOf("app.post('/api/ai-runners/comparisons/automatic/rebuild'", start);
  assert.ok(start >= 0 && end > start, '服务端必须提供单独的默认池创建入口');
  const route = server.slice(start, end);
  assert.match(route, /adminOnly\(req,res\)/, '默认池只能由管理员创建');
  assert.match(route, /resolveDefaultComparisonPool/, '默认标的必须通过受控解析器获取');
  assert.match(route, /groups\.find\([^)]*market/, '目标市场已有冻结组时必须拒绝覆盖');
  assert.match(route, /comparisonScheduler\.register/, '创建账户后必须登记到持久调度器');
  assert.match(route, /createAiRunnerComparison/, '账户必须沿用独立模拟账本创建流程');
  assert.doesNotMatch(route, /comparisonScheduler\.(?:setEnabled|pause)\([^)]*false/, '创建不得自动启用调度或恢复市场');
  assert.match(route, /status:\s*['"]paused['"]|paused:\s*true|register\(/, '路由必须保留调度器的安全暂停策略');
});

test('default pool endpoint persists and audits whether the fixed model was selected randomly or explicitly', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  const start = server.indexOf("app.post('/api/ai-runners/comparisons/automatic/defaults'");
  const end = server.indexOf("app.post('/api/ai-runners/comparisons/automatic/rebuild'", start);
  const route = server.slice(start, end);
  assert.match(route, /comparisonScheduler\.register\(\{\s*market,\s*groupId:group\.id,\s*model,\s*modelSelection,/s,
    '调度器必须持久保存实际使用的随机/固定选择模式');
  assert.match(route, /ai_comparison_default_pool_created[\s\S]*modelSelection/,
    '创建审计记录必须包含模型选择来源');
});

test('manual comparison rebuild persists the selected model provenance too', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  const start = server.indexOf("app.post('/api/ai-runners/comparisons/automatic/rebuild'");
  const end = server.indexOf("app.post('/api/ai-runners/comparisons/automatic/control'", start);
  const route = server.slice(start, end);
  assert.match(route, /comparisonScheduler\.register\(\{[\s\S]*?modelSelection,/,
    '重建冻结组必须保留实际模型选择模式');
});
