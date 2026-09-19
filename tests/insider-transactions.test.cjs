const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSecArchiveCandidates } = require('../dist/features/insider-transactions');

test('SEC Form 4 candidates use the raw primary document basename before legacy fallbacks', () => {
  assert.deepEqual(
    buildSecArchiveCandidates('0001234567-26-000089', 'xslF345X06/wk-form4_1789000000.xml'),
    ['wk-form4_1789000000.xml', 'form4.xml', '0001234567-26-000089.txt'],
  );
});

test('SEC Form 4 candidates reject unsafe or missing document paths', () => {
  assert.deepEqual(
    buildSecArchiveCandidates('0001234567-26-000089', '../private.xml'),
    ['form4.xml', '0001234567-26-000089.txt'],
  );
});
