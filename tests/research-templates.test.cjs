const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
require('ts-node/register/transpile-only');
process.env.MONEYMONEY_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'mm-template-'));
const { listResearchTemplates, getResearchTemplate, checkResearchTemplate, researchTemplateCatalogDigest } = require('../src/features/research-templates');
const { SQLiteStateStore } = require('../src/storage/sqlite-state');
const { ResearchProjectStore } = require('../src/features/research-projects');

const projectInput = { market: 'stocks', title: '因子检验', question: 'q', hypothesis: 'h', counterEvidence: 'c', acceptance: 'a' };

function storeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-template-store-'));
  const state = new SQLiteStateStore(path.join(dir, 'state.sqlite'), dir);
  return { state, store: new ResearchProjectStore(state, () => null), close() { state.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('template catalog is versioned by market', () => {
  assert.ok(listResearchTemplates().length >= 5);
  assert.deepEqual(listResearchTemplates('options').map(row => row.id), ['options-valuation']);
  assert.equal(getResearchTemplate('factor-validation@1').market, 'stocks');
  assert.equal(getResearchTemplate('factor-validation@9'), null);
  assert.match(researchTemplateCatalogDigest(), /^[a-f0-9]{64}$/);
  assert.throws(() => listResearchTemplates('bonds'), /市场/);
});

test('checklist reports missing required items and unknown completions', () => {
  const missing = checkResearchTemplate('factor-validation', ['universe-as-of', 'bogus-item']);
  assert.equal(missing.status, 'missing');
  assert.ok(missing.missing.some(item => item.id === 'industry-evidence'));
  assert.deepEqual(missing.unknownCompleted, ['bogus-item']);
  const ready = checkResearchTemplate('factor-validation', ['universe-as-of', 'industry-evidence', 'factor-observations', 'forward-returns', 'rolling-oos', 'survivorship-note']);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.missing.length, 0);
  assert.throws(() => checkResearchTemplate('not-real', []), /不存在/);
});

test('projects can adopt a compatible template and reject mismatches', () => {
  const fixture = storeFixture();
  try {
    const project = fixture.store.create({ ...projectInput, templateRef: 'factor-validation@1' });
    assert.equal(project.templateRef, 'factor-validation@1');
    assert.equal(fixture.store.read(project.id).templateRef, 'factor-validation@1');
    assert.throws(() => fixture.store.create({ ...projectInput, market: 'options', templateRef: 'factor-validation@1' }), /市场不一致/);
    assert.throws(() => fixture.store.create({ ...projectInput, templateRef: 'missing@1' }), /不存在/);
    assert.throws(() => fixture.store.create({ ...projectInput, templateRef: 42 }), /无效/);
  } finally {
    fixture.close();
  }
});
