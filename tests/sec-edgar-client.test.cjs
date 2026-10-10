const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSecTickerDirectory,
  parseSecSubmissions,
  parseSecCompanyFacts,
  parseSecQuarterlyEarningsActual,
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
      form: ['10-K', '8-K', '4', ''], accessionNumber: ['0001-23-000001', '0001-23-000002', '0001-23-000003', ''], filingDate: ['2026-01-30', '2026-02-01', '2026-02-02', ''], acceptanceDateTime: ['2026-01-30T16:00:00.000Z', 'bad', '', ''], primaryDocument: ['annual.htm', 'current.htm', 'xslF345X06/primarydocument.xml', '']
    } },
  });
  assert.equal(result.companyName, 'Apple Inc.');
  assert.deepEqual(result.filings.map(item => item.form), ['10-K', '8-K', '4']);
  assert.equal(result.filings[2].primaryDocument, 'xslF345X06/primarydocument.xml');
  assert.equal(result.filings[0].acceptedAt, '2026-01-30T16:00:00.000Z');
  assert.equal(result.filings[1].acceptedAt, undefined);
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

test('SEC quarterly earnings require exact period, filing accession, and post-event acceptance time', () => {
  const facts = { facts: { 'us-gaap': {
    EarningsPerShareDiluted: { units: { 'USD/shares': [
      { start: '2026-04-01', end: '2026-06-30', val: 1.234, form: '10-Q', filed: '2026-08-01', accn: '0000320193-26-000081' },
      { start: '2026-04-01', end: '2026-06-30', val: 9.99, form: '10-Q', filed: '2026-08-01', accn: '0000320193-26-000099' },
    ] } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
      { start: '2026-04-01', end: '2026-06-30', val: 85000000000, form: '10-Q', filed: '2026-08-01', accn: '0000320193-26-000081' },
    ] } },
  } } };
  const submissions = { name: 'Apple Inc.', filings: { recent: {
    form: ['10-Q'], accessionNumber: ['0000320193-26-000081'], filingDate: ['2026-08-01'], reportDate: ['2026-06-30'],
    acceptanceDateTime: ['2026-08-01T17:30:00.000Z'], primaryDocument: ['aapl-20260630.htm'],
  } } };
  const input = { symbol: 'AAPL', cik: '0000320193', reportPeriodEnd: '2026-06-30', eventDate: '2026-07-29T00:00:00.000Z' };
  const actual = parseSecQuarterlyEarningsActual(facts, submissions, input);
  assert.equal(actual.symbol, 'AAPL');
  assert.equal(actual.epsUsdPerShare, 1.234);
  assert.equal(actual.revenueUsd, 85000000000);
  assert.equal(actual.accessionNumber, '0000320193-26-000081');
  assert.equal(actual.acceptedAt, '2026-08-01T17:30:00.000Z');
  assert.match(actual.sourceUrl, /www\.sec\.gov\/Archives\/edgar\/data\/320193\/000032019326000081\/aapl-20260630\.htm/);
  assert.equal(parseSecQuarterlyEarningsActual(facts, submissions, { ...input, reportPeriodEnd: '2026-03-31' }), null);
  assert.equal(parseSecQuarterlyEarningsActual(facts, submissions, { ...input, eventDate: '2026-08-02T00:00:00.000Z' }), null);
});

test('SEC 8-K earnings release actuals require matching XBRL accession and report period', () => {
  const accessionNumber = '0000320193-26-000111';
  const facts = { facts: { 'us-gaap': {
    EarningsPerShareDiluted: { units: { 'USD/shares': [
      { start: '2026-04-01', end: '2026-06-30', val: 1.45, form: '8-K', filed: '2026-08-01', accn: accessionNumber },
      { start: '2026-04-01', end: '2026-06-30', val: 99, form: '8-K', filed: '2026-08-01', accn: '0000320193-26-000999' },
    ] } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
      { start: '2026-04-01', end: '2026-06-30', val: 91000000000, form: '8-K', filed: '2026-08-01', accn: accessionNumber },
    ] } },
  } } };
  const submissions = { name: 'Apple Inc.', filings: { recent: {
    form: ['8-K'], accessionNumber: [accessionNumber], filingDate: ['2026-08-01'], reportDate: ['2026-08-01'],
    acceptanceDateTime: ['2026-08-01T17:30:00.000Z'], primaryDocument: ['aapl-earnings-release.htm'],
  } } };
  const actual = parseSecQuarterlyEarningsActual(facts, submissions, {
    symbol: 'AAPL', cik: '0000320193', reportPeriodEnd: '2026-06-30', eventDate: '2026-08-01T16:00:00.000Z',
  });
  assert.equal(actual.form, '8-K');
  assert.equal(actual.epsUsdPerShare, 1.45);
  assert.equal(actual.revenueUsd, 91000000000);
  assert.match(actual.sourceUrl, /aapl-earnings-release\.htm$/);

  const mismatched = structuredClone(submissions);
  mismatched.filings.recent.accessionNumber[0] = '0000320193-26-000222';
  assert.equal(parseSecQuarterlyEarningsActual(facts, mismatched, {
    symbol: 'AAPL', cik: '0000320193', reportPeriodEnd: '2026-06-30', eventDate: '2026-08-01T16:00:00.000Z',
  }), null, 'facts from another accession must not be attached to this 8-K');
});
