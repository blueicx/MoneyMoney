const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { getEquityOptionsSnapshot, getOptionsSnapshot } = require('../dist/features/options-market.js');

function cboeOption(symbol, expiry, type, strike, iv, bid = 1, ask = 1.1) {
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, '0');
  return {
    option: `${symbol}${expiry}${type === 'call' ? 'C' : 'P'}${strikeCode}`,
    bid,
    ask,
    volume: 10,
    open_interest: 20,
    iv,
  };
}

async function withCboeOptions(symbol, options, run) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { current_price: 100, options } }),
  });
  try {
    return await run(await getEquityOptionsSnapshot(symbol));
  } finally {
    global.fetch = originalFetch;
  }
}

test('CBOE snapshot exposes an ATM IV term structure using same-expiry, same-strike call/put pairs', async () => {
  await withCboeOptions('TERM', [
    cboeOption('TERM', '261218', 'call', 100, 0.3),
    cboeOption('TERM', '261218', 'put', 100, 0.4),
    cboeOption('TERM', '261218', 'call', 90, 0.8),
    cboeOption('TERM', '261218', 'put', 110, 0.9),
    cboeOption('TERM', '270115', 'call', 102, 0.35),
    cboeOption('TERM', '270115', 'put', 102, 0.45),
  ], snapshot => {
    const structure = snapshot.ivTermStructure;
    assert.equal(structure.status, 'available');
    assert.equal(structure.source, snapshot.source);
    assert.equal(structure.fetchedAt, snapshot.fetchedAt);
    assert.deepEqual(structure.points.map(point => point.atmStrike), [100, 102]);
    assert.deepEqual(structure.points.map(point => point.callIvPct), [30, 35]);
    assert.deepEqual(structure.points.map(point => point.putIvPct), [40, 45]);
    assert.deepEqual(structure.points.map(point => point.putMinusCallPp), [10, 10]);
    assert.ok(structure.points.every(point => point.pairedContracts === 2));
  });
});

test('Deribit snapshot uses its own real chain and keeps its IV values source-bound', async () => {
  const originalFetch = global.fetch;
  const expiryMs = Date.UTC(2026, 11, 18, 8);
  const names = ['BTC-18DEC26-100-C', 'BTC-18DEC26-100-P'];
  global.fetch = async url => {
    const address = String(url);
    const result = address.includes('get_index_price') ? { price: 100 }
      : address.includes('get_instruments') ? names.map(instrument_name => ({ kind: 'option', instrument_name, expiration_timestamp: expiryMs }))
        : names.map((instrument_name, index) => ({ instrument_name, bid_price: 0.009, ask_price: 0.0095, volume: 10, open_interest: 20, mark_iv: index ? 44 : 42 }));
    return { ok: true, json: async () => ({ result }) };
  };
  try {
    const snapshot = await getOptionsSnapshot('BTC');
    assert.equal(snapshot.ivTermStructure.source, 'Deribit Public API');
    assert.equal(snapshot.ivTermStructure.status, 'available');
    assert.equal(snapshot.ivTermStructure.points[0].callIvPct, 42);
    assert.equal(snapshot.ivTermStructure.points[0].putIvPct, 44);
    assert.equal(snapshot.ivTermStructure.points[0].putMinusCallPp, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('ATM IV term structure does not combine neighboring strikes or different expiries', async () => {
  await withCboeOptions('TIVY', [
    cboeOption('TIVY', '261218', 'call', 100, 0.3),
    cboeOption('TIVY', '261218', 'put', 101, 0.4),
    cboeOption('TIVY', '270115', 'put', 100, 0.5),
  ], snapshot => {
    assert.equal(snapshot.ivTermStructure.status, 'unavailable');
    assert.match(snapshot.ivTermStructure.reason, /同一到期日、同一行权价/);
    assert.equal(snapshot.ivTermStructure.points.length, 0);
  });
});

test('ATM IV term structure excludes stale-looking wide/unquoted contracts and out-of-band strikes', async () => {
  await withCboeOptions('TIVZ', [
    cboeOption('TIVZ', '261218', 'call', 100, 0.3, 0, 0),
    cboeOption('TIVZ', '261218', 'put', 100, 0.4, 1, 2),
    cboeOption('TIVZ', '270115', 'call', 104, 0.3),
    cboeOption('TIVZ', '270115', 'put', 104, 0.4),
  ], snapshot => {
    assert.equal(snapshot.ivTermStructure.status, 'unavailable');
    assert.match(snapshot.ivTermStructure.reason, /近 ATM|双边有效报价/);
    assert.equal(snapshot.ivTermStructure.points.length, 0);
  });
});

test('options workspace renders the current-chain term structure as a scoped data panel', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const renderer = source.match(/function renderOptionIvTermStructure\([\s\S]*?\n\}/)?.[0];
  assert.ok(renderer, 'the options workspace should render a dedicated term-structure panel');
  assert.match(renderer, /ivTermStructure/);
  assert.match(renderer, /来源|source/);
  assert.match(renderer, /缺失|不可用/);
  assert.match(renderer, /不是预测|不构成预测/);
  assert.match(source, /renderOptionIvTermStructure\(optionsSnapshot\)/);
});

test('term-structure panel shows source-bound measurements and explicit missing-expiry reasons', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const renderer = source.match(/function renderOptionIvTermStructure\([\s\S]*?\n\}/)?.[0];
  const dom = new JSDOM('<div id="option-iv-term-structure"></div>');
  const context = {
    document: dom.window.document,
    stockEscapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  };
  const snapshot = {
    ivTermStructure: {
      status: 'partial', source: 'CBOE Delayed Quotes', fetchedAt: '2026-10-12T01:00:00.000Z',
      maxMoneynessPct: 3, coveredExpiries: 1, totalExpiries: 2, coveragePct: 50,
      points: [{ label: '2026-12-18', daysToExpiry: 67, atmStrike: 100, moneynessPct: 0, callIvPct: 30,
        putIvPct: 40, atmIvPct: 35, putMinusCallPp: 10, pairedContracts: 2 }],
      missingExpiries: [{ label: '2027-01-15', daysToExpiry: 95, reason: '近 ATM 合约缺少有效 IV 或双边报价 <bad>' }],
      reason: '1/2 个到期日有有效配对；其余到期日未纳入曲线',
    },
  };
  vm.runInNewContext(`${renderer}; renderOptionIvTermStructure(snapshot);`, { ...context, snapshot });
  const panel = dom.window.document.querySelector('.option-iv-term');
  assert.match(panel.textContent, /部分覆盖 · 1\/2 个到期日 · 50\.0%/);
  assert.match(panel.textContent, /CBOE Delayed Quotes/);
  assert.match(panel.textContent, /30\.00%/);
  assert.match(panel.textContent, /\+10\.00 个百分点/);
  assert.match(panel.textContent, /近 ATM 合约缺少有效 IV 或双边报价 <bad>/);
  assert.equal(panel.querySelector('tr.is-unavailable').querySelector('td[colspan="5"]').innerHTML.includes('&lt;bad&gt;'), true);
  dom.window.close();
});
