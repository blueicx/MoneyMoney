const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const isolatedDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-guru-service-'));
process.env.MONEYMONEY_DATA_DIR = isolatedDataRoot;
const {
  parse13FInformationTable,
  parse13FCoverPage,
  apply13FAmendment,
  compare13FReports,
} = require('../dist/features/guru-holdings.js');
const {
  normalizeSecCik,
  parseSec13FSubmissions,
  buildSec13FArchiveUrl,
  findSec13FInformationTable,
  loadSec13FDocuments,
  fetchSecJson,
  fetchSecText,
  reportedValueUnitForFilingDate,
} = require('../dist/features/sec-edgar-client.js');
const { GURU_MANAGER_REGISTRY, resolveGuruStockMapping, searchGuruManagerRegistry } = require('../dist/features/guru-holdings-registry.js');
const { createGuruHoldingsService } = require('../dist/features/guru-holdings.js');
const { researchRepository } = require('../dist/features/research-repository.js');
const { stateStore } = require('../dist/storage/sqlite-state.js');

test.after(() => {
  researchRepository.close();
  stateStore.close();
  fs.rmSync(isolatedDataRoot, { recursive: true, force: true });
});

test('13F parser preserves CUSIP, class, shares, and reported value', () => {
  const xml = '<informationTable><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>125000</value><shrsOrPrnAmt><sshPrnamt>500</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>';

  assert.deepEqual(parse13FInformationTable(xml), [{
    issuerName: 'APPLE INC',
    classTitle: 'COM',
    cusip: '037833100',
    reportedValue: 125000,
    shares: 500,
    putCall: null,
    investmentDiscretion: null,
    shareAmountType: 'SH',
  }]);
});

test('13F parser accepts SEC information tables with a namespace prefix', () => {
  const xml = '<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">'
    + '<ns1:infoTable><ns1:nameOfIssuer>10X GENOMICS INC</ns1:nameOfIssuer><ns1:titleOfClass>CL A COM</ns1:titleOfClass>'
    + '<ns1:cusip>88025U109</ns1:cusip><ns1:value>512798</ns1:value><ns1:shrsOrPrnAmt>'
    + '<ns1:sshPrnamt>13375</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>'
    + '<ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion></ns1:infoTable></ns1:informationTable>';

  assert.deepEqual(parse13FInformationTable(xml), [{
    issuerName: '10X GENOMICS INC',
    classTitle: 'CL A COM',
    cusip: '88025U109',
    reportedValue: 512798,
    shares: 13375,
    putCall: null,
    investmentDiscretion: 'SOLE',
    shareAmountType: 'SH',
  }]);
});

test('13F parser aggregates same security split across investment-discretion lines', () => {
  const xml = '<informationTable>'
    + '<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>20</value><shrsOrPrnAmt><sshPrnamt>100</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion></infoTable>'
    + '<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>10</value><shrsOrPrnAmt><sshPrnamt>50</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>DEFINED</investmentDiscretion></infoTable>'
    + '</informationTable>';
  const [position] = parse13FInformationTable(xml);
  assert.equal(position.shares, 150);
  assert.equal(position.reportedValue, 30);
  assert.equal(position.shareAmountType, 'SH');
  assert.equal(position.investmentDiscretion, 'DEFINED,SOLE');
});

test('13F parser rejects duplicate CUSIP rows with incompatible share/principal units', () => {
  const xml = '<informationTable>'
    + '<infoTable><nameOfIssuer>EXAMPLE CORP</nameOfIssuer><titleOfClass>NOTE</titleOfClass><cusip>037833100</cusip><value>20</value><shrsOrPrnAmt><sshPrnamt>100</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>'
    + '<infoTable><nameOfIssuer>EXAMPLE CORP</nameOfIssuer><titleOfClass>NOTE</titleOfClass><cusip>037833100</cusip><value>30</value><shrsOrPrnAmt><sshPrnamt>200</sshPrnamt><sshPrnamtType>PRN</sshPrnamtType></shrsOrPrnAmt></infoTable>'
    + '</informationTable>';
  assert.throws(() => parse13FInformationTable(xml), /duplicate .* ambiguous/i);
});

test('quarter comparison uses disclosed shares, not changing market value', () => {
  const previous = { positions: [{ cusip: '037833100', shares: 100, reportedValueUsd: 20_000 }] };
  const current = { positions: [{ cusip: '037833100', shares: 120, reportedValueUsd: 18_000 }] };

  const row = compare13FReports(previous, current)[0];

  assert.equal(row.change, 'increased');
  assert.equal(row.shareDelta, 20);
});

test('missing current filing is labeled not disclosed rather than sold out', () => {
  const previous = { positions: [{ cusip: '037833100', shares: 100, reportedValueUsd: 20_000 }] };

  assert.equal(compare13FReports(previous, { positions: [] })[0].change, 'not-disclosed');
});

test('13F parser decodes XML entities and rejects invalid or ambiguous rows', () => {
  const xml = '<informationTable><infoTable><nameOfIssuer>A &amp; B</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>-1</value><shrsOrPrnAmt><sshPrnamt>5</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>';

  assert.throws(() => parse13FInformationTable(xml), /invalid reported value/i);
  assert.throws(() => parse13FInformationTable('<informationTable><infoTable></informationTable>'), /malformed/i);
});

test('13F identity keeps put/call rows distinct and reports absent baseline as unavailable', () => {
  const current = { positions: [{
    issuerName: 'APPLE INC', classTitle: 'COM', cusip: '037833100', shares: 100,
    reportedValue: 20, putCall: 'PUT', investmentDiscretion: null,
  }] };

  assert.equal(compare13FReports(null, current)[0].change, 'unavailable');
  assert.equal(compare13FReports({ positions: [] }, current)[0].change, 'newly-disclosed');
});

test('13F amendment metadata distinguishes restatement, additive filing, and unknown type', () => {
  assert.deepEqual(parse13FCoverPage('<coverPage><isAmendment>true</isAmendment><amendmentNo>2</amendmentNo><amendmentType>RESTATEMENT</amendmentType></coverPage>'), {
    amendmentNumber: 2,
    amendmentType: 'RESTATEMENT',
  });
  assert.deepEqual(parse13FCoverPage('<coverPage><isAmendment>false</isAmendment></coverPage>'), {
    amendmentNumber: 0,
    amendmentType: null,
  });

  const base = { positions: [{ cusip: '037833100', classTitle: 'COM', shares: 100, putCall: null }] };
  const restatement = { positions: [{ cusip: '037833100', classTitle: 'COM', shares: 80, putCall: null }], amendmentNumber: 1, amendmentType: 'RESTATEMENT' };
  const additive = { positions: [{ cusip: '594918104', classTitle: 'COM', shares: 25, putCall: null }], amendmentNumber: 1, amendmentType: 'ADD NEW HOLDINGS' };
  const unknown = { positions: [], amendmentNumber: 1, amendmentType: 'UNKNOWN' };

  assert.equal(apply13FAmendment(base, restatement).positions[0].shares, 80);
  assert.equal(apply13FAmendment(base, additive).positions.length, 2);
  assert.equal(apply13FAmendment(base, unknown).comparable, false);
});

test('13F additive amendment with a duplicate line identity is not compared', () => {
  const base = { positions: [{ cusip: '037833100', classTitle: 'COM', shares: 100, putCall: null }] };
  const amendment = { positions: [{ cusip: '037833100', classTitle: 'COM', shares: 20, putCall: null }], amendmentNumber: 1, amendmentType: 'ADD NEW HOLDINGS' };

  assert.equal(apply13FAmendment(base, amendment).comparable, false);
});

test('SEC filer lookup keeps filing-agent accession IDs under the queried filer archive CIK', () => {
  assert.equal(normalizeSecCik('12345'), '0000012345');
  assert.throws(() => normalizeSecCik('12345abc'), /invalid .*CIK/i);

  const parsed = parseSec13FSubmissions({
    name: 'Example Capital',
    filings: { recent: {
      form: ['13F-HR', '4', '13F-HR/A'],
      accessionNumber: ['0001193125-26-226661', '0000000001-26-000002', '0001193125-26-352200'],
      filingDate: ['2026-05-14', '2026-05-15', '2026-08-14'],
      reportDate: ['2026-03-31', '', '2026-06-30'],
      primaryDocument: ['primary.xml', 'form4.xml', 'amendment.xml'],
    } },
  }, '0001067983');

  assert.deepEqual(parsed.filings.map(item => item.form), ['13F-HR', '13F-HR/A']);
  assert.equal(parsed.filings[0].reportPeriod, '2026-03-31');
  assert.equal(parsed.filings[0].sourceUrl, 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526226661/');
});

test('SEC 13F primary document preserves a safe basename from the submissions subdirectory', () => {
  const parsed = parseSec13FSubmissions({ filings: { recent: {
    form: ['13F-HR'], accessionNumber: ['0001193125-26-352200'], filingDate: ['2026-08-14'],
    reportDate: ['2026-06-30'], primaryDocument: ['xslForm13F_X02/primary_doc.xml'],
  } } }, '0001067983');
  assert.equal(parsed.filings[0].primaryDocument, 'primary_doc.xml');
});

test('SEC 13F reported value unit follows the January 2023 filing-date rule', () => {
  assert.equal(reportedValueUnitForFilingDate('2023-01-03'), 'usd');
  assert.equal(reportedValueUnitForFilingDate('2026-08-14'), 'usd');
  assert.equal(reportedValueUnitForFilingDate('2022-12-30'), 'thousand-usd');
  assert.equal(reportedValueUnitForFilingDate('unknown'), 'unknown');
});

test('SEC archive URLs scope by filer CIK independently from filing-agent accession prefix', () => {
  assert.equal(buildSec13FArchiveUrl('12345', '0000012345-26-000001', 'infoTable.xml'),
    'https://www.sec.gov/Archives/edgar/data/12345/000001234526000001/infoTable.xml');
  assert.equal(buildSec13FArchiveUrl('1067983', '0001193125-26-226661', '53405.xml'),
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526226661/53405.xml');
  assert.equal(buildSec13FArchiveUrl('12345', '0000012345-26-000001', '../bad.xml'), null);
  assert.equal(buildSec13FArchiveUrl('12345', 'not-an-accession', 'infoTable.xml'), null);
});

test('SEC archive index selects only a validated information-table XML file', () => {
  assert.equal(findSec13FInformationTable({ directory: { item: [
    { name: 'primary_doc.xml', type: 'text/xml' },
    { name: 'infotable.xml', type: 'text/xml' },
    { name: '../unsafe.xml', type: 'text/xml' },
  ] } }), 'infotable.xml');
  assert.equal(findSec13FInformationTable({ directory: { item: [{ name: 'primary_doc.xml' }] } }), null);
});

test('SEC filing loader discovers an opaque XML information table by content', async () => {
  const requests = [];
  const filing = {
    form: '13F-HR', accessionNumber: '0001193125-26-226661', filingDate: '2026-05-15', reportPeriod: '2026-03-31',
    primaryDocument: 'xslForm13F_X02/primary_doc.xml', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526226661/',
  };
  const informationTableXml = '<informationTable><infoTable><nameOfIssuer>ALLY FINL INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>02005N100</cusip><value>498992850</value><shrsOrPrnAmt><sshPrnamt>12719675</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>';
  const coverPageXml = '<coverPage><isAmendment>false</isAmendment></coverPage>';
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.endsWith('/index.json')) return { ok: true, json: async () => ({ directory: { item: [
      { name: 'primary_doc.xml', type: 'text/xml', size: '5555' },
      { name: '53405.xml', type: 'text/xml', size: '45259' },
    ] } }) };
    if (url.endsWith('/53405.xml')) return { ok: true, text: async () => informationTableXml };
    if (url.endsWith('/primary_doc.xml')) return { ok: true, text: async () => coverPageXml };
    throw new Error(`Unexpected SEC URL ${url}`);
  };

  const result = await loadSec13FDocuments('0001067983', filing, fetchImpl);

  assert.equal(result.informationTableXml, informationTableXml);
  assert.equal(result.coverPageXml, coverPageXml);
  assert.equal(result.informationTableUrl, 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526226661/53405.xml');
  assert.equal(result.sourceUrl, filing.sourceUrl);
  assert.deepEqual(requests, [
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526226661/index.json',
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526226661/53405.xml',
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526226661/primary_doc.xml',
  ]);
});

test('SEC text fetch uses identified SEC headers and preserves upstream errors', async () => {
  let request;
  const body = '<informationTable />';
  const result = await fetchSecText('https://www.sec.gov/example.xml', async (url, init) => {
    request = { url, init };
    return { ok: true, text: async () => body };
  });
  assert.equal(result, body);
  assert.equal(request.url, 'https://www.sec.gov/example.xml');
  assert.match(request.init.headers['User-Agent'], /MoneyMoney/i);
  assert.match(request.init.headers.Accept, /xml/i);
  await assert.rejects(fetchSecText('https://www.sec.gov/example.xml', async () => ({
    ok: false,
    status: 403,
    text: async () => '',
  })), /SEC HTTP 403/);
});

test('SEC JSON and XML requests share a conservative request-rate limit', async () => {
  const starts = [];
  const fetchImpl = async url => {
    starts.push(Date.now());
    return { ok: true, json: async () => ({ url }), text: async () => `<xml>${url}</xml>` };
  };

  await fetchSecText('https://www.sec.gov/Archives/example.xml', fetchImpl);
  await fetchSecJson('https://data.sec.gov/submissions/example.json', fetchImpl);

  assert.ok(starts[1] - starts[0] >= 100, `SEC requests were only ${starts[1] - starts[0]}ms apart`);
});

test('guru registry uses canonical filer CIKs and exact CUSIP plus class mappings', () => {
  assert.ok(GURU_MANAGER_REGISTRY.length > 0);
  assert.ok(GURU_MANAGER_REGISTRY.every(item => /^\d{10}$/.test(item.cik)));
  assert.ok(searchGuruManagerRegistry('Berkshire').some(item => item.cik === '0001067983'));
  assert.equal(resolveGuruStockMapping('AAPL', '037833100', 'COM').symbol, 'AAPL');
  assert.equal(resolveGuruStockMapping('AAPL', '037833100', 'PREFERRED'), null);
  assert.equal(resolveGuruStockMapping('UNKNOWN', '037833100', 'COM'), null);
});

test('unmapped hot stocks report the missing SEC identity mapping instead of guessed holders', async () => {
  const service = createGuruHoldingsService({
    repository: { listGuru13FReports: () => [] },
    stateStore: { get: () => null, set() {}, acquireLease: () => true, releaseLease: () => true },
    now: () => new Date('2026-09-29T00:00:00.000Z'),
  });

  const result = await service.getGuruStockHolders('SNDK');

  assert.equal(result.dataStatus, 'unavailable');
  assert.equal(result.mapping, null);
  assert.deepEqual(result.holders, []);
  assert.match(result.reason, /CUSIP.*类别映射/);
});

test('guru snapshots distinguish source-empty, source-failed, and expired cache', async () => {
  const now = new Date('2026-09-29T00:00:00.000Z');
  const emptyState = new Map([['guru13f:manager:0001067983:status', {
    checkedAt: now.toISOString(), dataStatus: 'empty', reason: 'SEC submissions contain no 13F filings',
  }]]);
  const emptyService = createGuruHoldingsService({
    repository: { listGuru13FReports: () => [] },
    stateStore: {
      get: key => emptyState.get(key) || null,
      set: (key, value) => emptyState.set(key, value),
      acquireLease: () => true,
      releaseLease: () => true,
    },
    now: () => now,
  });
  assert.equal((await emptyService.getGuruManagerSnapshot('0001067983')).dataStatus, 'empty');

  const failedState = new Map([['guru13f:manager:0001067983:status', {
    checkedAt: now.toISOString(), dataStatus: 'unavailable', reason: 'SEC HTTP 403',
  }]]);
  const failedService = createGuruHoldingsService({
    repository: { listGuru13FReports: () => [] },
    stateStore: { get: key => failedState.get(key) || null, set: (key, value) => failedState.set(key, value), acquireLease: () => true, releaseLease: () => true },
    now: () => now,
  });
  assert.equal((await failedService.getGuruManagerSnapshot('0001067983')).dataStatus, 'unavailable');

  const staleReport = {
    cik: '0001067983', accession: '0001067983-26-000001', reportPeriod: '2026-03-31', filedAt: '2026-05-14',
    form: '13F-HR', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/',
    fetchedAt: '2026-09-27T22:00:00.000Z', contentHash: 'sha256:fixture', positions: [],
  };
  const staleService = createGuruHoldingsService({
    repository: { listGuru13FReports: () => [staleReport] },
    stateStore: { get: () => null, set() {}, acquireLease: () => true, releaseLease: () => true },
    now: () => now,
  });
  const stale = await staleService.getGuruManagerSnapshot('0001067983');
  assert.equal(stale.dataStatus, 'delayed');
  assert.match(stale.reason, /24|过期|缓存/i);
});

test('stock-centric view preserves prior 13F rows as not-disclosed instead of dropping them', async () => {
  const cik = '0001067983';
  const now = new Date('2026-09-29T00:00:00.000Z');
  const previous = {
    cik, accession: '0001067983-26-000001', reportPeriod: '2026-03-31', filedAt: '2026-05-14', form: '13F-HR',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/',
    informationTableUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/infotable.xml',
    fetchedAt: now.toISOString(), contentHash: 'sha256:older', reportedValueUnit: 'thousand-usd',
    positions: [{ issuerName: 'APPLE INC', classTitle: 'COM', cusip: '037833100', shares: 100, reportedValue: 20, reportedValueUsd: 20_000, putCall: null, investmentDiscretion: 'SOLE' }],
  };
  const current = {
    ...previous,
    accession: '0001067983-26-000002', reportPeriod: '2026-06-30', filedAt: '2026-08-14',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000002/',
    informationTableUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000002/infotable.xml',
    contentHash: 'sha256:newer', positions: [],
  };
  const service = createGuruHoldingsService({
    repository: { listGuru13FReports: () => [current, previous] },
    stateStore: { get: () => null, set() {}, acquireLease: () => true, releaseLease: () => true },
    now: () => now,
  });

  const result = await service.getGuruStockHolders('AAPL', [cik]);

  assert.equal(result.holders.length, 1);
  assert.equal(result.holders[0].change, 'not-disclosed');
  assert.equal(result.holders[0].shares, null);
  assert.equal(result.holders[0].previousShares, 100);
});

test('stored post-2023 13F snapshots are read as dollars even if saved with the legacy thousand-dollar unit', () => {
  const now = new Date('2026-09-29T00:00:00.000Z');
  const legacyReport = {
    cik: '0001067983', accession: '0001193125-26-352200', reportPeriod: '2026-06-30', filedAt: '2026-08-14', form: '13F-HR',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526352200/',
    fetchedAt: now.toISOString(), contentHash: 'sha256:legacy-value-unit', reportedValueUnit: 'thousand-usd',
    positions: [{ issuerName: 'ALLY FINL INC', classTitle: 'COM', cusip: '02005N100', shares: 27_000_000,
      reportedValue: 1_240_650_000, reportedValueUsd: 1_240_650_000_000, putCall: null, investmentDiscretion: 'DEFINED,SOLE', shareAmountType: 'SH' }],
  };
  const service = createGuruHoldingsService({
    repository: { listGuru13FReports: () => [legacyReport] },
    stateStore: { get: () => null, set() {}, acquireLease: () => true, releaseLease: () => true },
    now: () => now,
  });

  const result = service.getGuruManagerSnapshot('0001067983');

  assert.equal(result.latestReport.reportedValueUnit, 'usd');
  assert.equal(result.latestReport.positions[0].reportedValueUsd, 1_240_650_000);
});

test('manager refresh stores only injected SEC evidence, normalizes reported value, and releases its lease', async () => {
  const cik = '0001067983';
  const now = new Date('2026-09-29T00:00:00.000Z');
  const reports = [];
  const states = new Map();
  let leaseReleased = 0;
  const service = createGuruHoldingsService({
    repository: {
      listGuru13FReports: queryCik => reports.filter(report => report.cik === queryCik).sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod)),
      saveGuru13FReport: report => reports.push(report),
    },
    stateStore: {
      get: key => states.get(key) || null,
      set: (key, value) => states.set(key, value),
      acquireLease: () => true,
      releaseLease: () => { leaseReleased += 1; return true; },
    },
    loadSubmissions: async queryCik => ({
      cik: queryCik,
      companyName: 'Berkshire Hathaway Inc.',
      filings: [{
        form: '13F-HR', accessionNumber: `${queryCik}-26-000001`, filingDate: '2026-08-14', reportPeriod: '2026-06-30',
        primaryDocument: 'primary_doc.xml', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/',
      }],
    }),
    loadDocuments: async () => ({
      informationTableXml: '<informationTable><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>125000</value><shrsOrPrnAmt><sshPrnamt>500</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>',
      coverPageXml: '<coverPage><isAmendment>false</isAmendment></coverPage>',
      informationTableUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/infotable.xml',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/',
    }),
    now: () => now,
  });

  const result = await service.refreshGuruManager(cik, true);

  assert.equal(result.dataStatus, 'cached');
  assert.equal(result.latestReport.positions[0].reportedValueUsd, 125_000);
  assert.equal(result.latestReport.reportedValueUnit, 'usd');
  assert.equal(result.latestReport.managerName, 'Berkshire Hathaway Inc.');
  assert.equal(leaseReleased, 1);
});

test('featured SEC refresh continues serially after an individual filer failure', async () => {
  const calls = [];
  const states = new Map();
  let activeRequests = 0;
  let maxConcurrentRequests = 0;
  const service = createGuruHoldingsService({
    repository: { listGuru13FReports: () => [] },
    stateStore: {
      get: key => states.get(key) || null,
      set: (key, value) => states.set(key, value),
      acquireLease: () => true,
      releaseLease: () => true,
    },
    loadSubmissions: async cik => {
      activeRequests += 1;
      maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
      calls.push(cik);
      await Promise.resolve();
      activeRequests -= 1;
      if (cik === GURU_MANAGER_REGISTRY[0].cik) throw new Error('fixture SEC timeout');
      return { cik, companyName: 'Fixture', filings: [] };
    },
    now: () => new Date('2026-09-29T00:00:00.000Z'),
  });

  const snapshots = await service.refreshGuruFeaturedManagers();

  assert.deepEqual(calls, GURU_MANAGER_REGISTRY.map(manager => manager.cik));
  assert.equal(snapshots.length, GURU_MANAGER_REGISTRY.length);
  assert.equal(maxConcurrentRequests, 1);
  assert.equal(snapshots[0].dataStatus, 'unavailable');
  assert.equal(snapshots[1].dataStatus, 'empty');
});
