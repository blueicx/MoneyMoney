const test = require('node:test');
const assert = require('node:assert/strict');
const { assessOptionQuoteQuality } = require('../dist/features/options-market.js');

test('option quote quality distinguishes executable two-sided prices, wide spreads and missing quotes', () => {
  assert.deepEqual(assessOptionQuoteQuality({ bidPrice: 1.9, askPrice: 2.1, spreadPct: 10, volume: 20, openInterest: 100 }), {
    status: 'quoted', label: '双边报价可见', referenceAsk: 2.1, referenceBid: 1.9,
  });
  assert.equal(assessOptionQuoteQuality({ bidPrice: 1, askPrice: 2, spreadPct: 66.67, volume: 1, openInterest: 2 }).status, 'wide-spread');
  assert.equal(assessOptionQuoteQuality({ bidPrice: 0, askPrice: 0, spreadPct: null, volume: 0, openInterest: 0 }).status, 'unquoted');
});
