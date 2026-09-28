const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-guru-'));
process.env.MONEYMONEY_DATA_DIR = tempRoot;
const { researchRepository, setDbPath } = require('../dist/features/research-repository.js');

test('13F reports persist idempotently and restore after reopening SQLite', () => {
  const dbPath = path.join(tempRoot, 'research.sqlite');
  const older = {
    cik: '0000012345',
    accession: '0000012345-26-000001',
    reportPeriod: '2026-03-31',
    filedAt: '2026-05-14',
    form: '13F-HR',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/12345/000001234526000001/',
    fetchedAt: '2026-05-15T00:00:00.000Z',
    contentHash: 'sha256:older',
    positions: [{ cusip: '037833100', classTitle: 'COM', shares: 100, reportedValue: 20 }],
  };
  const newer = {
    ...older,
    accession: '0000012345-26-000002',
    reportPeriod: '2026-06-30',
    filedAt: '2026-08-14',
    form: '13F-HR/A',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/12345/000001234526000002/',
    fetchedAt: '2026-08-15T00:00:00.000Z',
    contentHash: 'sha256:newer',
  };

  try {
    setDbPath(dbPath);
    researchRepository.saveGuru13FReport(older);
    researchRepository.saveGuru13FReport(newer);
    researchRepository.saveGuru13FReport(newer);

    setDbPath(dbPath);
    assert.deepEqual(researchRepository.getGuru13FReport(older.accession), older);
    assert.deepEqual(researchRepository.getGuru13FReport(newer.accession), newer);
    assert.deepEqual(researchRepository.listGuru13FReports(older.cik, 10).map(report => report.accession), [
      newer.accession,
      older.accession,
    ]);
    assert.deepEqual(researchRepository.listGuru13FReports('0000099999', 10), []);
  } finally {
    researchRepository.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
