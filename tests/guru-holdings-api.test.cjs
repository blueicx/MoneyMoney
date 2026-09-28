const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createGuruHoldingsRouter } = require('../dist/features/guru-holdings-router.js');

function envelope(overrides = {}) {
  return {
    market: 'stocks',
    dataStatus: 'cached',
    source: 'SEC EDGAR Form 13F',
    updatedAt: '2026-09-29T00:00:00.000Z',
    reason: null,
    evidenceRefs: ['https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/'],
    ...overrides,
  };
}

async function withApi(service, adminAllowed, run) {
  const app = express();
  app.use('/api/stocks/guru-holdings', createGuruHoldingsRouter(service, (_req, res) => {
    if (adminAllowed) return true;
    res.status(403).json({ error: '管理员权限不足' });
    return false;
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/stocks/guru-holdings`;
    await run(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('manager directory and CIK detail return stock-scoped evidence envelopes', async () => {
  let lookupQuery = null;
  let detailCik = null;
  const service = {
    listGuruManagers: async query => { lookupQuery = query; return [{ cik: '0001067983', filingName: 'Berkshire Hathaway Inc.' }]; },
    getGuruManagerSnapshot: cik => { detailCik = cik; return envelope({ instrument: null, latestReport: { reportPeriod: '2026-06-30' } }); },
  };
  await withApi(service, false, async base => {
    const listResponse = await fetch(`${base}/managers?query=Berkshire`);
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(lookupQuery, 'Berkshire');
    assert.equal(list.market, 'stocks');
    assert.ok('dataStatus' in list && 'source' in list && 'updatedAt' in list && 'reason' in list && 'evidenceRefs' in list);
    assert.equal(list.data[0].cik, '0001067983');

    const detailResponse = await fetch(`${base}/managers/0001067983`);
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailCik, '0001067983');
    assert.equal(detail.market, 'stocks');
    assert.equal(detail.latestReport.reportPeriod, '2026-06-30');
  });
});

test('stock holder query validates the equity symbol and bounds selected CIKs', async () => {
  let stockQuery = null;
  const service = {
    getGuruStockHolders: async (symbol, ciks) => { stockQuery = { symbol, ciks }; return envelope({ instrument: symbol, holders: [] }); },
  };
  await withApi(service, false, async base => {
    const response = await fetch(`${base}/symbols/AAPL?ciks=1067983,1336528`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(stockQuery, { symbol: 'AAPL', ciks: ['1067983', '1336528'] });
    assert.equal(body.market, 'stocks');
    assert.equal(body.instrument, 'AAPL');

    const badSymbol = await fetch(`${base}/symbols/AAPL260918C00200000`);
    assert.equal(badSymbol.status, 400);
    const badCik = await fetch(`${base}/symbols/AAPL?ciks=not-a-cik`);
    assert.equal(badCik.status, 400);
    const tooMany = await fetch(`${base}/symbols/AAPL?ciks=${Array.from({ length: 21 }, (_, i) => String(i + 1)).join(',')}`);
    assert.equal(tooMany.status, 400);
  });
});

test('manual SEC refresh is admin-only and never runs for guests', async () => {
  let refreshCount = 0;
  const service = {
    refreshGuruManager: async cik => { refreshCount += 1; return envelope({ instrument: null, manager: { cik } }); },
  };
  await withApi(service, false, async base => {
    const response = await fetch(`${base}/managers/0001067983/refresh`, { method: 'POST' });
    assert.equal(response.status, 403);
    assert.equal(refreshCount, 0);
  });
  await withApi(service, true, async base => {
    const response = await fetch(`${base}/managers/0001067983/refresh`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(refreshCount, 1);
    assert.equal(body.market, 'stocks');
  });
});

test('API response envelope cannot be changed to another market by query input', async () => {
  let receivedCik = null;
  const service = {
    getGuruManagerSnapshot: cik => { receivedCik = cik; return envelope({ market: 'crypto', instrument: 'BTCUSDT' }); },
  };
  await withApi(service, false, async base => {
    const response = await fetch(`${base}/managers/0001067983?market=crypto`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(receivedCik, '0001067983');
    assert.equal(body.market, 'stocks');
    assert.equal(body.instrument, null);
  });
});
