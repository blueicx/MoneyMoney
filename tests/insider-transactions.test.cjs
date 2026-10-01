const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSecArchiveCandidates, classifyForm4Coverage } = require('../dist/features/insider-transactions');

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

test('Form 4 reports a capped filing window as partial instead of claiming complete coverage', () => {
  assert.equal(typeof classifyForm4Coverage, 'function', 'Form 4 coverage classifier should expose bounded-scan completeness');
  const result = classifyForm4Coverage({ totalFilings: 19, scannedFilings: 16, successfulFilings: 16, failedFilings: 0, transactionCount: 7 });
  assert.equal(result.dataStatus, 'partial');
  assert.match(result.reason, /3 份.*未读取/);
});
