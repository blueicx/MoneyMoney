const test = require('node:test');
const assert = require('node:assert/strict');
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
  fetchSecText,
} = require('../dist/features/sec-edgar-client.js');

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
  }]);
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

test('SEC filer lookup normalizes CIK and keeps only 13F reports', () => {
  assert.equal(normalizeSecCik('12345'), '0000012345');
  assert.throws(() => normalizeSecCik('12345abc'), /invalid .*CIK/i);

  const parsed = parseSec13FSubmissions({
    name: 'Example Capital',
    filings: { recent: {
      form: ['13F-HR', '4', '13F-HR/A'],
      accessionNumber: ['0000000001-26-000001', '0000000001-26-000002', '0000000001-26-000003'],
      filingDate: ['2026-05-14', '2026-05-15', '2026-08-14'],
      reportDate: ['2026-03-31', '', '2026-06-30'],
      primaryDocument: ['primary.xml', 'form4.xml', 'amendment.xml'],
    } },
  });

  assert.deepEqual(parsed.filings.map(item => item.form), ['13F-HR', '13F-HR/A']);
  assert.equal(parsed.filings[0].reportPeriod, '2026-03-31');
});

test('SEC archive URLs require a safe accession and XML basename', () => {
  assert.equal(buildSec13FArchiveUrl('12345', '0000012345-26-000001', 'infoTable.xml'),
    'https://www.sec.gov/Archives/edgar/data/12345/000001234526000001/infoTable.xml');
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
