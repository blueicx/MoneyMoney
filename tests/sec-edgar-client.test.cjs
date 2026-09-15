const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSecTickerDirectory,
  parseSecSubmissions,
  parseSecCompanyFacts,
  buildSecHeaders,
} = require('../dist/features/sec-edgar-client');

test('SEC ticker directory normalizes CIK, ticker, title and exchange', () => {
  const rows = parseSecTickerDirectory({
    '0': { cik_str: 320193, ticker: 'aapl', title: 'Apple Inc.', exchange: 'Nasdaq' },
  });
  assert.deepEqual(rows, [{ cik: '0000320193', ticker: 'AAPL', title: 'Apple Inc.', exchange: 'Nasdaq' }]);
});

test('SEC submissions keeps recent filing rows aligned and filters malformed rows', () => {
  const result = parseSecSubmissions({
    name: 'Apple Inc.',
    filings: { recent: {
      form: ['10-K', '8-K', ''], accessionNumber: ['0001-23-000001', '0001-23-000002', ''], filingDate: ['2026-01-30', '2026-02-01', '']
    } },
  });
  assert.equal(result.companyName, 'Apple Inc.');
  assert.deepEqual(result.filings.map(item => item.form), ['10-K', '8-K']);
});

test('company facts selects latest annual USD values by tag', () => {
  const result = parseSecCompanyFacts({
    entityName: 'Example Inc.', facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { start: '2024-01-01', end: '2024-12-31', val: 100, form: '10-K', fp: 'FY', filed: '2025-02-01' },
        { start: '2025-01-01', end: '2025-12-31', val: 120, form: '10-K', fp: 'FY', filed: '2026-02-01' },
      ] } },
    } },
  });
  assert.equal(result.entityName, 'Example Inc.');
  assert.equal(result.annualFacts.Revenues[0].value, 120);
});

test('SEC headers identify MoneyMoney without exposing runtime secrets', () => {
  const headers = buildSecHeaders({ MONEYMONEY_SEC_USER_AGENT: 'MoneyMoney/1.0 (stock research; contact: test@example.com)' });
  assert.match(headers['User-Agent'], /^MoneyMoney\/1\.0/);
  assert.equal(Object.keys(headers).some(key => /key|token|secret/i.test(key)), false);
});
