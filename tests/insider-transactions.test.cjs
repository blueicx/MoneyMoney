const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSecArchiveCandidates, classifyForm4Coverage, parseForm4Transactions } = require('../dist/features/insider-transactions');

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

test('Form 4 keeps derivative option disclosures separate from common-stock trades', () => {
  assert.equal(typeof parseForm4Transactions, 'function', 'Form 4 parser should expose a deterministic parser for transaction fixtures');
  const xml = `<ownershipDocument><rptOwnerName>Jane Doe</rptOwnerName>
    <nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-09-24</value></transactionDate><transactionCoding><transactionCode><value>S</value></transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>10</value></transactionShares><transactionPricePerShare><value>12</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
    </nonDerivativeTransaction></nonDerivativeTable>
    <derivativeTable><derivativeTransaction><securityTitle><value>Stock Option (right to buy)</value></securityTitle>
      <transactionDate><value>2026-09-25</value></transactionDate><transactionCoding><transactionCode><value>M</value></transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>20</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
      <underlyingSecurity><underlyingSecurityTitle><value>Common Stock</value></underlyingSecurityTitle></underlyingSecurity>
    </derivativeTransaction></derivativeTable></ownershipDocument>`;
  const rows = parseForm4Transactions(xml, '2026-09-26', 'https://www.sec.gov/Archives/edgar/data/1/0001/form4.xml');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.securityType), ['stock', 'derivative']);
  assert.equal(rows[0].securityTitle, 'Common Stock');
  assert.equal(rows[1].securityTitle, 'Stock Option (right to buy)');
  assert.equal(rows[1].underlyingSecurityTitle, 'Common Stock');
  assert.equal(rows[1].code, 'M');
});
